#!/bin/sh
# API for getting network segments (Bridge interfaces)

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

# GET does not require authorization (read only)
# POST requires authorization (policy changes)
if [ "$REQUEST_METHOD" = "POST" ]; then
    if ! validate_session; then
        json_error "Authorization required" 401
        exit 0
    fi
fi

# Routing policies file
ROUTING_POLICIES_FILE="$VPN_MANAGER_HOME/routing_policies.json"
# Segments cache (updated by S98singbox-rules at startup)
SEGMENTS_CACHE_FILE="$VPN_MANAGER_HOME/segments_cache.json"

# Initialize policies file
init_policies_file() {
    if [ ! -f "$ROUTING_POLICIES_FILE" ]; then
        # By default: br0 (Home) = split, others = direct
        echo '{"policies":{"br0":"split"},"global":"split"}' > "$ROUTING_POLICIES_FILE"
        chmod 644 "$ROUTING_POLICIES_FILE"
    fi
}

# Get Bridge interfaces list via ndmc
get_bridge_segments() {
    # ndmc available on Keenetic
    if command -v ndmc >/dev/null 2>&1; then
        # Get Bridge interfaces list
        local raw_output=$(ndmc -c 'show interface' 2>&1)
        
        # Check if ndmc call succeeded (may not work in CGI context)
        if echo "$raw_output" | grep -q "failed"; then
            # Fallback: use ip link
            local bridges=$(ip link show 2>/dev/null | grep -oE 'br[0-9]+:' | sed 's/://' | sort -u)
            
            for br in $bridges; do
                local idx="${br#br}"
                local ip_subnet=$(ip -4 addr show "$br" 2>/dev/null | grep -oE 'inet [0-9.]+/[0-9]+' | awk '{print $2}')
                echo "$idx|$br|$br|$br|$ip_subnet"
            done
            return
        fi
        
        local bridges=$(echo "$raw_output" | grep -oE 'id: Bridge[0-9]+' | sed 's/id: //')
        
        for bridge_id in $bridges; do
            # Get interface details
            local info=$(ndmc -c "show interface $bridge_id" 2>/dev/null)
            
            # Parse fields
            local idx=$(echo "$info" | grep -E '^\s+index:' | head -1 | awk '{print $2}')
            local name=$(echo "$info" | grep -E '^\s+interface-name:' | head -1 | awk '{print $2}')
            local desc=$(echo "$info" | grep -E '^\s+description:' | head -1 | sed 's/.*description: //')
            local address=$(echo "$info" | grep -E '^\s+address:' | head -1 | awk '{print $2}')
            local mask=$(echo "$info" | grep -E '^\s+mask:' | head -1 | awk '{print $2}')
            
            # Calculate Linux interface name
            local bridge_dev="br$idx"
            
            # Form subnet
            local subnet=""
            if [ -n "$address" ] && [ -n "$mask" ]; then
                # Convert mask to CIDR
                local cidr=$(mask_to_cidr "$mask")
                subnet="$address/$cidr"
            fi
            
            [ -z "$desc" ] && desc="$name"
            
            echo "$idx|$name|$desc|$bridge_dev|$subnet"
        done
    else
        # Fallback: just look at br* interfaces via ip
        for br in $(ip link show 2>/dev/null | grep -oE 'br[0-9]+' | sort -u); do
            idx="${br#br}"
            local ip_subnet=$(get_segment_ips "$br")
            echo "$idx|$br|$br|$br|$ip_subnet"
        done
    fi
}

# Mask to CIDR conversion
mask_to_cidr() {
    local mask="$1"
    local cidr=0
    for octet in $(echo "$mask" | tr '.' ' '); do
        case "$octet" in
            255) cidr=$((cidr + 8)) ;;
            254) cidr=$((cidr + 7)) ;;
            252) cidr=$((cidr + 6)) ;;
            248) cidr=$((cidr + 5)) ;;
            240) cidr=$((cidr + 4)) ;;
            224) cidr=$((cidr + 3)) ;;
            192) cidr=$((cidr + 2)) ;;
            128) cidr=$((cidr + 1)) ;;
            0) ;;
        esac
    done
    echo "$cidr"
}

# Get segment IP addresses
get_segment_ips() {
    local bridge="$1"
    ip -4 addr show "$bridge" 2>/dev/null | grep -oE 'inet [0-9.]+/[0-9]+' | awk '{print $2}'
}

# Check VPN server presence (sing-box inbound on port 8388)
# Returns JSON object or empty string
get_vpn_server_info() {
    local creds_file="$VPN_MANAGER_HOME/vpnserver-credentials.json"
    local config_file="/opt/etc/sing-box/config.json"
    local port=""
    local found=0
    
    # Check VPN server credentials presence
    if [ -f "$creds_file" ]; then
        port=$(jq -r '.server_port // 8388' "$creds_file" 2>/dev/null)
        found=1
    fi
    
    # Fallback: check sing-box config for VPN server inbound
    if [ "$found" = "0" ] && [ -f "$config_file" ]; then
        if jq -e '.inbounds[] | select(.tag == "ss-server-in" or .tag == "vpn-server-in")' "$config_file" >/dev/null 2>&1; then
            port=$(jq -r '.inbounds[] | select(.tag == "ss-server-in" or .tag == "vpn-server-in") | .listen_port // 8388' "$config_file" 2>/dev/null | head -1)
            found=1
        fi
    fi
    
    if [ "$found" = "1" ] && [ -n "$port" ]; then
        echo "{\"port\":$port,\"enabled\":true}"
    else
        echo ""
    fi
}

# Form JSON with segments list
list_segments() {
    init_policies_file
    
    # Get policies
    local policies_json=$(cat "$ROUTING_POLICIES_FILE" 2>/dev/null || echo '{"policies":{},"global":"split"}')
    local global_policy=$(echo "$policies_json" | jq -r '.global // "split"')
    
    # Check segments cache (created by S98singbox-rules at startup)
    local use_cache=0
    if [ -f "$SEGMENTS_CACHE_FILE" ] && [ -s "$SEGMENTS_CACHE_FILE" ]; then
        # Check that cache contains valid JSON with segments
        local cached=$(cat "$SEGMENTS_CACHE_FILE")
        local segments_count=$(echo "$cached" | jq -r '.segments | length' 2>/dev/null)
        if [ -n "$segments_count" ] && [ "$segments_count" -gt 0 ] 2>/dev/null; then
            use_cache=1
            
            local segments=$(echo "$cached" | jq -r '.segments // []')
            
            # Update policies in cached segments
            local updated_segments=$(echo "$segments" | jq --argjson policies "$(echo "$policies_json" | jq '.policies')" --arg global "$global_policy" '
                [.[] | . + {policy: ($policies[.bridge] // $global)}]
            ')
            
            # VPN server (sing-box inbound on port 8388)
            local vpn_info=""
            local vpn_server=$(get_vpn_server_info)
            if [ -n "$vpn_server" ]; then
                local vpn_port=$(echo "$vpn_server" | jq -r '.port // 8388')
                local vpn_policy=$(echo "$policies_json" | jq -r '.policies["vpn_server"] // "split"')
                vpn_info=",\"vpn_server\":{\"port\":$vpn_port,\"policy\":\"$vpn_policy\",\"isInternal\":true}"
            fi
            
            echo "{\"segments\":$updated_segments$vpn_info,\"global_policy\":\"$global_policy\"}" | jq '.'
            return
        fi
    fi
    
    # Fallback: Get data via ip link with friendly names
    local segments_json='[]'
    
    for br in $(ip link show 2>/dev/null | grep -oE 'br[0-9]+' | sort -u); do
        local idx="${br#br}"
        local subnet=$(ip -4 addr show "$br" 2>/dev/null | grep -oE 'inet [0-9.]+/[0-9]+' | awk '{print $2}')
        
        # Generate friendly names (as in S98singbox-rules)
        local name=""
        local desc=""
        case "$idx" in
            0) name="Home"; desc="Home network" ;;
            1) name="Guest"; desc="Guest network" ;;
            *) name="Segment$idx"; desc="Segment $idx" ;;
        esac
        
        # Get policy
        local policy=$(echo "$policies_json" | jq -r ".policies[\"$br\"] // \"$global_policy\"")
        
        segments_json=$(echo "$segments_json" | jq \
            --argjson idx "$idx" \
            --arg name "$name" \
            --arg desc "$desc" \
            --arg bridge "$br" \
            --arg subnet "$subnet" \
            --arg policy "$policy" \
            '. + [{index: $idx, name: $name, description: $desc, bridge: $bridge, subnet: $subnet, policy: $policy}]')
    done
    
    # VPN server (sing-box inbound on port 8388)
    local vpn_info=""
    local vpn_server=$(get_vpn_server_info)
    if [ -n "$vpn_server" ]; then
        local vpn_port=$(echo "$vpn_server" | jq -r '.port // 8388')
        local vpn_policy=$(echo "$policies_json" | jq -r '.policies["vpn_server"] // "split"')
        vpn_info=",\"vpn_server\":{\"port\":$vpn_port,\"policy\":\"$vpn_policy\",\"isInternal\":true}"
    fi
    
    echo "{\"segments\":$segments_json$vpn_info,\"global_policy\":\"$global_policy\"}" | jq '.'
}

# Save routing policies
save_policies() {
    init_policies_file
    
    # Read POST data
    local post_data=$(cat)
    
    # Validation JSON
    if ! echo "$post_data" | jq '.' >/dev/null 2>&1; then
        json_error "Invalid JSON" 400
        return
    fi
    
    # Expected format:
    # { "policies": {"br0": "split", "br1": "direct", "br2": "fullvpn"}, "global": "split" }
    
    # Check policies presence
    local policies=$(echo "$post_data" | jq -r '.policies // empty')
    if [ -z "$policies" ]; then
        json_error "Missing 'policies' field" 400
        return
    fi
    
    # Get global policy
    local global=$(echo "$post_data" | jq -r '.global // "split"')
    
    # Validate policy values
    # split = Direct primary, vpnprimary = VPN primary (B1). Whole-word match only:
    # a substring check let values like "vpn" or "lit" through.
    local valid_policies="direct split vpnprimary fullvpn"
    local validation_error=""

    # Check each policy
    for bridge in $(echo "$policies" | jq -r 'keys[]'); do
        local policy=$(echo "$policies" | jq -r ".[\"$bridge\"]")
        case " $valid_policies " in
            *" $policy "*)
                # OK
                ;;
            *)
                validation_error="Invalid policy '$policy' for '$bridge'. Valid: direct, split, vpnprimary, fullvpn"
                break
                ;;
        esac
    done

    if [ -n "$validation_error" ]; then
        json_error "$validation_error" 400
        return
    fi

    # Check global
    case " $valid_policies " in
        *" $global "*)
            # OK
            ;;
        *)
            json_error "Invalid global policy '$global'. Valid: direct, split, vpnprimary, fullvpn" 400
            return
            ;;
    esac
    
    # Save
    echo "$post_data" | jq '{policies: .policies, global: .global}' > "$ROUTING_POLICIES_FILE"
    
    # Check if VPN server policy changed
    local vpn_server_policy=$(echo "$policies" | jq -r '.vpn_server // empty')
    
    if [ -n "$vpn_server_policy" ]; then
        # Update route rules for VPN clients in sing-box config
        update_vpnclient_rules "$vpn_server_policy"
        
        # Restart sing-box to apply changes
        if [ -x "/opt/etc/init.d/S99sing-box" ]; then
            /opt/etc/init.d/S99sing-box restart >/dev/null 2>&1 &
        fi
    fi
    
    # Apply iptables rules for bridge segments
    if [ -x "/opt/etc/init.d/S98singbox-rules" ]; then
        /opt/etc/init.d/S98singbox-rules reload >/dev/null 2>&1 &
    fi
    
    json_success '"Policies saved"'
}

# Update segments cache (calls S98singbox-rules update-cache)
refresh_cache() {
    if [ -x "/opt/etc/init.d/S98singbox-rules" ]; then
        /opt/etc/init.d/S98singbox-rules update-cache >/dev/null 2>&1
        json_success '"Cache updated"'
    else
        json_error "S98singbox-rules not found" 500
    fi
}

# Main router
# Check action from query string
ACTION=""
case "$QUERY_STRING" in
    *action=refresh*) ACTION="refresh" ;;
esac

case "$REQUEST_METHOD" in
    GET)
        if [ "$ACTION" = "refresh" ]; then
            # Update cache (requires authorization)
            if ! validate_session; then
                json_error "Authorization required" 401
                exit 0
            fi
            refresh_cache
        else
            # Return segments list with policies
            echo "Content-Type: application/json"
            echo ""
            list_segments
        fi
        ;;
    POST)
        # Save policies (save_policies outputs headers via json_success/json_error)
        save_policies
        ;;
    *)
        json_error "Method not allowed" 405
        ;;
esac
