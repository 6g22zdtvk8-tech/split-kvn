#!/bin/sh
# =============================================================================
# VPN Server (VLESS + WebSocket) API
# =============================================================================

# Include common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Paths
VPN_SERVER_CREDS="/opt/etc/vpn-manager/vpnserver-credentials.json"
SINGBOX_INIT="/opt/etc/init.d/S99sing-box"
SINGBOX_CONFIG="/opt/etc/sing-box/config.json"
VPN_SERVER_PORT=8388

# Compatibility with old paths (migration)
OLD_SS_CREDS="/opt/etc/vpn-manager/ssserver-credentials.json"

# =============================================================================
# Migration from Shadowsocks to VLESS
# =============================================================================

migrate_from_shadowsocks() {
    # If old Shadowsocks config exists but no new VLESS вЂ” migration needed
    if [ -f "$OLD_SS_CREDS" ] && [ ! -f "$VPN_SERVER_CREDS" ]; then
        log_action "VPN_MIGRATION" "Migrating from Shadowsocks to VLESS"
        
        # Save user names for migration
        local user_names=$(jq -r '.users[].name' "$OLD_SS_CREDS" 2>/dev/null)
        
        # Generate new VLESS credentials
        setup_vless_credentials
        
        # Restore users (with new UUIDs)
        for name in $user_names; do
            if [ "$name" != "default" ]; then
                local uuid=$(generate_uuid)
                local tmp_creds=$(mktemp)
                jq ".users += [{\"name\": \"$name\", \"uuid\": \"$uuid\"}]" "$VPN_SERVER_CREDS" > "$tmp_creds"
                mv "$tmp_creds" "$VPN_SERVER_CREDS"
            fi
        done
        
        # Archive old config
        mv "$OLD_SS_CREDS" "${OLD_SS_CREDS}.bak.$(date +%Y%m%d)"
        
        log_action "VPN_MIGRATION" "Migration completed"
    fi
}

# =============================================================================
# Key generation
# =============================================================================

generate_uuid() {
    if [ -x /opt/bin/sing-box ]; then
        /opt/bin/sing-box generate uuid 2>/dev/null
    elif command -v uuidgen >/dev/null 2>&1; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        cat /proc/sys/kernel/random/uuid 2>/dev/null || \
        (od -x /dev/urandom | head -1 | awk '{print $2$3"-"$4"-"$5"-"$6"-"$7$8$9}')
    fi
}

generate_reality_keypair() {
    if [ -x /opt/bin/sing-box ]; then
        /opt/bin/sing-box generate reality-keypair 2>/dev/null
    else
        echo ""
    fi
}

generate_short_id() {
    if [ -x /opt/bin/sing-box ]; then
        /opt/bin/sing-box generate rand --hex 8 2>/dev/null
    else
        head -c 4 /dev/urandom | od -A n -t x1 | tr -d ' \n'
    fi
}

setup_vless_credentials() {
    mkdir -p "$(dirname "$VPN_SERVER_CREDS")"
    
    local user_uuid=$(generate_uuid)
    
    cat > "$VPN_SERVER_CREDS" << EOF
{
  "protocol": "vless",
  "server_port": $VPN_SERVER_PORT,
  "transport": "ws",
  "ws_path": "/vless-ws",
  "tls": false,
  "users": [
    {
      "name": "default",
      "uuid": "$user_uuid"
    }
  ],
  "created_at": "$(date -Iseconds 2>/dev/null || date)"
}
EOF
    
    chmod 600 "$VPN_SERVER_CREDS"
}

# =============================================================================
# Functions
# =============================================================================

get_server_status() {
    local running="false"
    local pid=""
    
    # Get actual port from credentials (FEAT-201)
    local actual_port="$VPN_SERVER_PORT"
    if [ -f "$VPN_SERVER_CREDS" ]; then
        actual_port=$(jq -r '.server_port // 8388' "$VPN_SERVER_CREDS" 2>/dev/null)
    fi
    
    if [ -f /var/run/sing-box.pid ]; then
        pid=$(cat /var/run/sing-box.pid 2>/dev/null)
        if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
            running="true"
        fi
    fi
    
    if [ "$running" = "false" ]; then
        pid=$(ps | grep "sing-box" | grep -v grep | awk '{print $1}' | head -1)
        if [ -n "$pid" ]; then
            running="true"
        fi
    fi
    
    local port_open="false"
    if netstat -tlnp 2>/dev/null | grep -q ":$actual_port "; then
        port_open="true"
        running="true"
    fi
    
    echo "{\"running\":$running,\"pid\":\"$pid\",\"port\":$actual_port,\"port_open\":$port_open}"
}

get_external_address() {
    local ddns_addr=""
    local ip_addr=""
    local external_addr=""
    local detection_method=""
    local is_nat="false"
    
    # Method 1: Custom DDNS via /rci/show/ndns
    local rci_ndns=$(curl -s --max-time 2 http://localhost:79/rci/show/ndns 2>/dev/null)
    if [ -n "$rci_ndns" ]; then
        local ndns_name=$(echo "$rci_ndns" | jq -r '.name // empty' 2>/dev/null)
        local ndns_domain=$(echo "$rci_ndns" | jq -r '.domain // empty' 2>/dev/null)
        local ndns_ip=$(echo "$rci_ndns" | jq -r '.address // empty' 2>/dev/null)
        
        if [ -n "$ndns_name" ] && [ -n "$ndns_domain" ]; then
            ddns_addr="${ndns_name}.${ndns_domain}"
        fi
        if [ -n "$ndns_ip" ]; then
            ip_addr="$ndns_ip"
        fi
    fi
    
    # Method 2: Cloud DDNS
    if [ -z "$ddns_addr" ]; then
        local rci_cloud=$(curl -s --max-time 2 http://localhost:79/rci/show/cloud 2>/dev/null)
        if [ -n "$rci_cloud" ]; then
            local token=$(echo "$rci_cloud" | jq -r '.agent.service.token_alias // empty' 2>/dev/null | cut -c1-24)
            local dom=$(echo "$rci_cloud" | jq -r '.agent.domain // empty' 2>/dev/null)
            if [ -n "$token" ] && [ -n "$dom" ]; then
                ddns_addr="${token}.${dom}"
            fi
        fi
    fi
    
    # WAN IP
    local wan_ip=""
    local wan_rci=$(curl -s --max-time 2 http://localhost:79/rci/show/interface/GigabitEthernet1 2>/dev/null)
    if [ -n "$wan_rci" ]; then
        wan_ip=$(echo "$wan_rci" | jq -r '.address // empty' 2>/dev/null)
    fi
    
    if [ -z "$wan_ip" ]; then
        wan_ip=$(ip route get 8.8.8.8 2>/dev/null | sed -n 's/.*src \([^ ]*\).*/\1/p')
    fi
    
    # External IP — query multiple providers in parallel and take majority.
    # Why majority: a single provider can give a wrong result if it gets routed
    # through someone else's VPN (e.g. upstream router routes its domain via VPN
    # by matching some subnet) — we'd then "see" the upstream VPN's egress IP
    # instead of our real ISP one. With ≥3 independent providers, the real IP
    # wins as long as the divergent answer is the minority.
    local external_ip=""
    local external_ip_uncertain="false"
    local external_ip_sources=""
    local _eip_dir=$(mktemp -d 2>/dev/null || echo "/tmp/eip.$$")
    mkdir -p "$_eip_dir" 2>/dev/null
    
    # Each entry: "name|url"
    # Odd number of providers (5) avoids 2-2 ties when one provider is hijacked
    # by upstream-VPN routing.
    set -- \
        "ipify|https://api.ipify.org" \
        "icanhazip|https://ipv4.icanhazip.com" \
        "ifconfig|https://ifconfig.me/ip" \
        "amazonaws|https://checkip.amazonaws.com" \
        "ipinfo|https://ipinfo.io/ip"
    
    for entry in "$@"; do
        local name="${entry%%|*}"
        local url="${entry#*|}"
        (
            # No `local` here — subshell has its own variable scope already,
            # and BusyBox `local` is only meaningful inside function bodies.
            raw=$(curl -s -4 --max-time 3 "$url" 2>/dev/null | tr -d ' \r\n\t')
            # Validate as IPv4 to discard HTML error pages or empty bodies
            case "$raw" in
                [0-9]*.[0-9]*.[0-9]*.[0-9]*) echo "$raw" > "$_eip_dir/$name" ;;
            esac
        ) &
    done
    wait
    
    # Collect, then majority-vote.
    # BusyBox-friendly: sort | uniq -c gives counts, sort -nr puts winner first.
    local _all=$(cat "$_eip_dir"/* 2>/dev/null)
    if [ -n "$_all" ]; then
        local _winner=$(echo "$_all" | sort | uniq -c | sort -nr | head -1)
        local _winner_count=$(echo "$_winner" | awk '{print $1}')
        local _winner_ip=$(echo "$_winner" | awk '{print $2}')
        local _total=$(echo "$_all" | wc -l | tr -d ' \r\n')
        external_ip="$_winner_ip"
        # Build "name=ip" diagnostics list (newline-separated)
        for f in "$_eip_dir"/*; do
            [ -f "$f" ] || continue
            external_ip_sources="${external_ip_sources}$(basename "$f")=$(cat "$f")\n"
        done
        # Mark uncertain if no clear majority (e.g. 4 different answers, 2-2 split).
        # Need strictly more than half to be confident.
        if [ "$_total" -gt 1 ] && [ "$_winner_count" -le $((_total / 2)) ]; then
            external_ip_uncertain="true"
        fi
    fi
    rm -rf "$_eip_dir" 2>/dev/null
    
    if [ -z "$ip_addr" ]; then
        ip_addr="$wan_ip"
    fi
    
    if [ -n "$ddns_addr" ]; then
        external_addr="$ddns_addr"
        detection_method="ddns"
    elif [ -n "$ip_addr" ]; then
        external_addr="$ip_addr"
        detection_method="ip"
    else
        external_addr="not_detected"
        ip_addr=""
        detection_method="none"
    fi
    
    # NAT detection — three logical outcomes:
    #   1) is_nat=true,  is_nat_uncertain=false → definitely behind NAT
    #   2) is_nat=false, is_nat_uncertain=false → definitely public IP (external check confirmed)
    #   3) is_nat=true,  is_nat_uncertain=true  → couldn't confirm with external service
    #                                              (services failed/blocked) → default to NAT-warning
    #
    # Why default to NAT when uncertain: a false "you have a public IP" is much worse than
    # a false "you might be behind NAT" — the former leads users to set up port-forwards
    # that silently won't work; the latter just suggests checking with the ISP.
    local is_nat_uncertain="false"
    
    # Layer 1: known private/CGNAT ranges → definitely NAT
    #   RFC 1918: 10/8, 172.16/12, 192.168/16
    #   RFC 6598: 100.64.0.0/10 (CGNAT, used by ISPs to share one public IP)
    if [ -n "$wan_ip" ]; then
        case "$wan_ip" in
            192.168.*|10.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*)
                is_nat="true"
                ;;
            100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*)
                is_nat="true"
                ;;
        esac
    fi
    
    # Layer 2: cross-check with what the internet actually sees.
    if [ "$is_nat" = "false" ]; then
        if [ -n "$wan_ip" ] && [ -n "$external_ip" ]; then
            # We have both — direct comparison is conclusive either way
            if [ "$wan_ip" != "$external_ip" ]; then
                is_nat="true"
            fi
            # else: matches → keep is_nat=false (confirmed public IP)
        else
            # External services unreachable / all returned garbage. We CAN'T confirm
            # the router actually has a publicly-reachable IP, so don't mislead the user.
            is_nat="true"
            is_nat_uncertain="true"
        fi
    fi
    
    # Strip trailing literal \n from sources list for cleaner JSON output
    external_ip_sources=$(printf '%b' "$external_ip_sources" | sed 's/\\n$//' | tr '\n' ',' | sed 's/,$//')
    
    echo "{\"address\":\"$external_addr\",\"ip\":\"${ip_addr:-}\",\"wan_ip\":\"${wan_ip:-}\",\"external_ip\":\"${external_ip:-}\",\"external_ip_uncertain\":$external_ip_uncertain,\"external_ip_sources\":\"${external_ip_sources}\",\"method\":\"$detection_method\",\"is_nat\":$is_nat,\"is_nat_uncertain\":$is_nat_uncertain}"
}

# Generation VLESS URL
# WebSocket format: vless://uuid@server:port?type=ws&path=/path&security=none#name
generate_vless_url() {
    local uuid="$1"
    local server="$2"
    local port="$3"
    local ws_path="$4"
    local name="$5"
    
    # URL encode parameters
    local encoded_name=$(echo "$name" | sed 's/ /%20/g; s/@/%40/g')
    local encoded_path=$(echo "$ws_path" | sed 's|/|%2F|g')
    
    echo "vless://${uuid}@${server}:${port}?type=ws&path=${encoded_path}&security=none#${encoded_name}"
}

get_server_config() {
    # Check migration
    migrate_from_shadowsocks
    
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        echo "{\"configured\":false,\"protocol\":\"vless\"}"
        return
    fi
    
    local status=$(get_server_status)
    local creds=$(cat "$VPN_SERVER_CREDS")
    local external_info=$(get_external_address)
    
    # Extract data
    local server_addr=$(echo "$external_info" | jq -r '.address')
    local server_ip=$(echo "$external_info" | jq -r '.ip // empty')
    local wan_ip=$(echo "$external_info" | jq -r '.wan_ip // empty')
    local external_ip=$(echo "$external_info" | jq -r '.external_ip // empty')
    local external_ip_uncertain=$(echo "$external_info" | jq -r '.external_ip_uncertain // false')
    local external_ip_sources=$(echo "$external_info" | jq -r '.external_ip_sources // empty')
    local detection_method=$(echo "$external_info" | jq -r '.method')
    local is_nat=$(echo "$external_info" | jq -r '.is_nat')
    local is_nat_uncertain=$(echo "$external_info" | jq -r '.is_nat_uncertain // false')
    
    # Get VLESS parameters
    local port=$(echo "$creds" | jq -r '.server_port // 8388')
    local ws_path=$(echo "$creds" | jq -r '.ws_path // "/vless-ws"')
    
    # IP for links
    local url_ip="$server_ip"
    if [ "$is_nat" = "true" ] && [ -n "$wan_ip" ]; then
        url_ip="$wan_ip"
    fi
    
    # Generate URL for each user
    local users_with_urls="[]"
    local user_count=$(echo "$creds" | jq '.users | length')
    
    for i in $(seq 0 $((user_count - 1))); do
        local user=$(echo "$creds" | jq ".users[$i]")
        local name=$(echo "$user" | jq -r '.name')
        local uuid=$(echo "$user" | jq -r '.uuid')
        local is_suspended=$(echo "$user" | jq -r '.suspended // false')
        
        # URL with DDNS/main address
        local vless_url=$(generate_vless_url "$uuid" "$server_addr" "$port" "$ws_path" "${name}@${server_addr}")
        
        # URL with IP (if different)
        local vless_url_ip=""
        if [ -n "$url_ip" ] && [ "$url_ip" != "$server_addr" ]; then
            vless_url_ip=$(generate_vless_url "$uuid" "$url_ip" "$port" "$ws_path" "${name}@${url_ip}")
        fi
        
        users_with_urls=$(echo "$users_with_urls" | jq --arg name "$name" --arg uuid "$uuid" --arg url "$vless_url" --arg url_ip "$vless_url_ip" --argjson suspended "$is_suspended" \
            '. += [{"name": $name, "uuid": $uuid, "vless_url": $url, "vless_url_ip": (if $url_ip != "" then $url_ip else null end), "suspended": $suspended}]')
    done
    
    # Assemble result
    echo "$creds" | jq \
        --argjson status "$status" \
        --argjson users "$users_with_urls" \
        --arg server "$server_addr" \
        --arg server_ip "$url_ip" \
        --arg wan_ip "$wan_ip" \
        --arg external_ip "$external_ip" \
        --argjson external_ip_uncertain "$external_ip_uncertain" \
        --arg external_ip_sources "$external_ip_sources" \
        --arg detection_method "$detection_method" \
        --argjson is_nat "$is_nat" \
        --argjson is_nat_uncertain "$is_nat_uncertain" \
        '. + {
            configured: true,
            protocol: "vless",
            status: $status,
            users: $users,
            server: $server,
            server_ip: $server_ip,
            wan_ip: $wan_ip,
            external_ip: $external_ip,
            external_ip_uncertain: $external_ip_uncertain,
            external_ip_sources: $external_ip_sources,
            detection_method: $detection_method,
            is_nat: $is_nat,
            is_nat_uncertain: $is_nat_uncertain
        }'
}

get_users() {
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        echo "[]"
        return
    fi
    
    jq -r '.users // []' "$VPN_SERVER_CREDS"
}

add_user() {
    local name="$1"
    
    if [ -z "$name" ]; then
        json_error "errors.usernameRequired" 400
        return
    fi
    
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        json_error "errors.vpnServerNotConfigured" 400
        return
    fi
    
    # Check if user exists
    if jq -e ".users[] | select(.name == \"$name\")" "$VPN_SERVER_CREDS" >/dev/null 2>&1; then
        json_error "User '$name' already exists" 400
        return
    fi
    
    # Generate UUID
    local uuid=$(generate_uuid)
    
    # Add user
    local tmp_creds=$(mktemp)
    jq ".users += [{\"name\": \"$name\", \"uuid\": \"$uuid\"}]" "$VPN_SERVER_CREDS" > "$tmp_creds"
    mv "$tmp_creds" "$VPN_SERVER_CREDS"
    chmod 600 "$VPN_SERVER_CREDS"
    
    # Update config sing-box
    update_singbox_users
    
    # Restart sing-box (synchronous to ensure config is reloaded)
    if [ -f "$SINGBOX_INIT" ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
        sleep 2
        # Verify sing-box is running
        if ! pgrep -f "sing-box" >/dev/null 2>&1; then
            json_error "errors.singboxStartFailed" 500
            return
        fi
    fi
    
    log_action "VPNSERVER_USER_ADDED" "User: $name"
    json_success "{\"message\":\"User added\",\"name\":\"$name\",\"uuid\":\"$uuid\"}"
}

update_singbox_users() {
    if [ ! -f "$SINGBOX_CONFIG" ] || [ ! -f "$VPN_SERVER_CREDS" ]; then
        return
    fi
    
    # Only include active (non-suspended) users
    local users_json=$(jq -r '[.users[] | select(.suspended != true) | {name: .name, uuid: .uuid}]' "$VPN_SERVER_CREDS")
    
    # Update config sing-box
    local tmp_config=$(mktemp)
    jq --argjson users "$users_json" \
        '(.inbounds[] | select(.tag == "ss-server-in")).users = $users' \
        "$SINGBOX_CONFIG" > "$tmp_config"
    
    if [ -s "$tmp_config" ]; then
        mv "$tmp_config" "$SINGBOX_CONFIG"
        chmod 644 "$SINGBOX_CONFIG"
    else
        rm -f "$tmp_config"
    fi
}

delete_user() {
    local name="$1"
    
    if [ -z "$name" ]; then
        json_error "errors.usernameRequired" 400
        return
    fi
    
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        json_error "errors.vpnServerNotConfigured" 400
        return
    fi
    
    # Delete from credentials
    local tmp_creds=$(mktemp)
    jq "del(.users[] | select(.name == \"$name\"))" "$VPN_SERVER_CREDS" > "$tmp_creds"
    mv "$tmp_creds" "$VPN_SERVER_CREDS"
    chmod 600 "$VPN_SERVER_CREDS"
    
    # Update config sing-box
    update_singbox_users
    
    # Restart sing-box (synchronous)
    if [ -f "$SINGBOX_INIT" ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
        sleep 2
        if ! pgrep -f "sing-box" >/dev/null 2>&1; then
            json_error "errors.singboxStartFailed" 500
            return
        fi
    fi
    
    log_action "VPNSERVER_USER_DELETED" "User: $name"
    json_success "{\"message\":\"User deleted\"}"
}

regenerate_user_uuid() {
    local name="$1"
    
    if [ -z "$name" ]; then
        json_error "errors.usernameRequired" 400
        return
    fi
    
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        json_error "errors.vpnServerNotConfigured" 400
        return
    fi
    
    # Generate new UUID
    local new_uuid=$(generate_uuid)
    
    # Update credentials
    local tmp_creds=$(mktemp)
    jq "(.users[] | select(.name == \"$name\")).uuid = \"$new_uuid\"" "$VPN_SERVER_CREDS" > "$tmp_creds"
    mv "$tmp_creds" "$VPN_SERVER_CREDS"
    chmod 600 "$VPN_SERVER_CREDS"
    
    # Update config sing-box
    update_singbox_users
    
    # Restart sing-box (synchronous)
    if [ -f "$SINGBOX_INIT" ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
        sleep 2
        if ! pgrep -f "sing-box" >/dev/null 2>&1; then
            json_error "errors.singboxStartFailed" 500
            return
        fi
    fi
    
    log_action "VPNSERVER_USER_UUID_REGENERATED" "User: $name"
    json_success "{\"message\":\"UUID regenerated\",\"name\":\"$name\",\"uuid\":\"$new_uuid\"}"
}

rename_user() {
    local old_name="$1"
    local new_name="$2"
    
    if [ -z "$old_name" ] || [ -z "$new_name" ]; then
        json_error "errors.oldNewNameRequired" 400
        return
    fi
    
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        json_error "errors.vpnServerNotConfigured" 400
        return
    fi
    
    if ! jq -e ".users[] | select(.name == \"$old_name\")" "$VPN_SERVER_CREDS" >/dev/null 2>&1; then
        json_error "User '$old_name' not found" 404
        return
    fi
    
    if jq -e ".users[] | select(.name == \"$new_name\")" "$VPN_SERVER_CREDS" >/dev/null 2>&1; then
        json_error "User '$new_name' already exists" 400
        return
    fi
    
    local tmp_creds=$(mktemp)
    jq "(.users[] | select(.name == \"$old_name\")).name = \"$new_name\"" "$VPN_SERVER_CREDS" > "$tmp_creds"
    mv "$tmp_creds" "$VPN_SERVER_CREDS"
    chmod 600 "$VPN_SERVER_CREDS"
    
    update_singbox_users
    
    # Restart sing-box (synchronous)
    if [ -f "$SINGBOX_INIT" ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
        sleep 2
        if ! pgrep -f "sing-box" >/dev/null 2>&1; then
            json_error "errors.singboxStartFailed" 500
            return
        fi
    fi
    
    log_action "VPNSERVER_USER_RENAMED" "Old: $old_name, New: $new_name"
    json_success "{\"message\":\"User renamed\",\"old_name\":\"$old_name\",\"new_name\":\"$new_name\"}"
}

suspend_user() {
    local name="$1"
    local suspended="$2"
    
    if [ -z "$name" ]; then
        json_error "errors.usernameRequired" 400
        return
    fi
    
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        json_error "errors.vpnServerNotConfigured" 400
        return
    fi
    
    if ! jq -e ".users[] | select(.name == \"$name\")" "$VPN_SERVER_CREDS" >/dev/null 2>&1; then
        json_error "User '$name' not found" 404
        return
    fi
    
    local tmp_creds=$(mktemp)
    if [ "$suspended" = "true" ]; then
        jq "(.users[] | select(.name == \"$name\")).suspended = true" "$VPN_SERVER_CREDS" > "$tmp_creds"
    else
        jq "(.users[] | select(.name == \"$name\")) |= del(.suspended)" "$VPN_SERVER_CREDS" > "$tmp_creds"
    fi
    mv "$tmp_creds" "$VPN_SERVER_CREDS"
    chmod 600 "$VPN_SERVER_CREDS"
    
    update_singbox_users
    
    if [ -f "$SINGBOX_INIT" ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
        sleep 2
        if ! pgrep -f "sing-box" >/dev/null 2>&1; then
            json_error "errors.singboxStartFailed" 500
            return
        fi
    fi
    
    log_action "VPNSERVER_USER_SUSPENDED" "User: $name, suspended: $suspended"
    json_success "{\"message\":\"User updated\",\"name\":\"$name\",\"suspended\":$suspended}"
}

# =============================================================================
# Export / Import users
# =============================================================================

# Build an export bundle.
# $1 = comma-separated list of names; empty = all users.
# Output is a JSON object suitable for re-import.
export_users() {
    local names_csv="$1"
    
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        json_error "errors.vpnServerNotConfigured" 400
        return
    fi
    
    local exported_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date)
    local users_json
    
    if [ -z "$names_csv" ]; then
        users_json=$(jq '[.users[] | {name: .name, uuid: .uuid, suspended: (.suspended // false)}]' "$VPN_SERVER_CREDS")
    else
        # Build a JSON array of names from CSV, then filter the users array
        local names_arr=$(echo "$names_csv" | jq -R 'split(",") | map(select(length > 0))')
        users_json=$(jq --argjson names "$names_arr" \
            '[.users[] | select(.name as $n | $names | index($n)) | {name: .name, uuid: .uuid, suspended: (.suspended // false)}]' \
            "$VPN_SERVER_CREDS")
    fi
    
    # Wrap in versioned envelope
    jq -n \
        --argjson users "$users_json" \
        --arg exported_at "$exported_at" \
        '{
            version: 1,
            type: "vpn-manager-vlessserver-users",
            exported_at: $exported_at,
            users: $users
        }'
}

# Import users from a JSON bundle.
# $1 = JSON payload string with shape {users: [...], mode: "skip"|"overwrite"}
import_users() {
    local payload="$1"
    
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        json_error "errors.vpnServerNotConfigured" 400
        return
    fi
    
    # Validate payload shape
    if ! echo "$payload" | jq empty 2>/dev/null; then
        json_error "errors.invalidJson" 400
        return
    fi
    
    local payload_type=$(echo "$payload" | jq -r '.type // empty' 2>/dev/null)
    if [ "$payload_type" != "vpn-manager-vlessserver-users" ]; then
        json_error "errors.unsupportedFileType" 400
        return
    fi
    
    local mode=$(echo "$payload" | jq -r '.mode // "skip"' 2>/dev/null)
    case "$mode" in
        skip|overwrite) ;;
        *) mode="skip" ;;
    esac
    
    # Get list of existing names for conflict detection
    local existing_names=$(jq -r '[.users[].name]' "$VPN_SERVER_CREDS")
    
    # Iterate incoming users; build a working copy of credentials
    local tmp_creds=$(mktemp)
    cp "$VPN_SERVER_CREDS" "$tmp_creds"
    
    local added=0
    local overwritten=0
    local skipped=0
    local invalid=0
    
    local incoming_count=$(echo "$payload" | jq '.users | length' 2>/dev/null)
    [ -z "$incoming_count" ] && incoming_count=0
    
    local i=0
    while [ "$i" -lt "$incoming_count" ]; do
        local name=$(echo "$payload" | jq -r ".users[$i].name // empty" 2>/dev/null)
        local uuid=$(echo "$payload" | jq -r ".users[$i].uuid // empty" 2>/dev/null)
        i=$((i + 1))
        
        # Basic validation
        if [ -z "$name" ] || [ -z "$uuid" ]; then
            invalid=$((invalid + 1))
            continue
        fi
        # UUID must look like a UUID (8-4-4-4-12 hex)
        if ! echo "$uuid" | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
            invalid=$((invalid + 1))
            continue
        fi
        # Name: alnum + dash + underscore + space, length 1-64
        if ! echo "$name" | grep -qE '^[A-Za-z0-9_ -]{1,64}$'; then
            invalid=$((invalid + 1))
            continue
        fi
        
        local exists=$(echo "$existing_names" | jq --arg n "$name" 'index($n) != null')
        
        if [ "$exists" = "true" ]; then
            if [ "$mode" = "overwrite" ]; then
                local tmp2=$(mktemp)
                jq --arg n "$name" --arg u "$uuid" \
                    '(.users[] | select(.name == $n)).uuid = $u' \
                    "$tmp_creds" > "$tmp2" && mv "$tmp2" "$tmp_creds"
                overwritten=$((overwritten + 1))
            else
                skipped=$((skipped + 1))
            fi
        else
            local tmp2=$(mktemp)
            jq --arg n "$name" --arg u "$uuid" \
                '.users += [{"name": $n, "uuid": $u}]' \
                "$tmp_creds" > "$tmp2" && mv "$tmp2" "$tmp_creds"
            added=$((added + 1))
            # Track this name as existing for subsequent iterations
            existing_names=$(echo "$existing_names" | jq --arg n "$name" '. + [$n]')
        fi
    done
    
    # Validate result and persist
    if ! jq empty "$tmp_creds" 2>/dev/null; then
        rm -f "$tmp_creds"
        json_error "Failed to build credentials" 500
        return
    fi
    mv "$tmp_creds" "$VPN_SERVER_CREDS"
    chmod 600 "$VPN_SERVER_CREDS"
    
    # Push to sing-box and restart (synchronous so client retry works immediately)
    update_singbox_users
    if [ -f "$SINGBOX_INIT" ] && [ "$added" -gt 0 -o "$overwritten" -gt 0 ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
        sleep 2
        if ! pgrep -f "sing-box" >/dev/null 2>&1; then
            json_error "errors.singboxStartFailed" 500
            return
        fi
    fi
    
    log_action "VPNSERVER_USERS_IMPORTED" "added=$added overwritten=$overwritten skipped=$skipped invalid=$invalid mode=$mode"
    json_success "{\"message\":\"Import completed\",\"added\":$added,\"overwritten\":$overwritten,\"skipped\":$skipped,\"invalid\":$invalid,\"mode\":\"$mode\"}"
}

server_start() {
    if [ ! -f "$SINGBOX_INIT" ]; then
        json_error "errors.singboxNotInstalled" 500
        return
    fi
    
    "$SINGBOX_INIT" start >/dev/null 2>&1
    sleep 2
    
    if pgrep -f "sing-box" >/dev/null 2>&1; then
        log_action "SINGBOX_STARTED" "via vpnserver API"
        json_success "{\"message\":\"VPN server started\"}"
    else
        json_error "errors.singboxStartFailed" 500
    fi
}

server_stop() {
    if [ ! -f "$SINGBOX_INIT" ]; then
        json_error "errors.singboxNotInstalled" 500
        return
    fi
    
    "$SINGBOX_INIT" stop >/dev/null 2>&1
    log_action "SINGBOX_STOPPED" "via vpnserver API"
    json_success "{\"message\":\"VPN server stopped\"}"
}

server_restart() {
    if [ ! -f "$SINGBOX_INIT" ]; then
        json_error "errors.singboxNotInstalled" 500
        return
    fi
    
    "$SINGBOX_INIT" restart >/dev/null 2>&1
    sleep 2
    
    if pgrep -f "sing-box" >/dev/null 2>&1; then
        log_action "SINGBOX_RESTARTED" "via vpnserver API"
        json_success "{\"message\":\"VPN server restarted\"}"
    else
        json_error "errors.singboxStartFailed" 500
    fi
}

# =============================================================================
# Port management (FEAT-201)
# =============================================================================

check_port_available() {
    local port="$1"
    
    # Check if port is already in use
    if netstat -tuln 2>/dev/null | grep -q ":$port "; then
        return 1
    fi
    
    return 0
}

change_server_port() {
    local new_port="$1"
    
    # Validation
    if [ -z "$new_port" ]; then
        json_error "Port not specified" 400
        return
    fi
    
    # Check that it's a number
    if ! echo "$new_port" | grep -qE '^[0-9]+$'; then
        json_error "Port must be a number" 400
        return
    fi
    
    # Check range
    if [ "$new_port" -lt 1024 ] || [ "$new_port" -gt 65535 ]; then
        json_error "Port must be in range 1024-65535" 400
        return
    fi
    
    # Get current port from credentials
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        json_error "VPN server not configured" 500
        return
    fi
    
    local old_port=$(jq -r '.server_port // empty' "$VPN_SERVER_CREDS")
    if [ -z "$old_port" ]; then
        old_port="$VPN_SERVER_PORT"
    fi
    
    # If port hasn't changed
    if [ "$new_port" = "$old_port" ]; then
        json_success "{\"message\":\"Port unchanged\",\"port\":$new_port}"
        return
    fi
    
    # Check if new port is available (except if it's the current port)
    if ! check_port_available "$new_port"; then
        json_error "Port $new_port is already in use" 409
        return
    fi
    
    # Check if old port was opened in Keenetic
    local old_port_was_open="false"
    local port_config=$(ndmc -c "show running-config" 2>/dev/null)
    if echo "$port_config" | grep -q "ip static.*$old_port"; then
        old_port_was_open="true"
    fi
    
    # Update vpnserver-credentials.json
    local tmp_creds=$(mktemp)
    jq ".server_port = $new_port" "$VPN_SERVER_CREDS" > "$tmp_creds"
    if [ -s "$tmp_creds" ] && jq empty "$tmp_creds" 2>/dev/null; then
        mv "$tmp_creds" "$VPN_SERVER_CREDS"
        chmod 600 "$VPN_SERVER_CREDS"
    else
        rm -f "$tmp_creds"
        json_error "Failed to update credentials" 500
        return
    fi
    
    # Update sing-box config (find ss-server-in inbound and update listen_port)
    if [ -f "$SINGBOX_CONFIG" ]; then
        local tmp_config=$(mktemp)
        jq "(.inbounds[] | select(.tag == \"ss-server-in\")).listen_port = $new_port" "$SINGBOX_CONFIG" > "$tmp_config"
        if [ -s "$tmp_config" ] && jq empty "$tmp_config" 2>/dev/null; then
            mv "$tmp_config" "$SINGBOX_CONFIG"
            chmod 644 "$SINGBOX_CONFIG"
        else
            rm -f "$tmp_config"
            json_error "Failed to update sing-box config" 500
            return
        fi
    fi
    
    # Update port forwarding if old port was open
    if [ "$old_port_was_open" = "true" ]; then
        # Close old port
        ndmc -c "no ip static tcpudp ISP $old_port" >/dev/null 2>&1
        
        # Open new port
        ndmc -c "ip static tcpudp ISP $new_port 127.0.0.1 !$new_port" >/dev/null 2>&1
        
        # Save configuration
        ndmc -c "system configuration save" >/dev/null 2>&1
    fi
    
    # Restart sing-box
    if [ -f "$SINGBOX_INIT" ]; then
        "$SINGBOX_INIT" restart >/dev/null 2>&1
        sleep 2
        if ! pgrep -f "sing-box" >/dev/null 2>&1; then
            json_error "errors.singboxStartFailed" 500
            return
        fi
    fi
    
    log_action "VPN_SERVER_PORT_CHANGED" "Port changed from $old_port to $new_port"
    json_success "{\"message\":\"Port changed to $new_port\",\"port\":$new_port,\"old_port\":$old_port,\"port_forwarding_updated\":$old_port_was_open}"
}

# =============================================================================
# Request processing
# =============================================================================

PATH_INFO="${PATH_INFO:-}"
ACTION=$(echo "$PATH_INFO" | cut -d'/' -f2)
PARAM=$(echo "$PATH_INFO" | cut -d'/' -f3)

case "$REQUEST_METHOD" in
    GET)
        case "$ACTION" in
            ""|status)
                get_server_config
                ;;
            users)
                get_users
                ;;
            export)
                # Export users as JSON. Optional query: ?names=alice,bob (default: all)
                NAMES=$(echo "$QUERY_STRING" | sed -n 's/.*names=\([^&]*\).*/\1/p')
                # URL-decode commas (basic): we accept raw csv too
                NAMES=$(echo "$NAMES" | sed 's/%2C/,/gi; s/+/ /g')
                echo "Content-Type: application/json"
                echo "Content-Disposition: attachment; filename=\"vpn-users-$(date +%Y%m%d-%H%M%S).json\""
                echo ""
                export_users "$NAMES"
                ;;
            *)
                json_error "Unknown action: $ACTION" 400
                ;;
        esac
        ;;
        
    POST)
        case "$ACTION" in
            start)
                server_start
                ;;
            stop)
                server_stop
                ;;
            restart)
                server_restart
                ;;
            change-port)
                POST_DATA=$(read_post_data)
                NEW_PORT=$(echo "$POST_DATA" | jq -r '.port // empty')
                change_server_port "$NEW_PORT"
                ;;
            import)
                # Import users bundle. Body: {type, version, users:[...], mode:"skip|overwrite"}
                POST_DATA=$(read_post_data)
                import_users "$POST_DATA"
                ;;
            users)
                POST_DATA=$(read_post_data)
                USER_NAME=$(echo "$POST_DATA" | jq -r '.name // empty')
                add_user "$USER_NAME"
                ;;
            regenerate)
                POST_DATA=$(read_post_data)
                USER_NAME=$(echo "$POST_DATA" | jq -r '.name // empty')
                regenerate_user_uuid "$USER_NAME"
                ;;
            rename)
                POST_DATA=$(read_post_data)
                OLD_NAME=$(echo "$POST_DATA" | jq -r '.old_name // empty')
                NEW_NAME=$(echo "$POST_DATA" | jq -r '.new_name // empty')
                rename_user "$OLD_NAME" "$NEW_NAME"
                ;;
            suspend)
                POST_DATA=$(read_post_data)
                USER_NAME=$(echo "$POST_DATA" | jq -r '.name // empty')
                SUSPENDED=$(echo "$POST_DATA" | jq -r '.suspended | tostring')
                suspend_user "$USER_NAME" "$SUSPENDED"
                ;;
            *)
                json_error "Unknown action: $ACTION" 400
                ;;
        esac
        ;;
        
    DELETE)
        case "$ACTION" in
            users)
                if [ -n "$PARAM" ]; then
                    delete_user "$PARAM"
                else
                    json_error "errors.specifyUsername" 400
                fi
                ;;
            *)
                json_error "Unknown action: $ACTION" 400
                ;;
        esac
        ;;
        
    *)
        json_error "Method not supported" 405
        ;;
esac
