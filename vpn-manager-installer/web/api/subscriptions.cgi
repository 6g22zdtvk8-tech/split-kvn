#!/bin/sh
# VPN server subscription management API

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

# Authorization check
if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Subscriptions file
SUBSCRIPTIONS_FILE="$VPN_MANAGER_HOME/subscriptions.json"

# Initialize / heal subscriptions file (empty or invalid JSON must not silently break UI)
init_subscriptions_file() {
    if [ ! -f "$SUBSCRIPTIONS_FILE" ] || [ ! -s "$SUBSCRIPTIONS_FILE" ]; then
        echo '{"subscriptions":[]}' > "$SUBSCRIPTIONS_FILE"
        chmod 644 "$SUBSCRIPTIONS_FILE"
        return 0
    fi
    if ! jq -e '.subscriptions | type == "array"' "$SUBSCRIPTIONS_FILE" >/dev/null 2>&1; then
        local bak="${SUBSCRIPTIONS_FILE}.corrupt.bak.$(date +%Y%m%d%H%M%S)"
        cp -a "$SUBSCRIPTIONS_FILE" "$bak" 2>/dev/null || true
        echo '{"subscriptions":[]}' > "$SUBSCRIPTIONS_FILE"
        chmod 644 "$SUBSCRIPTIONS_FILE"
        log_action "SUBSCRIPTIONS_HEALED" "Invalid JSON backed up to $bak"
    fi
}

# Atomically write subscriptions.json; fail if jq produced empty/invalid output.
# Usage: write_subscriptions_json [jq args...] '<filter>'
write_subscriptions_json() {
    local tmp="${SUBSCRIPTIONS_FILE}.tmp.$$"
    if ! jq "$@" "$SUBSCRIPTIONS_FILE" > "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        return 1
    fi
    if [ ! -s "$tmp" ] || ! jq -e '.subscriptions | type == "array"' "$tmp" >/dev/null 2>&1; then
        rm -f "$tmp"
        return 1
    fi
    mv "$tmp" "$SUBSCRIPTIONS_FILE"
    chmod 644 "$SUBSCRIPTIONS_FILE"
    return 0
}

# List of supported protocols
SUPPORTED_PROTOCOLS="shadowsocks vless vmess trojan hysteria2 wireguard"

# Convert ssconf:// to https://
normalize_subscription_url() {
    local url="$1"
    case "$url" in
        ssconf://*)
            echo "https://${url#ssconf://}"
            ;;
        *)
            echo "$url"
            ;;
    esac
}

# Check if subscription content is a stub (dummy response from server).
# Stub = base64-encoded single vless:// with 0.0.0.0 server — means real servers were not returned.
_is_stub_content() {
    local content="$1"
    local trimmed=$(echo "$content" | tr -d '[:space:]')
    # Try base64 decode; if result contains @0.0.0.0: it's a stub
    local decoded
    decoded=$(echo "$trimmed" | base64 -d 2>/dev/null)
    if echo "$decoded" | grep -q '@0\.0\.0\.0:'; then
        return 0
    fi
    # Also treat empty content as stub
    [ -z "$trimmed" ] && return 0
    return 1
}

# Server links the panel can read, plain or base64 (not a Xray/Clash config file).
_has_share_links() {
    local file="$1"
    grep -qE '^(ss|vless|vmess|trojan|hysteria2|hy2|tuic)://' "$file" && return 0
    tr -d '[:space:]' < "$file" | base64 -d 2>/dev/null | grep -qE '^(ss|vless|vmess|trojan|hysteria2|hy2|tuic)://'
}

# Some providers answer Happ with a whole Xray JSON config instead of links, but give
# links to v2rayN. Same router HWID, so no extra device is used up on the provider side.
# Args: $1 = url, $2 = headers_file, $3 = content_file, $4 = extra curl args (e.g. SOCKS)
_retry_links_ua() {
    _has_share_links "$3" && return 0
    local router_hwid
    router_hwid=$(get_router_hwid)
    local tmp="$3.links"
    curl -sL --connect-timeout 10 --max-time 30 $4 \
         -H "User-Agent: v2rayN/7.0" \
         -H "x-hwid: $router_hwid" \
         -D "$tmp.h" -o "$tmp" \
         "$1" 2>/dev/null
    if [ -s "$tmp" ] && _has_share_links "$tmp"; then
        mv "$tmp" "$3"
        [ -n "$2" ] && mv "$tmp.h" "$2"
        log_action "SUBSCRIPTION_FETCH" "Happ UA gave no links for $1, took links via v2rayN UA"
    fi
    rm -f "$tmp" "$tmp.h"
    return 0
}

# Internal: try to download a URL, falling back to the active VPN's SOCKS5 if the direct attempt fails.
# If the response is a stub (HWID-protected subscription), retries with Happ UA + router HWID.
# Args: $1 = url, $2 = headers_file (optional), $3 = content_file (required)
# Sets global _LAST_FETCH_USED_VPN = 0|1.
# Returns: 0 on success, non-zero on total failure.
_fetch_with_vpn_fallback() {
    local url="$1"
    local headers_file="$2"
    local content_file="$3"
    
    [ -z "$content_file" ] && return 1
    
    local headers_arg=""
    [ -n "$headers_file" ] && headers_arg="-D $headers_file"
    
    # Direct attempt — this is how subscriptions normally update.
    > "$content_file"
    [ -n "$headers_file" ] && > "$headers_file"
    
    curl -sL --connect-timeout 10 --max-time 30 \
         -H "User-Agent: VPN-Manager/1.0" \
         $headers_arg -o "$content_file" \
         "$url" 2>/dev/null
    local rc=$?
    
    if [ $rc -eq 0 ] && [ -s "$content_file" ]; then
        # Check if server returned a stub (HWID-protected subscription)
        if _is_stub_content "$(cat "$content_file")"; then
            log_action "SUBSCRIPTION_FETCH" "Stub response detected for $url, retrying with Happ UA + router HWID"
            _fetch_with_happ_ua "$url" "$headers_file" "$content_file"
            return $?
        fi
        _LAST_FETCH_USED_VPN=0
        return 0
    fi
    
    # Direct failed (timeout, DNS block, ISP filter, …). If the VPN tunnel is up,
    # retry via the SOCKS5 inbound (health-check-in @ 127.0.0.1:2080).
    # --socks5-hostname pushes DNS resolution into the tunnel as well.
    local active_cfg="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}/active-config"
    if [ -f "$active_cfg" ] && [ -s "$active_cfg" ]; then
        > "$content_file"
        [ -n "$headers_file" ] && > "$headers_file"
        
        curl -sL --connect-timeout 15 --max-time 45 \
             --socks5-hostname 127.0.0.1:2080 \
             -H "User-Agent: VPN-Manager/1.0" \
             $headers_arg -o "$content_file" \
             "$url" 2>/dev/null
        rc=$?
        
        if [ $rc -eq 0 ] && [ -s "$content_file" ]; then
            if _is_stub_content "$(cat "$content_file")"; then
                log_action "SUBSCRIPTION_FETCH" "Stub via VPN for $url, retrying with Happ UA + router HWID"
                _fetch_with_happ_ua "$url" "$headers_file" "$content_file"
                return $?
            fi
            _LAST_FETCH_USED_VPN=1
            log_action "SUBSCRIPTION_FETCH" "Direct failed for $url, succeeded via VPN fallback"
            return 0
        fi
    fi
    
    _LAST_FETCH_USED_VPN=0
    return 1
}

# Retry subscription fetch using Happ UA + persistent router HWID.
# Used as fallback when the server returns a stub for HWID-protected subscriptions.
# Args: $1 = url, $2 = headers_file (optional), $3 = content_file (required)
_fetch_with_happ_ua() {
    local url="$1"
    local headers_file="$2"
    local content_file="$3"
    
    local router_hwid
    router_hwid=$(get_router_hwid)
    local happ_ua="Happ/4.9.0/linux/$router_hwid"
    
    local headers_arg=""
    [ -n "$headers_file" ] && headers_arg="-D $headers_file"
    
    > "$content_file"
    [ -n "$headers_file" ] && > "$headers_file"
    
    curl -sL --connect-timeout 10 --max-time 30 \
         -H "User-Agent: $happ_ua" \
         -H "x-hwid: $router_hwid" \
         $headers_arg -o "$content_file" \
         "$url" 2>/dev/null
    local rc=$?
    
    if [ $rc -eq 0 ] && [ -s "$content_file" ]; then
        # If still a stub — device limit reached or HWID not accepted
        if _is_stub_content "$(cat "$content_file")"; then
            log_action "SUBSCRIPTION_FETCH" "Happ UA also returned stub for $url (device limit?)"
            _LAST_FETCH_USED_VPN=0
            return 1
        fi
        _LAST_FETCH_USED_VPN=0
        log_action "SUBSCRIPTION_FETCH" "Succeeded with Happ UA for $url (HWID: $router_hwid)"
        _retry_links_ua "$url" "$headers_file" "$content_file" ""
        return 0
    fi
    
    # Try via SOCKS5 if direct Happ attempt also failed
    local active_cfg="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}/active-config"
    if [ -f "$active_cfg" ] && [ -s "$active_cfg" ]; then
        > "$content_file"
        [ -n "$headers_file" ] && > "$headers_file"
        
        curl -sL --connect-timeout 15 --max-time 45 \
             --socks5-hostname 127.0.0.1:2080 \
             -H "User-Agent: $happ_ua" \
             -H "x-hwid: $router_hwid" \
             $headers_arg -o "$content_file" \
             "$url" 2>/dev/null
        rc=$?
        
        if [ $rc -eq 0 ] && [ -s "$content_file" ] && ! _is_stub_content "$(cat "$content_file")"; then
            _LAST_FETCH_USED_VPN=1
            log_action "SUBSCRIPTION_FETCH" "Happ UA via VPN succeeded for $url"
            _retry_links_ua "$url" "$headers_file" "$content_file" "--socks5-hostname 127.0.0.1:2080"
            return 0
        fi
    fi
    
    _LAST_FETCH_USED_VPN=0
    return 1
}

# Download subscription (content only, for backward compatibility)
fetch_subscription() {
    local url="$1"
    local normalized_url=$(normalize_subscription_url "$url")
    local content_file="/tmp/sub_content_$$"
    
    if _fetch_with_vpn_fallback "$normalized_url" "" "$content_file"; then
        cat "$content_file"
        rm -f "$content_file"
        return 0
    fi
    rm -f "$content_file"
    return 1
}

# Download subscription with metadata from headers
# Returns JSON: {"content": "...", "metadata": {...}, "via_vpn": true|false}
fetch_subscription_with_metadata() {
    local url="$1"
    local normalized_url=$(normalize_subscription_url "$url")
    local headers_file="/tmp/sub_headers_$$"
    local content_file="/tmp/sub_content_$$"
    
    if ! _fetch_with_vpn_fallback "$normalized_url" "$headers_file" "$content_file"; then
        rm -f "$headers_file" "$content_file" 2>/dev/null
        echo '{"content":"","metadata":null,"via_vpn":false}'
        return 1
    fi
    
    local content=$(cat "$content_file")
    local metadata=$(parse_subscription_headers "$headers_file")
    local via_vpn="false"
    [ "${_LAST_FETCH_USED_VPN:-0}" = "1" ] && via_vpn="true"
    
    rm -f "$headers_file" "$content_file" 2>/dev/null
    
    # Escape content for JSON
    local escaped_content=$(echo "$content" | jq -Rs '.')
    
    echo "{\"content\":$escaped_content,\"metadata\":$metadata,\"via_vpn\":$via_vpn}"
}

# Parse subscription headers to extract metadata
parse_subscription_headers() {
    local headers_file="$1"
    
    [ ! -f "$headers_file" ] && echo 'null' && return
    
    local title=""
    local expire=""
    local upload=""
    local download=""
    local total=""
    local update_interval=""
    
    # Read headers
    while IFS= read -r line; do
        # Remove \r at end (Windows line endings)
        line=$(echo "$line" | tr -d '\r')
        
        # subscription-userinfo: upload=X; download=Y; total=Z; expire=T
        case "$line" in
            subscription-userinfo:*|Subscription-Userinfo:*)
                local userinfo="${line#*:}"
                # Parse fields
                upload=$(echo "$userinfo" | grep -oE 'upload=[0-9]+' | cut -d= -f2)
                download=$(echo "$userinfo" | grep -oE 'download=[0-9]+' | cut -d= -f2)
                total=$(echo "$userinfo" | grep -oE 'total=[0-9]+' | cut -d= -f2)
                expire=$(echo "$userinfo" | grep -oE 'expire=[0-9]+' | cut -d= -f2)
                ;;
            profile-title:*|Profile-Title:*)
                local raw_title="${line#*:}"
                raw_title=$(echo "$raw_title" | sed 's/^[[:space:]]*//')
                # Check base64 prefix
                case "$raw_title" in
                    base64:*)
                        local b64="${raw_title#base64:}"
                        # Decode and replace newlines with spaces
                        title=$(echo "$b64" | base64 -d 2>/dev/null | tr '\n\r' ' ' | sed 's/  */ /g;s/^ *//;s/ *$//')
                        ;;
                    *)
                        title=$(echo "$raw_title" | tr -d '\n\r')
                        ;;
                esac
                ;;
            profile-update-interval:*|Profile-Update-Interval:*)
                update_interval="${line#*:}"
                update_interval=$(echo "$update_interval" | tr -d '[:space:]')
                ;;
        esac
    done < "$headers_file"
    
    # If nothing found - return null
    if [ -z "$title" ] && [ -z "$expire" ] && [ -z "$upload" ] && [ -z "$download" ] && [ -z "$total" ] && [ -z "$update_interval" ]; then
        echo 'null'
        return
    fi
    
    # Form JSON with metadata
    local json="{"
    local first=1
    
    if [ -n "$title" ]; then
        local escaped_title=$(echo "$title" | jq -Rs '.' | sed 's/^"//;s/"$//')
        [ $first -eq 0 ] && json="$json,"
        json="$json\"title\":\"$escaped_title\""
        first=0
    fi
    
    if [ -n "$expire" ]; then
        [ $first -eq 0 ] && json="$json,"
        json="$json\"expire\":$expire"
        first=0
    fi
    
    if [ -n "$upload" ]; then
        [ $first -eq 0 ] && json="$json,"
        json="$json\"upload\":$upload"
        first=0
    fi
    
    if [ -n "$download" ]; then
        [ $first -eq 0 ] && json="$json,"
        json="$json\"download\":$download"
        first=0
    fi
    
    if [ -n "$total" ]; then
        [ $first -eq 0 ] && json="$json,"
        json="$json\"total\":$total"
        first=0
    fi
    
    if [ -n "$update_interval" ]; then
        [ $first -eq 0 ] && json="$json,"
        json="$json\"update_interval\":$update_interval"
        first=0
    fi
    
    json="$json}"
    echo "$json"
}

# Decode content (may be base64)
decode_subscription_content() {
    local content="$1"
    
    # Remove spaces/newlines for check
    local trimmed=$(echo "$content" | tr -d '[:space:]')
    
    # Check if content is base64
    # Base64 contains only A-Za-z0-9+/= 
    if echo "$trimmed" | grep -qE '^[A-Za-z0-9+/=]+$'; then
        # Try to decode as base64
        local decoded=$(base64_decode "$trimmed")
        if [ -n "$decoded" ] && echo "$decoded" | grep -qE '^(ss|vless|vmess|trojan|hysteria2|hy2|wireguard)://'; then
            echo "$decoded"
            return
        fi
    fi
    
    # If not base64 or failed to decode - return as is
    echo "$content"
}

# Parse Clash YAML without yq (simple parser)
parse_clash_yaml() {
    local yaml_content="$1"
    local result="["
    local first=1
    local current_proxy=""

    # Write content to a temp file to avoid pipe subshell (pipe | while creates a
    # subshell in POSIX sh / BusyBox sh, so variable changes inside the loop are
    # lost after the loop ends).
    local tmp_yaml="/tmp/clash_yaml_$$"
    printf '%s\n' "$yaml_content" > "$tmp_yaml"

    while IFS= read -r line; do
        # Skip empty lines and comments
        case "$line" in
            ""|\#*) continue ;;
        esac

        # Start of new proxy (line starting with "  - name:" or "  - type:")
        if echo "$line" | grep -qE '^\s*-\s*(name|type):'; then
            if [ -n "$current_proxy" ]; then
                local parsed
                parsed=$(parse_clash_proxy "$current_proxy")
                if [ -n "$parsed" ] && [ "$parsed" != "null" ]; then
                    [ $first -eq 0 ] && result="$result,"
                    result="$result$parsed"
                    first=0
                fi
            fi
            current_proxy="$line"
        elif [ -n "$current_proxy" ]; then
            current_proxy="$current_proxy
$line"
        fi
    done < "$tmp_yaml"
    rm -f "$tmp_yaml"

    # Last proxy
    if [ -n "$current_proxy" ]; then
        local parsed
        parsed=$(parse_clash_proxy "$current_proxy")
        if [ -n "$parsed" ] && [ "$parsed" != "null" ]; then
            [ $first -eq 0 ] && result="$result,"
            result="$result$parsed"
        fi
    fi

    result="$result]"
    echo "$result"
}

# Parse single Clash proxy
parse_clash_proxy() {
    local proxy_yaml="$1"
    
    # Extract fields using sed (BusyBox-compatible)
    local name=$(echo "$proxy_yaml" | sed -n 's/.*name:[[:space:]]*["'"'"']\?\([^"'"'"']*\)["'"'"']\?.*/\1/p' | head -1)
    local type=$(echo "$proxy_yaml" | sed -n 's/.*type:[[:space:]]*\([a-z]*\).*/\1/p' | head -1)
    local server=$(echo "$proxy_yaml" | sed -n 's/.*server:[[:space:]]*\([^[:space:]]*\).*/\1/p' | head -1)
    local port=$(echo "$proxy_yaml" | sed -n 's/.*port:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
    local password=$(echo "$proxy_yaml" | sed -n 's/.*password:[[:space:]]*["'"'"']\?\([^"'"'"']*\)["'"'"']\?.*/\1/p' | head -1)
    local cipher=$(echo "$proxy_yaml" | sed -n 's/.*cipher:[[:space:]]*\([^[:space:]]*\).*/\1/p' | head -1)
    local uuid=$(echo "$proxy_yaml" | sed -n 's/.*uuid:[[:space:]]*\([^[:space:]]*\).*/\1/p' | head -1)
    
    # Skip unsupported types
    case "$type" in
        ss|shadowsocks) type="shadowsocks" ;;
        vmess) type="vmess" ;;
        vless) type="vless" ;;
        trojan) type="trojan" ;;
        wireguard|wg) type="wireguard" ;;
        *) return ;;  # Unsupported type
    esac
    
    [ -z "$server" ] && return
    [ -z "$port" ] && return
    
    # Form JSON
    local json="{\"protocol\":\"$type\",\"name\":\"$name\",\"server\":\"$server\",\"server_port\":$port"
    [ -n "$password" ] && json="$json,\"password\":\"$password\""
    [ -n "$cipher" ] && json="$json,\"method\":\"$cipher\""
    [ -n "$uuid" ] && json="$json,\"uuid\":\"$uuid\""
    json="$json}"
    
    echo "$json"
}

# Parse servers from subscription content
parse_subscription_servers() {
    local content="$1"
    local subscription_id="$2"
    
    local servers="[]"
    local parsed_count=0
    local skipped_count=0
    local skipped_protocols=""
    
    # Decode if base64
    local decoded=$(decode_subscription_content "$content")
    
    # First check if it's JSON (SIP008 format)
    if echo "$decoded" | jq -e '.servers' >/dev/null 2>&1; then
        # SIP008 format: {"servers": [...]}
        servers=$(echo "$decoded" | jq -c '[.servers[] | {
            protocol: "shadowsocks",
            name: .remarks,
            server: .server,
            server_port: .server_port,
            method: .method,
            password: .password
        }]' 2>/dev/null)
        parsed_count=$(json_len "$servers")
    elif echo "$decoded" | jq -e '.server and .method' >/dev/null 2>&1; then
        # Single server format (ssconf:// often returns this)
        local name=$(echo "$decoded" | jq -r '.tag // .remarks // "Server"' 2>/dev/null)
        servers=$(echo "$decoded" | jq -c '[{
            protocol: "shadowsocks",
            name: (.tag // .remarks // "Server"),
            server: .server,
            server_port: .server_port,
            method: .method,
            password: .password
        }]' 2>/dev/null)
        parsed_count=1
    elif echo "$decoded" | jq -e '.outbounds' >/dev/null 2>&1; then
        # V2Ray JSON format: {"outbounds": [...]}
        servers=$(echo "$decoded" | jq -c '[.outbounds[] | select(.protocol) | {
            protocol: .protocol,
            name: (.tag // .remarks // "Server"),
            server: (.settings.vnext[0].address // .settings.servers[0].address // .settings.address),
            server_port: (.settings.vnext[0].port // .settings.servers[0].port // .settings.port),
            method: .settings.servers[0].method,
            password: .settings.servers[0].password,
            uuid: .settings.vnext[0].users[0].id,
            flow: .settings.vnext[0].users[0].flow,
            security: .settings.vnext[0].users[0].security
        }]' 2>/dev/null)
        parsed_count=$(json_len "$servers")
    elif echo "$decoded" | grep -q "^proxies:" 2>/dev/null; then
        # Clash YAML format: proxies: [...]
        # Simple parsing without yq
        servers=$(parse_clash_yaml "$decoded")
        parsed_count=$(json_len "$servers")
    else
        # Format: one URL per line
        local result="["
        local first=1
        
        echo "$decoded" | while IFS= read -r line; do
            # Remove spaces and CR
            line=$(echo "$line" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            [ -z "$line" ] && continue
            
            # Skip comments
            case "$line" in
                \#*) continue ;;
            esac
            
            # Determine protocol
            local proto=""
            case "$line" in
                ss://*) proto="shadowsocks" ;;
                vless://*) proto="vless" ;;
                vmess://*) proto="vmess" ;;
                trojan://*) proto="trojan" ;;
                hysteria2://*|hy2://*) proto="hysteria2" ;;
                wireguard://*) proto="wireguard" ;;
                *)
                    # Unsupported protocol
                    continue
                    ;;
            esac
            
            # Parse URL
            local parsed=$(parse_vpn_url "$line")
            
            if [ -n "$parsed" ] && [ "$parsed" != "null" ]; then
                # Check for error
                local error=$(echo "$parsed" | jq -r '.error // empty' 2>/dev/null)
                if [ -n "$error" ]; then
                    continue
                fi
                
                echo "$parsed"
            fi
        done
    fi
}

# Generate subscription ID
generate_subscription_id() {
    echo "sub_$(date +%s)_$(head -c 4 /dev/urandom | md5sum | cut -c1-8)"
}

# Generate server ID
generate_server_id() {
    local name="$1"
    local base=$(echo "$name" | tr ' ' '_' | tr -cd 'a-zA-Z0-9_-' | head -c 24)
    [ -z "$base" ] && base="server"
    echo "${base}_$(date +%s)_$(head -c 2 /dev/urandom | md5sum | cut -c1-4)"
}

# Save servers from subscription
save_subscription_servers() {
    local subscription_id="$1"
    local servers_json="$2"
    
    local saved_ids="[]"
    local count=$(json_len "$servers_json")
    
    local i=0
    while [ $i -lt $count ]; do
        local server=$(echo "$servers_json" | jq -c ".[$i]" 2>/dev/null)
        local name=$(echo "$server" | jq -r '.name // empty' 2>/dev/null)
        local protocol=$(echo "$server" | jq -r '.protocol // empty' 2>/dev/null)
        
        # Generate ID for server
        local server_id=$(generate_server_id "$name")
        
        # Add subscription_id and metadata
        local now=$(date '+%Y-%m-%dT%H:%M:%S')
        local full_server=$(echo "$server" | jq -c \
            --arg id "$server_id" \
            --arg sub_id "$subscription_id" \
            --arg created "$now" \
            '. + {id: $id, subscription_id: $sub_id, created_at: $created, updated_at: $created}' \
            2>/dev/null)
        
        # Save to file
        echo "$full_server" > "$VPN_CONFIGS_DIR/${server_id}.json"
        
        # Add ID to list
        saved_ids=$(echo "$saved_ids" | jq -c ". + [\"$server_id\"]" 2>/dev/null)
        
        i=$((i + 1))
    done
    
    echo "$saved_ids"
}

# Delete subscription servers
delete_subscription_servers() {
    local subscription_id="$1"
    
    for f in "$VPN_CONFIGS_DIR"/*.json; do
        [ -f "$f" ] || continue
        local sub_id=$(jq -r '.subscription_id // empty' "$f" 2>/dev/null)
        if [ "$sub_id" = "$subscription_id" ]; then
            rm -f "$f"
        fi
    done
}

# Get subscription servers list
get_subscription_servers() {
    local subscription_id="$1"
    
    local result="["
    local first=1
    
    for f in "$VPN_CONFIGS_DIR"/*.json; do
        [ -f "$f" ] || continue
        local sub_id=$(jq -r '.subscription_id // empty' "$f" 2>/dev/null)
        if [ "$sub_id" = "$subscription_id" ]; then
            if [ $first -eq 0 ]; then
                result="$result,"
            fi
            result="$result$(cat "$f")"
            first=0
        fi
    done
    
    result="$result]"
    echo "$result"
}

# Determine action from URL
PATH_PARTS=$(echo "$PATH_INFO" | sed 's/^\///')
ACTION=$(echo "$PATH_PARTS" | cut -d'/' -f1)
SUB_ID=$(echo "$PATH_PARTS" | cut -d'/' -f2)
SUB_ACTION=$(echo "$PATH_PARTS" | cut -d'/' -f3)

init_subscriptions_file

case "$REQUEST_METHOD" in
    GET)
        case "$ACTION" in
            ""|list)
                # List all subscriptions
                SUBS=$(cat "$SUBSCRIPTIONS_FILE")
                json_success "$SUBS"
                ;;
            
            supported-protocols)
                # List of supported protocols
                json_success "{\"protocols\":[\"Shadowsocks\",\"VLESS\",\"VMess\",\"Trojan\",\"Hysteria2\",\"WireGuard\"]}"
                ;;
            
            *)
                # Get specific subscription
                SUB=$(jq -c ".subscriptions[] | select(.id == \"$ACTION\")" "$SUBSCRIPTIONS_FILE" 2>/dev/null)
                if [ -n "$SUB" ]; then
                    # Add servers list
                    SERVERS=$(get_subscription_servers "$ACTION")
                    RESULT=$(echo "$SUB" | jq -c --argjson servers "$SERVERS" '. + {servers: $servers}')
                    json_success "$RESULT"
                else
                    json_error "Subscription not found" 404
                fi
                ;;
        esac
        ;;
    
    POST)
        POST_DATA=$(read_post_data)
        
        case "$ACTION" in
            ""|create|add)
                # Add new subscription
                URL=$(json_get_value "$POST_DATA" "url")
                NAME=$(json_get_value "$POST_DATA" "name")
                AUTO_UPDATE=$(json_get_bool "$POST_DATA" "auto_update")
                UPDATE_INTERVAL=$(json_get_number "$POST_DATA" "update_interval")
                
                if [ -z "$URL" ]; then
                    json_error "Subscription URL is required" 400
                    exit 0
                fi
                
                [ -z "$AUTO_UPDATE" ] && AUTO_UPDATE="true"
                [ -z "$UPDATE_INTERVAL" ] && UPDATE_INTERVAL=3
                
                # Download subscription with metadata
                FETCH_RESULT=$(fetch_subscription_with_metadata "$URL")
                CONTENT=$(echo "$FETCH_RESULT" | jq -r '.content // empty')
                SUB_METADATA=$(echo "$FETCH_RESULT" | jq -c '.metadata // null')
                
                if [ -z "$CONTENT" ]; then
                    json_error "Failed to download subscription" 400
                    exit 0
                fi
                
                # Decode content
                DECODED=$(decode_subscription_content "$CONTENT")
                
                # Parse servers
                SERVERS_JSON="[]"
                PARSED_COUNT=0
                SKIPPED_COUNT=0
                
                # Check SIP008 format
                if echo "$DECODED" | jq -e '.servers' >/dev/null 2>&1; then
                    SERVERS_JSON=$(echo "$DECODED" | jq -c '[.servers[] | {
                        protocol: "shadowsocks",
                        name: (.remarks // .server),
                        server: .server,
                        server_port: .server_port,
                        method: .method,
                        password: .password
                    }]' 2>/dev/null)
                    PARSED_COUNT=$(json_len "$SERVERS_JSON")
                elif echo "$DECODED" | jq -e '.server and .method' >/dev/null 2>&1; then
                    # Single server format (ssconf:// often returns this)
                    SERVERS_JSON=$(echo "$DECODED" | jq -c '[{
                        protocol: "shadowsocks",
                        name: (.tag // .remarks // "Server"),
                        server: .server,
                        server_port: .server_port,
                        method: .method,
                        password: .password
                    }]' 2>/dev/null)
                    PARSED_COUNT=$(json_len "$SERVERS_JSON")
                elif echo "$DECODED" | jq -e '.outbounds' >/dev/null 2>&1; then
                    # V2Ray JSON format
                    SERVERS_JSON=$(echo "$DECODED" | jq -c '[.outbounds[] | select(.protocol) | {
                        protocol: .protocol,
                        name: (.tag // .remarks // "Server"),
                        server: (.settings.vnext[0].address // .settings.servers[0].address),
                        server_port: (.settings.vnext[0].port // .settings.servers[0].port),
                        method: .settings.servers[0].method,
                        password: .settings.servers[0].password,
                        uuid: .settings.vnext[0].users[0].id
                    }]' 2>/dev/null)
                    PARSED_COUNT=$(json_len "$SERVERS_JSON")
                elif echo "$DECODED" | grep -q "^proxies:" 2>/dev/null; then
                    # Clash YAML format
                    SERVERS_JSON=$(parse_clash_yaml "$DECODED")
                    PARSED_COUNT=$(json_len "$SERVERS_JSON")
                else
                    # Format: one URL per line
                    TMP_SERVERS="/tmp/sub_servers_$$"
                    echo "[]" > "$TMP_SERVERS"
                    
                    echo "$DECODED" | while IFS= read -r line; do
                        line=$(echo "$line" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
                        [ -z "$line" ] && continue
                        case "$line" in \#*) continue ;; esac
                        
                        parsed=$(parse_vpn_url "$line")
                        if [ -n "$parsed" ] && [ "$parsed" != "null" ]; then
                            error=$(echo "$parsed" | jq -r '.error // empty' 2>/dev/null)
                            if [ -z "$error" ]; then
                                # Add only valid JSON: a broken entry is skipped and can never empty the list
                                if echo "$parsed" | jq -e 'type == "object"' >/dev/null 2>&1 && \
                                   jq -c --argjson s "$parsed" '. + [$s]' "$TMP_SERVERS" > "$TMP_SERVERS.new" 2>/dev/null; then
                                    mv "$TMP_SERVERS.new" "$TMP_SERVERS"
                                else
                                    rm -f "$TMP_SERVERS.new"
                                fi
                            fi
                        fi
                    done
                    
                    SERVERS_JSON=$(cat "$TMP_SERVERS")
                    rm -f "$TMP_SERVERS"
                    PARSED_COUNT=$(json_len "$SERVERS_JSON")
                fi
                
                if [ "$PARSED_COUNT" -eq 0 ]; then
                    json_error "errors.noSupportedServers" 400
                    exit 0
                fi
                
                # Generate subscription ID
                SUB_ID=$(generate_subscription_id)
                NOW=$(date '+%Y-%m-%dT%H:%M:%S')
                
                # If name not provided, try to extract from URL
                if [ -z "$NAME" ]; then
                    NAME=$(echo "$URL" | sed 's|.*://||' | cut -d'/' -f1-2 | tr '/' '-')
                    [ -z "$NAME" ] && NAME="Subscription"
                fi
                
                # Save servers
                SERVER_IDS=$(save_subscription_servers "$SUB_ID" "$SERVERS_JSON")
                
                # Use title from metadata if name not provided
                if [ -z "$NAME" ] && [ "$SUB_METADATA" != "null" ]; then
                    META_TITLE=$(echo "$SUB_METADATA" | jq -r '.title // empty' 2>/dev/null)
                    [ -n "$META_TITLE" ] && NAME="$META_TITLE"
                fi
                
                # Save subscription with metadata
                NEW_SUB=$(jq -nc \
                    --arg id "$SUB_ID" \
                    --arg name "$NAME" \
                    --arg url "$URL" \
                    --argjson auto_update "$AUTO_UPDATE" \
                    --argjson update_interval "$UPDATE_INTERVAL" \
                    --argjson server_count "$PARSED_COUNT" \
                    --arg created_at "$NOW" \
                    --arg updated_at "$NOW" \
                    --argjson metadata "$SUB_METADATA" \
                    '{
                        id: $id,
                        name: $name,
                        url: $url,
                        auto_update: $auto_update,
                        update_interval: $update_interval,
                        server_count: $server_count,
                        created_at: $created_at,
                        updated_at: $updated_at,
                        metadata: $metadata
                    }'
                )
                
                # Add to subscriptions file (atomic + validated — empty/corrupt file must not wipe registry)
                if ! write_subscriptions_json --argjson s "$NEW_SUB" '.subscriptions += [$s]'; then
                    delete_subscription_servers "$SUB_ID"
                    json_error "Failed to save subscription registry (subscriptions.json)" 500
                    exit 0
                fi
                
                log_action "SUBSCRIPTION_ADDED" "ID: $SUB_ID, Name: $NAME, Servers: $PARSED_COUNT"
                json_success "{\"id\":\"$SUB_ID\",\"name\":\"$NAME\",\"server_count\":$PARSED_COUNT,\"message\":\"Subscription added\"}"
                ;;
            
            preview)
                # Preview subscription (without saving)
                URL=$(json_get_value "$POST_DATA" "url")
                
                if [ -z "$URL" ]; then
                    json_error "Subscription URL is required" 400
                    exit 0
                fi
                
                CONTENT=$(fetch_subscription "$URL")
                
                if [ -z "$CONTENT" ]; then
                    json_error "Failed to download subscription" 400
                    exit 0
                fi
                
                DECODED=$(decode_subscription_content "$CONTENT")
                
                # Parse servers
                SERVERS_JSON="[]"
                
                if echo "$DECODED" | jq -e '.servers' >/dev/null 2>&1; then
                    SERVERS_JSON=$(echo "$DECODED" | jq -c '[.servers[] | {
                        protocol: "shadowsocks",
                        name: (.remarks // .server),
                        server: .server,
                        server_port: .server_port
                    }]' 2>/dev/null)
                elif echo "$DECODED" | jq -e '.server and .method' >/dev/null 2>&1; then
                    # Single server format
                    SERVERS_JSON=$(echo "$DECODED" | jq -c '[{
                        protocol: "shadowsocks",
                        name: (.tag // .remarks // "Server"),
                        server: .server,
                        server_port: .server_port
                    }]' 2>/dev/null)
                elif echo "$DECODED" | jq -e '.outbounds' >/dev/null 2>&1; then
                    # V2Ray JSON format
                    SERVERS_JSON=$(echo "$DECODED" | jq -c '[.outbounds[] | select(.protocol) | {
                        protocol: .protocol,
                        name: (.tag // .remarks // "Server"),
                        server: (.settings.vnext[0].address // .settings.servers[0].address),
                        server_port: (.settings.vnext[0].port // .settings.servers[0].port)
                    }]' 2>/dev/null)
                elif echo "$DECODED" | grep -q "^proxies:" 2>/dev/null; then
                    # Clash YAML format
                    SERVERS_JSON=$(parse_clash_yaml "$DECODED" | jq -c '[.[] | {protocol, name, server, server_port}]' 2>/dev/null)
                else
                    TMP_SERVERS="/tmp/sub_preview_$$"
                    echo "[]" > "$TMP_SERVERS"
                    
                    echo "$DECODED" | while IFS= read -r line; do
                        line=$(echo "$line" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
                        [ -z "$line" ] && continue
                        case "$line" in \#*) continue ;; esac
                        
                        parsed=$(parse_vpn_url "$line")
                        if [ -n "$parsed" ] && [ "$parsed" != "null" ]; then
                            error=$(echo "$parsed" | jq -r '.error // empty' 2>/dev/null)
                            if [ -z "$error" ]; then
                                # For preview keep only basic fields
                                preview=$(echo "$parsed" | jq -c '{protocol, name, server, server_port}')
                                current=$(cat "$TMP_SERVERS")
                                echo "$current" | jq -c ". + [$preview]" > "$TMP_SERVERS"
                            fi
                        fi
                    done
                    
                    SERVERS_JSON=$(cat "$TMP_SERVERS")
                    rm -f "$TMP_SERVERS"
                fi
                
                COUNT=$(json_len "$SERVERS_JSON")
                
                json_success "{\"servers\":$SERVERS_JSON,\"count\":$COUNT}"
                ;;
            
            *)
                # Actions with specific subscription (ACTION=subId, SUB_ID=action)
                case "$SUB_ID" in
                    refresh)
                        # Update subscription servers
                        SUB=$(jq -c ".subscriptions[] | select(.id == \"$ACTION\")" "$SUBSCRIPTIONS_FILE" 2>/dev/null)
                        
                        if [ -z "$SUB" ]; then
                            json_error "Subscription not found" 404
                            exit 0
                        fi
                        
                        URL=$(echo "$SUB" | jq -r '.url')
                        
                        # Download new list with metadata
                        FETCH_RESULT=$(fetch_subscription_with_metadata "$URL")
                        CONTENT=$(echo "$FETCH_RESULT" | jq -r '.content // empty')
                        SUB_METADATA=$(echo "$FETCH_RESULT" | jq -c '.metadata // null')
                        
                        if [ -z "$CONTENT" ]; then
                            json_error "errors.subscriptionLoadFailed" 400
                            exit 0
                        fi
                        
                        DECODED=$(decode_subscription_content "$CONTENT")
                        
                        # Parse servers
                        SERVERS_JSON="[]"
                        
                        if echo "$DECODED" | jq -e '.servers' >/dev/null 2>&1; then
                            SERVERS_JSON=$(echo "$DECODED" | jq -c '[.servers[] | {
                                protocol: "shadowsocks",
                                name: (.remarks // .server),
                                server: .server,
                                server_port: .server_port,
                                method: .method,
                                password: .password
                            }]' 2>/dev/null)
                        elif echo "$DECODED" | jq -e '.server and .method' >/dev/null 2>&1; then
                            # Single server format
                            SERVERS_JSON=$(echo "$DECODED" | jq -c '[{
                                protocol: "shadowsocks",
                                name: (.tag // .remarks // "Server"),
                                server: .server,
                                server_port: .server_port,
                                method: .method,
                                password: .password
                            }]' 2>/dev/null)
                        elif echo "$DECODED" | jq -e '.outbounds' >/dev/null 2>&1; then
                            # V2Ray JSON format
                            SERVERS_JSON=$(echo "$DECODED" | jq -c '[.outbounds[] | select(.protocol) | {
                                protocol: .protocol,
                                name: (.tag // .remarks // "Server"),
                                server: (.settings.vnext[0].address // .settings.servers[0].address),
                                server_port: (.settings.vnext[0].port // .settings.servers[0].port),
                                method: .settings.servers[0].method,
                                password: .settings.servers[0].password,
                                uuid: .settings.vnext[0].users[0].id
                            }]' 2>/dev/null)
                        elif echo "$DECODED" | grep -q "^proxies:" 2>/dev/null; then
                            # Clash YAML format
                            SERVERS_JSON=$(parse_clash_yaml "$DECODED")
                        else
                            TMP_SERVERS="/tmp/sub_refresh_$$"
                            echo "[]" > "$TMP_SERVERS"
                            
                            echo "$DECODED" | while IFS= read -r line; do
                                line=$(echo "$line" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
                                [ -z "$line" ] && continue
                                case "$line" in \#*) continue ;; esac
                                
                                parsed=$(parse_vpn_url "$line")
                                if [ -n "$parsed" ] && [ "$parsed" != "null" ]; then
                                    error=$(echo "$parsed" | jq -r '.error // empty' 2>/dev/null)
                                    if [ -z "$error" ]; then
                                        # Add only valid JSON: a broken entry is skipped and can never empty the list
                                        if echo "$parsed" | jq -e 'type == "object"' >/dev/null 2>&1 && \
                                           jq -c --argjson s "$parsed" '. + [$s]' "$TMP_SERVERS" > "$TMP_SERVERS.new" 2>/dev/null; then
                                            mv "$TMP_SERVERS.new" "$TMP_SERVERS"
                                        else
                                            rm -f "$TMP_SERVERS.new"
                                        fi
                                    fi
                                fi
                            done
                            
                            SERVERS_JSON=$(cat "$TMP_SERVERS")
                            rm -f "$TMP_SERVERS"
                        fi
                        
                        NEW_COUNT=$(json_len "$SERVERS_JSON")
                        
                        if [ "$NEW_COUNT" -eq 0 ]; then
                            json_error "errors.emptyListServersKept" 400
                            exit 0
                        fi
                        
                        # === FEAT-009: Remember active server BEFORE deletion ===
                        ACTIVE_ID=$(get_active_config)
                        NEED_MIGRATION=""
                        OLD_NAME=""
                        OLD_SERVER=""
                        OLD_PORT=""
                        
                        # Several connections: the group is rebuilt after the refresh
                        # (multi_resync), no single active server to migrate
                        multi_is_on && ACTIVE_ID=""
                        if [ -n "$ACTIVE_ID" ]; then
                            ACTIVE_FILE="$VPN_CONFIGS_DIR/${ACTIVE_ID}.json"
                            if [ -f "$ACTIVE_FILE" ]; then
                                ACTIVE_SUB_ID=$(jq -r '.subscription_id // empty' "$ACTIVE_FILE" 2>/dev/null)
                                if [ "$ACTIVE_SUB_ID" = "$ACTION" ]; then
                                    # Active server from this subscription вЂ” remember data
                                    NEED_MIGRATION="yes"
                                    OLD_NAME=$(jq -r '.name' "$ACTIVE_FILE" 2>/dev/null)
                                    OLD_SERVER=$(jq -r '.server' "$ACTIVE_FILE" 2>/dev/null)
                                    OLD_PORT=$(jq -r '.server_port' "$ACTIVE_FILE" 2>/dev/null)
                                    ACTIVE_JSON=$(cat "$ACTIVE_FILE" 2>/dev/null)
                                    log_action "SUBSCRIPTION_REFRESH" "Active server from this subscription: $ACTIVE_ID ($OLD_NAME)"
                                fi
                            fi
                        fi
                        # === END FEAT-009 pre-delete ===
                        
                        # Touch only what actually changed. A full rewrite deletes and re-creates
                        # every server file under a new id, and on the flash that costs ~11-24 KiB
                        # per file (4 KiB block + inode + directory + journal) — megabytes a day
                        # when the provider returned the same servers. The plan below says which
                        # files stay, which go and which servers are new; "full" (duplicate
                        # servers, or jq trouble) falls back to the old delete-everything path.
                        SKIP_REWRITE=""
                        ACTIVE_GONE=""
                        MULTI_BEFORE=$(multi_members_of_subscription "$ACTION")
                        CURRENT_SERVERS=$(get_subscription_servers "$ACTION")
                        [ -n "$CURRENT_SERVERS" ] || CURRENT_SERVERS="[]"
                        PLAN=$(jq -c -n --argjson cur "$CURRENT_SERVERS" --argjson new "$SERVERS_JSON" '
                            def sorted: walk(if type == "object" then to_entries | sort_by(.key) | from_entries else . end);
                            def norm: del(.id, .subscription_id, .created_at, .updated_at) | sorted | tojson;
                            # What makes it the same server. Some providers (FOLK, 26.09) hand out
                            # a different REALITY sni on every fetch; that must update the server,
                            # not replace it under a new id — a new id drops it out of the group.
                            def ident: [.name, .protocol, .server, .server_port, (.uuid // .password // "")] | tojson;
                            ($cur | map({id: .id, n: norm, i: ident})) as $c
                            | ($new | map({s: ., n: norm, i: ident})) as $n
                            | ($c | map(.n)) as $ck
                            | ($n | map(.n)) as $nk
                            | if ($ck | unique | length) != ($ck | length) or ($nk | unique | length) != ($nk | length)
                              then {mode: "full"}
                              else
                                [$c[] | select(.n as $k | ($nk | index($k)) == null)] as $cr
                                | [$n[] | select(.n as $k | ($ck | index($k)) == null)] as $nr
                                | ($cr | map(.i)) as $ci
                                | ($nr | map(.i)) as $ni
                                # only when the identity is unambiguous on both sides
                                | (if ($ci | unique | length) == ($ci | length) and ($ni | unique | length) == ($ni | length)
                                   then [$cr[] | .i as $k | select($ni | index($k)) | {id: .id, s: ($nr[$ni | index($k)].s)}]
                                   else [] end) as $upd
                                | ($upd | map(.id)) as $uids
                                | ($upd | map(.s | ident)) as $uis
                                | {mode: "delta",
                                   keep:   [$c[] | select(.n as $k | $nk | index($k)) | .id],
                                   update: $upd,
                                   delete: [$cr[] | select(.id as $x | ($uids | index($x)) == null) | .id],
                                   create: [$nr[] | select(.i as $k | ($uis | index($k)) == null) | .s]}
                              end' 2>/dev/null)
                        if [ "$(printf '%s' "$PLAN" | jq -r '.mode // empty' 2>/dev/null)" = "delta" ]; then
                            KEEP_COUNT=$(printf '%s' "$PLAN" | jq -r '.keep | length' 2>/dev/null)
                            CREATE_JSON=$(printf '%s' "$PLAN" | jq -c '.create' 2>/dev/null)
                            CREATE_COUNT=$(json_len "$CREATE_JSON")
                            # Same server, changed details: rewrite the file under its old id.
                            # sing-box keeps the old details until the next rebuild — no restart
                            # every hour for a disguise that rotates.
                            UPD_COUNT=0
                            UPD_NOW=$(date '+%Y-%m-%dT%H:%M:%S')
                            UPD_ALL=$(printf '%s' "$PLAN" | jq -c '.update // []' 2>/dev/null)
                            UPD_N=$(json_len "$UPD_ALL")
                            while [ "$UPD_COUNT" -lt "$UPD_N" ]; do
                                UPD_ID=$(printf '%s' "$UPD_ALL" | jq -r ".[$UPD_COUNT].id")
                                UPD_FILE="$VPN_CONFIGS_DIR/${UPD_ID}.json"
                                if [ -f "$UPD_FILE" ]; then
                                    UPD_JSON=$(jq -c --argjson s "$(printf '%s' "$UPD_ALL" | jq -c ".[$UPD_COUNT].s")" --arg now "$UPD_NOW" \
                                        '$s + {id: .id, subscription_id: .subscription_id, created_at: .created_at, updated_at: $now}' "$UPD_FILE" 2>/dev/null)
                                    [ -n "$UPD_JSON" ] && printf '%s\n' "$UPD_JSON" > "$UPD_FILE.tmp" && mv "$UPD_FILE.tmp" "$UPD_FILE"
                                fi
                                UPD_COUNT=$((UPD_COUNT + 1))
                            done
                            DEL_COUNT=0
                            for DEL_ID in $(printf '%s' "$PLAN" | jq -r '.delete[]?' 2>/dev/null); do
                                rm -f "$VPN_CONFIGS_DIR/${DEL_ID}.json"
                                DEL_COUNT=$((DEL_COUNT + 1))
                                [ "$DEL_ID" = "$ACTIVE_ID" ] && ACTIVE_GONE="yes"
                            done
                            if [ "$CREATE_COUNT" -gt 0 ]; then
                                SERVER_IDS=$(save_subscription_servers "$ACTION" "$CREATE_JSON")
                            fi
                            SKIP_REWRITE="yes"
                            log_action "SUBSCRIPTION_DELTA" "ID: $ACTION, kept: $KEEP_COUNT, updated: $UPD_COUNT, removed: $DEL_COUNT, added: $CREATE_COUNT"
                            # The active server only moves if its own file was one of the removed
                            [ "$ACTIVE_GONE" = "yes" ] || NEED_MIGRATION=""
                        fi

                        if [ -z "$SKIP_REWRITE" ]; then
                        # Delete old servers
                        delete_subscription_servers "$ACTION"
                        
                        # Save new ones
                        SERVER_IDS=$(save_subscription_servers "$ACTION" "$SERVERS_JSON")
                        fi

                        # === FEAT-009: Migration to new server with connectivity check ===
                        MIGRATED_TO=""
                        if [ "$NEED_MIGRATION" = "yes" ]; then
                            # Same server under a new id: repoint active-config, keep sing-box running
                            SAME_ID=$(find_same_server_config "$ACTIVE_JSON")
                            if [ -n "$SAME_ID" ]; then
                                set_active_config "$SAME_ID"
                                MIGRATED_TO="$SAME_ID"
                                log_action "SUBSCRIPTION_MIGRATION" "Active server unchanged: $ACTIVE_ID -> $SAME_ID, no restart"
                            else
                                MIGRATED_TO=$(migrate_with_check "$OLD_NAME" "$OLD_SERVER" "$OLD_PORT" "$ACTION")
                                if [ -n "$MIGRATED_TO" ]; then
                                    log_action "SUBSCRIPTION_MIGRATION" "Active server migrated: $ACTIVE_ID -> $MIGRATED_TO"
                                else
                                    log_action "SUBSCRIPTION_MIGRATION" "WARNING: No replacement found for $ACTIVE_ID, clearing active config"
                                    rm -f "$ACTIVE_CONFIG"
                                fi
                            fi
                        fi
                        # === END FEAT-009 post-save ===
                        
                        # Update subscription metadata
                        NOW=$(date '+%Y-%m-%dT%H:%M:%S')
                        if ! write_subscriptions_json --arg now "$NOW" \
                           --argjson count "$NEW_COUNT" \
                           --argjson metadata "$SUB_METADATA" \
                           "(.subscriptions[] | select(.id == \"$ACTION\")) |= . + {updated_at: \$now, server_count: \$count, metadata: \$metadata}"; then
                            json_error "Failed to update subscription registry" 500
                            exit 0
                        fi
                        
                        log_action "SUBSCRIPTION_REFRESHED" "ID: $ACTION, Servers: $NEW_COUNT, Migrated: $MIGRATED_TO"
                        multi_follow_members "$ACTION" "$MULTI_BEFORE"
                        multi_resync >/dev/null 2>&1
                        
                        # Form response with migration info
                        if [ -n "$MIGRATED_TO" ]; then
                            json_success "{\"server_count\":$NEW_COUNT,\"migrated_to\":\"$MIGRATED_TO\",\"message\":\"Subscription updated, VPN switched to new server\"}"
                        else
                        json_success "{\"server_count\":$NEW_COUNT,\"message\":\"Subscription updated\"}"
                        fi
                        ;;
                    
                    ""|*)
                        json_error "Unknown action: $SUB_ID" 400
                        ;;
                esac
                ;;
        esac
        ;;
    
    PUT)
        # Update subscription settings
        if [ -z "$ACTION" ]; then
            json_error "errors.subscriptionIdRequired" 400
            exit 0
        fi
        
        SUB=$(jq -c ".subscriptions[] | select(.id == \"$ACTION\")" "$SUBSCRIPTIONS_FILE" 2>/dev/null)
        
        if [ -z "$SUB" ]; then
            json_error "Subscription not found" 404
            exit 0
        fi
        
        POST_DATA=$(read_post_data)
        NAME=$(json_get_value "$POST_DATA" "name")
        AUTO_UPDATE=$(json_get_bool "$POST_DATA" "auto_update")
        UPDATE_INTERVAL=$(json_get_number "$POST_DATA" "update_interval")
        
        NOW=$(date '+%Y-%m-%dT%H:%M:%S')
        
        # Update fields
        UPDATE_EXPR=". + {updated_at: \"$NOW\"}"
        [ -n "$NAME" ] && UPDATE_EXPR="$UPDATE_EXPR | .name = \"$NAME\""
        [ -n "$AUTO_UPDATE" ] && UPDATE_EXPR="$UPDATE_EXPR | .auto_update = $AUTO_UPDATE"
        [ -n "$UPDATE_INTERVAL" ] && UPDATE_EXPR="$UPDATE_EXPR | .update_interval = $UPDATE_INTERVAL"
        
        if ! write_subscriptions_json "(.subscriptions[] | select(.id == \"$ACTION\")) |= ($UPDATE_EXPR)"; then
            json_error "Failed to update subscription registry" 500
            exit 0
        fi
        
        log_action "SUBSCRIPTION_UPDATED" "ID: $ACTION"
        json_success "{\"message\":\"Subscription settings updated\"}"
        ;;
    
    DELETE)
        # Delete subscription
        if [ -z "$ACTION" ]; then
            json_error "errors.subscriptionIdRequired" 400
            exit 0
        fi
        
        SUB=$(jq -c ".subscriptions[] | select(.id == \"$ACTION\")" "$SUBSCRIPTIONS_FILE" 2>/dev/null)
        
        if [ -z "$SUB" ]; then
            json_error "Subscription not found" 404
            exit 0
        fi
        
        # Check if any server is active from subscription
        ACTIVE_CONFIG=$(get_active_config)
        if [ -n "$ACTIVE_CONFIG" ] && [ -f "$VPN_CONFIGS_DIR/${ACTIVE_CONFIG}.json" ]; then
            ACTIVE_SUB_ID=$(jq -r '.subscription_id // empty' "$VPN_CONFIGS_DIR/${ACTIVE_CONFIG}.json" 2>/dev/null)
            if [ "$ACTIVE_SUB_ID" = "$ACTION" ]; then
                if check_singbox_running; then
                    json_error "errors.cannotDeleteActiveSubscription" 400
                    exit 0
                fi
            fi
        fi
        
        # Delete servers
        delete_subscription_servers "$ACTION"
        
        # Delete subscription from file
        if ! write_subscriptions_json "del(.subscriptions[] | select(.id == \"$ACTION\"))"; then
            json_error "Failed to update subscription registry" 500
            exit 0
        fi
        
        log_action "SUBSCRIPTION_DELETED" "ID: $ACTION"
        multi_resync >/dev/null 2>&1
        json_success "{\"message\":\"Subscription deleted\"}"
        ;;
    
    *)
        json_error "Method not supported" 405
        ;;
esac
