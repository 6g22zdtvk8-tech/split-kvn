#!/bin/sh
# API for getting system status (sing-box)

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

# Authorization check
if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Get system information
get_system_info() {
    UPTIME=$(cat /proc/uptime | cut -d' ' -f1 | cut -d'.' -f1)
    LOAD=$(cat /proc/loadavg | cut -d' ' -f1-3)
    
    # Device ID
    DEVICE_ID_FILE="$VPN_MANAGER_HOME/device-id"
    if [ -f "$DEVICE_ID_FILE" ]; then
        DEVICE_ID=$(cat "$DEVICE_ID_FILE")
    else
        DEVICE_ID="unknown"
    fi
    
    # Memory
    MEM_TOTAL=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    MEM_FREE=$(grep MemFree /proc/meminfo | awk '{print $2}')
    MEM_AVAILABLE=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
    [ -z "$MEM_AVAILABLE" ] && MEM_AVAILABLE=$MEM_FREE
    
    # Disk (/opt)
    DISK_INFO=$(df /opt 2>/dev/null | tail -1)
    DISK_TOTAL=$(echo "$DISK_INFO" | awk '{print $2}')
    DISK_USED=$(echo "$DISK_INFO" | awk '{print $3}')
    DISK_FREE=$(echo "$DISK_INFO" | awk '{print $4}')
    [ -z "$DISK_TOTAL" ] && DISK_TOTAL=0
    [ -z "$DISK_USED" ] && DISK_USED=0
    [ -z "$DISK_FREE" ] && DISK_FREE=0
    
    echo "{\"uptime\":$UPTIME,\"load\":\"$LOAD\",\"device_id\":\"$DEVICE_ID\",\"memory\":{\"total\":$MEM_TOTAL,\"free\":$MEM_FREE,\"available\":$MEM_AVAILABLE},\"disk\":{\"total\":$DISK_TOTAL,\"used\":$DISK_USED,\"free\":$DISK_FREE}}"
}

# Get VPN status (sing-box)
get_vpn_status_full() {
    local singbox_status="stopped"
    local ss_status="stopped"
    local pid=0
    local uptime=0
    local server=""
    local port=0
    local method=""
    
    if check_singbox_running; then
        singbox_status="running"
        ss_status="running"
        pid=$(get_singbox_pid)
    fi
    
    # Get process uptime
    if [ -n "$pid" ] && [ "$pid" != "0" ] && [ -d "/proc/$pid" ]; then
        start_time=$(stat -c %Y /proc/$pid 2>/dev/null)
        if [ -n "$start_time" ]; then
            now=$(date +%s)
            uptime=$((now - start_time))
        fi
    fi
    
    # Data from sing-box config
    if [ -f "$SINGBOX_CONFIG" ]; then
        if command -v jq >/dev/null 2>&1; then
            server=$(jq -r '.outbounds[0].server // empty' "$SINGBOX_CONFIG" 2>/dev/null)
            port=$(jq -r '.outbounds[0].server_port // 0' "$SINGBOX_CONFIG" 2>/dev/null)
            method=$(jq -r '.outbounds[0].method // empty' "$SINGBOX_CONFIG" 2>/dev/null)
        fi
    fi
    [ -z "$port" ] && port=0
    
    active_config=$(get_active_config)
    
    # Number of IPs in ipset
    local ipset_count=0
    ipset_count=$(ipset list vpn_domains 2>/dev/null | grep -c '^[0-9]')
    [ -z "$ipset_count" ] && ipset_count=0
    
    echo "{\"mode\":\"singbox\",\"singbox_status\":\"$singbox_status\",\"ss_status\":\"$ss_status\",\"pid\":$pid,\"uptime\":$uptime,\"active_config\":\"$active_config\",\"server\":\"$server\",\"port\":$port,\"method\":\"$method\",\"ipset_count\":$ipset_count}"
}

# Get services status
get_services_status() {
    # dnsmasq
    if pgrep -x dnsmasq >/dev/null 2>&1; then
        dnsmasq_status="running"
        dnsmasq_pid=$(pgrep -x dnsmasq | head -1)
    else
        dnsmasq_status="stopped"
        dnsmasq_pid=0
    fi
    
    # dnscrypt-proxy
    if pgrep dnscrypt-proxy >/dev/null 2>&1; then
        dnscrypt_status="running"
    else
        dnscrypt_status="stopped"
    fi
    
    # sing-box
    if pgrep -f "sing-box run" >/dev/null 2>&1; then
        singbox_status="running"
        singbox_pid=$(pgrep -f "sing-box run" | head -1)
    else
        singbox_status="stopped"
        singbox_pid=0
    fi
    
    echo "{\"dnsmasq\":{\"status\":\"$dnsmasq_status\",\"pid\":$dnsmasq_pid},\"dnscrypt\":{\"status\":\"$dnscrypt_status\"},\"singbox\":{\"status\":\"$singbox_status\",\"pid\":$singbox_pid}}"
}

# Get domain and ipset statistics
get_domains_stats() {
    local domains_count=0
    local domains_udp_count=0
    local ipset_count=0
    local ipset6_count=0
    local ipset_udp_count=0
    
    # every domain in effect: cloud lists and own ones, as dnsmasq got them
    domains_count=$(vpn_domains_in_effect "$DNSMASQ_VPN_DOMAINS")
    domains_udp_count=$(vpn_domains_in_effect "$DNSMASQ_VPN_DOMAINS_UDP")
    
    # Number of IPs in ipset
    ipset_count=$(ipset list vpn_domains 2>/dev/null | grep -c '^[0-9]')
    [ -z "$ipset_count" ] && ipset_count=0
    ipset6_count=$(ipset list vpn_domains6 2>/dev/null | grep -c ':')
    [ -z "$ipset6_count" ] && ipset6_count=0
    ipset_udp_count=$(ipset list vpn_domains_udp 2>/dev/null | grep -c '^[0-9]')
    [ -z "$ipset_udp_count" ] && ipset_udp_count=0
    
    echo "{\"domains\":$domains_count,\"domains_udp\":$domains_udp_count,\"ipset_entries\":$ipset_count,\"ipset6_entries\":$ipset6_count,\"ipset_udp_entries\":$ipset_udp_count}"
}

# Domains of the VPN lists that dnsmasq really serves (cloud + own, no duplicates;
# the own vpn-domains.txt alone missed the cloud lists — "0 domains" on most routers)
vpn_domains_in_effect() {
    local n
    n=$(grep -c '^ipset=/' "$1" 2>/dev/null)
    echo "${n:-0}"
}

# Get device statistics
get_devices_stats() {
    local devices_count=0
    local devices_enabled=0
    
    if [ -f "$DEVICE_ROUTING" ]; then
        devices_count=$(grep -c '"ip"' "$DEVICE_ROUTING" 2>/dev/null)
        [ -z "$devices_count" ] && devices_count=0
        devices_enabled=$(grep -c '"enabled"[[:space:]]*:[[:space:]]*true' "$DEVICE_ROUTING" 2>/dev/null)
        [ -z "$devices_enabled" ] && devices_enabled=0
    fi
    
    echo "{\"total\":$devices_count,\"enabled\":$devices_enabled}"
}

# Get configuration count
get_configs_stats() {
    local configs_count=0
    
    if [ -d "$VPN_CONFIGS_DIR" ]; then
        for f in "$VPN_CONFIGS_DIR"/*.json; do
            [ -f "$f" ] && configs_count=$((configs_count + 1))
        done
    fi
    
    local active=$(get_active_config)
    
    echo "{\"total\":$configs_count,\"active\":\"$active\"}"
}

# Main response
case "$REQUEST_METHOD" in
    GET)
        ACTION=$(echo "$PATH_INFO" | sed 's/^\///' | cut -d'/' -f1)
        
        case "$ACTION" in
            ""|full)
                # Full status
                SYSTEM=$(get_system_info)
                VPN=$(get_vpn_status_full)
                SERVICES=$(get_services_status)
                DOMAINS=$(get_domains_stats)
                DEVICES=$(get_devices_stats)
                CONFIGS=$(get_configs_stats)
                
                # Read version from VERSION file
                if [ -f "/opt/etc/vpn-manager/VERSION" ]; then
                    VERSION=$(cat /opt/etc/vpn-manager/VERSION | head -1 | tr -d '\r\n')
                else
                    VERSION="2.10.0"
                fi
                
                # Get router IP
                ROUTER_IP=$(get_router_ip)
                
                json_success "{\"version\":\"$VERSION\",\"router_ip\":\"$ROUTER_IP\",\"system\":$SYSTEM,\"vpn\":$VPN,\"services\":$SERVICES,\"domains\":$DOMAINS,\"devices\":$DEVICES,\"configs\":$CONFIGS}"
                ;;
                
            system)
                json_success "$(get_system_info)"
                ;;
                
            vpn)
                json_success "$(get_vpn_status_full)"
                ;;
                
            services)
                json_success "$(get_services_status)"
                ;;
                
            domains)
                json_success "$(get_domains_stats)"
                ;;
                
            devices)
                json_success "$(get_devices_stats)"
                ;;
                
            configs)
                json_success "$(get_configs_stats)"
                ;;
                
            quick)
                # Quick status for dashboard
                ss_running="false"
                check_ss_running && ss_running="true"
                
                ipset_count=$(ipset list vpn_domains 2>/dev/null | grep -c '^[0-9]')
                [ -z "$ipset_count" ] && ipset_count=0
                domains_count=$(vpn_domains_in_effect "$DNSMASQ_VPN_DOMAINS")
                
                json_success "{\"mode\":\"singbox\",\"vpn_running\":$ss_running,\"ipset_entries\":$ipset_count,\"domains\":$domains_count}"
                ;;
                
            traffic)
                # Traffic statistics via sing-box Clash API
                SINGBOX_API="http://127.0.0.1:9090"
                
                # Totals since sing-box started and the open connections — one /connections
                # call. (/traffic streams its first line only after a second: read with a 1 s
                # limit it never came, the panel always showed 0 B)
                CONNECTIONS=$(curl -s --connect-timeout 2 --max-time 5 "${SINGBOX_API}/connections" 2>/dev/null)
                UP=0; DOWN=0; CONN_COUNT=0
                if [ -n "$CONNECTIONS" ]; then
                    set -- $(printf '%s' "$CONNECTIONS" | jq -r '"\(.uploadTotal // 0) \(.downloadTotal // 0) \((.connections // []) | length)"' 2>/dev/null)
                    [ $# -eq 3 ] && { UP=$1; DOWN=$2; CONN_COUNT=$3; }
                fi
                
                json_success "{\"upload\":$UP,\"download\":$DOWN,\"connections\":$CONN_COUNT,\"api_available\":true}"
                ;;
                
            *)
                json_error "Unknown status section" 404
                ;;
        esac
        ;;
        
    *)
        json_error "Method not supported" 405
        ;;
esac
