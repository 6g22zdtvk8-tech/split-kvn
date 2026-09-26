#!/bin/sh
# API for network settings (IPv6, port-forwarding)

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

# Authorization check
if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# =============================================================================
# Functions for IPv6 management
# =============================================================================

# Check IPv6 status
check_ipv6_status() {
    # Check running-config for IPv6 ON WAN INTERFACE
    # In config interface is named GigabitEthernet1 (rename ISP)
    local config=$(ndmc -c 'show running-config' 2>/dev/null)
    
    # IPv6 enabled if WAN interface has ipv6 address/prefix auto
    # Search in GigabitEthernet1 block (physical WAN name)
    if echo "$config" | grep -A30 'interface GigabitEthernet1$' | grep -qE 'ipv6 (address|prefix) auto'; then
        echo "enabled"
    else
        echo "disabled"
    fi
}

# Enable IPv6
enable_ipv6() {
    local output=""
    local errors=""
    
    # Enable IPv6 on WAN interface (ISP вЂ” logical WAN name)
    output=$(ndmc -c 'interface ISP ipv6 address auto' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    output=$(ndmc -c 'interface ISP ipv6 prefix auto' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    output=$(ndmc -c 'interface ISP ipv6 name-servers auto' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    # Enable global IPv6 settings
    output=$(ndmc -c 'ipv6 subnet Default' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    output=$(ndmc -c 'ipv6 local-prefix default' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    # Save configuration
    ndmc -c 'system configuration save' >/dev/null 2>&1
    
    if [ -n "$errors" ]; then
        echo "$errors"
        return 1
    fi
    return 0
}

# Disconnection IPv6
disable_ipv6() {
    local output=""
    local errors=""
    
    # Disable IPv6 on WAN interface (ISP вЂ” logical WAN name)
    output=$(ndmc -c 'interface ISP no ipv6 address auto' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    output=$(ndmc -c 'interface ISP no ipv6 prefix auto' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    output=$(ndmc -c 'interface ISP no ipv6 name-servers auto' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    # Disable global IPv6 settings
    output=$(ndmc -c 'no ipv6 subnet Default' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    output=$(ndmc -c 'no ipv6 local-prefix default' 2>&1)
    [ $? -ne 0 ] && errors="$errors$output\n"
    
    # Save configuration
    ndmc -c 'system configuration save' >/dev/null 2>&1
    
    if [ -n "$errors" ]; then
        echo "$errors"
        return 1
    fi
    return 0
}

# =============================================================================
# Functions for port-forwarding management
# =============================================================================

# Check port 8388 status
check_port_status() {
    local config=$(ndmc -c "show running-config" 2>/dev/null)
    
    # Search for port 8388 forwarding rule
    if echo "$config" | grep -q "ip static.*8388"; then
        echo "open"
    else
        echo "closed"
    fi
}

# Open port 8388
open_port_8388() {
    local output=""
    
    # Add forwarding rule
    # IMPORTANT: !8388 вЂ” exclamation mark is required in Keenetic syntax
    # Use single quotes so ! is not interpreted by shell
    output=$(ndmc -c 'ip static tcpudp ISP 8388 127.0.0.1 !8388' 2>&1)
    
    # Save configuration
    ndmc -c "system configuration save" >/dev/null 2>&1
    
    echo "$output"
    return 0
}

# Close port 8388
close_port_8388() {
    local output=""
    
    # Delete forwarding rule
    output=$(ndmc -c "no ip static tcpudp ISP 8388" 2>&1)
    
    # Save configuration
    ndmc -c "system configuration save" >/dev/null 2>&1
    
    echo "$output"
    return 0
}

# =============================================================================
# Request processing
# =============================================================================

case "$REQUEST_METHOD" in
    GET)
        # Get status
        case "$QUERY_STRING" in
            action=ipv6_status)
                status=$(check_ipv6_status)
                json_success "{\"ipv6\":\"$status\"}"
                ;;
            action=port_status)
                status=$(check_port_status)
                json_success "{\"port_8388\":\"$status\"}"
                ;;
            action=all_status)
                ipv6_status=$(check_ipv6_status)
                port_status=$(check_port_status)
                json_success "{\"ipv6\":\"$ipv6_status\",\"port_8388\":\"$port_status\"}"
                ;;
            *)
                json_error "Unknown action" 400
                ;;
        esac
        ;;
    POST)
        # Change settings
        read_post_data
        ACTION=$(get_param "action")
        
        case "$ACTION" in
            enable_ipv6)
                log_action "ENABLE_IPV6" ""
                output=$(enable_ipv6)
                if [ $? -eq 0 ]; then
                    json_success "{\"message\":\"IPv6 enabled\",\"status\":\"enabled\",\"log\":\"$(echo "$output" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
                else
                    json_success "{\"message\":\"IPv6 enabled (with warnings)\",\"status\":\"enabled\",\"log\":\"$(echo "$output" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
                fi
                ;;
            disable_ipv6)
                log_action "DISABLE_IPV6" ""
                output=$(disable_ipv6)
                if [ $? -eq 0 ]; then
                    json_success "{\"message\":\"IPv6 disabled\",\"status\":\"disabled\",\"log\":\"$(echo "$output" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
                else
                    json_success "{\"message\":\"IPv6 disabled (with warnings)\",\"status\":\"disabled\",\"log\":\"$(echo "$output" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
                fi
                ;;
            open_port)
                log_action "OPEN_PORT_8388" ""
                output=$(open_port_8388)
                status=$(check_port_status)
                json_success "{\"message\":\"Port 8388 opened\",\"status\":\"$status\",\"log\":\"$(echo "$output" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
                ;;
            close_port)
                log_action "CLOSE_PORT_8388" ""
                output=$(close_port_8388)
                status=$(check_port_status)
                json_success "{\"message\":\"Port 8388 closed\",\"status\":\"$status\",\"log\":\"$(echo "$output" | sed 's/"/\\"/g' | tr '\n' ' ')\"}"
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

exit 0
