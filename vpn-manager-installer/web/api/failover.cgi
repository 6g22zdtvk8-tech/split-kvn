#!/bin/sh
# =============================================================================
# VPN Failover API
# - GET  /failover.cgi/status   → mode, interval, daemon state, last check
# - GET  /failover.cgi/intervals → available interval values for UI dropdown
# - POST /failover.cgi/settings → update mode + interval (also reschedules cron)
# - POST /failover.cgi/check    → trigger failover daemon synchronously
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

# Auth
if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

SETTINGS_FILE="$VPN_MANAGER_HOME/settings.json"
# The daemon keeps its state in RAM and copies it to the drive once a day;
# right after a reboot, before the first check, only the drive copy exists
STATE_FILE="/tmp/vpn-manager/failover-state.json"
[ -s "$STATE_FILE" ] || STATE_FILE="$VPN_MANAGER_HOME/failover-state.json"
DAEMON_SCRIPT="$VPN_MANAGER_HOME/scripts/failover-daemon.sh"
CRONTAB_FILE="/opt/var/spool/cron/crontabs/root"

# Default values
DEFAULT_MODE="off"
DEFAULT_INTERVAL=300

# Allowed intervals (seconds) — must match frontend dropdown
ALLOWED_INTERVALS="30 60 180 300 600 1200 1800 3600 7200 21600 43200 86400"

# Read setting with default
read_setting_or() {
    local key="$1" def="$2"
    if [ -s "$SETTINGS_FILE" ]; then
        local v=$(jq -r ".$key // empty" "$SETTINGS_FILE" 2>/dev/null)
        [ -n "$v" ] && echo "$v" || echo "$def"
    else
        echo "$def"
    fi
}

# Validate mode
is_valid_mode() {
    case "$1" in
        off|subscription|all) return 0 ;;
        *) return 1 ;;
    esac
}

# Validate interval against allowed list
is_valid_interval() {
    local v="$1"
    for x in $ALLOWED_INTERVALS; do
        [ "$v" = "$x" ] && return 0
    done
    return 1
}

# Build cron expression for given interval (seconds).
# Cron has minute granularity — round up to the nearest reasonable interval
# and convert to a cron expression.
build_cron_expr() {
    local sec="$1"
    case "$sec" in
        30)    echo "* * * * *" ;;          # 30s: best we can do is every minute
        60)    echo "* * * * *" ;;          # 1min
        180)   echo "*/3 * * * *" ;;        # 3min
        300)   echo "*/5 * * * *" ;;        # 5min
        600)   echo "*/10 * * * *" ;;       # 10min
        1200)  echo "*/20 * * * *" ;;       # 20min
        1800)  echo "*/30 * * * *" ;;       # 30min
        3600)  echo "0 * * * *" ;;          # 1h
        7200)  echo "0 */2 * * *" ;;        # 2h
        21600) echo "0 */6 * * *" ;;        # 6h
        43200) echo "0 */12 * * *" ;;       # 12h
        86400) echo "0 4 * * *" ;;          # 24h, at 04:00
        *)     echo "*/5 * * * *" ;;
    esac
}

# Update cron job: remove old failover line, add new if mode != off
update_cron() {
    local mode="$1" interval="$2"
    
    mkdir -p "$(dirname "$CRONTAB_FILE")"
    touch "$CRONTAB_FILE"
    
    # Remove any existing failover-daemon line
    local tmp=$(mktemp)
    grep -v 'failover-daemon.sh' "$CRONTAB_FILE" > "$tmp" 2>/dev/null
    mv "$tmp" "$CRONTAB_FILE"
    
    # Add new line if mode is active
    if [ "$mode" != "off" ] && [ -x "$DAEMON_SCRIPT" ]; then
        local expr=$(build_cron_expr "$interval")
        echo "$expr $DAEMON_SCRIPT check >/dev/null 2>&1" >> "$CRONTAB_FILE"
    fi
    
    chmod 600 "$CRONTAB_FILE"
    /opt/etc/init.d/S10cron restart >/dev/null 2>&1 || true
}

get_status() {
    local mode=$(read_setting_or "failover_mode" "$DEFAULT_MODE")
    local interval=$(read_setting_or "failover_check_interval" "$DEFAULT_INTERVAL")
    
    # Validate state
    is_valid_mode "$mode" || mode="$DEFAULT_MODE"
    is_valid_interval "$interval" || interval="$DEFAULT_INTERVAL"
    
    # Read daemon state
    local daemon_state="{}"
    [ -s "$STATE_FILE" ] && jq empty "$STATE_FILE" 2>/dev/null && daemon_state=$(cat "$STATE_FILE")
    
    # Active config
    local active_id=""
    [ -f "$VPN_MANAGER_HOME/active-config" ] && active_id=$(cat "$VPN_MANAGER_HOME/active-config" 2>/dev/null | tr -d '\n\r ')
    
    # Cron presence (whether scheduling is actually in place)
    local cron_active="false"
    if [ -f "$CRONTAB_FILE" ] && grep -q 'failover-daemon.sh' "$CRONTAB_FILE" 2>/dev/null; then
        cron_active="true"
    fi
    
    jq -n \
        --arg mode "$mode" \
        --argjson interval "$interval" \
        --argjson state "$daemon_state" \
        --arg active "$active_id" \
        --argjson cron_active "$cron_active" \
        --arg intervals "$ALLOWED_INTERVALS" \
        '{
            mode: $mode,
            check_interval: $interval,
            cron_active: $cron_active,
            active_config: (if $active == "" then null else $active end),
            available_intervals: ($intervals | split(" ") | map(tonumber)),
            daemon_state: $state
        }'
}

save_settings() {
    local mode="$1" interval="$2"
    
    if ! is_valid_mode "$mode"; then
        json_error "errors.invalidValue" 400
        return
    fi
    if ! is_valid_interval "$interval"; then
        json_error "errors.invalidInterval" 400
        return
    fi
    
    # Make sure settings.json exists and is valid
    if [ ! -s "$SETTINGS_FILE" ] || ! jq empty "$SETTINGS_FILE" 2>/dev/null; then
        echo '{}' > "$SETTINGS_FILE"
        chmod 644 "$SETTINGS_FILE"
    fi
    
    local tmp=$(mktemp)
    jq --arg m "$mode" --argjson i "$interval" \
        '.failover_mode = $m | .failover_check_interval = $i' \
        "$SETTINGS_FILE" > "$tmp" 2>/dev/null
    
    if [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null; then
        mv "$tmp" "$SETTINGS_FILE"
    else
        rm -f "$tmp"
        json_error "errors.settingsSave" 500
        return
    fi
    
    update_cron "$mode" "$interval"
    log_action "FAILOVER_SETTINGS" "mode=$mode interval=$interval"
    
    json_success "{\"mode\":\"$mode\",\"check_interval\":$interval}"
}

trigger_check() {
    if [ ! -x "$DAEMON_SCRIPT" ]; then
        json_error "errors.daemonMissing" 500
        return
    fi
    
    log_action "FAILOVER_MANUAL_CHECK" "Triggered from UI"
    # Manual mode: probe regardless of failover_mode setting (no switch when off).
    # Run synchronously so that get_status() below sees fresh state.
    "$DAEMON_SCRIPT" manual >/dev/null 2>&1
    
    json_response "$(get_status)"
}

# Routing
ACTION=$(echo "$PATH_INFO" | sed 's|^/||' | cut -d'/' -f1)

case "$REQUEST_METHOD" in
    GET)
        case "$ACTION" in
            ""|status)
                json_response "$(get_status)"
                ;;
            *)
                json_error "Unknown action: $ACTION" 404
                ;;
        esac
        ;;
    POST)
        POST_DATA=$(read_post_data)
        case "$ACTION" in
            settings)
                MODE=$(echo "$POST_DATA" | jq -r '.mode // empty')
                INTERVAL=$(echo "$POST_DATA" | jq -r '.check_interval // empty')
                save_settings "$MODE" "$INTERVAL"
                ;;
            check)
                trigger_check
                ;;
            *)
                json_error "Unknown action: $ACTION" 404
                ;;
        esac
        ;;
    *)
        json_error "Method not allowed" 405
        ;;
esac
