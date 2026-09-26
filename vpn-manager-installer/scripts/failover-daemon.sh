#!/bin/sh
# VPN failover daemon (FEAT: автопереключение конфигов при недоступности VPN)
# Runs from cron at user-configured interval.
# Two-step health check:
#   1) TCP reachability of the active VPN server (direct, via ISP)
#   2) parallel HTTP via SOCKS5 inbound (127.0.0.1:2080) → real tunnel health
# If unhealthy: rotate to next candidate config (mode-aware), with TTL/cooldown
# protections to avoid rapid cycling when many servers are down at once.
#
# All logging via syslog (tag: vpn-failover).

export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

VPN_MANAGER_HOME="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}"
SETTINGS_FILE="$VPN_MANAGER_HOME/settings.json"
ACTIVE_CONFIG_FILE="$VPN_MANAGER_HOME/active-config"
VPN_CONFIGS_DIR="$VPN_MANAGER_HOME/configs"
# Live state in RAM: every check rewrites it, and on the drive that wore the flash.
# The drive keeps a copy for a reboot, refreshed at most once a day.
STATE_FILE="/tmp/vpn-manager/failover-state.json"
STATE_FLASH="$VPN_MANAGER_HOME/failover-state.json"
STATE_PERSIST_MIN=1440
LOCK_FILE="/tmp/vpn-failover.lock"
SINGBOX_CONFIG="/opt/etc/sing-box/config.json"
SINGBOX_INIT="/opt/etc/init.d/S99sing-box"
SINGBOX_RULES_INIT="/opt/etc/init.d/S98singbox-rules"

# Tunables (NOT user-configurable; intentional defaults)
FAILED_TTL_SEC=600         # don't retry a failed server for 10 minutes
FULL_CYCLE_COOLDOWN=300    # if all servers are fresh-failed, wait 5 min before resetting
MAX_HISTORY=10
# Cascade cap is computed dynamically per-run from the candidate pool size
# (see run_check) — no artificial upper bound. The pool already reflects the
# user's policy (mode=subscription → siblings only; mode=all → every config),
# so capping it would silently ignore configs the user explicitly opted in.
# Worst-case duration is bounded by SINGBOX_SETTLE_WAIT + FAST_POST_SWITCH_WAIT
# + FAST_PROBE_MAX_TIME (~10s) per failed attempt × pool size.

# Probing the *currently active* config — be lenient: any failure must be confirmed
# multiple times to avoid switching on transient glitches (Wi-Fi blip, DNS hiccup).
PROBE_MAX_TIME=8           # per-URL HTTP timeout for the active-config check
HEALTH_CONFIRM_RETRIES=2   # consecutive failures required before declaring active unhealthy
HEALTH_CONFIRM_DELAY=5     # seconds between confirmation retries

# Probing a *freshly-switched candidate* during cascade — be quick: if it doesn't
# answer within a few seconds of being activated, treat it as dead and try the next.
# Total per failed cascade attempt ≈ 3s (restart+settle) + FAST_POST_SWITCH_WAIT + FAST_PROBE_MAX_TIME.
FAST_POST_SWITCH_WAIT=5    # wait after switching before probing the candidate
FAST_PROBE_MAX_TIME=5      # per-URL HTTP timeout while cascading
SINGBOX_SETTLE_WAIT=1      # short pause after sing-box restart before any probe

log() {
    logger -t vpn-failover "$1"
    [ -t 1 ] && echo "[$(date '+%H:%M:%S')] $1"
}

# Lock to avoid concurrent runs (multiple cron triggers, manual + cron, etc.)
acquire_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
            log "Another daemon run in progress (pid=$pid), skipping"
            exit 0
        fi
    fi
    echo $$ > "$LOCK_FILE"
}

release_lock() {
    rm -f "$LOCK_FILE"
}

trap release_lock EXIT INT TERM

now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
now_epoch() { date +%s; }

# ---- Settings ----
read_setting() {
    local key="$1" default="$2"
    if [ -s "$SETTINGS_FILE" ]; then
        local val=$(jq -r ".$key // empty" "$SETTINGS_FILE" 2>/dev/null)
        [ -n "$val" ] && echo "$val" || echo "$default"
    else
        echo "$default"
    fi
}

# ---- State (JSON file) ----
init_state() {
    mkdir -p "$(dirname "$STATE_FILE")"
    if [ ! -s "$STATE_FILE" ] || ! jq empty "$STATE_FILE" 2>/dev/null; then
        # After a reboot (or the first run of this version): carry on from the drive copy
        if [ -s "$STATE_FLASH" ] && jq empty "$STATE_FLASH" 2>/dev/null; then
            cp "$STATE_FLASH" "$STATE_FILE"
        else
            echo '{"failed_servers":{},"switches":[],"last_check_at":null,"last_check_result":null,"last_full_cycle_at":null}' > "$STATE_FILE"
        fi
    fi
}

# Copy the RAM state to the drive: at most once a day, and only when it changed
persist_state() {
    [ -s "$STATE_FILE" ] && jq empty "$STATE_FILE" 2>/dev/null || return 0
    if [ -f "$STATE_FLASH" ]; then
        local age_min=$(( ( $(date +%s) - $(date -r "$STATE_FLASH" +%s 2>/dev/null || echo 0) ) / 60 ))
        [ "$age_min" -ge "$STATE_PERSIST_MIN" ] || return 0
        cmp -s "$STATE_FILE" "$STATE_FLASH" && return 0
    fi
    cp "$STATE_FILE" "$STATE_FLASH.tmp" && mv "$STATE_FLASH.tmp" "$STATE_FLASH"
}

state_set() {
    local key="$1" value="$2"
    init_state
    local tmp=$(mktemp)
    jq --argjson v "$value" ".${key} = \$v" "$STATE_FILE" > "$tmp" 2>/dev/null
    [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null && mv "$tmp" "$STATE_FILE" || rm -f "$tmp"
}

state_set_str() {
    local key="$1" value="$2"
    init_state
    local tmp=$(mktemp)
    jq --arg v "$value" ".${key} = \$v" "$STATE_FILE" > "$tmp" 2>/dev/null
    [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null && mv "$tmp" "$STATE_FILE" || rm -f "$tmp"
}

mark_failed() {
    local id="$1"
    init_state
    local now=$(now_iso)
    local tmp=$(mktemp)
    jq --arg id "$id" --arg ts "$now" '.failed_servers[$id] = $ts' "$STATE_FILE" > "$tmp" 2>/dev/null
    [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null && mv "$tmp" "$STATE_FILE" || rm -f "$tmp"
}

clear_failed() {
    local id="$1"
    init_state
    local tmp=$(mktemp)
    jq --arg id "$id" 'del(.failed_servers[$id])' "$STATE_FILE" > "$tmp" 2>/dev/null
    [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null && mv "$tmp" "$STATE_FILE" || rm -f "$tmp"
}

reset_failed_all() {
    init_state
    local tmp=$(mktemp)
    jq '.failed_servers = {}' "$STATE_FILE" > "$tmp" 2>/dev/null
    [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null && mv "$tmp" "$STATE_FILE" || rm -f "$tmp"
}

# GC: drop failed_servers entries older than 2×TTL — they're already irrelevant
# for selection logic and would otherwise accumulate forever in the JSON file.
gc_state() {
    init_state
    local now_e=$(now_epoch)
    local cutoff=$((now_e - FAILED_TTL_SEC * 2))
    local tmp=$(mktemp)
    jq --argjson cutoff "$cutoff" '
        .failed_servers = (
            (.failed_servers // {}) | to_entries
            | map(select(
                (.value | sub("Z$";"") | sub("T";" ") | strptime("%Y-%m-%d %H:%M:%S") | mktime) > $cutoff
            ))
            | from_entries
        )
    ' "$STATE_FILE" > "$tmp" 2>/dev/null
    if [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null; then
        mv "$tmp" "$STATE_FILE"
    else
        # Fallback (no strptime on busybox jq): rebuild map keeping last 50 entries
        rm -f "$tmp"
        tmp=$(mktemp)
        jq '
            .failed_servers = (
                (.failed_servers // {}) | to_entries
                | sort_by(.value) | reverse | .[0:50]
                | from_entries
            )
        ' "$STATE_FILE" > "$tmp" 2>/dev/null
        [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null && mv "$tmp" "$STATE_FILE" || rm -f "$tmp"
    fi
}

# Append a switch event; keep only MAX_HISTORY most recent.
# Also stores resolved human-readable labels so the UI can show
# "MyServer (1.2.3.4:443)" instead of the raw internal id.
record_switch() {
    local from="$1" to="$2" reason="$3"
    init_state
    local now=$(now_iso)
    local from_label=$(config_label "$from")
    local to_label=$(config_label "$to")
    local tmp=$(mktemp)
    jq --arg at "$now" \
       --arg from "$from" --arg to "$to" \
       --arg from_label "$from_label" --arg to_label "$to_label" \
       --arg reason "$reason" --argjson max "$MAX_HISTORY" \
        '.switches = ([{at:$at, from:$from, to:$to, from_label:$from_label, to_label:$to_label, reason:$reason}] + (.switches // [])) | .switches = (.switches[0:$max])' \
        "$STATE_FILE" > "$tmp" 2>/dev/null
    [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null && mv "$tmp" "$STATE_FILE" || rm -f "$tmp"
}

# Convert ISO8601 (UTC) to epoch
iso_to_epoch() {
    local iso="$1"
    [ -z "$iso" ] && echo 0 && return
    # Try GNU date first, then BusyBox-compatible parsing
    local e=$(date -u -d "$iso" +%s 2>/dev/null)
    if [ -z "$e" ] || [ "$e" = "0" ]; then
        # BusyBox: strip the trailing Z, replace T with space
        local s=$(echo "$iso" | sed 's/T/ /; s/Z$//')
        e=$(date -u -d "$s" +%s 2>/dev/null)
    fi
    echo "${e:-0}"
}

# Human-readable label for a config id, for log messages and switch history.
# Format: "<name> (<server>:<port>)" with fallback to "<id>" when fields missing.
config_label() {
    local id="$1"
    local cfg="$VPN_CONFIGS_DIR/${id}.json"
    if [ ! -f "$cfg" ]; then
        echo "$id"
        return
    fi
    local label=$(jq -r '
        (.name // .id // empty) as $n
        | (.server // empty) as $s
        | (.server_port // empty) as $p
        | if ($n == "") then $s
          elif $s == "" then $n
          elif $p == "" then "\($n) (\($s))"
          else "\($n) (\($s):\($p))"
          end
    ' "$cfg" 2>/dev/null)
    if [ -z "$label" ] || [ "$label" = "null" ]; then
        echo "$id"
    else
        echo "$label"
    fi
}

# ---- Health check ----
# HTTP-via-VPN probe: the only reliable end-to-end check.
# Issues N parallel curl requests through the SOCKS5 inbound (`health-check-in`),
# which sing-box routes via the active VPN outbound. First successful 2xx wins.
#
# This single probe verifies all of: (a) sing-box up, (b) tunnel up,
# (c) DNS through tunnel works, (d) tunnel egress reaches the public Internet.
#
# We intentionally DO NOT do a separate TCP probe to the VPN server itself —
# busybox `nc` on Keenetic strips `-z`/`-w` flags, and direct curl to the
# VPN endpoint can hairpin through the tunnel (false negatives). The HTTP probe
# below is sufficient to decide "switch or stay".
# probe_http_via_vpn [max_time]
# Optional arg: per-URL curl --max-time. Defaults to PROBE_MAX_TIME.
probe_http_via_vpn() {
    local max_time="${1:-$PROBE_MAX_TIME}"
    local connect_timeout=$max_time
    [ "$connect_timeout" -gt 5 ] && connect_timeout=5
    
    local tmp_dir=$(mktemp -d)
    local urls="https://www.gstatic.com/generate_204 https://connectivitycheck.gstatic.com/generate_204 http://captive.apple.com/hotspot-detect.html https://www.msftconnecttest.com/connecttest.txt"
    local pids=""
    local i=0
    local results=""
    
    for url in $urls; do
        i=$((i + 1))
        (
            local code
            code=$(curl --socks5-hostname 127.0.0.1:2080 -s -o /dev/null \
                        --connect-timeout "$connect_timeout" --max-time "$max_time" \
                        -w "%{http_code}" "$url" 2>/dev/null)
            case "$code" in
                2*) echo "ok:$code" > "$tmp_dir/r$i" ;;
                *)  echo "fail:$code" > "$tmp_dir/r$i" ;;
            esac
        ) &
        pids="$pids $!"
    done
    
    # Early-exit poll: as soon as ANY probe writes ok:* we kill remaining children
    # and return success. Saves up to (max_time - first_response_time) seconds per probe.
    local deadline=$(( $(date +%s) + max_time + 1 ))
    local found_ok=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
        for r in "$tmp_dir"/r*; do
            [ -f "$r" ] || continue
            case "$(cat "$r" 2>/dev/null)" in
                ok:*) found_ok=1 ; break 2 ;;
            esac
        done
        sleep 1
    done
    
    if [ "$found_ok" -eq 1 ]; then
        for pid in $pids; do kill "$pid" 2>/dev/null; done
        rm -rf "$tmp_dir"
        return 0
    fi
    
    # No early-ok — wait for any stragglers so we can collect all results for logging
    for pid in $pids; do
        wait "$pid" 2>/dev/null
    done
    
    local result=1
    for r in "$tmp_dir"/r*; do
        [ -f "$r" ] || continue
        local v=$(cat "$r")
        results="$results $v"
        case "$v" in
            ok:*) result=0 ;;
        esac
    done
    rm -rf "$tmp_dir"
    
    # Verbose per-URL log only on failure (avoids syslog spam on healthy paths)
    if [ "$result" -ne 0 ]; then
        log "HTTP-via-VPN FAIL (max_time=${max_time}s) — per-URL:$results"
    fi
    return $result
}

# Quick health check used during cascade — single probe, no confirmation retries.
# A freshly-switched candidate that doesn't respond within a few seconds is treated
# as dead, so we move on quickly instead of burning ~30s on retries.
check_health_fast() {
    probe_http_via_vpn "$FAST_PROBE_MAX_TIME"
}

check_health_for_active() {
    local active_id="$1"
    local cfg="$VPN_CONFIGS_DIR/${active_id}.json"
    [ ! -f "$cfg" ] && return 1
    
    # First probe: succeed → done.
    if probe_http_via_vpn; then
        return 0
    fi
    
    # First probe failed. Confirm with up to N retries before declaring unhealthy.
    # Avoids switching due to transient network glitches.
    local i=1
    while [ $i -le $HEALTH_CONFIRM_RETRIES ]; do
        sleep "$HEALTH_CONFIRM_DELAY"
        log "Health probe confirm retry $i/$HEALTH_CONFIRM_RETRIES for $active_id"
        if probe_http_via_vpn; then
            log "Health probe RECOVERED for $active_id on retry $i"
            return 0
        fi
        i=$((i + 1))
    done
    
    log "Health probe FAILED (all retries) for $active_id"
    return 1
}

# ---- Candidate selection ----
# List candidate config IDs based on failover mode.
# - subscription: only configs that share .subscription_id with the current active config
# - all: every config in $VPN_CONFIGS_DIR
list_candidates() {
    local active_id="$1" mode="$2"
    local active_cfg="$VPN_CONFIGS_DIR/${active_id}.json"
    local active_sub_id=""
    [ -f "$active_cfg" ] && active_sub_id=$(jq -r '.subscription_id // empty' "$active_cfg" 2>/dev/null)
    
    for f in "$VPN_CONFIGS_DIR"/*.json; do
        [ -f "$f" ] || continue
        local id=$(jq -r '.id // empty' "$f" 2>/dev/null)
        [ -z "$id" ] && continue
        
        if [ "$mode" = "subscription" ]; then
            local sub=$(jq -r '.subscription_id // empty' "$f" 2>/dev/null)
            [ "$sub" != "$active_sub_id" ] && continue
            [ -z "$active_sub_id" ] && continue
        fi
        echo "$id"
    done
}

# Pick next candidate that is not the current active and not in fresh-failed set
pick_next_candidate() {
    local active_id="$1" mode="$2"
    
    init_state
    local now_e=$(now_epoch)
    local all=$(list_candidates "$active_id" "$mode")
    
    # First pass: skip current and fresh-failed
    for id in $all; do
        [ "$id" = "$active_id" ] && continue
        local failed_at=$(jq -r --arg id "$id" '.failed_servers[$id] // empty' "$STATE_FILE" 2>/dev/null)
        if [ -n "$failed_at" ]; then
            local fe=$(iso_to_epoch "$failed_at")
            local age=$((now_e - fe))
            [ "$age" -lt "$FAILED_TTL_SEC" ] && continue
        fi
        echo "$id"
        return 0
    done
    
    # Everyone is in fresh-failed → check cooldown for full cycle reset
    local last_cycle=$(jq -r '.last_full_cycle_at // empty' "$STATE_FILE" 2>/dev/null)
    if [ -n "$last_cycle" ]; then
        local le=$(iso_to_epoch "$last_cycle")
        local age=$((now_e - le))
        if [ "$age" -lt "$FULL_CYCLE_COOLDOWN" ]; then
            log "All candidates in fresh-failed set, cooldown active (age=${age}s < ${FULL_CYCLE_COOLDOWN}s) — staying on $active_id"
            return 1
        fi
    fi
    
    # Cooldown expired (or never set): reset failed list and pick anything but active
    log "All candidates fresh-failed, cooldown expired — resetting and starting new cycle"
    reset_failed_all
    state_set_str "last_full_cycle_at" "$(now_iso)"
    
    for id in $all; do
        [ "$id" = "$active_id" ] && continue
        echo "$id"
        return 0
    done
    
    return 1
}

# ---- Switch ----
# Apply config + restart sing-box. Requires common.sh (sourced once at startup if available).
# Args:
#   $1 = config_id
#   $2 = "fast" → skip the iptables/ipset reapply step.
#                  Safe during cascade: routing rules don't depend on which
#                  sing-box outbound is active (they always point traffic at
#                  the TUN/TPROXY inbound, sing-box internally selects egress
#                  by tag — and we just rewrote that tag in apply_singbox_outbound).
apply_config_and_restart() {
    local config_id="$1"
    local mode="${2:-full}"
    local cfg="$VPN_CONFIGS_DIR/${config_id}.json"
    [ ! -f "$cfg" ] && return 1
    
    if ! command -v apply_singbox_outbound >/dev/null 2>&1; then
        log "ERROR: apply_singbox_outbound function not available"
        return 1
    fi
    
    if ! apply_singbox_outbound "$cfg" "vpn"; then
        log "Failed to apply config $config_id"
        return 1
    fi
    
    echo "$config_id" > "$ACTIVE_CONFIG_FILE"
    
    if [ -x "$SINGBOX_INIT" ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
    fi
    sleep "$SINGBOX_SETTLE_WAIT"
    
    if [ "$mode" != "fast" ]; then
        # Reapply iptables rules (no warmup, fast). Skipped during cascade.
        if [ -x "$SINGBOX_RULES_INIT" ]; then
            SKIP_WARMUP=1 "$SINGBOX_RULES_INIT" start 0 >/dev/null 2>&1
        fi
    fi
    
    return 0
}

# ---- Main ----
# Args:
#   $1 = "manual" → user-triggered: always run probes & update state, even if mode=off.
#                  Switching still gated by mode (no switch when off).
#   anything else → cron path: skip entirely when mode=off (no-op for efficiency).
run_check() {
    local manual="${1:-auto}"
    local mode=$(read_setting "failover_mode" "off")
    local can_switch="true"

    # Several connections: sing-box itself moves traffic to a live server,
    # a second switcher would only fight it
    if jq -e '.mode == "multi"' "$VPN_MANAGER_HOME/multi.json" >/dev/null 2>&1; then
        [ "$manual" = "manual" ] && log "Multi mode is on — sing-box handles failover, nothing to do"
        return 0
    fi
    
    if [ "$mode" = "off" ]; then
        if [ "$manual" != "manual" ]; then
            # Silent exit on auto-run when off (cron noise reduction)
            return 0
        fi
        log "Manual check requested while mode=off — probing only, will not switch"
        can_switch="false"
    elif [ "$mode" != "subscription" ] && [ "$mode" != "all" ]; then
        log "Unknown failover_mode=$mode, treating as off"
        return 0
    fi
    
    # Garbage-collect aged-out failed_servers entries
    gc_state
    
    local active_id=""
    [ -f "$ACTIVE_CONFIG_FILE" ] && active_id=$(cat "$ACTIVE_CONFIG_FILE" 2>/dev/null | tr -d '\n\r ')
    
    # Read previous result before overwriting — used for transition-only logging
    local prev_result=""
    [ -s "$STATE_FILE" ] && prev_result=$(jq -r '.last_check_result // empty' "$STATE_FILE" 2>/dev/null)
    
    state_set_str "last_check_at" "$(now_iso)"
    
    if [ -z "$active_id" ]; then
        [ "$prev_result" != "no-active" ] && log "No active config — nothing to check"
        state_set_str "last_check_result" "no-active"
        return 0
    fi
    
    if check_health_for_active "$active_id"; then
        # Log only on recovery (avoid hourly noise when everything works)
        if [ "$prev_result" != "ok" ]; then
            log "Active config $active_id is healthy (mode=$mode)"
        fi
        state_set_str "last_check_result" "ok"
        clear_failed "$active_id"
        return 0
    fi
    
    state_set_str "last_check_result" "failed"
    log "Active config $(config_label "$active_id") [$active_id] unhealthy (mode=$mode, manual=$manual)"
    
    if [ "$can_switch" != "true" ]; then
        log "Active config unhealthy, but failover is off — not switching"
        return 0
    fi
    
    mark_failed "$active_id"
    
    # Cascade switching: if the picked candidate is also unhealthy, immediately try the next one
    # within the same daemon run, rather than waiting for the next cron tick.
    #
    # The cap is the actual candidate pool size (minus 1 for the active config itself,
    # which is in the list but never re-picked). The pool reflects the user's policy:
    #   mode=subscription → siblings of the active config (same subscription_id)
    #   mode=all          → every config under $VPN_CONFIGS_DIR
    # No artificial upper bound — if the user has 50 configs in scope, we'll try up to 49.
    local candidate_count
    candidate_count=$(list_candidates "$active_id" "$mode" | grep -c .)
    local max_attempts=$((candidate_count - 1))
    if [ "$max_attempts" -lt 1 ]; then
        log "No alternative candidates in mode=$mode (pool=$candidate_count) — staying on $(config_label "$active_id")"
        return 1
    fi
    log "Cascade cap for this run: $max_attempts (mode=$mode, candidate pool=$candidate_count)"
    
    local origin_id="$active_id"
    local current_id="$active_id"
    local attempt=1
    while [ "$attempt" -le "$max_attempts" ]; do
        local next_id
        next_id=$(pick_next_candidate "$current_id" "$mode")
        if [ -z "$next_id" ]; then
            log "No usable candidate found (attempt $attempt) — staying on $(config_label "$current_id")"
            return 1
        fi
        
        log "Switching (attempt $attempt/$max_attempts): $(config_label "$current_id") → $(config_label "$next_id")"
        # Use fast mode: skip iptables/ipset reapply (rules already in place from boot
        # and don't depend on which outbound is active). Saves ~1-2s per attempt.
        if ! apply_config_and_restart "$next_id" "fast"; then
            log "Switch to $(config_label "$next_id") failed (apply error) — aborting cascade"
            # Don't blacklist next_id — apply error is a local issue, not a network one.
            return 1
        fi
        
        sleep "$FAST_POST_SWITCH_WAIT"
        
        # Use fast probe (single attempt, short timeout) for cascade — if a freshly-
        # switched candidate doesn't answer quickly, it's not worth waiting for retries.
        if check_health_fast; then
            log "Switch successful: $(config_label "$next_id") is healthy"
            clear_failed "$next_id"
            # Update last_check_result so the UI reflects the actual outcome
            # (cascade succeeded → current state is healthy, not "failed").
            state_set_str "last_check_result" "ok"
            local reason="active config unhealthy"
            [ "$attempt" -gt 1 ] && reason="cascade: $((attempt - 1)) candidate(s) also failed"
            record_switch "$origin_id" "$next_id" "$reason"
            return 0
        fi
        
        # Candidate also unhealthy → mark failed and immediately try the next one.
        log "Candidate $(config_label "$next_id") also unhealthy (attempt $attempt) — trying next"
        mark_failed "$next_id"
        current_id="$next_id"
        attempt=$((attempt + 1))
    done
    
    log "Cascade exhausted after $max_attempts attempts — last tried: $(config_label "$current_id"). Will retry on next run."
    record_switch "$origin_id" "$current_id" "cascade exhausted ($max_attempts attempts, all failed)"
    return 1
}

# ---- Entrypoint ----
main() {
    if [ ! -f "$SETTINGS_FILE" ]; then
        log "settings.json missing — exiting"
        exit 0
    fi
    
    # Source common.sh for apply_singbox_outbound and friends
    for path in "/opt/share/www/vpn-manager/api/common.sh" \
                "/opt/etc/vpn-manager/web/api/common.sh" \
                "/opt/vpn-manager-installer/web/api/common.sh"; do
        if [ -f "$path" ]; then
            cd "$(dirname "$path")"
            . "$path"
            break
        fi
    done
    
    acquire_lock
    init_state
    
    case "$1" in
        check|"") run_check "auto"; persist_state ;;
        manual)   run_check "manual"; persist_state ;;
        status)
            [ -f "$STATE_FILE" ] && cat "$STATE_FILE" || echo '{}'
            ;;
        *)
            echo "Usage: $0 {check|manual|status}"
            exit 1
            ;;
    esac
}

main "$@"
