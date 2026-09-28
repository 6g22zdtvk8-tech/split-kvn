#!/bin/sh
# Common functions for VPN Manager CGI scripts
# Integration with sing-box

# PATH for CGI environment (lighttpd doesn't set PATH)
export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"

# ============================================
# Directories
# ============================================
VPN_MANAGER_HOME="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}"
VPN_CONFIGS_DIR="$VPN_MANAGER_HOME/configs"
VPN_LOG_DIR="/opt/var/log/vpn-manager"
SESSION_DIR="/opt/etc/vpn-manager/sessions"  # on the flash: sessions survive a reboot
SESSION_TTL=2592000  # a session lives 30 days from its last use

# ============================================
# sing-box files
# ============================================
SINGBOX_CONFIG="/opt/etc/sing-box/config.json"
SINGBOX_INIT="/opt/etc/init.d/S99sing-box"
SINGBOX_RULES_INIT="/opt/etc/init.d/S98singbox-rules"

# Domain files
VPN_DOMAINS_TCPUDP="$VPN_MANAGER_HOME/vpn-domains.txt"
VPN_DOMAINS_UDPONLY="$VPN_MANAGER_HOME/vpn-domains-udp.txt"
DOMAINS_FILE="$VPN_DOMAINS_TCPUDP"
VPN_SUBNETS_TCPUDP="$VPN_MANAGER_HOME/vpn-subnets.txt"
VPN_SUBNETS_UDPONLY="$VPN_MANAGER_HOME/vpn-subnets-udp.txt"

# Remote lists (FEAT-011: auto-update from cloud)
REMOTE_LISTS_DIR="$VPN_MANAGER_HOME/remote-lists"
REMOTE_DOMAINS_TCPUDP="$REMOTE_LISTS_DIR/tcp_udp_domains.txt"
REMOTE_DOMAINS_UDPONLY="$REMOTE_LISTS_DIR/udp_domains.txt"
REMOTE_SUBNETS_TCPUDP="$REMOTE_LISTS_DIR/tcp_udp_subnets.txt"
REMOTE_SUBNETS_UDPONLY="$REMOTE_LISTS_DIR/udp_subnets.txt"
SETTINGS_FILE="$VPN_MANAGER_HOME/settings.json"

# dnsmasq configs
DNSMASQ_VPN_DOMAINS="/opt/etc/dnsmasq.d/vpn-domains.conf"
DNSMASQ_VPN_DOMAINS_UDP="/opt/etc/dnsmasq.d/vpn-domains-udp.conf"

# ============================================
# VPN Manager files
# ============================================
AUTH_DB="$VPN_MANAGER_HOME/auth.db"
ACTIVE_CONFIG="$VPN_MANAGER_HOME/active-config"
DEVICE_ROUTING="$VPN_MANAGER_HOME/device-routing.json"
AUTOSTART_FLAG="$VPN_MANAGER_HOME/autostart-enabled"

# ============================================
# Router network auto-detection
# ============================================

# Get router IP address (busybox-compatible)
get_router_ip() {
    local ip=""
    
    # Try br0 (LAN bridge on Keenetic)
    ip=$(ip -4 addr show br0 2>/dev/null | awk '/inet / {print $2}' | cut -d'/' -f1 | head -1)
    
    # Fallback: eth0
    [ -z "$ip" ] && ip=$(ip -4 addr show eth0 2>/dev/null | awk '/inet / {print $2}' | cut -d'/' -f1 | head -1)
    
    # Fallback: from route
    [ -z "$ip" ] && ip=$(ip -4 route get 1 2>/dev/null | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
    
    # Fallback: first private IP
    if [ -z "$ip" ]; then
        ip=$(ip -4 addr 2>/dev/null | awk '/inet / {print $2}' | cut -d'/' -f1 | grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -1)
    fi
    
    echo "${ip:-192.168.1.1}"
}

# Get local network in CIDR format
get_local_network_cidr() {
    local router_ip=$(get_router_ip)
    # Replace last octet with 0/24
    echo "$router_ip" | sed 's/\.[0-9]*$/.0\/24/'
}

# Get network prefix (first 3 octets)
get_network_prefix() {
    local router_ip=$(get_router_ip)
    echo "$router_ip" | sed 's/\.[0-9]*$//'
}

# ============================================
# Router HWID (persistent device identity for subscription auth)
# ============================================
ROUTER_HWID_FILE="$VPN_MANAGER_HOME/router-hwid"

get_router_hwid() {
    if [ -f "$ROUTER_HWID_FILE" ] && [ -s "$ROUTER_HWID_FILE" ]; then
        cat "$ROUTER_HWID_FILE"
        return 0
    fi
    # Generate a new random 16-char hex HWID and persist it
    local hwid
    hwid=$(cat /dev/urandom 2>/dev/null | tr -dc 'a-f0-9' | head -c 16)
    # Fallback if /dev/urandom unavailable
    if [ -z "$hwid" ]; then
        hwid=$(date +%s%N 2>/dev/null | md5sum 2>/dev/null | head -c 16)
    fi
    [ -z "$hwid" ] && hwid="vpnmanager000001"
    mkdir -p "$(dirname "$ROUTER_HWID_FILE")"
    echo "$hwid" > "$ROUTER_HWID_FILE"
    echo "$hwid"
}

# ============================================
# Auto-update lists support (FEAT-011)
# ============================================

# Check if auto-update lists is enabled
is_auto_update_enabled() {
    if [ -f "$SETTINGS_FILE" ]; then
        local enabled=$(jq 'if .auto_update_lists == null then true else .auto_update_lists end' "$SETTINGS_FILE" 2>/dev/null)
        [ "$enabled" = "true" ]
    else
        return 0  # By default enabled
    fi
}

# Get merged content from local and remote files (used for VPN client rules)
# Parameters: $1 = local_file, $2 = remote_file
get_merged_content() {
    local local_file="$1"
    local remote_file="$2"
    
    {
        [ -f "$local_file" ] && cat "$local_file"
        if is_auto_update_enabled && [ -f "$remote_file" ]; then
            cat "$remote_file"
        fi
    } 2>/dev/null | grep -v '^#' | grep -v '^$' | tr -d ' \t\r' | sort -u
}

# Create required directories
# Only when missing: chmod on every request rewrites the directory's inode (ctime) —
# with the panel polling every 5 s that was ~5 MB/hour of flash writes (27.09)
if [ ! -d "$SESSION_DIR" ]; then
    mkdir -p "$SESSION_DIR" 2>/dev/null
    chmod 700 "$SESSION_DIR" 2>/dev/null
fi

# Sessions used to live in RAM (/tmp/vpn-manager-sessions) and died with every reboot.
# Carry the live ones over once, so the update itself logs nobody out.
if [ -d /tmp/vpn-manager-sessions ]; then
    mv /tmp/vpn-manager-sessions/* "$SESSION_DIR"/ 2>/dev/null
    rmdir /tmp/vpn-manager-sessions 2>/dev/null
fi

# ============================================
# HTTP responses
# ============================================

json_response() {
    echo "Content-Type: application/json"
    echo "Cache-Control: no-cache"
    echo ""
    echo "$1"
}

json_error() {
    local code="${2:-400}"
    echo "Status: $code"
    echo "Content-Type: application/json"
    echo ""
    echo "{\"success\":false,\"error\":\"$1\"}"
}

json_success() {
    echo "Content-Type: application/json"
    echo ""
    if [ -n "$1" ]; then
        echo "{\"success\":true,\"data\":$1}"
    else
        echo "{\"success\":true}"
    fi
}

# ============================================
# JSON handling (without jq - via sed/awk)
# ============================================

# Get value by key from JSON string
json_get_value() {
    local json="$1"
    local key="$2"
    # Use jq for correct parsing (including multiline strings)
    local result=$(echo "$json" | jq -r ".$key // empty" 2>/dev/null)
    if [ -n "$result" ]; then
        echo "$result"
    else
        # Fallback to sed for simple cases
        echo "$json" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1
    fi
}

# Get boolean value (returns "true" or "false" as string)
json_get_bool() {
    local json="$1"
    local key="$2"
    # jq -r for boolean returns "true" or "false" as string
    local result=$(echo "$json" | jq -r ".$key" 2>/dev/null)
    case "$result" in
        true|false)
            echo "$result"
            ;;
        *)
            # Fallback to sed for boolean without quotes
            echo "$json" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p" | head -1
            ;;
    esac
}

# Get numeric value
json_get_number() {
    local json="$1"
    local key="$2"
    echo "$json" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p" | head -1
}

# ============================================
# Reading POST/PUT data
# ============================================

read_post_data() {
    # Works for POST, PUT and other methods with request body
    if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ]; then
        # Use dd for reliable byte-count reading (head -c may have issues in some environments)
        dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null
    fi
}

# URL decoding
urldecode() {
    local data="$1"
    printf '%b' "${data//\%/\\x}"
}

# ============================================
# Sessions
# ============================================

generate_session_id() {
    head -c 32 /dev/urandom 2>/dev/null | md5sum | cut -d' ' -f1
}

get_session_id() {
    local cookies="$HTTP_COOKIE"
    local id=$(echo "$cookies" | sed -n 's/.*vpn_session=\([^;]*\).*/\1/p')
    # Only a name generate_session_id could have made (32 hex digits): anything else
    # ("../..", a path) would point outside SESSION_DIR and must not count as a session
    case "$id" in
        *[!0-9a-f]*) return 0 ;;
    esac
    [ ${#id} -eq 32 ] && echo "$id"
}

validate_session() {
    # Router's own scripts call the API scripts directly as a process (see
    # subscription-update.sh), never over HTTP: lighttpd always sets REMOTE_ADDR and
    # cannot pass this variable, so a network client cannot pose as one of them.
    # Not "trust 127.0.0.1": VPN-server users reach the router's loopback through sing-box.
    if [ -n "$VPN_MANAGER_INTERNAL" ] && [ -z "$REMOTE_ADDR" ]; then
        return 0
    fi

    # Cross-site request guard: the panel sends this header with every API call. A page
    # on another site cannot add a custom header without a CORS preflight, which lighttpd
    # never approves — so it can't drive the API through a LAN browser, password or not.
    if [ "$HTTP_X_REQUESTED_WITH" != "vpn-manager" ]; then
        return 1
    fi

    # If authorization is disabled - always allow access
    if [ -f "$AUTH_DB" ]; then
        local auth_mode=$(grep -o '"auth_mode"[[:space:]]*:[[:space:]]*"[^"]*"' "$AUTH_DB" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')
        if [ "$auth_mode" = "disabled" ]; then
            return 0
        fi
    fi
    
    local session_id=$(get_session_id)
    if [ -z "$session_id" ]; then
        return 1
    fi
    
    local session_file="$SESSION_DIR/$session_id"
    if [ ! -f "$session_file" ]; then
        return 1
    fi
    
    # A session lives SESSION_TTL from its last use: the file's modification time,
    # refreshed at most once an hour, so the flash sees one tiny write per hour of use.
    # touch -c never re-creates a file that a logout has just removed.
    local seen=$(date -r "$session_file" +%s 2>/dev/null)
    local now=$(date +%s)
    case "$seen" in
        ''|*[!0-9]*) return 1 ;;
    esac

    if [ $((now - seen)) -gt "$SESSION_TTL" ]; then
        rm -f "$session_file"
        return 1
    fi

    if [ $((now - seen)) -gt 3600 ]; then
        touch -c "$session_file" 2>/dev/null
    fi

    return 0
}

create_session() {
    local username="$1"
    local session_id=$(generate_session_id)
    local session_file="$SESSION_DIR/$session_id"
    local now=$(date +%s)

    # Drop sessions nobody has used for longer than the lifetime (by last use)
    local f seen
    for f in "$SESSION_DIR"/*; do
        [ -f "$f" ] || continue
        seen=$(date -r "$f" +%s 2>/dev/null)
        case "$seen" in
            ''|*[!0-9]*) continue ;;
        esac
        [ $((now - seen)) -gt "$SESSION_TTL" ] && rm -f "$f"
    done

    echo "$now" > "$session_file"
    echo "$username" >> "$session_file"
    chmod 600 "$session_file"

    echo "$session_id"
}

# Session cookie. Max-Age keeps it across browser restarts (a cookie without it is
# dropped when the browser closes); the lifetime matches SESSION_TTL. Lax is enough:
# cross-site requests are already refused by the X-Requested-With check above.
session_cookie_header() {
    echo "Set-Cookie: vpn_session=$1; Path=/; Max-Age=$SESSION_TTL; HttpOnly; SameSite=Lax"
}

destroy_session() {
    local session_id=$(get_session_id)
    if [ -n "$session_id" ]; then
        rm -f "$SESSION_DIR/$session_id"
    fi
}

# ============================================
# Password hashing (using sha256sum)
# ============================================

hash_password() {
    local password="$1"
    local salt=$(head -c 16 /dev/urandom 2>/dev/null | md5sum | cut -c1-16)
    local hash=$(echo -n "${salt}${password}" | sha256sum | cut -d' ' -f1)
    echo "${salt}:${hash}"
}

verify_password() {
    local password="$1"
    local stored_hash="$2"
    
    local salt=$(echo "$stored_hash" | cut -d: -f1)
    local expected=$(echo "$stored_hash" | cut -d: -f2)
    local computed=$(echo -n "${salt}${password}" | sha256sum | cut -d' ' -f1)
    
    [ "$expected" = "$computed" ]
}

# URL decoding
urldecode() {
    local data="$1"
    printf '%b' "${data//+/ }" | sed 's/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g' | xargs -0 printf '%b'
}

# ============================================
# Validation
# ============================================

validate_ip() {
    local ip="$1"
    echo "$ip" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'
}

validate_port() {
    local port="$1"
    [ "$port" -ge 1 ] && [ "$port" -le 65535 ] 2>/dev/null
}

validate_domain() {
    local domain="$1"
    echo "$domain" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
}

# ============================================
# Logging — всё через syslog-ng
# ============================================

# Универсальная функция логирования
# Использование: vpn_log "INFO" "message" "tag"
vpn_log() {
    local level="${1:-INFO}"
    local message="$2"
    local tag="${3:-vpn-manager}"
    
    # Приоритет для syslog
    local priority="user.info"
    case "$level" in
        ERROR|error) priority="user.err" ;;
        WARN|warn)   priority="user.warning" ;;
        DEBUG|debug) priority="user.debug" ;;
    esac
    
    # Отправляем в syslog (syslog-ng подхватит)
    logger -t "$tag" -p "$priority" "$message"
}

# Алиасы для удобства
log_info()  { vpn_log "INFO"  "$1" "${2:-vpn-manager}"; }
log_warn()  { vpn_log "WARN"  "$1" "${2:-vpn-manager}"; }
log_error() { vpn_log "ERROR" "$1" "${2:-vpn-manager}"; }

# Обратная совместимость: log_action -> vpn_log
log_action() {
    local action="$1"
    local details="$2"
    local ip="${REMOTE_ADDR:-unknown}"
    
    vpn_log "INFO" "[$ip] $action: $details" "vpn-manager"
}

# ============================================
# VPN configuration management
# ============================================

get_active_config() {
    if [ -f "$ACTIVE_CONFIG" ]; then
        cat "$ACTIVE_CONFIG"
    fi
}

set_active_config() {
    local config_id="$1"
    echo "$config_id" > "$ACTIVE_CONFIG"
}

list_configs() {
    local result="["
    local first=1
    
    for f in "$VPN_CONFIGS_DIR"/*.json; do
        [ -f "$f" ] || continue
        if [ $first -eq 0 ]; then
            result="$result,"
        fi
        result="$result$(cat "$f")"
        first=0
    done
    
    result="$result]"
    echo "$result"
}

# ============================================
# Several connections (multi mode)
# ============================================
# One server leads (the user's choice), the others stand by. In sing-box:
#   vpn       fallback: every new connection tries vpn-main, then vpn-auto, then
#             each server in turn;
#             whatever failed to connect sits out for 3 minutes
#   vpn-main  selector: the main server; switched through the Clash API, no restart
#   vpn-auto  urltest: the fastest of the ticked servers, re-checked every minute
#   m-<id>    one outbound per ticked server
# Everything else (lists, device policies, DNS, the VPN server) keeps pointing at "vpn".
MULTI_FILE="$VPN_MANAGER_HOME/multi.json"
MULTI_LIMIT=20
CLASH_API="http://127.0.0.1:9090"

multi_state() {
    if [ -s "$MULTI_FILE" ] && jq -e 'type == "object"' "$MULTI_FILE" >/dev/null 2>&1; then
        jq -c '{mode: (.mode // "single"), members: (.members // []), subscriptions: (.subscriptions // []), primary: (.primary // "")}' "$MULTI_FILE"
    else
        echo '{"mode":"single","members":[],"subscriptions":[],"primary":""}'
    fi
}

multi_is_on() {
    [ "$(multi_state | jq -r '.mode')" = "multi" ]
}

multi_save() {
    local tmp="$MULTI_FILE.tmp"
    printf '%s' "$1" | jq -c '.' > "$tmp" 2>/dev/null && [ -s "$tmp" ] && mv "$tmp" "$MULTI_FILE" || { rm -f "$tmp"; return 1; }
}

# Configs that may take part: every config file as {id, name, protocol, subscription_id}
multi_catalog() {
    local files=$(ls "$VPN_CONFIGS_DIR"/*.json 2>/dev/null)
    [ -n "$files" ] || { echo '[]'; return; }
    # shellcheck disable=SC2086
    jq -c -s '[.[] | {id: (.id // ""), name: (.name // .id // ""), protocol: (.protocol // "shadowsocks"),
                      subscription_id: (.subscription_id // "")} | select(.id != "")]' $files 2>/dev/null || echo '[]'
}

# The servers sing-box runs: ticked servers first, then the servers of ticked
# subscriptions; no WireGuard/AmneziaWG, no duplicates, at most MULTI_LIMIT.
# Prints {ids: [...], truncated: N}
multi_effective() {
    local state="${1:-$(multi_state)}"
    multi_catalog | jq -c --argjson st "$state" --argjson limit "$MULTI_LIMIT" '
        . as $cat
        | [$cat[] | select(.protocol != "wireguard" and .protocol != "amneziawg")] as $ok
        | ($ok | map(.id)) as $okids
        | ([$st.members[] | select(. as $m | $okids | index($m))]
           + [$ok[] | select(.subscription_id as $s | $s != "" and ($st.subscriptions | index($s))) | .id])
        | reduce .[] as $i ([]; if index($i) then . else . + [$i] end)
        | {ids: .[:$limit], truncated: ((length - $limit) | if . > 0 then . else 0 end)}'
}

# Build the multi-mode outbounds and write them into the sing-box config.
# Does not restart sing-box. Keeps multi.json and active-config in step.
apply_multi_config() {
    local state=$(multi_state)
    local ids=$(multi_effective "$state" | jq -r '.ids[]')
    [ -n "$ids" ] || { log_action "MULTI" "No servers to run"; return 1; }

    local primary=$(printf '%s' "$state" | jq -r '.primary')
    printf '%s\n' "$ids" | grep -qxF "$primary" || primary=$(printf '%s\n' "$ids" | head -1)

    local items="[" tags="[" id out first=1
    for id in $ids; do
        out=$(generate_outbound_json "$VPN_CONFIGS_DIR/$id.json" "m-$id")
        [ -n "$out" ] || continue
        # A dead server must fail fast, so the fallback moves on: without this a
        # dropped connection waits for the system TCP timeout (15 s+) — tested on the router.
        # 3 s: a live VPN server answers the TCP handshake well within it
        out=$(printf '%s' "$out" | jq -c '. + {connect_timeout: "3s"}') || continue
        [ $first -eq 1 ] || { items="$items,"; tags="$tags,"; }
        items="$items$out"
        tags="$tags\"m-$id\""
        first=0
    done
    items="$items]"; tags="$tags]"
    [ $first -eq 0 ] || { log_action "MULTI" "Could not build any server"; return 1; }

    # Order for the last-resort tail: fastest by the last check first (when sing-box
    # has measured them), unmeasured at the end
    local px=$(curl -s -m 3 "$CLASH_API/proxies" 2>/dev/null)
    printf '%s' "$px" | jq -e '.proxies' >/dev/null 2>&1 || px='{"proxies":{}}'
    local tail_tags=$(jq -c -n --argjson tags "$tags" --argjson px "$px" '
        $tags | map({t: ., d: (($px.proxies[.].history // []) | if length > 0 then .[-1].delay else 0 end)})
        | map(. + {k: (if .d > 0 then .d else 999999 end)}) | sort_by(.k) | map(.t)')

    items=$(jq -c -n --argjson items "$items" --argjson tags "$tags" --argjson tail "$tail_tags" --arg main "m-$primary" '
        $items + [
          {type: "selector", tag: "vpn-main", outbounds: $tags, default: $main},
          {type: "urltest",  tag: "vpn-auto", outbounds: $tags,
           url: "https://www.gstatic.com/generate_204", interval: "1m", tolerance: 150, idle_timeout: "30m"},
          # After vpn-auto every server once more, one by one: right after the main
          # server dies, urltest may still point at it until its next check
          {type: "fallback", tag: "vpn", outbounds: (["vpn-main", "vpn-auto"] + $tail), blacklist_timeout: "3m"}
        ]') || return 1

    apply_singbox_vpn_items "vpn" "$items" || return 1
    multi_save "$(printf '%s' "$state" | jq -c --arg p "$primary" '.primary = $p')"
    set_active_config "$primary"
    log_action "MULTI" "Applied $(printf '%s\n' "$ids" | wc -l | tr -d ' ') servers, main: $primary"
    return 0
}

# Switch the main server of a running sing-box without a restart (Clash API),
# and write it into the config so the next restart starts from it too
multi_set_primary_live() {
    local id="$1"
    curl -s -m 5 -X PUT -H 'Content-Type: application/json' \
        -d "{\"name\":\"m-$id\"}" "$CLASH_API/proxies/vpn-main" >/dev/null 2>&1
    local tmp=$(mktemp)
    if jq --arg d "m-$id" '(.outbounds[] | select(.tag == "vpn-main") | .default) = $d' "$SINGBOX_CONFIG" > "$tmp" 2>/dev/null \
       && [ -s "$tmp" ]; then
        mv "$tmp" "$SINGBOX_CONFIG"; chmod 644 "$SINGBOX_CONFIG"
    else
        rm -f "$tmp"
    fi
}

# Restart sing-box on the freshly written config and put the firewall rules back,
# the same sequence the Play button runs
multi_restart_vpn() {
    singbox_restart
    sleep 1
    SKIP_WARMUP=1 "$SINGBOX_RULES_INIT" start 0 >/dev/null 2>&1
    check_ss_running
}

# Ticked servers of one subscription, with what identifies them: taken before a
# refresh so the group can follow a server that comes back under a new id.
# Prints [{id, name, server, server_port}]
multi_members_of_subscription() {
    local sub="$1" id f out="["
    for id in $(multi_state | jq -r '.members[]'); do
        f="$VPN_CONFIGS_DIR/$id.json"
        [ -f "$f" ] || continue
        [ "$(jq -r '.subscription_id // empty' "$f" 2>/dev/null)" = "$sub" ] || continue
        [ "$out" = "[" ] || out="$out,"
        out="$out$(jq -c '{id, name, server, server_port}' "$f")"
    done
    echo "$out]"
}

# After a refresh: a ticked server whose file is gone is replaced by the server of the
# same subscription with the same name, address and port (then the same name alone).
# Without this the group silently shrinks every time a provider reshuffles ids.
multi_follow_members() {
    local sub="$1" before="$2"
    [ -n "$before" ] && [ "$before" != "[]" ] || return 0
    local state=$(multi_state) changed=0 n i old id name srv port new f
    n=$(printf '%s' "$before" | jq 'length')
    i=0
    while [ $i -lt $n ]; do
        old=$(printf '%s' "$before" | jq -c ".[$i]")
        id=$(printf '%s' "$old" | jq -r '.id')
        i=$((i + 1))
        [ -f "$VPN_CONFIGS_DIR/$id.json" ] && continue
        name=$(printf '%s' "$old" | jq -r '.name'); srv=$(printf '%s' "$old" | jq -r '.server'); port=$(printf '%s' "$old" | jq -r '.server_port')
        new=""
        for f in "$VPN_CONFIGS_DIR"/*.json; do
            [ -f "$f" ] || continue
            jq -e --arg s "$sub" --arg n "$name" --arg a "$srv" --arg p "$port" \
                '.subscription_id == $s and .name == $n and .server == $a and (.server_port | tostring) == $p' "$f" >/dev/null 2>&1 \
                && { new=$(basename "$f" .json); break; }
        done
        if [ -z "$new" ]; then
            for f in "$VPN_CONFIGS_DIR"/*.json; do
                [ -f "$f" ] || continue
                jq -e --arg s "$sub" --arg n "$name" '.subscription_id == $s and .name == $n' "$f" >/dev/null 2>&1 \
                    && { new=$(basename "$f" .json); break; }
            done
        fi
        [ -n "$new" ] || continue
        state=$(printf '%s' "$state" | jq -c --arg o "$id" --arg n "$new" \
            '.members |= map(if . == $o then $n else . end) | (if .primary == $o then .primary = $n else . end)')
        log_action "MULTI" "Server $id came back as $new after the refresh, kept in the group"
        changed=1
    done
    [ $changed -eq 1 ] && multi_save "$state"
    return 0
}

# After servers came or went (subscription refresh, a deleted config or subscription):
# rebuild the group only if the set sing-box runs is no longer the ticked set
multi_resync() {
    multi_is_on || return 0
    local want=$(multi_effective | jq -c '.ids | sort')
    local have=$(jq -c '[.outbounds[]? | .tag // "" | select(startswith("m-")) | ltrimstr("m-")] | sort' "$SINGBOX_CONFIG" 2>/dev/null)
    [ "$want" = "$have" ] && return 0
    log_action "MULTI" "Server set changed, rebuilding the group"
    apply_multi_config && multi_restart_vpn
}

# Live view for the panel: per server status and last delay from the Clash API
multi_status_json() {
    local state=$(multi_state)
    local eff=$(multi_effective "$state")
    local proxies=$(curl -s -m 5 "$CLASH_API/proxies" 2>/dev/null)
    printf '%s' "$proxies" | jq -e '.proxies' >/dev/null 2>&1 || proxies='{"proxies":{}}'
    local running=false
    check_ss_running && running=true
    multi_catalog | jq -c --argjson st "$state" --argjson eff "$eff" --argjson px "$proxies" \
        --argjson limit "$MULTI_LIMIT" --argjson running "$running" '
        (map({key: .id, value: .}) | from_entries) as $cat
        | $px.proxies as $p
        | ($p["vpn-main"].now // ("m-" + $st.primary)) as $main
        | ($p["vpn-auto"].now // "") as $auto
        # the fallback says which group carries new connections: vpn-main, or
        # vpn-auto while the main server sits out after a failure
        | ($p["vpn"].now // "vpn-main") as $fb
        | ($fb != "vpn-main") as $main_out
        | (if $fb == "vpn-auto" then $auto elif $fb == "vpn-main" then $main else $fb end) as $carrier
        | def last_delay($t): ($p[$t].history // []) | if length > 0 then .[-1].delay else null end;
          def alive($t): ($p[$t].alive // null);
        {mode: $st.mode, limit: $limit, primary: $st.primary, members: $st.members,
           last_check: ([$eff.ids[] | ($p["m-" + .].history // []) | .[-1].time? // empty] | max),
           subscriptions: $st.subscriptions, truncated: $eff.truncated, running: $running,
           effective: [$eff.ids[] | . as $id | ("m-" + $id) as $t | last_delay($t) as $d
             | ($cat[$id] // {id: $id, name: $id, protocol: "", subscription_id: ""})
             + {delay: (if $d == null or $d == 0 then null else $d end),
                status: (if $d == 0 or alive($t) == false or ($t == $main and $main_out) then "down"
                         elif $t == $main then "primary"
                         elif $d == null then "unknown" else "reserve" end),
                main: ($t == $main),
                carrying: ($st.mode == "multi" and $t == $carrier)}]}
        | if .mode != "multi" then .effective = [] else . end'
}

# ============================================
# sing-box integration
# ============================================

# Check: sing-box is installed
is_singbox_installed() {
    [ -f "$SINGBOX_CONFIG" ] && [ -x "$SINGBOX_INIT" ]
}

# Check if sing-box is running
check_singbox_running() {
    pgrep -f "sing-box run" >/dev/null 2>&1
}

get_singbox_pid() {
    pgrep -f "sing-box run" 2>/dev/null | head -1
}

# Generate outbound JSON for different protocols
generate_outbound_json() {
    local config_file="$1"
    local tag="$2"
    
    [ -z "$tag" ] && tag="proxy"
    
    local config_data=$(cat "$config_file")
    local protocol=$(json_get_value "$config_data" "protocol")
    local server=$(json_get_value "$config_data" "server")
    local server_port=$(json_get_number "$config_data" "server_port")
    
    [ -z "$protocol" ] && protocol="shadowsocks"
    
    case "$protocol" in
        shadowsocks)
            local password=$(json_get_value "$config_data" "password")
            local method=$(json_get_value "$config_data" "method")
            local udp_over_tcp=$(json_get_bool "$config_data" "udp_over_tcp")
            [ -z "$method" ] && method="chacha20-ietf-poly1305"
            # udp_over_tcp: default false, unless explicitly set to true
            if [ "$udp_over_tcp" = "true" ]; then
                echo "{\"type\":\"shadowsocks\",\"tag\":\"$tag\",\"server\":\"$server\",\"server_port\":$server_port,\"method\":\"$method\",\"password\":\"$password\",\"udp_over_tcp\":{\"enabled\":true,\"version\":2}}"
            else
                echo "{\"type\":\"shadowsocks\",\"tag\":\"$tag\",\"server\":\"$server\",\"server_port\":$server_port,\"method\":\"$method\",\"password\":\"$password\"}"
            fi
            ;;
        vless)
            local uuid=$(json_get_value "$config_data" "uuid")
            local flow=$(json_get_value "$config_data" "flow")
            local transport_type=$(json_get_value "$config_data" "transport_type")
            local transport_path=$(json_get_value "$config_data" "transport_path")
            local transport_host=$(json_get_value "$config_data" "transport_host")
            local transport_mode=$(json_get_value "$config_data" "transport_mode")
            local security=$(json_get_value "$config_data" "security")
            local sni=$(json_get_value "$config_data" "sni")
            local fp=$(json_get_value "$config_data" "fingerprint")
            local pbk=$(json_get_value "$config_data" "public_key")
            local sid=$(json_get_value "$config_data" "short_id")
            local alpn=$(json_get_value "$config_data" "alpn")
            
            [ -z "$fp" ] && fp="chrome"
            
            # ALPN: for XHTTP h2 is required, add if not specified
            if [ "$transport_type" = "xhttp" ] && [ -z "$alpn" ]; then
                alpn="h2"
            fi
            
            # TLS config with ALPN support
            local tls_json=""
            local alpn_json=""
            if [ -n "$alpn" ]; then
                # Convert "h3,h2,http/1.1" to ["h3","h2","http/1.1"]
                alpn_json=",\"alpn\":[\"$(echo "$alpn" | sed 's/,/","/g')\"]"
            fi
            
            if [ "$security" = "reality" ]; then
                tls_json=",\"tls\":{\"enabled\":true,\"server_name\":\"$sni\"$alpn_json,\"reality\":{\"enabled\":true,\"public_key\":\"$pbk\",\"short_id\":\"$sid\"},\"utls\":{\"enabled\":true,\"fingerprint\":\"$fp\"}}"
            elif [ "$security" = "tls" ]; then
                tls_json=",\"tls\":{\"enabled\":true,\"server_name\":\"$sni\"$alpn_json,\"utls\":{\"enabled\":true,\"fingerprint\":\"$fp\"}}"
            fi
            
            local flow_json=""
            [ -n "$flow" ] && flow_json=",\"flow\":\"$flow\""
            
            # Transport (WebSocket, XHTTP, gRPC)
            local transport_json=""
            if [ "$transport_type" = "ws" ]; then
                transport_json=",\"transport\":{\"type\":\"ws\""
                [ -n "$transport_path" ] && transport_json="$transport_json,\"path\":\"$transport_path\""
                if [ -n "$transport_host" ]; then
                    transport_json="$transport_json,\"headers\":{\"Host\":\"$transport_host\"}"
                fi
                transport_json="$transport_json}"
            elif [ "$transport_type" = "xhttp" ]; then
                # XHTTP transport for sing-box Extended
                # mode from URL or auto (sing-box will determine optimal mode)
                [ -z "$transport_mode" ] && transport_mode="auto"
                transport_json=",\"transport\":{\"type\":\"xhttp\",\"mode\":\"$transport_mode\""
                [ -n "$transport_path" ] && transport_json="$transport_json,\"path\":\"$transport_path\""
                # host added only if specified in URL
                [ -n "$transport_host" ] && transport_json="$transport_json,\"host\":\"$transport_host\""
                # sing-box-extended 2.x refuses xhttp without padding; 100-1000 is Xray's default
                transport_json="$transport_json,\"x_padding_bytes\":\"100-1000\"}"
            elif [ "$transport_type" = "grpc" ]; then
                transport_json=",\"transport\":{\"type\":\"grpc\""
                [ -n "$transport_path" ] && transport_json="$transport_json,\"service_name\":\"$transport_path\""
                transport_json="$transport_json}"
            fi
            
            echo "{\"type\":\"vless\",\"tag\":\"$tag\",\"server\":\"$server\",\"server_port\":$server_port,\"uuid\":\"$uuid\"$flow_json$tls_json$transport_json}"
            ;;
        vmess)
            local uuid=$(json_get_value "$config_data" "uuid")
            local alter_id=$(json_get_number "$config_data" "alter_id")
            local security=$(json_get_value "$config_data" "vmess_security")
            local sni=$(json_get_value "$config_data" "sni")
            local transport_type=$(json_get_value "$config_data" "transport_type")
            local transport_path=$(json_get_value "$config_data" "transport_path")
            local transport_host=$(json_get_value "$config_data" "transport_host")
            
            [ -z "$alter_id" ] && alter_id=0
            [ -z "$security" ] && security="auto"
            
            local tls_json=""
            [ -n "$sni" ] && tls_json=",\"tls\":{\"enabled\":true,\"server_name\":\"$sni\"}"
            
            # WebSocket transport
            local transport_json=""
            if [ "$transport_type" = "ws" ]; then
                transport_json=",\"transport\":{\"type\":\"ws\""
                [ -n "$transport_path" ] && transport_json="$transport_json,\"path\":\"$transport_path\""
                if [ -n "$transport_host" ]; then
                    transport_json="$transport_json,\"headers\":{\"Host\":\"$transport_host\"}"
                fi
                transport_json="$transport_json}"
            fi
            
            echo "{\"type\":\"vmess\",\"tag\":\"$tag\",\"server\":\"$server\",\"server_port\":$server_port,\"uuid\":\"$uuid\",\"alter_id\":$alter_id,\"security\":\"$security\"$tls_json$transport_json}"
            ;;
        trojan)
            local password=$(json_get_value "$config_data" "password")
            local sni=$(json_get_value "$config_data" "sni")
            local transport_type=$(json_get_value "$config_data" "transport_type")
            local transport_path=$(json_get_value "$config_data" "transport_path")
            local transport_host=$(json_get_value "$config_data" "transport_host")
            
            local tls_json=",\"tls\":{\"enabled\":true"
            [ -n "$sni" ] && tls_json="$tls_json,\"server_name\":\"$sni\""
            tls_json="$tls_json}"
            
            # WebSocket transport
            local transport_json=""
            if [ "$transport_type" = "ws" ]; then
                transport_json=",\"transport\":{\"type\":\"ws\""
                [ -n "$transport_path" ] && transport_json="$transport_json,\"path\":\"$transport_path\""
                if [ -n "$transport_host" ]; then
                    transport_json="$transport_json,\"headers\":{\"Host\":\"$transport_host\"}"
                fi
                transport_json="$transport_json}"
            fi
            
            echo "{\"type\":\"trojan\",\"tag\":\"$tag\",\"server\":\"$server\",\"server_port\":$server_port,\"password\":\"$password\"$tls_json$transport_json}"
            ;;
        hysteria2)
            # QUIC over UDP; TLS is always on, ALPN defaults to h3 in sing-box
            jq -c --arg tag "$tag" '
                {type: "hysteria2", tag: $tag, server: .server, server_port: (.server_port | tonumber), password: .password,
                 tls: ({enabled: true}
                       + (if (.sni // "") != "" then {server_name: .sni} else {} end)
                       + (if .skip_verify == true then {insecure: true} else {} end)
                       + (if (.alpn // "") != "" then {alpn: (.alpn | split(","))} else {} end))}
                + (if (.obfs // "") != "" then {obfs: {type: .obfs, password: (.obfs_password // "")}} else {} end)' "$config_file" 2>/dev/null
            ;;
        wireguard)
            local private_key=$(json_get_value "$config_data" "private_key")
            local peer_public_key=$(json_get_value "$config_data" "peer_public_key")
            local pre_shared_key=$(json_get_value "$config_data" "pre_shared_key")
            local reserved=$(json_get_value "$config_data" "reserved")
            local mtu=$(json_get_number "$config_data" "mtu")
            local local_address=$(json_get_value "$config_data" "local_address")
            
            [ -z "$mtu" ] && mtu=1280
            
            local psk_json=""
            [ -n "$pre_shared_key" ] && psk_json=",\"pre_shared_key\":\"$pre_shared_key\""
            
            # sing-box-extended 2.x has no "reserved" on a WireGuard peer: it is dropped
            # (only Cloudflare WARP uses it; such a config needs a WARP-aware client)
            local reserved_json=""
            
            # sing-box 1.13+: WireGuard is an endpoint, not an outbound (apply_singbox_outbound
            # puts it into .endpoints); the peer carries the server and the keys
            echo "{\"type\":\"wireguard\",\"tag\":\"$tag\",\"address\":[\"$local_address\"],\"private_key\":\"$private_key\",\"mtu\":$mtu,\"peers\":[{\"address\":\"$server\",\"port\":$server_port,\"public_key\":\"$peer_public_key\"$psk_json,\"allowed_ips\":[\"0.0.0.0/0\",\"::/0\"]$reserved_json}]}"
            ;;
        amneziawg)
            # AmneziaWG — WireGuard with obfuscation (sing-box Extended)
            local private_key=$(json_get_value "$config_data" "private_key")
            local peer_public_key=$(json_get_value "$config_data" "peer_public_key")
            local preshared_key=$(json_get_value "$config_data" "preshared_key")
            local mtu=$(json_get_number "$config_data" "mtu")
            local local_address=$(json_get_value "$config_data" "local_address")
            # AmneziaWG obfuscation parameters
            local jc=$(json_get_number "$config_data" "jc")
            local jmin=$(json_get_number "$config_data" "jmin")
            local jmax=$(json_get_number "$config_data" "jmax")
            local s1=$(json_get_number "$config_data" "s1")
            local s2=$(json_get_number "$config_data" "s2")
            local h1=$(json_get_number "$config_data" "h1")
            local h2=$(json_get_number "$config_data" "h2")
            local h3=$(json_get_number "$config_data" "h3")
            local h4=$(json_get_number "$config_data" "h4")
            
            [ -z "$mtu" ] && mtu=1280
            
            local psk_json=""
            [ -n "$preshared_key" ] && psk_json=",\"pre_shared_key\":\"$preshared_key\""
            
            # AmneziaWG parameters in "amnezia" object for sing-box Extended
            # Format: https://github.com/shtorm-7/sing-box-extended/blob/extended/examples/amnezia/client.json
            local amnezia_inner=""
            [ -n "$jc" ] && amnezia_inner="\"jc\":$jc"
            [ -n "$jmin" ] && { [ -n "$amnezia_inner" ] && amnezia_inner="$amnezia_inner,"; amnezia_inner="${amnezia_inner}\"jmin\":$jmin"; }
            [ -n "$jmax" ] && { [ -n "$amnezia_inner" ] && amnezia_inner="$amnezia_inner,"; amnezia_inner="${amnezia_inner}\"jmax\":$jmax"; }
            [ -n "$s1" ] && { [ -n "$amnezia_inner" ] && amnezia_inner="$amnezia_inner,"; amnezia_inner="${amnezia_inner}\"s1\":$s1"; }
            [ -n "$s2" ] && { [ -n "$amnezia_inner" ] && amnezia_inner="$amnezia_inner,"; amnezia_inner="${amnezia_inner}\"s2\":$s2"; }
            [ -n "$h1" ] && { [ -n "$amnezia_inner" ] && amnezia_inner="$amnezia_inner,"; amnezia_inner="${amnezia_inner}\"h1\":$h1"; }
            [ -n "$h2" ] && { [ -n "$amnezia_inner" ] && amnezia_inner="$amnezia_inner,"; amnezia_inner="${amnezia_inner}\"h2\":$h2"; }
            [ -n "$h3" ] && { [ -n "$amnezia_inner" ] && amnezia_inner="$amnezia_inner,"; amnezia_inner="${amnezia_inner}\"h3\":$h3"; }
            [ -n "$h4" ] && { [ -n "$amnezia_inner" ] && amnezia_inner="$amnezia_inner,"; amnezia_inner="${amnezia_inner}\"h4\":$h4"; }
            
            local amnezia_json=""
            [ -n "$amnezia_inner" ] && amnezia_json=",\"amnezia\":{$amnezia_inner}"
            
            echo "{\"type\":\"wireguard\",\"tag\":\"$tag\",\"address\":[\"$local_address\"],\"private_key\":\"$private_key\",\"mtu\":$mtu,\"peers\":[{\"address\":\"$server\",\"port\":$server_port,\"public_key\":\"$peer_public_key\"$psk_json,\"allowed_ips\":[\"0.0.0.0/0\",\"::/0\"]}]$amnezia_json}"
            ;;
        hysteria2)
            local password=$(json_get_value "$config_data" "password")
            local sni=$(json_get_value "$config_data" "sni")
            local up_mbps=$(json_get_number "$config_data" "up_mbps")
            local down_mbps=$(json_get_number "$config_data" "down_mbps")
            
            local tls_json=",\"tls\":{\"enabled\":true"
            [ -n "$sni" ] && tls_json="$tls_json,\"server_name\":\"$sni\""
            tls_json="$tls_json,\"insecure\":false}"
            
            local bandwidth_json=""
            [ -n "$up_mbps" ] && [ -n "$down_mbps" ] && bandwidth_json=",\"up_mbps\":$up_mbps,\"down_mbps\":$down_mbps"
            
            echo "{\"type\":\"hysteria2\",\"tag\":\"$tag\",\"server\":\"$server\",\"server_port\":$server_port,\"password\":\"$password\"$bandwidth_json$tls_json}"
            ;;
        *)
            # Fallback to shadowsocks
            local password=$(json_get_value "$config_data" "password")
            local method=$(json_get_value "$config_data" "method")
            local udp_over_tcp=$(json_get_bool "$config_data" "udp_over_tcp")
            [ -z "$method" ] && method="chacha20-ietf-poly1305"
            if [ "$udp_over_tcp" = "true" ]; then
                echo "{\"type\":\"shadowsocks\",\"tag\":\"$tag\",\"server\":\"$server\",\"server_port\":$server_port,\"method\":\"$method\",\"password\":\"$password\",\"udp_over_tcp\":{\"enabled\":true,\"version\":2}}"
            else
                echo "{\"type\":\"shadowsocks\",\"tag\":\"$tag\",\"server\":\"$server\",\"server_port\":$server_port,\"method\":\"$method\",\"password\":\"$password\"}"
            fi
            ;;
    esac
}

# sing-box 1.14 (sing-box-extended 2.x) refuses several shapes that 1.12 still took.
# The filter rewrites them in place and changes nothing in a config already in the
# new shape, so it is safe to run on every apply:
# - DNS servers "udp://host:port" / "tls://host" → {type, server, server_port};
#   a detour to "direct" is dropped (1.14 refuses a detour to an empty direct outbound)
# - DNS rules keyed by "outbound" are gone: route.default_domain_resolver does that job
# - inbound "sniff" moved to a route rule with action "sniff"
# - the WireGuard outbound became an endpoint
# - an xhttp transport needs x_padding_bytes
SINGBOX_114_JQ='
def conv_server:
  # no regex: the router jq is built without oniguruma
  if has("address") then
    (.address | split("://")) as $pp
    | (($pp[1] // $pp[0]) | split("/")[0]) as $hp
    | (if ($hp | startswith("["))
       then ($hp | split("]")) as $b | {h: ($b[0] | ltrimstr("[")), port: (($b[1] // "") | ltrimstr(":"))}
       else ($hp | split(":")) as $c | {h: $c[0], port: ($c[1] // "")} end) as $m
    | {type: (if ($pp | length) > 1 then $pp[0] else "udp" end), tag: .tag, server: $m.h}
      + (if $m.port != "" then {server_port: ($m.port | tonumber)} else {} end)
      + (if (.detour // "direct") != "direct" then {detour: .detour} else {} end)
  else . end;
def wg_endpoint:
  {type: "wireguard", tag: .tag,
   address: (.local_address // []), private_key: .private_key, mtu: (.mtu // 1280),
   peers: [{address: .server, port: .server_port, public_key: .peer_public_key,
            allowed_ips: ["0.0.0.0/0", "::/0"]}
           + (if .pre_shared_key then {pre_shared_key: .pre_shared_key} else {} end)]}
  + (if .amnezia then {amnezia: .amnezia} else {} end);
(if .dns.servers then .dns.servers = [.dns.servers[] | conv_server] else . end)
| (if .dns.rules then .dns.rules = [.dns.rules[] | select(has("outbound") | not)] else . end)
| ([.inbounds[]? | select(.sniff == true) | .tag]) as $sniffed
| .inbounds = [.inbounds[]? | del(.sniff, .sniff_override_destination, .domain_strategy)]
| (if ($sniffed | length) > 0 and ([.route.rules[]? | select(.action == "sniff")] | length) == 0
   then .route.rules = [{inbound: $sniffed, action: "sniff"}] + (.route.rules // [])
   else . end)
| ([.outbounds[]? | select(.type == "wireguard") | wg_endpoint]) as $wg
| .outbounds = [.outbounds[]? | select(.type != "wireguard")]
| (if ($wg | length) > 0
   then .endpoints = ([.endpoints[]? | select(.tag as $t | [$wg[].tag] | index($t) | not)] + $wg)
   else . end)
| .outbounds = [.outbounds[] | if .transport.type == "xhttp" and (.transport | has("x_padding_bytes") | not)
                               then .transport.x_padding_bytes = "100-1000" else . end]
'

# Bring $SINGBOX_CONFIG (or $1) to the sing-box 1.14 shape; logs only when it changed
migrate_singbox_config_114() {
    local cfg="${1:-$SINGBOX_CONFIG}" tmp
    [ -s "$cfg" ] || return 0
    tmp=$(mktemp)
    if jq "$SINGBOX_114_JQ" "$cfg" > "$tmp" 2>/dev/null && [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null; then
        if [ "$(jq -S -c . "$cfg" 2>/dev/null)" != "$(jq -S -c . "$tmp")" ]; then
            mv "$tmp" "$cfg"
            chmod 644 "$cfg"
            log_action "SINGBOX_CONFIG" "Config brought to the sing-box 1.14 format"
        fi
    fi
    rm -f "$tmp"
    return 0
}

# Base sing-box config template (used if config is empty/corrupted)
get_singbox_base_config() {
    cat << 'BASECONFIG'
{
  "log": {"level": "warn", "timestamp": true},
  "dns": {
    "servers": [
      {"type": "udp", "tag": "local", "server": "127.0.0.1", "server_port": 5353}
    ],
    "final": "local",
    "strategy": "ipv4_only"
  },
  "inbounds": [
    {"type": "tun", "tag": "tun-in", "interface_name": "singbox0", "address": ["172.19.0.1/30"], "mtu": 1400, "auto_route": false, "stack": "gvisor"},
    {"type": "vless", "tag": "ss-server-in", "listen": "::", "listen_port": 8388, "users": [], "transport": {"type": "ws", "path": "/vless-ws"}},
    {"type": "socks", "tag": "health-check-in", "listen": "127.0.0.1", "listen_port": 2080}
  ],
  "outbounds": [
    {"type": "direct", "tag": "direct"}
  ],
  "route": {
    "rules": [
      {"inbound": ["ss-server-in", "health-check-in"], "action": "sniff"}
    ],
    "final": "direct",
    "auto_detect_interface": true
  }
}
BASECONFIG
}

# Check and restore sing-box config if corrupted
ensure_valid_singbox_config() {
    # If file doesn't exist or is empty - create from template
    if [ ! -f "$SINGBOX_CONFIG" ] || [ ! -s "$SINGBOX_CONFIG" ]; then
        log_action "SINGBOX_CONFIG" "Config missing or empty, creating from template"
        mkdir -p "$(dirname "$SINGBOX_CONFIG")"
        get_singbox_base_config > "$SINGBOX_CONFIG"
        chmod 644 "$SINGBOX_CONFIG"
        return 0
    fi
    
    # Check that it's valid JSON
    if ! jq empty "$SINGBOX_CONFIG" 2>/dev/null; then
        log_action "SINGBOX_CONFIG" "Config is invalid JSON, recreating from template"
        # Backup corrupted file
        cp "$SINGBOX_CONFIG" "${SINGBOX_CONFIG}.broken.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
        get_singbox_base_config > "$SINGBOX_CONFIG"
        chmod 644 "$SINGBOX_CONFIG"
        return 0
    fi
    
    # Migrate: add health-check-in SOCKS5 inbound if missing (legacy installs)
    # Used by subscription update fallback (item 2) and failover daemon (item 8)
    if ! jq -e '.inbounds[] | select(.tag == "health-check-in")' "$SINGBOX_CONFIG" >/dev/null 2>&1; then
        local tmp_mig=$(mktemp)
        jq '.inbounds += [{"type":"socks","tag":"health-check-in","listen":"127.0.0.1","listen_port":2080}]' \
            "$SINGBOX_CONFIG" > "$tmp_mig" 2>/dev/null
        if [ -s "$tmp_mig" ] && jq empty "$tmp_mig" 2>/dev/null; then
            mv "$tmp_mig" "$SINGBOX_CONFIG"
            chmod 644 "$SINGBOX_CONFIG"
            log_action "SINGBOX_CONFIG" "Added missing health-check-in SOCKS5 inbound"
        else
            rm -f "$tmp_mig"
        fi
    fi
    
    # Migrate (B16): VPN-server clients keep the destination they asked for. With
    # sniff_override_destination sing-box swapped it for the sniffed name — apps that
    # disguise their traffic with someone else's name (Telegram) were sent to that
    # site, hung there, and the hanging connections used up sing-box's descriptors.
    # Sniffing stays, so the rules matching by name still work.
    if jq -e '.inbounds[] | select(.tag == "ss-server-in" and .sniff_override_destination == true)' "$SINGBOX_CONFIG" >/dev/null 2>&1; then
        local tmp_b16=$(mktemp)
        jq '(.inbounds[] | select(.tag == "ss-server-in") | .sniff_override_destination) = false' \
            "$SINGBOX_CONFIG" > "$tmp_b16" 2>/dev/null
        if [ -s "$tmp_b16" ] && jq empty "$tmp_b16" 2>/dev/null; then
            mv "$tmp_b16" "$SINGBOX_CONFIG"
            chmod 644 "$SINGBOX_CONFIG"
            log_action "SINGBOX_CONFIG" "VPN server: destination override off (B16)"
        else
            rm -f "$tmp_b16"
        fi
    fi

    migrate_singbox_config_114

    return 0
}

# Apply outbound in sing-box config
apply_singbox_outbound() {
    local config_file="$1"
    local tag="$2"
    
    if [ ! -f "$config_file" ]; then
        log_action "SINGBOX_CONFIG" "VPN config file not found: $config_file"
        return 1
    fi
    
    [ -z "$tag" ] && tag="proxy"
    
    # Make sure sing-box config is valid (create from template if needed)
    ensure_valid_singbox_config
    
    # Generate outbound JSON
    local outbound_json=$(generate_outbound_json "$config_file" "$tag")
    
    if [ -z "$outbound_json" ]; then
        log_action "SINGBOX_CONFIG" "Failed to generate outbound JSON"
        return 1
    fi

    apply_singbox_vpn_items "$tag" "[$outbound_json]"
}

# Put the VPN side into the sing-box config: $2 is a JSON array of outbounds/endpoints,
# one of them tagged $1 — everything routes to that tag. One server (single mode) is a
# one-item array; several servers (multi mode) come with their group outbounds.
# Whatever an earlier apply left (the old server, the m-* members, the groups) goes first.
apply_singbox_vpn_items() {
    local tag="$1"
    local items_json="$2"

    ensure_valid_singbox_config

    # Update sing-box config
    if command -v jq >/dev/null 2>&1; then
        local tmp_config="/tmp/singbox_config_tmp.json"
        
        # Generate routing rules for VPN clients (ss-server-in) by their segment policy
        # (without it every server switch reset them to Direct primary)
        local vpnclient_policy=$(jq -r '.policies.vpn_server // "split"' "$VPN_MANAGER_HOME/routing_policies.json" 2>/dev/null)
        local vpnclient_rules=$(generate_vpnclient_route_rules "$tag" "${vpnclient_policy:-split}")
        
        # Remove old outbound with same tag, add new one, set final.
        #
        # DNS:
        # - For resolving VPN outbound endpoint domain (tag) use bootstrap via local dnsmasq
        #   (udp://127.0.0.1:5353, detour=direct). DoT (tls://8.8.8.8:853) is often blocked by
        #   ISP/routers and leaves VPN dead with "lookup ... dial tcp 8.8.8.8:853: i/o timeout".
        #   Local dnsmasq uses plain UDP upstream and doesn't loop through TUN at bootstrap time.
        # - For other requests use local dnsmasq on udp://127.0.0.1:5353 (not router IP!) to preserve ipset logic.
        #
        # Route rules:
        # - Add rules for ss-server-in (VPN clients) so they route by same rules as LAN clients
        # - Domains from vpn-domains.txt -> via VPN
        # - Subnets from vpn-subnets.txt -> via VPN
        # - Other ss-server-in traffic -> direct
        #
        # sing-box 1.14 removed dns.rules "outbound→bootstrap"; route.default_domain_resolver replaces it.
        # Without route.default_domain_resolver sing-box falls back to DoT (8.8.8.8:853) for
        # resolving the VPN server hostname → "lookup ... dial tcp 8.8.8.8:853: i/o timeout".
        # Log level: warn normally (info logs every connection and wears the drive out),
        # info only while verbose mode is on
        jq --argjson items "$items_json" --arg tag "$tag" --argjson vpnclient_rules "$vpnclient_rules" \
           --arg loglevel "$(singbox_log_level)" \
           '
           # direct-lan-* (B8): exactly the outbounds the new rules name
           ([$vpnclient_rules[]? | .outbound? // empty | select(type == "string" and startswith("direct-lan-"))] | unique
            | map({type: "direct", tag: ., bind_interface: ltrimstr("direct-lan-")})) as $lan_outbounds
           # WireGuard is an endpoint in sing-box 1.13+, everything else an outbound.
           # Ours: the VPN tag, the multi-mode groups and their m-* members
           | def ours: (.tag // "") as $t | $t == $tag or $t == "vpn-main" or $t == "vpn-auto" or ($t | startswith("m-"));
           .endpoints = ([(.endpoints // [])[] | select(ours | not)]
                           + [$items[] | select(.type == "wireguard")])
           | (if (.endpoints | length) == 0 then del(.endpoints) else . end)
           | .outbounds = ([.outbounds[] | select((ours | not) and .tag != "direct" and ((.tag // "") | startswith("direct-lan-") | not))]
                         + [$items[] | select(.type != "wireguard")]
                         + [{"type":"direct","tag":"direct"}] + $lan_outbounds)
           | .log = ((.log // {}) + {"level": $loglevel, "timestamp": true})
           | .route.final = $tag
           | .route.default_domain_resolver = "bootstrap"
           | .route.rules = (
               # Remove old rules for ss-server-in, health-check-in and ip_is_private, then re-add
               [(.route.rules // [])[] | select(.inbound != ["ss-server-in"] and .inbound != ["health-check-in"] and .ip_is_private != true)]
               + (if $vpnclient_rules != [] then $vpnclient_rules else [] end)
               # Always force health-check-in through the active VPN outbound,
               # so the failover daemon can verify the actual tunnel health (not the ISP path).
               + [{"inbound": ["health-check-in"], "outbound": $tag}]
               + [{"ip_is_private": true, "outbound": "direct"}]
             )
           | .dns = (
               .dns // {}
               # sing-box 1.14 server format. The VPN server name itself resolves
               # through route.default_domain_resolver (bootstrap), set above
               | .servers = [
                   {"type":"udp","tag":"bootstrap","server":"127.0.0.1","server_port":5353},
                   {"type":"udp","tag":"local","server":"127.0.0.1","server_port":5353},
                   {"type":"tls","tag":"remote","server":"8.8.8.8","detour":$tag}
                 ]
               | .rules = []
               | .final = "local"
               | .strategy = "ipv4_only"
             )
           ' \
           "$SINGBOX_CONFIG" > "$tmp_config"
        
        # Check that result is not empty and is valid JSON
        if [ -s "$tmp_config" ] && jq empty "$tmp_config" 2>/dev/null; then
            mv "$tmp_config" "$SINGBOX_CONFIG"
            chmod 644 "$SINGBOX_CONFIG"
            log_action "SINGBOX_CONFIG" "Applied outbound: $tag (with DNS detour and rules, local DNS: udp://127.0.0.1:5353)"
        else
            rm -f "$tmp_config"
            log_action "SINGBOX_CONFIG" "ERROR: jq returned empty or invalid result, config not modified"
            return 1
        fi
    else
        log_action "SINGBOX_CONFIG" "jq not available, cannot update config"
        return 1
    fi
    
    return 0
}

# ============================================
# Parse VPN URL (SS, VLESS, VMess, Trojan, Hysteria2)
# ============================================

# Base64 decoding (URL-safe and regular)
base64_decode() {
    local input="$1"
    # Add padding if needed
    local padding=$((4 - ${#input} % 4))
    [ $padding -lt 4 ] && input="${input}$(printf '=%.0s' $(seq 1 $padding))"
    # Replace URL-safe characters
    input=$(echo "$input" | tr '_-' '/+')
    echo "$input" | base64 -d 2>/dev/null
}

# URL decode
url_decode() {
    local encoded="$1"
    printf '%b' "${encoded//%/\\x}"
}

# Parse Shadowsocks URL: ss://base64(method:password)@server:port#name
parse_ss_url() {
    local url="$1"
    local data="${url#ss://}"
    local name=""
    
    # Check for v2ray-plugin (not supported)
    if echo "$data" | grep -qi 'plugin='; then
        echo "{\"error\":\"Shadowsocks with plugin (v2ray-plugin) is not supported. Use Trojan or VMess with WebSocket.\"}"
        return
    fi
    
    # Extract name (after #)
    if echo "$data" | grep -q '#'; then
        name=$(echo "$data" | sed 's/.*#//')
        name=$(url_decode "$name")
        data=$(echo "$data" | sed 's/#.*//')
    fi
    
    # Remove parameters after ? (if any)
    data=$(echo "$data" | sed 's/?.*//')
    
    local server="" port="" method="" password=""
    
    # Format 1: base64(method:password)@server:port
    if echo "$data" | grep -q '@'; then
        local userinfo=$(echo "$data" | sed 's/@.*//')
        local hostport=$(echo "$data" | sed 's/.*@//')
        
        server=$(echo "$hostport" | sed 's/:.*//')
        port=$(echo "$hostport" | sed 's/.*://')
        
        local decoded=$(base64_decode "$userinfo")
        if [ -n "$decoded" ]; then
            method=$(echo "$decoded" | cut -d: -f1)
            password=$(echo "$decoded" | cut -d: -f2-)
        fi
    else
        # Format 2: base64(method:password@server:port)
        local decoded=$(base64_decode "$data")
        if [ -n "$decoded" ]; then
            method=$(echo "$decoded" | cut -d: -f1)
            local rest=$(echo "$decoded" | cut -d: -f2-)
            password=$(echo "$rest" | sed 's/@.*//')
            server=$(echo "$rest" | sed 's/.*@//' | sed 's/:.*//')
            port=$(echo "$rest" | sed 's/.*://')
        fi
    fi
    
    [ -z "$name" ] && name="$server:$port"
    
    if [ -n "$server" ] && [ -n "$port" ] && [ -n "$password" ]; then
        echo "{\"protocol\":\"shadowsocks\",\"name\":\"$name\",\"server\":\"$server\",\"server_port\":$port,\"method\":\"$method\",\"password\":\"$password\"}"
    fi
}

# Parse VLESS URL: vless://uuid@server:port?params#name
# Length of a JSON array; always a number, 0 for empty or broken input
# (a bare "jq length || echo 0" yields "" on empty input and let a refresh wipe a list)
json_len() {
    local n=$(printf '%s' "$1" | jq 'if type == "array" then length else 0 end' 2>/dev/null)
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    echo "$n"
}

parse_vless_url() {
    local url="$1"
    local data="${url#vless://}"
    local name=""
    
    if echo "$data" | grep -q '#'; then
        name=$(echo "$data" | sed 's/.*#//')
        name=$(url_decode "$name")
        data=$(echo "$data" | sed 's/#.*//')
    fi
    
    local uuid=$(echo "$data" | sed 's/@.*//')
    local rest=$(echo "$data" | sed 's/.*@//')
    # Remove path from hostport (format server:port/path?params or server:port?params)
    local hostport=$(echo "$rest" | sed 's/[?/].*//')
    local params=$(echo "$rest" | grep '?' | sed 's/.*?//')
    
    local server=$(echo "$hostport" | sed 's/:.*//')
    local port=$(echo "$hostport" | sed 's/.*://')
    
    # Parse parameters
    local transport="" security="" sni="" fp="" pbk="" sid="" flow="" spx="" encryption="" alpn=""
    local transport_path="" transport_host="" transport_mode=""
    
    for param in $(echo "$params" | tr '&' ' '); do
        local key=$(echo "$param" | cut -d= -f1)
        local value=$(echo "$param" | cut -d= -f2-)
        value=$(url_decode "$value")
        
        case "$key" in
            type) transport="$value" ;;
            security) security="$value" ;;
            sni|serverName) sni="$value" ;;
            fp|fingerprint) fp="$value" ;;
            pbk) pbk="$value" ;;
            sid) sid="$value" ;;
            flow) flow="$value" ;;
            spx) spx="$value" ;;
            encryption) encryption="$value" ;;
            path) transport_path="$value" ;;
            host) transport_host="$value" ;;
            mode) transport_mode="$value" ;;
            alpn) alpn="$value" ;;
        esac
    done
    
    [ -z "$name" ] && name="$server:$port"
    [ -z "$fp" ] && fp="chrome"
    [ -z "$transport" ] && transport="tcp"
    
    # Build transport JSON - always include transport_type for validation
    local transport_json=",\"transport_type\":\"$transport\""
    if [ "$transport" = "ws" ] || [ "$transport" = "xhttp" ] || [ "$transport" = "grpc" ]; then
        transport_json="$transport_json,\"transport_path\":\"$transport_path\",\"transport_host\":\"$transport_host\""
    fi
    if [ "$transport" = "xhttp" ] && [ -n "$transport_mode" ]; then
        transport_json="$transport_json,\"transport_mode\":\"$transport_mode\""
    fi
    
    # ALPN for TLS
    local alpn_json=""
    [ -n "$alpn" ] && alpn_json=",\"alpn\":\"$alpn\""
    
    if [ -n "$server" ] && [ -n "$port" ] && [ -n "$uuid" ]; then
        echo "{\"protocol\":\"vless\",\"name\":\"$name\",\"server\":\"$server\",\"server_port\":$port,\"uuid\":\"$uuid\",\"flow\":\"$flow\",\"security\":\"$security\",\"sni\":\"$sni\",\"fingerprint\":\"$fp\",\"public_key\":\"$pbk\",\"short_id\":\"$sid\"$alpn_json$transport_json}"
    fi
}

# Parse Trojan URL: trojan://password@server:port?params#name
parse_trojan_url() {
    local url="$1"
    local data="${url#trojan://}"
    local name=""
    
    if echo "$data" | grep -q '#'; then
        name=$(echo "$data" | sed 's/.*#//')
        name=$(url_decode "$name")
        data=$(echo "$data" | sed 's/#.*//')
    fi
    
    local password=$(echo "$data" | sed 's/@.*//')
    password=$(url_decode "$password")
    local rest=$(echo "$data" | sed 's/.*@//')
    local hostport=$(echo "$rest" | sed 's/?.*//')
    local params=$(echo "$rest" | grep '?' | sed 's/.*?//')
    
    local server=$(echo "$hostport" | sed 's/:.*//')
    local port=$(echo "$hostport" | sed 's/.*://')
    
    local sni=""
    local transport_type=""
    local transport_path=""
    local transport_host=""
    
    for param in $(echo "$params" | tr '&' ' '); do
        local key=$(echo "$param" | cut -d= -f1)
        local value=$(echo "$param" | cut -d= -f2-)
        value=$(url_decode "$value")
        case "$key" in
            sni|serverName) sni="$value" ;;
            type) transport_type="$value" ;;
            path) transport_path="$value" ;;
            host) transport_host="$value" ;;
        esac
    done
    
    [ -z "$name" ] && name="$server:$port"
    
    # Build transport JSON if WebSocket
    local transport_json=""
    if [ "$transport_type" = "ws" ]; then
        transport_json=",\"transport_type\":\"ws\",\"transport_path\":\"$transport_path\",\"transport_host\":\"$transport_host\""
    fi
    
    if [ -n "$server" ] && [ -n "$port" ] && [ -n "$password" ]; then
        echo "{\"protocol\":\"trojan\",\"name\":\"$name\",\"server\":\"$server\",\"server_port\":$port,\"password\":\"$password\",\"sni\":\"$sni\"$transport_json}"
    fi
}

# Parse Hysteria2 URL: hysteria2://auth@server:port/?sni=..&insecure=1&obfs=salamander&obfs-password=..#name
# (hy2:// is the same). Port hopping (mport) and client-only extras (fm, pinSHA256) are not carried over.
parse_hysteria2_url() {
    local url="$1"
    local data="${url#*://}"
    local name=""

    if echo "$data" | grep -q '#'; then
        name=$(url_decode "$(echo "$data" | sed 's/.*#//')")
        data=$(echo "$data" | sed 's/#.*//')
    fi

    local password=""
    if echo "$data" | grep -q '@'; then
        password=$(url_decode "$(echo "$data" | sed 's/@[^@]*$//')")
        data=$(echo "$data" | sed 's/.*@//')
    fi
    local hostport=$(echo "$data" | sed 's/[/?].*//')
    local params=$(echo "$data" | grep '?' | sed 's/[^?]*?//')

    local server port
    case "$hostport" in
        \[*) server=$(echo "$hostport" | sed 's/^\[\([^]]*\)\].*/\1/'); port=$(echo "$hostport" | sed -n 's/^\[[^]]*\]:\([0-9]*\).*/\1/p') ;;
        *) server=$(echo "$hostport" | sed 's/:.*//'); port=$(echo "$hostport" | sed -n 's/^[^:]*:\([0-9]*\).*/\1/p') ;;
    esac
    [ -z "$port" ] && port=443

    local sni="" insecure="" obfs="" obfs_password="" alpn=""
    for param in $(echo "$params" | tr '&' ' '); do
        local key=$(echo "$param" | cut -d= -f1)
        local value=$(url_decode "$(echo "$param" | cut -d= -f2-)")
        case "$key" in
            sni|peer) sni="$value" ;;
            insecure|allowInsecure) insecure="$value" ;;
            obfs) obfs="$value" ;;
            obfs-password|obfs_password) obfs_password="$value" ;;
            alpn) alpn="$value" ;;
            auth) [ -z "$password" ] && password="$value" ;;
        esac
    done
    case "$insecure" in 1|true) insecure=true ;; *) insecure=false ;; esac
    [ "$obfs" = "none" ] && obfs=""

    [ -z "$name" ] && name="$server:$port"

    if [ -n "$server" ] && [ -n "$password" ]; then
        jq -c -n --arg name "$name" --arg server "$server" --argjson port "$port" --arg password "$password" \
            --arg sni "$sni" --argjson insecure "$insecure" --arg obfs "$obfs" --arg obfs_password "$obfs_password" --arg alpn "$alpn" \
            '{protocol: "hysteria2", name: $name, server: $server, server_port: $port, password: $password, sni: $sni}
             + (if $insecure then {skip_verify: true} else {} end)
             + (if $obfs != "" then {obfs: $obfs, obfs_password: $obfs_password} else {} end)
             + (if $alpn != "" then {alpn: $alpn} else {} end)'
    fi
}

# Parse WireGuard/AmneziaWG .conf file
parse_wireguard_conf() {
    local conf_data="$1"
    local name="${2:-}"
    
    local private_key="" address="" dns="" mtu=""
    local public_key="" endpoint="" allowed_ips="" keepalive=""
    local server="" port=""
    
    # AmneziaWG obfuscation parameters
    local jc="" jmin="" jmax="" s1="" s2="" h1="" h2="" h3="" h4=""
    local is_amnezia=0
    
    # Extract values via temp file
    local tmp_file="/tmp/wg_parse_$$"
    echo "$conf_data" | tr -d '\r' > "$tmp_file"
    
    private_key=$(grep -i "^PrivateKey" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    address=$(grep -i "^Address" "$tmp_file" | head -1 | cut -d'=' -f2- | cut -d',' -f1 | tr -d '[:space:]')
    mtu=$(grep -i "^MTU" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    public_key=$(grep -i "^PublicKey" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    endpoint=$(grep -i "^Endpoint" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    
    # AmneziaWG parameters (Jc, Jmin, Jmax, S1, S2, H1-H4)
    jc=$(grep -i "^Jc" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    jmin=$(grep -i "^Jmin" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    jmax=$(grep -i "^Jmax" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    s1=$(grep -i "^S1" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    s2=$(grep -i "^S2" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    h1=$(grep -i "^H1" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    h2=$(grep -i "^H2" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    h3=$(grep -i "^H3" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    h4=$(grep -i "^H4" "$tmp_file" | head -1 | cut -d'=' -f2- | tr -d '[:space:]')
    
    rm -f "$tmp_file"
    
    # Detect AmneziaWG by presence of characteristic parameters
    if [ -n "$jc" ] || [ -n "$h1" ]; then
        is_amnezia=1
    fi
    
    server=$(echo "$endpoint" | sed 's/:.*//')
    port=$(echo "$endpoint" | sed 's/.*://')
    
    [ -z "$mtu" ] && mtu="1280"
    
    # Default name based on protocol
    if [ -z "$name" ]; then
        if [ "$is_amnezia" = "1" ]; then
            name="AmneziaWG $server"
        else
            name="WireGuard $server"
        fi
    fi
    
    # Add /32 mask to address if missing (sing-box requires CIDR)
    if [ -n "$address" ] && ! echo "$address" | grep -q '/'; then
        address="${address}/32"
    fi
    
    if [ -n "$server" ] && [ -n "$port" ] && [ -n "$private_key" ] && [ -n "$public_key" ]; then
        if [ "$is_amnezia" = "1" ]; then
            # AmneziaWG with obfuscation parameters
            local awg_params=""
            [ -n "$jc" ] && awg_params="$awg_params,\"jc\":$jc"
            [ -n "$jmin" ] && awg_params="$awg_params,\"jmin\":$jmin"
            [ -n "$jmax" ] && awg_params="$awg_params,\"jmax\":$jmax"
            [ -n "$s1" ] && awg_params="$awg_params,\"s1\":$s1"
            [ -n "$s2" ] && awg_params="$awg_params,\"s2\":$s2"
            [ -n "$h1" ] && awg_params="$awg_params,\"h1\":$h1"
            [ -n "$h2" ] && awg_params="$awg_params,\"h2\":$h2"
            [ -n "$h3" ] && awg_params="$awg_params,\"h3\":$h3"
            [ -n "$h4" ] && awg_params="$awg_params,\"h4\":$h4"
            echo "{\"protocol\":\"amneziawg\",\"name\":\"$name\",\"server\":\"$server\",\"server_port\":$port,\"private_key\":\"$private_key\",\"peer_public_key\":\"$public_key\",\"local_address\":\"$address\",\"mtu\":$mtu$awg_params}"
        else
        echo "{\"protocol\":\"wireguard\",\"name\":\"$name\",\"server\":\"$server\",\"server_port\":$port,\"private_key\":\"$private_key\",\"peer_public_key\":\"$public_key\",\"local_address\":\"$address\",\"mtu\":$mtu}"
        fi
    else
        echo "null"
    fi
}

# Main URL parsing function
parse_vpn_url() {
    local url="$1"
    
    # First check WireGuard .conf format (multiline)
    if echo "$url" | grep -q '\[Interface\]'; then
        parse_wireguard_conf "$url"
        return
    fi
    
    case "$url" in
        ss://*)
            parse_ss_url "$url"
            ;;
        vless://*)
            parse_vless_url "$url"
            ;;
        trojan://*)
            parse_trojan_url "$url"
            ;;
        hysteria2://*|hy2://*)
            parse_hysteria2_url "$url"
            ;;
        vmess://*)
            # VMess is usually base64 encoded JSON
            local data="${url#vmess://}"
            local decoded=$(base64_decode "$data")
            if [ -n "$decoded" ]; then
                # Extract fields from JSON (port and aid can be strings in VMess JSON)
                local server=$(json_get_value "$decoded" "add")
                local port=$(json_get_value "$decoded" "port")
                local uuid=$(json_get_value "$decoded" "id")
                local name=$(json_get_value "$decoded" "ps")
                local aid=$(json_get_value "$decoded" "aid")
                local security=$(json_get_value "$decoded" "scy")
                local sni=$(json_get_value "$decoded" "sni")
                local tls=$(json_get_value "$decoded" "tls")
                local net=$(json_get_value "$decoded" "net")
                local ws_path=$(json_get_value "$decoded" "path")
                local ws_host=$(json_get_value "$decoded" "host")
                
                [ -z "$name" ] && name="$server:$port"
                [ -z "$aid" ] && aid=0
                [ -z "$security" ] && security="auto"
                
                # Build transport JSON for WebSocket
                local transport_json=""
                if [ "$net" = "ws" ]; then
                    transport_json=",\"transport_type\":\"ws\",\"transport_path\":\"$ws_path\",\"transport_host\":\"$ws_host\""
                fi
                
                # Build TLS JSON
                local tls_json=""
                if [ "$tls" = "tls" ] && [ -n "$sni" ]; then
                    tls_json=",\"sni\":\"$sni\""
                fi
                
                if [ -n "$server" ] && [ -n "$port" ] && [ -n "$uuid" ]; then
                    echo "{\"protocol\":\"vmess\",\"name\":\"$name\",\"server\":\"$server\",\"server_port\":$port,\"uuid\":\"$uuid\",\"alter_id\":$aid,\"security\":\"$security\"$tls_json$transport_json}"
                fi
            fi
            ;;
        *)
            echo "null"
            ;;
    esac
}

# ============================================
# Export: turn a stored config back into a shareable link
# ============================================

# Percent-encode the characters that would break a URI fragment or query value.
uri_escape() {
    printf '%s' "$1" | sed -e 's|%|%25|g' -e 's|/|%2F|g' -e 's|:|%3A|g' \
        -e 's|?|%3F|g' -e 's|#|%23|g' -e 's|&|%26|g' -e 's|=|%3D|g' -e 's| |%20|g'
}

# Read one key from a config file; empty string when absent or JSON null.
cfg_get() {
    jq -r --arg k "$2" '(.[$k] // "") | tostring' "$1" 2>/dev/null
}

# Append "key=value" to the query string held in $_q, skipping empty values.
_q_add() {
    [ -z "$2" ] && return 0
    [ "$2" = "null" ] && return 0
    _q="${_q}${_q:+&}$1=$2"
}

# Build a client link for a stored config. Prints nothing for protocols that
# have no URI form (WireGuard/AmneziaWG) — those are exported as .conf files
# instead, see config_to_conf().
config_to_link() {
    local f="$1"
    [ -f "$f" ] || return 1

    local proto name server port label
    proto=$(cfg_get "$f" protocol)
    name=$(cfg_get "$f" name)
    [ -n "$name" ] || name=$(cfg_get "$f" remarks)
    [ -n "$name" ] || name=$(cfg_get "$f" id)
    server=$(cfg_get "$f" server)
    port=$(cfg_get "$f" server_port)
    label=$(uri_escape "$name")

    case "$proto" in
        shadowsocks)
            local userinfo
            userinfo=$(printf '%s:%s' "$(cfg_get "$f" method)" "$(cfg_get "$f" password)" \
                | base64 2>/dev/null | tr -d '\n')
            [ -n "$userinfo" ] || return 1
            printf 'ss://%s@%s:%s#%s\n' "$userinfo" "$server" "$port" "$label"
            ;;
        vless|trojan)
            local _q="" cred sec pbk sid path
            if [ "$proto" = "vless" ]; then
                cred=$(cfg_get "$f" uuid)
            else
                cred=$(cfg_get "$f" password)
            fi
            [ -n "$cred" ] || return 1
            _q_add type "$(cfg_get "$f" transport_type)"
            _q_add mode "$(cfg_get "$f" transport_mode)"
            path=$(cfg_get "$f" transport_path)
            [ -n "$path" ] && _q_add path "$(uri_escape "$path")"
            _q_add host "$(cfg_get "$f" transport_host)"
            sec=$(cfg_get "$f" security)
            [ -n "$sec" ] || sec=$(cfg_get "$f" tls)
            _q_add security "$sec"
            _q_add sni "$(cfg_get "$f" sni)"
            _q_add fp "$(cfg_get "$f" fingerprint)"
            pbk=$(cfg_get "$f" reality_public_key)
            [ -n "$pbk" ] || pbk=$(cfg_get "$f" public_key)
            _q_add pbk "$pbk"
            sid=$(cfg_get "$f" reality_short_id)
            [ -n "$sid" ] || sid=$(cfg_get "$f" short_id)
            _q_add sid "$sid"
            _q_add flow "$(cfg_get "$f" flow)"
            _q_add alpn "$(cfg_get "$f" alpn)"
            printf '%s://%s@%s:%s?%s#%s\n' "$proto" "$cred" "$server" "$port" "$_q" "$label"
            ;;
        hysteria2)
            local _q="" cred
            cred=$(cfg_get "$f" password)
            [ -n "$cred" ] || return 1
            _q_add sni "$(cfg_get "$f" sni)"
            [ "$(cfg_get "$f" skip_verify)" = "true" ] && _q_add insecure 1
            _q_add obfs "$(cfg_get "$f" obfs)"
            _q_add obfs-password "$(uri_escape "$(cfg_get "$f" obfs_password)")"
            _q_add alpn "$(cfg_get "$f" alpn)"
            case "$server" in *:*) server="[$server]" ;; esac
            printf 'hysteria2://%s@%s:%s/%s#%s\n' "$(uri_escape "$cred" | sed 's|@|%40|g')" "$server" "$port" "${_q:+?$_q}" "$label"
            ;;
        vmess)
            # VMess carries its parameters as base64-encoded JSON, not a query string.
            local payload
            payload=$(jq -c -n \
                --arg v "2" \
                --arg ps "$name" \
                --arg add "$server" \
                --arg port "$port" \
                --arg id "$(cfg_get "$f" uuid)" \
                --arg aid "$(cfg_get "$f" alter_id)" \
                --arg scy "$(cfg_get "$f" security)" \
                --arg net "$(cfg_get "$f" transport_type)" \
                --arg host "$(cfg_get "$f" transport_host)" \
                --arg path "$(cfg_get "$f" transport_path)" \
                --arg tls "$(cfg_get "$f" tls)" \
                --arg sni "$(cfg_get "$f" sni)" \
                '{v:$v,ps:$ps,add:$add,port:$port,id:$id,aid:(($aid|length>0)|if . then $aid else "0" end),scy:(($scy|length>0)|if . then $scy else "auto" end),net:(($net|length>0)|if . then $net else "tcp" end),host:$host,path:$path,tls:$tls,sni:$sni}' 2>/dev/null)
            [ -n "$payload" ] || return 1
            printf 'vmess://%s\n' "$(printf '%s' "$payload" | base64 2>/dev/null | tr -d '\n')"
            ;;
        *)
            return 1
            ;;
    esac
}

# Rebuild a WireGuard/AmneziaWG .conf for configs that were imported as files.
config_to_conf() {
    local f="$1"
    [ -f "$f" ] || return 1

    local proto
    proto=$(cfg_get "$f" protocol)
    case "$proto" in
        wireguard|amneziawg) ;;
        *) return 1 ;;
    esac

    local addr dns mtu psk k
    addr=$(cfg_get "$f" local_address)
    [ -n "$addr" ] || addr=$(cfg_get "$f" address)
    dns=$(cfg_get "$f" dns)
    mtu=$(cfg_get "$f" mtu)
    psk=$(cfg_get "$f" pre_shared_key)

    echo "[Interface]"
    echo "PrivateKey = $(cfg_get "$f" private_key)"
    [ -n "$addr" ] && echo "Address = $addr"
    [ -n "$dns" ] && echo "DNS = $dns"
    [ -n "$mtu" ] && echo "MTU = $mtu"
    # AmneziaWG obfuscation parameters, absent on plain WireGuard.
    for k in jc jmin jmax s1 s2 h1 h2 h3 h4; do
        local v
        v=$(cfg_get "$f" "$k")
        [ -n "$v" ] && echo "$(echo "$k" | tr 'a-z' 'A-Z') = $v"
    done
    echo
    echo "[Peer]"
    echo "PublicKey = $(cfg_get "$f" peer_public_key)"
    [ -n "$psk" ] && echo "PresharedKey = $psk"
    echo "AllowedIPs = $(cfg_get "$f" allowed_ips || echo '0.0.0.0/0, ::/0')"
    echo "Endpoint = $(cfg_get "$f" server):$(cfg_get "$f" server_port)"
}

# ============================================
# Rule-set for VPN clients (ss-server-in)
# ============================================

# Generate JSON array of domain_suffix from vpn-domains.txt (merged with remote)
# --- List sets (B1) -----------------------------------------------------------
# "world" = the original lists, "russia" = direct-*.txt (+ remote-lists/direct/).
# Prints "<local file> <remote file>" of set $1 and list $2 (dom|dom_udp|sub|sub_udp)
list_set_files() {
    case "$1:$2" in
        russia:dom)     echo "$VPN_MANAGER_HOME/direct-domains.txt $REMOTE_LISTS_DIR/direct/tcp_udp_domains.txt" ;;
        russia:dom_udp) echo "$VPN_MANAGER_HOME/direct-domains-udp.txt $REMOTE_LISTS_DIR/direct/udp_domains.txt" ;;
        russia:sub)     echo "$VPN_MANAGER_HOME/direct-subnets.txt $REMOTE_LISTS_DIR/direct/tcp_udp_subnets.txt" ;;
        russia:sub_udp) echo "$VPN_MANAGER_HOME/direct-subnets-udp.txt $REMOTE_LISTS_DIR/direct/udp_subnets.txt" ;;
        *:dom)          echo "$VPN_DOMAINS_TCPUDP $REMOTE_DOMAINS_TCPUDP" ;;
        *:dom_udp)      echo "$VPN_DOMAINS_UDPONLY $REMOTE_DOMAINS_UDPONLY" ;;
        *:sub)          echo "$VPN_SUBNETS_TCPUDP $REMOTE_SUBNETS_TCPUDP" ;;
        *:sub_udp)      echo "$VPN_SUBNETS_UDPONLY $REMOTE_SUBNETS_UDPONLY" ;;
    esac
}

# Which set a split mode uses: "split" (Direct primary) sends its set via VPN,
# "vpnprimary" sends its set direct. settings.json list_binding, defaults world / russia.
list_binding() {
    local v=$(jq -r --arg m "$1" '.list_binding[$m] // empty' "$SETTINGS_FILE" 2>/dev/null)
    case "$v" in
        world|russia) echo "$v" ;;
        *) if [ "$1" = "vpnprimary" ]; then echo russia; else echo world; fi ;;
    esac
}

# JSON array for sing-box rules: domain suffixes (dom*) or CIDRs (sub*) of set $1, list $2
list_set_json() {
    local files=$(list_set_files "$1" "$2")
    local merged_content=$(get_merged_content "${files% *}" "${files#* }")
    [ -z "$merged_content" ] && echo "[]" && return
    case "$2" in
        dom*) echo "$merged_content" | sed 's/^\*\.//; s/^\*//' | grep -v '^$' ;;
        *)    echo "$merged_content" | grep -E '^[0-9a-fA-F.:]+/[0-9]+$' ;;
    esac | awk 'BEGIN { printf "[" } NR>1 { printf "," } { printf "\"%s\"", $0 } END { printf "]" }'
}

# World-set shortcuts, kept for existing callers
generate_domain_suffixes_json()     { list_set_json world dom; }
generate_ip_cidrs_json()            { list_set_json world sub; }
generate_domain_suffixes_udp_json() { list_set_json world dom_udp; }
generate_ip_cidrs_udp_json()        { list_set_json world sub_udp; }

# --- Access of VPN-server clients to the panel and the home network (B8) --------
# settings.json vpn_lan_access: off (default) / panel / lan. sing-box dials for the
# ss-server-in clients itself, and its plain "direct" outbound follows
# auto_detect_interface to the internet port: requests to home addresses went to the
# ISP and timed out. Each home bridge gets a direct outbound bound to it; the rules go
# first, before the rules of the VPN-server segment policy, and take private
# addresses only, so internet traffic still follows the segment policy.
# What the owner chose in the panel
vpn_lan_access_setting() {
    local v=$(jq -r '.vpn_lan_access // empty' "$SETTINGS_FILE" 2>/dev/null)
    case "$v" in
        panel|lan) echo "$v" ;;
        *) echo off ;;
    esac
}

# The panel has a password only in "password" mode ("first_login" still has the default one)
panel_password_set() {
    [ -f "$AUTH_DB" ] && grep -q '"auth_mode"[[:space:]]*:[[:space:]]*"password"' "$AUTH_DB" 2>/dev/null
}

# What the rules actually give. The password is checked here, when the rules are built,
# not only when the setting is saved: a password recovery, a reinstall or a restored
# backup can leave the setting on with no password. Without a password access stays on
# only when the owner dropped it after the panel's warning ("disabled" mode + the mark);
# "first_login" never counts.
vpn_lan_access() {
    local v=$(vpn_lan_access_setting)
    if [ "$v" = off ] || panel_password_set; then
        echo "$v"
        return
    fi
    if grep -q '"auth_mode"[[:space:]]*:[[:space:]]*"disabled"' "$AUTH_DB" 2>/dev/null && \
       [ "$(jq -r '.vpn_lan_access_no_password // false' "$SETTINGS_FILE" 2>/dev/null)" = true ]; then
        echo "$v"
    else
        echo off
    fi
}

# The "no password, risk accepted" mark: set when the owner drops the password after
# the warning, cleared by a new password, a new choice of access or a recovery
vpn_lan_no_password_mark() {
    [ -f "$SETTINGS_FILE" ] || return 0
    local tmp="$SETTINGS_FILE.tmp.$$" expr='del(.vpn_lan_access_no_password)'
    [ "$1" = set ] && expr='.vpn_lan_access_no_password = true'
    # cat, not mv: keeps the file's owner and mode (settings.json is private)
    if jq "$expr" "$SETTINGS_FILE" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
        cat "$tmp" > "$SETTINGS_FILE"
    fi
    rm -f "$tmp"
}

# A change of the panel login (or of the panel port) can change the access the rules
# give: rebuild them. sing-box checks the result first (on failure the previous config
# stays), and is restarted only when the config really changed — a restart drops
# every tunnel of the router.
vpn_lan_rebuild() {
    [ "$(vpn_lan_access_setting)" = off ] && return 0
    local prev="/tmp/vpn-lan-rebuild.prev.$$"
    cp "$SINGBOX_CONFIG" "$prev" 2>/dev/null || return 1
    if update_vpnclient_rules && singbox_config_ok; then
        if ! cmp -s "$prev" "$SINGBOX_CONFIG"; then
            check_singbox_running && singbox_restart
        fi
    elif [ "$(vpn_lan_access)" = off ] && vpn_lan_strip "$prev" > "$prev.off" 2>/dev/null && [ -s "$prev.off" ]; then
        # Access is being taken away (a password recovery, say): never fall back to the
        # old allow rules — the previous config without the B8 rules instead
        cat "$prev.off" > "$SINGBOX_CONFIG"
        cmp -s "$prev" "$SINGBOX_CONFIG" || { check_singbox_running && singbox_restart; }
        log_action "VPN_LAN_ACCESS" "Rebuild failed, B8 rules removed from the previous sing-box config"
    else
        cat "$prev" > "$SINGBOX_CONFIG"
        log_action "VPN_LAN_ACCESS" "Rebuild failed, previous sing-box config kept"
    fi
    rm -f "$prev" "$prev.off"
}

# A sing-box config with every B8 rule and outbound removed — the same as with access
# off (install-singbox.sh does the same on a reinstall)
vpn_lan_strip() {
    jq -e '.route.rules = [(.route.rules // [])[] | select((((.outbound // "") | startswith("direct-lan-")) or (.inbound == ["ss-server-in"] and .action == "reject")) | not)]
           | .outbounds = [(.outbounds // [])[] | select((.tag // "") | startswith("direct-lan-") | not)]' "$1"
}

# sing-box's own check of a config file; passes where sing-box is not installed
singbox_config_ok() {
    command -v sing-box >/dev/null 2>&1 || return 0
    sing-box check -c "${1:-$SINGBOX_CONFIG}" >/dev/null 2>&1
}

# Port lighttpd serves the panel on
panel_port() {
    local p=$(grep -oE 'server\.port[[:space:]]*=[[:space:]]*[0-9]+' /opt/etc/lighttpd/conf.d/00-vpn-manager-base.conf 2>/dev/null | grep -oE '[0-9]+$' | head -1)
    echo "${p:-8001}"
}

# Home segments from the segments cache, one per line: "bridge network/prefix router_ip".
# The cache keeps the router address with the prefix (192.168.1.1/24): the network is
# computed here. The format is checked in awk, not jq: the router's jq is built without
# regular expressions (test/match fail there).
vpn_lan_segments() {
    jq -r '.segments[]? | "\(.bridge // "") \(.subnet // "")"' "$VPN_MANAGER_HOME/segments_cache.json" 2>/dev/null |
    awk 'NF == 2 && $1 ~ /^[a-z0-9]+$/ && $2 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+$/ {
        split($2, a, "/"); split(a[1], o, ".")
        bits = a[2] + 0
        if (bits < 8 || bits > 32) next
        ip = ((o[1] * 256 + o[2]) * 256 + o[3]) * 256 + o[4]
        size = 2 ^ (32 - bits)
        net = ip - (ip % size)
        printf "%s %d.%d.%d.%d/%d %s\n", $1, int(net / 16777216) % 256, int(net / 65536) % 256, int(net / 256) % 256, net % 256, bits, a[1]
    }'
}

# Rules for ss-server-in, placed before its policy rules (none while access is off:
# the config is then exactly as before B8):
#   both  - the panel: its name, its spare address and the router's own addresses on the
#           panel port go to 127.0.0.1 through a loopback-bound outbound. The router
#           cannot reach its own address through a bridge (a socket bound to br0 gets no
#           answer from it, checked 14.09); lighttpd lets 127.x in (99-vpn-manager.conf)
#   panel - the rest of the home segments and the router's loopback are refused at once
#   lan   - the home segments go to their bridges; the router's loopback is refused.
#           The router's other ports stay unreachable over the VPN, as before B8 (the
#           owner's decision: B8 does not open or close them)
# Other private addresses (a modem behind the internet port) keep following the policy.
# The outbounds these rules name (direct-lan-lo, direct-lan-<bridge>) are derived from
# the rules by the two rebuilds, so the two can never disagree.
# The name (home.arpa, RFC 8375, the zone for home networks) reaches the router with
# clients that pass the site name on (Shadowrocket; over plain HTTP sing-box also reads
# it from the request). The spare address is public, so every client sends it into the
# tunnel; only its panel port is taken, and for VPN-server clients only. Many VPN
# clients send private addresses to the phone's own network instead of the tunnel.
# Home devices get the same name from dnsmasq (update_panel_name_dns).
VPN_PANEL_NAME="panel.home.arpa"
VPN_PANEL_IP="1.1.1.1"
vpn_lan_rules_json() {
    local mode=$(vpn_lan_access) port=$(panel_port)
    if [ "$mode" = off ]; then
        echo '[]'
        return
    fi
    local segs=$(vpn_lan_segments)
    local to_panel='"action":"route","outbound":"direct-lan-lo","override_address":"127.0.0.1"'
    {
        printf '{"inbound":["ss-server-in"],"domain":["%s"],"port":[%s],%s}\n' "$VPN_PANEL_NAME" "$port" "$to_panel"
        printf '{"inbound":["ss-server-in"],"ip_cidr":["%s/32"],"port":[%s],%s}\n' "$VPN_PANEL_IP" "$port" "$to_panel"
        # The router's own addresses, panel port
        echo "$segs" | awk 'NF {print $3 "/32"}' |
            jq -R -s -c --argjson port "$port" 'split("\n") | map(select(length > 0))
                | if length > 0 then {inbound: ["ss-server-in"], ip_cidr: ., port: [$port], action: "route", outbound: "direct-lan-lo", override_address: "127.0.0.1"} else empty end'
        if [ "$mode" = lan ]; then
            echo "$segs" | while read -r br net ip; do
                [ -n "$br" ] || continue
                printf '{"inbound":["ss-server-in"],"ip_cidr":["%s"],"outbound":"direct-lan-%s"}\n' "$net" "$br"
            done
        fi
        if [ "$mode" = panel ]; then
            echo "$segs" | awk 'NF {print $2}' |
                jq -R -s -c 'split("\n") | map(select(length > 0)) + ["127.0.0.0/8"] | {inbound: ["ss-server-in"], ip_cidr: ., action: "reject"}'
        else
            echo '{"inbound":["ss-server-in"],"ip_cidr":["127.0.0.0/8"],"action":"reject"}'
        fi
    } | jq -s -c '.'
}

# The panel name for home devices (B8; does not depend on the VPN access setting):
# dnsmasq answers with the router's address in the segment the query came from.
# The file is rewritten, and dnsmasq restarted, only when it changed.
PANEL_NAME_CONF="${PANEL_NAME_CONF:-/opt/etc/dnsmasq.d/panel-name.conf}"
update_panel_name_dns() {
    local segs=$(vpn_lan_segments)
    # Segments not known yet: leave the file as it is
    [ -n "$segs" ] || return 0
    # A leading dot: dnsmasq skips such files in conf-dir, should it restart meanwhile
    local tmp="$(dirname "$PANEL_NAME_CONF")/.$(basename "$PANEL_NAME_CONF").tmp.$$"
    mkdir -p "$(dirname "$PANEL_NAME_CONF")" 2>/dev/null
    if ! {
        echo "# VPN Manager (B8): $VPN_PANEL_NAME -> the router, in the segment of the asking device"
        echo "localise-queries"
        echo "$segs" | awk -v n="$VPN_PANEL_NAME" 'NF {print "interface-name=" n "," $1 "/4"}'
    } > "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        return 1
    fi
    if cmp -s "$tmp" "$PANEL_NAME_CONF"; then
        rm -f "$tmp"
        return 0
    fi
    mv "$tmp" "$PANEL_NAME_CONF" && dnsmasq_restart
}

# Generate routing rules for VPN clients (ss-server-in)
# These rules duplicate iptables/ipset logic for local clients
# Supports 4 lists: vpn-domains.txt, vpn-domains-udp.txt, vpn-subnets.txt, vpn-subnets-udp.txt
# Parameters:
#   $1 - vpn_tag (outbound name for VPN, default "vpn")
#   $2 - policy (direct/split/fullvpn, default "split")
generate_vpnclient_route_rules() {
    local vpn_tag="$1"
    local policy="$2"
    [ -z "$vpn_tag" ] && vpn_tag="vpn"
    [ -z "$policy" ] && policy="split"
    
    local rules="["
    local has_rules=0
    
    case "$policy" in
        direct)
            # All ss-server-in traffic -> direct (VPN not used)
            rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"network\": [\"tcp\", \"udp\"],
    \"outbound\": \"direct\"
  }"
            has_rules=1
            ;;
        fullvpn)
            # All ss-server-in traffic -> VPN
            rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"network\": [\"tcp\", \"udp\"],
    \"outbound\": \"$vpn_tag\"
  }"
            has_rules=1
            ;;
        split|vpnprimary|*)
            # Direct primary (split): only the lists of its set go via VPN.
            # VPN primary: the same set still goes via VPN first (a specific site there
            # wins over a whole zone in the direct set), then the direct set goes
            # direct, then everything else via VPN.
            local via_set=$(list_binding split)

            # TCP+UDP lists (all traffic via VPN)
            local domain_suffixes=$(list_set_json "$via_set" dom)
            local ip_cidrs=$(list_set_json "$via_set" sub)

            # UDP-only lists (only UDP via VPN)
            local domain_suffixes_udp=$(list_set_json "$via_set" dom_udp)
            local ip_cidrs_udp=$(list_set_json "$via_set" sub_udp)

            # Rule 1: TCP+UDP domains -> VPN
            if [ "$domain_suffixes" != "[]" ]; then
                [ $has_rules -eq 1 ] && rules="$rules,"
                rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"domain_suffix\": $domain_suffixes,
    \"outbound\": \"$vpn_tag\"
  }"
                has_rules=1
            fi
            
            # Rule 2: TCP+UDP subnets -> VPN
            if [ "$ip_cidrs" != "[]" ]; then
                [ $has_rules -eq 1 ] && rules="$rules,"
                rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"ip_cidr\": $ip_cidrs,
    \"outbound\": \"$vpn_tag\"
  }"
                has_rules=1
            fi
            
            # Rule 3: UDP-only domains -> VPN (UDP only)
            if [ "$domain_suffixes_udp" != "[]" ]; then
                [ $has_rules -eq 1 ] && rules="$rules,"
                rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"network\": [\"udp\"],
    \"domain_suffix\": $domain_suffixes_udp,
    \"outbound\": \"$vpn_tag\"
  }"
                has_rules=1
            fi
            
            # Rule 4: UDP-only subnets -> VPN (UDP only)
            if [ "$ip_cidrs_udp" != "[]" ]; then
                [ $has_rules -eq 1 ] && rules="$rules,"
                rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"network\": [\"udp\"],
    \"ip_cidr\": $ip_cidrs_udp,
    \"outbound\": \"$vpn_tag\"
  }"
                has_rules=1
            fi
            
            # Default for the rest: direct in Direct primary, VPN in VPN primary
            local rest_out="direct"
            if [ "$policy" = "vpnprimary" ]; then
                rest_out="$vpn_tag"
                local direct_set=$(list_binding vpnprimary)
                local d_dom=$(list_set_json "$direct_set" dom)
                local d_sub=$(list_set_json "$direct_set" sub)
                local d_dom_udp=$(list_set_json "$direct_set" dom_udp)
                local d_sub_udp=$(list_set_json "$direct_set" sub_udp)
                # Direct set -> direct; its UDP-only lists only for UDP (their TCP stays in VPN)
                local key list net
                for spec in "domain_suffix:$d_dom:" "ip_cidr:$d_sub:" "domain_suffix:$d_dom_udp:udp" "ip_cidr:$d_sub_udp:udp"; do
                    key=${spec%%:*}
                    net=${spec##*:}
                    list=${spec#*:}
                    list=${list%:*}
                    [ "$list" = "[]" ] && continue
                    [ $has_rules -eq 1 ] && rules="$rules,"
                    if [ -n "$net" ]; then
                        rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"network\": [\"udp\"],
    \"$key\": $list,
    \"outbound\": \"direct\"
  }"
                    else
                        rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"$key\": $list,
    \"outbound\": \"direct\"
  }"
                    fi
                    has_rules=1
                done
            fi

            # Rule 5: Everything else (always added for both split modes)
            [ $has_rules -eq 1 ] && rules="$rules,"
            rules="$rules
  {
    \"inbound\": [\"ss-server-in\"],
    \"network\": [\"tcp\", \"udp\"],
    \"outbound\": \"$rest_out\"
  }"
            has_rules=1
            ;;
    esac
    
    rules="$rules
]"

    # B8 rules go first: they take private addresses only, the policy keeps the rest.
    # If they cannot be built the policy rules go out alone, as before.
    local merged=$(printf '%s' "$rules" | jq -c --argjson lan "$(vpn_lan_rules_json)" '$lan + .' 2>/dev/null)
    if [ -n "$merged" ]; then
        echo "$merged"
    else
        echo "$rules"
    fi
}

# Update dnsmasq with domains for ipset
update_dnsmasq_domains() {
    local domains_file="$1"
    [ -z "$domains_file" ] && domains_file="$DOMAINS_FILE"
    
    if [ ! -f "$domains_file" ]; then
        return 1
    fi
    
    mkdir -p "$(dirname "$DNSMASQ_VPN_DOMAINS")"
    
    # Convert domains to dnsmasq ipset format
    > "$DNSMASQ_VPN_DOMAINS"
    
    while IFS= read -r line; do
        # Remove comments and whitespace
        line=$(echo "$line" | sed 's/#.*//' | tr -d '[:space:]')
        [ -z "$line" ] && continue
        
        # Remove wildcard prefix if exists (dnsmasq matches subdomains itself)
        line=$(echo "$line" | sed 's/^\*\.//')
        line=$(echo "$line" | sed 's/^\*//')
        
        [ -n "$line" ] && echo "ipset=/$line/vpn_domains" >> "$DNSMASQ_VPN_DOMAINS"
    done < "$domains_file"
    
    return 0
}

# Update VPN client routing rules in sing-box config
# Called when vpn-domains.txt, vpn-subnets.txt or VPN server policy changes
# Parameters:
#   $1 - policy (optional, if not specified - read from routing_policies.json)
update_vpnclient_rules() {
    if [ ! -f "$SINGBOX_CONFIG" ]; then
        log_action "VPNCLIENT_RULES" "sing-box config not found, skipping"
        return 1
    fi
    
    # Get current active VPN tag
    local vpn_tag="vpn"
    if [ -f "$ACTIVE_CONFIG" ]; then
        local active_id=$(cat "$ACTIVE_CONFIG")
        if [ -n "$active_id" ] && [ -f "$VPN_CONFIGS_DIR/${active_id}.json" ]; then
            vpn_tag="vpn"
        fi
    fi
    
    # Get VPN server policy
    local policy="$1"
    if [ -z "$policy" ]; then
        local routing_policies_file="$VPN_MANAGER_HOME/routing_policies.json"
        if [ -f "$routing_policies_file" ]; then
            policy=$(jq -r '.policies["vpn_server"] // "split"' "$routing_policies_file" 2>/dev/null)
        fi
        [ -z "$policy" ] && policy="split"
    fi
    
    log_action "VPNCLIENT_RULES" "Updating with policy: $policy"
    
    # Generate new rules based on policy
    local vpnclient_rules=$(generate_vpnclient_route_rules "$vpn_tag" "$policy")
    
    if ! command -v jq >/dev/null 2>&1; then
        log_action "VPNCLIENT_RULES" "jq not available"
        return 1
    fi
    
    local tmp_config="/tmp/singbox_vpnclient_update.json"
    
    # Update route.rules and the direct-lan-* outbounds they use (B8), preserving the rest
    jq --argjson vpnclient_rules "$vpnclient_rules" \
       '
       # direct-lan-* (B8): exactly the outbounds the new rules name
       ([$vpnclient_rules[]? | .outbound? // empty | select(type == "string" and startswith("direct-lan-"))] | unique
        | map({type: "direct", tag: ., bind_interface: ltrimstr("direct-lan-")})) as $lan_outbounds
       | .outbounds = ([(.outbounds // [])[] | select((.tag // "") | startswith("direct-lan-") | not)] + $lan_outbounds)
       | .route.rules = (
           # Remove old rules for ss-server-in and ip_is_private, then re-add
           [(.route.rules // [])[] | select(.inbound != ["ss-server-in"] and .ip_is_private != true)]
           + (if $vpnclient_rules != [] then $vpnclient_rules else [] end)
           + [{"ip_is_private": true, "outbound": "direct"}]
         )
       ' \
       "$SINGBOX_CONFIG" > "$tmp_config"
    
    if [ -s "$tmp_config" ] && jq empty "$tmp_config" 2>/dev/null; then
        mv "$tmp_config" "$SINGBOX_CONFIG"
        chmod 644 "$SINGBOX_CONFIG"
        log_action "VPNCLIENT_RULES" "Updated route rules for ss-server-in"
        # The home panel name follows the segments as well (B8)
        update_panel_name_dns
        return 0
    else
        rm -f "$tmp_config"
        log_action "VPNCLIENT_RULES" "ERROR: Failed to update route rules"
        return 1
    fi
}

# Restart sing-box
# ============================================
# sing-box log level (verbose mode)
# ============================================

SINGBOX_VERBOSE_FLAG="/tmp/singbox-verbose-until"

# Unix time until which verbose logging is on, or 0 (flag is in RAM: a reboot ends it)
verbose_log_until() {
    local until=$(cat "$SINGBOX_VERBOSE_FLAG" 2>/dev/null)
    case "$until" in
        ''|*[!0-9]*) echo 0; return ;;
    esac
    if [ "$until" -gt "$(date +%s)" ]; then echo "$until"; else echo 0; fi
}

# "info" (every connection) while verbose mode is on, otherwise "warn"
singbox_log_level() {
    if [ "$(verbose_log_until)" -gt 0 ]; then echo info; else echo warn; fi
}

# Put a log level into the sing-box config; restarts sing-box if it runs and the
# level actually changed.
singbox_set_log_level() {
    local level="$1" tmp="/tmp/singbox_config_loglevel.json"
    [ -f "$SINGBOX_CONFIG" ] || return 1
    [ "$(jq -r '.log.level // empty' "$SINGBOX_CONFIG" 2>/dev/null)" = "$level" ] && return 0
    if jq --arg l "$level" '.log = ((.log // {}) + {level: $l, timestamp: true})' "$SINGBOX_CONFIG" > "$tmp" 2>/dev/null \
        && [ -s "$tmp" ] && jq empty "$tmp" 2>/dev/null; then
        mv "$tmp" "$SINGBOX_CONFIG"
        chmod 644 "$SINGBOX_CONFIG"
    else
        rm -f "$tmp"
        return 1
    fi
    log_action "SINGBOX_LOG_LEVEL" "sing-box log level: $level"
    check_singbox_running && singbox_restart
    return 0
}

singbox_restart() {
    # Remove stop flag (for wrapper with auto-restart)
    rm -f /opt/var/run/sing-box.stopped
    if [ -x "$SINGBOX_INIT" ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
        return $?
    fi
    return 1
}

# Restart iptables rules for sing-box
singbox_rules_restart() {
    if [ -x "$SINGBOX_RULES_INIT" ]; then
        "$SINGBOX_RULES_INIT" restart >/dev/null 2>&1
        return $?
    fi
    return 1
}

# Restart dnsmasq
dnsmasq_restart() {
    if [ -x /opt/etc/init.d/S56dnsmasq ]; then
        /opt/etc/init.d/S56dnsmasq restart >/dev/null 2>&1
    elif [ -x /opt/etc/init.d/S55dnsmasq ]; then
        /opt/etc/init.d/S55dnsmasq restart >/dev/null 2>&1
    fi
    return $?
}

# "Russia" list set (B1) is kept by its own script; a quiet no-op if it is not installed
DIRECT_LISTS_SCRIPT="$VPN_MANAGER_HOME/scripts/direct-lists.sh"
direct_lists() {
    [ -x "$DIRECT_LISTS_SCRIPT" ] || return 0
    "$DIRECT_LISTS_SCRIPT" "$@" >/dev/null 2>&1
}

# Get VPN status
get_vpn_status() {
    if check_singbox_running; then
        echo "running"
    else
        echo "stopped"
    fi
}

# Apply config in sing-box
apply_shadowsocks_config() {
    local config_file="$1"
    
    if [ ! -f "$config_file" ]; then
        return 1
    fi
    
    apply_singbox_outbound "$config_file" "vpn"
    return $?
}

# Domain validation
validate_domain() {
    local line="$1"
    
    # Empty string - OK
    [ -z "$line" ] && return 0
    
    # Comment - OK
    case "$line" in
        \#*) return 0 ;;
    esac
    
    # Wildcard domain: *domain.com or *.domain.com
    if echo "$line" | grep -qE '^\*\.?[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$'; then
        return 0
    fi
    
    # Regular domain: domain.com
    if echo "$line" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$'; then
        return 0
    fi
    
    return 1
}

# ============================================
# Check VPN status
# ============================================

check_ss_running() {
    check_singbox_running
}

get_ss_pid() {
    get_singbox_pid
}

# Simple server availability check (ping)
check_server_ping() {
    local server="$1"
    local timeout="${2:-3}"
    
    ping -c 1 -W "$timeout" "$server" >/dev/null 2>&1
}

# ============================================
# FEAT-009: Active server migration when subscription updates
# ============================================

# Resolve hostname to IP
resolve_to_ip() {
    local host="$1"
    case "$host" in
        [0-9]*.[0-9]*.[0-9]*.[0-9]*) echo "$host"; return ;;
    esac
    nslookup "$host" 2>/dev/null | grep -A1 'Name:' | grep 'Address' | head -1 | awk '{print $NF}' 2>/dev/null
}

# Calculate IP distance (by matching octets, lower = closer)
ip_distance() {
    local ip1="$1"
    local ip2="$2"
    [ -z "$ip1" ] || [ -z "$ip2" ] && echo 999 && return
    
    local a1=$(echo "$ip1" | cut -d. -f1)
    local a2=$(echo "$ip2" | cut -d. -f1)
    local b1=$(echo "$ip1" | cut -d. -f2)
    local b2=$(echo "$ip2" | cut -d. -f2)
    local c1=$(echo "$ip1" | cut -d. -f3)
    local c2=$(echo "$ip2" | cut -d. -f3)
    
    [ "$a1" != "$a2" ] && echo 3 && return
    [ "$b1" != "$b2" ] && echo 2 && return
    [ "$c1" != "$c2" ] && echo 1 && return
    echo 0
}

# Test VPN server connectivity via sing-box outbound mechanism
test_server_connectivity() {
    local server_file="$1"
    local server=$(jq -r '.server' "$server_file" 2>/dev/null)
    local port=$(jq -r '.server_port' "$server_file" 2>/dev/null)
    
    [ -z "$server" ] || [ -z "$port" ] && return 1
    
    local test_hosts="8.8.8.8 4.2.2.2 1.1.1.1"
    for host in $test_hosts; do
        if curl -s --connect-timeout 5 --max-time 8 \
            --proxy "socks5h://127.0.0.1:9090" \
            "http://$host" >/dev/null 2>&1; then
            return 0
        fi
    done
    return 1
}

# Find similar server in subscription
# Priority: 1) name match, 2) server:port match, 3) nearest by IP with connectivity check, 4) first server
# Returns found server ID or empty string
find_similar_server() {
    local old_name="$1"
    local old_server="$2"
    local old_port="$3"
    local subscription_id="$4"
    
    local found_by_address=""
    local first_id=""
    local all_ids=""
    local all_servers=""
    
    for f in "$VPN_CONFIGS_DIR"/*.json; do
        [ -f "$f" ] || continue
        
        local sub_id=$(jq -r '.subscription_id // empty' "$f" 2>/dev/null)
        [ "$sub_id" != "$subscription_id" ] && continue
        
        local id=$(jq -r '.id' "$f" 2>/dev/null)
        local name=$(jq -r '.name' "$f" 2>/dev/null)
        local server=$(jq -r '.server' "$f" 2>/dev/null)
        local port=$(jq -r '.server_port' "$f" 2>/dev/null)
        
        [ -z "$first_id" ] && first_id="$id"
        all_ids="$all_ids $id"
        all_servers="$all_servers $id:$server"
        
        # Priority 1: exact name match
        if [ "$name" = "$old_name" ]; then
            log_action "FIND_SIMILAR" "Found by name: $id ($name)"
            echo "$id"
            return 0
        fi
        
        # Priority 2: server:port match
        if [ "$server" = "$old_server" ] && [ "$port" = "$old_port" ]; then
            found_by_address="$id"
        fi
    done
    
    if [ -n "$found_by_address" ]; then
        log_action "FIND_SIMILAR" "Found by address: $found_by_address ($old_server:$old_port)"
        echo "$found_by_address"
        return 0
    fi
    
    # Priority 3: nearest by IP address
    local old_ip=$(resolve_to_ip "$old_server")
    if [ -n "$old_ip" ]; then
        local best_id=""
        local best_dist=999
        
        for entry in $all_servers; do
            local eid=$(echo "$entry" | cut -d: -f1)
            local eserver=$(echo "$entry" | cut -d: -f2-)
            local eip=$(resolve_to_ip "$eserver")
            [ -z "$eip" ] && continue
            
            local dist=$(ip_distance "$old_ip" "$eip")
            if [ "$dist" -lt "$best_dist" ]; then
                best_dist="$dist"
                best_id="$eid"
            fi
        done
        
        if [ -n "$best_id" ] && [ "$best_dist" -lt 999 ]; then
            log_action "FIND_SIMILAR" "Found nearest by IP (distance=$best_dist): $best_id"
            echo "$best_id"
            return 0
        fi
    fi
    
    # Priority 4: first server as fallback
    if [ -n "$first_id" ]; then
        log_action "FIND_SIMILAR" "Using first server as fallback: $first_id"
        echo "$first_id"
    else
        log_action "FIND_SIMILAR" "No servers found in subscription $subscription_id"
        echo ""
    fi
}

# Check VPN connectivity through the active outbound
# Tests several URLs via sing-box tools fetch; returns 0 if at least one succeeds
check_vpn_connectivity() {
    local outbound="${1:-vpn}"
    local test_urls="https://www.gstatic.com/generate_204 https://ya.ru https://2ip.ru"
    
    for url in $test_urls; do
        if sing-box tools fetch -c "$SINGBOX_CONFIG" -o "$outbound" "$url" >/dev/null 2>&1; then
            log_action "VPN_CHECK" "Connectivity OK via $outbound ($url)"
            return 0
        fi
    done
    
    log_action "VPN_CHECK" "Connectivity FAILED via $outbound (all test URLs unreachable)"
    return 1
}

# Get all servers in a subscription, ranked by similarity to the old active server
# Returns space-separated list of server IDs (best match first)
get_subscription_servers_ranked() {
    local old_name="$1"
    local old_server="$2"
    local old_port="$3"
    local subscription_id="$4"
    
    local by_name=""
    local by_address=""
    local by_ip_ranked=""
    local rest=""
    
    local old_ip=$(resolve_to_ip "$old_server")
    
    # Collect all servers with metadata
    local all_entries=""
    for f in "$VPN_CONFIGS_DIR"/*.json; do
        [ -f "$f" ] || continue
        
        local sub_id=$(jq -r '.subscription_id // empty' "$f" 2>/dev/null)
        [ "$sub_id" != "$subscription_id" ] && continue
        
        local id=$(jq -r '.id' "$f" 2>/dev/null)
        local name=$(jq -r '.name' "$f" 2>/dev/null)
        local server=$(jq -r '.server' "$f" 2>/dev/null)
        local port=$(jq -r '.server_port' "$f" 2>/dev/null)
        
        if [ "$name" = "$old_name" ]; then
            by_name="$id"
        elif [ "$server" = "$old_server" ] && [ "$port" = "$old_port" ]; then
            by_address="$by_address $id"
        else
            # Calculate IP distance for remaining servers
            if [ -n "$old_ip" ]; then
                local eip=$(resolve_to_ip "$server")
                if [ -n "$eip" ]; then
                    local dist=$(ip_distance "$old_ip" "$eip")
                    by_ip_ranked="$by_ip_ranked $dist:$id"
                else
                    rest="$rest $id"
                fi
            else
                rest="$rest $id"
            fi
        fi
    done
    
    # Sort IP-distance entries (ascending)
    local ip_sorted=""
    if [ -n "$by_ip_ranked" ]; then
        ip_sorted=$(echo "$by_ip_ranked" | tr ' ' '\n' | grep ':' | sort -t: -k1 -n | cut -d: -f2 | tr '\n' ' ')
    fi
    
    # Build final ranked list: name match -> address match -> IP distance -> rest
    local result=""
    [ -n "$by_name" ] && result="$by_name"
    [ -n "$by_address" ] && result="$result $by_address"
    [ -n "$ip_sorted" ] && result="$result $ip_sorted"
    [ -n "$rest" ] && result="$result $rest"
    
    echo "$result" | sed 's/^ *//;s/ *$//'
}

# Config of the same subscription that connects exactly like the given config JSON.
# A refresh recreates every config with a new id, name and timestamps even when the
# server is unchanged; switching to such a twin needs no sing-box restart.
# Usage: find_same_server_config '<old config json>'  → prints the new config id
find_same_server_config() {
    local want f
    want=$(echo "$1" | jq -cS 'del(.id, .name, .created_at, .updated_at)' 2>/dev/null)
    [ -n "$want" ] && [ "$want" != "null" ] || return 1
    for f in "$VPN_CONFIGS_DIR"/*.json; do
        [ -f "$f" ] || continue
        if [ "$(jq -cS 'del(.id, .name, .created_at, .updated_at)' "$f" 2>/dev/null)" = "$want" ]; then
            basename "$f" .json
            return 0
        fi
    done
    return 1
}

# Migrate active config with connectivity check
# Tries servers in ranked order, returns ID of the working server (or empty)
# Outputs result to stdout; caller should capture it
migrate_with_check() {
    local old_name="$1"
    local old_server="$2"
    local old_port="$3"
    local subscription_id="$4"
    
    local ranked=$(get_subscription_servers_ranked "$old_name" "$old_server" "$old_port" "$subscription_id")
    
    if [ -z "$ranked" ]; then
        log_action "MIGRATION" "No candidate servers found in subscription $subscription_id"
        echo ""
        return 1
    fi
    
    local tried=0
    local last_id=""
    
    for candidate_id in $ranked; do
        tried=$((tried + 1))
        last_id="$candidate_id"
        local candidate_file="$VPN_CONFIGS_DIR/${candidate_id}.json"
        
        if [ ! -f "$candidate_file" ]; then
            log_action "MIGRATION" "Config file missing for $candidate_id, skipping"
            continue
        fi
        
        local candidate_name=$(jq -r '.name // "unknown"' "$candidate_file" 2>/dev/null)
        log_action "MIGRATION" "Trying server $tried: $candidate_id ($candidate_name)"
        
        set_active_config "$candidate_id"
        
        if ! apply_singbox_outbound "$candidate_file" "vpn"; then
            log_action "MIGRATION" "Failed to apply config for $candidate_id, skipping"
            continue
        fi
        
        singbox_restart
        sleep 3
        
        if check_vpn_connectivity "vpn"; then
            log_action "MIGRATION" "Server $candidate_id ($candidate_name) is working (tried $tried)"
            echo "$candidate_id"
            return 0
        fi
        
        log_action "MIGRATION" "Server $candidate_id ($candidate_name) connectivity check failed"
    done
    
    # All failed — keep the last one tried (better than nothing)
    log_action "MIGRATION" "WARNING: All $tried servers failed connectivity check, keeping $last_id"
    echo "$last_id"
    return 1
}
