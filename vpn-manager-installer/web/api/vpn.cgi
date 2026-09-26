#!/bin/sh
# VPN configuration management API (sing-box)

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

# Authorization check
if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Create configs directory if not exists
mkdir -p "$VPN_CONFIGS_DIR" 2>/dev/null

# Determine action and ID from URL
PATH_PARTS=$(echo "$PATH_INFO" | sed 's/^\///')
ACTION=$(echo "$PATH_PARTS" | cut -d'/' -f1)
CONFIG_ID=$(echo "$PATH_PARTS" | cut -d'/' -f2)

case "$REQUEST_METHOD" in
    GET)
        case "$ACTION" in
            ""|list)
                # List all configurations
                CONFIGS=$(list_configs)
                ACTIVE=$(get_active_config)
                
                json_success "{\"configs\":$CONFIGS,\"active\":\"$ACTIVE\"}"
                ;;

            export-list)
                # Offer subscriptions as single items plus the configs added on
                # their own. A config that came from a subscription is already
                # covered by that subscription, so listing it again would only
                # invite the user to export the same thing twice.
                SUBS="[]"
                if [ -f "$VPN_MANAGER_HOME/subscriptions.json" ]; then
                    SUBS=$(jq -c '[(.subscriptions // [])[] | {id, name, server_count: (.server_count // 0)}]' \
                        "$VPN_MANAGER_HOME/subscriptions.json" 2>/dev/null)
                    [ -n "$SUBS" ] || SUBS="[]"
                fi

                ITEMS="["
                FIRST=1
                for f in "$VPN_CONFIGS_DIR"/*.json; do
                    [ -f "$f" ] || continue
                    [ -n "$(cfg_get "$f" subscription_id)" ] && continue
                    PROTO=$(cfg_get "$f" protocol)
                    case "$PROTO" in
                        wireguard|amneziawg) KIND="file" ;;
                        *) KIND="link" ;;
                    esac
                    CNAME=$(cfg_get "$f" name)
                    CID=$(basename "$f" .json)
                    [ -n "$CNAME" ] || CNAME="$CID"
                    ROW=$(jq -c -n --arg id "$CID" --arg name "$CNAME" \
                        --arg protocol "$PROTO" --arg kind "$KIND" \
                        '{id:$id,name:$name,protocol:$protocol,kind:$kind}' 2>/dev/null)
                    [ -n "$ROW" ] || continue
                    [ $FIRST -eq 0 ] && ITEMS="$ITEMS,"
                    ITEMS="$ITEMS$ROW"
                    FIRST=0
                done
                ITEMS="$ITEMS]"

                json_success "{\"subscriptions\":$SUBS,\"configs\":$ITEMS}"
                ;;

            export)
                # Build the payload for the picked items: links to copy as text,
                # and .conf bodies for protocols that have no URI form.
                SUB_IDS=$(echo "$QUERY_STRING" | sed -n 's/^.*subs=\([^&]*\).*$/\1/p' | sed 's/%2C/,/g')
                CFG_IDS=$(echo "$QUERY_STRING" | sed -n 's/^.*configs=\([^&]*\).*$/\1/p' | sed 's/%2C/,/g')

                LINKS="["
                LFIRST=1
                FILES="["
                FFIRST=1

                OLDIFS="$IFS"
                IFS=','

                for sid in $SUB_IDS; do
                    [ -n "$sid" ] || continue
                    [ -f "$VPN_MANAGER_HOME/subscriptions.json" ] || continue
                    ROW=$(jq -c --arg id "$sid" \
                        '(.subscriptions // [])[] | select(.id == $id)
                         | {kind:"subscription", name:(.name // $id), protocol:"subscription", link:(.url // "")}' \
                        "$VPN_MANAGER_HOME/subscriptions.json" 2>/dev/null | head -1)
                    [ -n "$ROW" ] || continue
                    [ $LFIRST -eq 0 ] && LINKS="$LINKS,"
                    LINKS="$LINKS$ROW"
                    LFIRST=0
                done

                for cid in $CFG_IDS; do
                    [ -n "$cid" ] || continue
                    F="$VPN_CONFIGS_DIR/$cid.json"
                    [ -f "$F" ] || continue
                    CNAME=$(cfg_get "$F" name)
                    [ -n "$CNAME" ] || CNAME="$cid"
                    PROTO=$(cfg_get "$F" protocol)

                    if LINK=$(config_to_link "$F") && [ -n "$LINK" ]; then
                        ROW=$(jq -c -n --arg name "$CNAME" --arg protocol "$PROTO" --arg link "$LINK" \
                            '{kind:"config", name:$name, protocol:$protocol, link:$link}' 2>/dev/null)
                        [ -n "$ROW" ] || continue
                        [ $LFIRST -eq 0 ] && LINKS="$LINKS,"
                        LINKS="$LINKS$ROW"
                        LFIRST=0
                    elif CONF=$(config_to_conf "$F") && [ -n "$CONF" ]; then
                        ROW=$(jq -c -n --arg name "$CNAME" --arg protocol "$PROTO" \
                            --arg filename "${cid}.conf" --arg content "$CONF" \
                            '{name:$name, protocol:$protocol, filename:$filename, content:$content}' 2>/dev/null)
                        [ -n "$ROW" ] || continue
                        [ $FFIRST -eq 0 ] && FILES="$FILES,"
                        FILES="$FILES$ROW"
                        FFIRST=0
                    fi
                done

                IFS="$OLDIFS"
                LINKS="$LINKS]"
                FILES="$FILES]"

                json_success "{\"links\":$LINKS,\"files\":$FILES}"
                ;;

            active)
                # Actions with active VPN via GET
                case "$CONFIG_ID" in
                    autostart-status)
                        # Autostart status
                        if [ -f "$AUTOSTART_FLAG" ]; then
                            json_success "{\"autostart\":true}"
                        else
                            json_success "{\"autostart\":false}"
                        fi
                        ;;
                    *)
                        json_error "Unknown action: $CONFIG_ID" 400
                        ;;
                esac
                ;;
            
            status)
                # Overall VPN status
                VPN_STATUS=$(get_vpn_status)
                
                if check_ss_running; then
                    SS_STATUS="running"
                    PID=$(get_ss_pid)
                    
                    # Get process uptime
                    UPTIME=0
                    if [ -n "$PID" ] && [ -d "/proc/$PID" ]; then
                        START_TIME=$(stat -c %Y /proc/$PID 2>/dev/null || echo "")
                        if [ -n "$START_TIME" ]; then
                            NOW=$(date +%s)
                            UPTIME=$((NOW - START_TIME))
                        fi
                    fi
                else
                    SS_STATUS="stopped"
                    PID=0
                    UPTIME=0
                fi
                
                ACTIVE=$(get_active_config)
                
                # Data from active config
                SERVER=""
                PORT=0
                METHOD=""
                if [ -n "$ACTIVE" ] && [ -f "$VPN_CONFIGS_DIR/$ACTIVE.json" ]; then
                    CONFIG_DATA=$(cat "$VPN_CONFIGS_DIR/$ACTIVE.json")
                    SERVER=$(json_get_value "$CONFIG_DATA" "server")
                    PORT=$(json_get_number "$CONFIG_DATA" "server_port")
                    METHOD=$(json_get_value "$CONFIG_DATA" "method")
                fi
                
                # IP count in ipset
                IPSET_COUNT=$(ipset list vpn_domains 2>/dev/null | grep -c '^[0-9]' || echo 0)
                
                json_success "{\"vpn_status\":\"$VPN_STATUS\",\"ss_status\":\"$SS_STATUS\",\"pid\":$PID,\"uptime\":$UPTIME,\"active_config\":\"$ACTIVE\",\"server\":\"$SERVER\",\"port\":$PORT,\"method\":\"$METHOD\",\"ipset_count\":$IPSET_COUNT}"
                ;;
                
            *)
                # Get specific configuration
                CONFIG_FILE="$VPN_CONFIGS_DIR/$ACTION.json"
                if [ -f "$CONFIG_FILE" ]; then
                    # Don't show password in response
                    CONFIG_DATA=$(cat "$CONFIG_FILE")
                    # Mask password
                    CONFIG_DATA=$(echo "$CONFIG_DATA" | sed 's/"password"[[:space:]]*:[[:space:]]*"[^"]*"/"password": "********"/')
                    json_response "$CONFIG_DATA"
                else
                    json_error "Configuration not found" 404
                fi
                ;;
        esac
        ;;
        
    POST)
        POST_DATA=$(read_post_data)
        
        # Import from URL
        if [ "$ACTION" = "import" ]; then
            IMPORT_URL=$(json_get_value "$POST_DATA" "url")
            
            if [ -z "$IMPORT_URL" ]; then
                json_error "URL is required" 400
                exit 0
            fi
            
            # Parse URL
            PARSED_DATA=$(parse_vpn_url "$IMPORT_URL")
            
            if [ -z "$PARSED_DATA" ] || [ "$PARSED_DATA" = "null" ]; then
                json_error "Failed to parse URL" 400
                exit 0
            fi
            
            json_success "$PARSED_DATA"
            exit 0
        fi
        
        if [ -z "$ACTION" ] || [ "$ACTION" = "create" ]; then
            # Create new configuration
            NAME=$(json_get_value "$POST_DATA" "name")
            PROTOCOL=$(json_get_value "$POST_DATA" "protocol")
            SERVER=$(json_get_value "$POST_DATA" "server")
            SERVER_PORT=$(json_get_number "$POST_DATA" "server_port")
            REMARKS=$(json_get_value "$POST_DATA" "remarks")
            
            # Validate required fields
            if [ -z "$NAME" ]; then
                json_error "Configuration name is required" 400
                exit 0
            fi
            if [ -z "$SERVER" ]; then
                json_error "Server address is required" 400
                exit 0
            fi
            if [ -z "$SERVER_PORT" ] || ! validate_port "$SERVER_PORT"; then
                json_error "Invalid server port" 400
                exit 0
            fi
            
            [ -z "$PROTOCOL" ] && PROTOCOL="shadowsocks"
            
            # Get IPv6 setting (disabled by default)
            IPV6_ENABLED=$(json_get_value "$POST_DATA" "ipv6_enabled")
            [ "$IPV6_ENABLED" = "true" ] && IPV6_ENABLED="true" || IPV6_ENABLED="false"
            
            # Generate ID
            CONFIG_ID=$(echo "$NAME" | tr ' ' '_' | tr -cd 'a-zA-Z0-9_-' | head -c 32)
            [ -z "$CONFIG_ID" ] && CONFIG_ID=$(date +%s)
            
            # Check ID uniqueness
            if [ -f "$VPN_CONFIGS_DIR/$CONFIG_ID.json" ]; then
                CONFIG_ID="${CONFIG_ID}_$(date +%s)"
            fi
            
            NOW=$(date '+%Y-%m-%dT%H:%M:%S')
            
            # Base fields for all protocols
            CONFIG_JSON="{
  \"id\": \"$CONFIG_ID\",
  \"name\": \"$NAME\",
  \"protocol\": \"$PROTOCOL\",
  \"server\": \"$SERVER\",
  \"server_port\": $SERVER_PORT,
  \"remarks\": \"$REMARKS\",
  \"ipv6_enabled\": $IPV6_ENABLED,
  \"created_at\": \"$NOW\",
  \"updated_at\": \"$NOW\""
            
            # Add fields depending on protocol
            case "$PROTOCOL" in
                shadowsocks)
                    PASSWORD=$(json_get_value "$POST_DATA" "password")
                    METHOD=$(json_get_value "$POST_DATA" "method")
                    UDP_OVER_TCP=$(json_get_bool "$POST_DATA" "udp_over_tcp")
                    [ -z "$METHOD" ] && METHOD="chacha20-ietf-poly1305"
                    [ -z "$PASSWORD" ] && { json_error "Password is required for Shadowsocks" 400; exit 0; }
                    CONFIG_JSON="$CONFIG_JSON,
  \"password\": \"$PASSWORD\",
  \"method\": \"$METHOD\""
                    # Add udp_over_tcp only if explicitly set to true
                    if [ "$UDP_OVER_TCP" = "true" ]; then
                        CONFIG_JSON="$CONFIG_JSON,
  \"udp_over_tcp\": true"
                    fi
                    ;;
                vless)
                    UUID=$(json_get_value "$POST_DATA" "uuid")
                    FLOW=$(json_get_value "$POST_DATA" "flow")
                    SECURITY=$(json_get_value "$POST_DATA" "security")
                    SNI=$(json_get_value "$POST_DATA" "sni")
                    FINGERPRINT=$(json_get_value "$POST_DATA" "fingerprint")
                    PUBLIC_KEY=$(json_get_value "$POST_DATA" "public_key")
                    SHORT_ID=$(json_get_value "$POST_DATA" "short_id")
                    TRANSPORT_TYPE=$(json_get_value "$POST_DATA" "transport_type")
                    TRANSPORT_PATH=$(json_get_value "$POST_DATA" "transport_path")
                    TRANSPORT_HOST=$(json_get_value "$POST_DATA" "transport_host")
                    TRANSPORT_MODE=$(json_get_value "$POST_DATA" "transport_mode")
                    ALPN=$(json_get_value "$POST_DATA" "alpn")
                    [ -z "$UUID" ] && { json_error "UUID is required for VLESS" 400; exit 0; }
                    CONFIG_JSON="$CONFIG_JSON,
  \"uuid\": \"$UUID\",
  \"flow\": \"$FLOW\",
  \"security\": \"$SECURITY\",
  \"sni\": \"$SNI\",
  \"fingerprint\": \"$FINGERPRINT\",
  \"public_key\": \"$PUBLIC_KEY\",
  \"short_id\": \"$SHORT_ID\",
  \"transport_type\": \"$TRANSPORT_TYPE\",
  \"transport_path\": \"$TRANSPORT_PATH\",
  \"transport_host\": \"$TRANSPORT_HOST\",
  \"transport_mode\": \"$TRANSPORT_MODE\",
  \"alpn\": \"$ALPN\""
                    ;;
                vmess)
                    UUID=$(json_get_value "$POST_DATA" "uuid")
                    ALTER_ID=$(json_get_number "$POST_DATA" "alter_id")
                    VMESS_SECURITY=$(json_get_value "$POST_DATA" "vmess_security")
                    SNI=$(json_get_value "$POST_DATA" "sni")
                    TRANSPORT_TYPE=$(json_get_value "$POST_DATA" "transport_type")
                    TRANSPORT_PATH=$(json_get_value "$POST_DATA" "transport_path")
                    TRANSPORT_HOST=$(json_get_value "$POST_DATA" "transport_host")
                    [ -z "$UUID" ] && { json_error "UUID is required for VMess" 400; exit 0; }
                    [ -z "$ALTER_ID" ] && ALTER_ID=0
                    [ -z "$VMESS_SECURITY" ] && VMESS_SECURITY="auto"
                    CONFIG_JSON="$CONFIG_JSON,
  \"uuid\": \"$UUID\",
  \"alter_id\": $ALTER_ID,
  \"vmess_security\": \"$VMESS_SECURITY\",
  \"sni\": \"$SNI\",
  \"transport_type\": \"$TRANSPORT_TYPE\",
  \"transport_path\": \"$TRANSPORT_PATH\",
  \"transport_host\": \"$TRANSPORT_HOST\""
                    ;;
                trojan)
                    PASSWORD=$(json_get_value "$POST_DATA" "password")
                    SNI=$(json_get_value "$POST_DATA" "sni")
                    TRANSPORT_TYPE=$(json_get_value "$POST_DATA" "transport_type")
                    TRANSPORT_PATH=$(json_get_value "$POST_DATA" "transport_path")
                    TRANSPORT_HOST=$(json_get_value "$POST_DATA" "transport_host")
                    [ -z "$PASSWORD" ] && { json_error "Password is required for Trojan" 400; exit 0; }
                    CONFIG_JSON="$CONFIG_JSON,
  \"password\": \"$PASSWORD\",
  \"sni\": \"$SNI\",
  \"transport_type\": \"$TRANSPORT_TYPE\",
  \"transport_path\": \"$TRANSPORT_PATH\",
  \"transport_host\": \"$TRANSPORT_HOST\""
                    ;;
                wireguard)
                    PRIVATE_KEY=$(json_get_value "$POST_DATA" "private_key")
                    PEER_PUBLIC_KEY=$(json_get_value "$POST_DATA" "peer_public_key")
                    PRE_SHARED_KEY=$(json_get_value "$POST_DATA" "pre_shared_key")
                    LOCAL_ADDRESS=$(json_get_value "$POST_DATA" "local_address")
                    MTU=$(json_get_number "$POST_DATA" "mtu")
                    RESERVED=$(json_get_value "$POST_DATA" "reserved")
                    [ -z "$PRIVATE_KEY" ] && { json_error "Private Key is required for WireGuard" 400; exit 0; }
                    [ -z "$PEER_PUBLIC_KEY" ] && { json_error "Peer Public Key is required for WireGuard" 400; exit 0; }
                    [ -z "$MTU" ] && MTU=1280
                    CONFIG_JSON="$CONFIG_JSON,
  \"private_key\": \"$PRIVATE_KEY\",
  \"peer_public_key\": \"$PEER_PUBLIC_KEY\",
  \"pre_shared_key\": \"$PRE_SHARED_KEY\",
  \"local_address\": \"$LOCAL_ADDRESS\",
  \"mtu\": $MTU,
  \"reserved\": \"$RESERVED\""
                    ;;
                amneziawg)
                    PRIVATE_KEY=$(json_get_value "$POST_DATA" "private_key")
                    PEER_PUBLIC_KEY=$(json_get_value "$POST_DATA" "peer_public_key")
                    PRE_SHARED_KEY=$(json_get_value "$POST_DATA" "preshared_key")
                    LOCAL_ADDRESS=$(json_get_value "$POST_DATA" "local_address")
                    MTU=$(json_get_number "$POST_DATA" "mtu")
                    # AmneziaWG obfuscation
                    AWG_JC=$(json_get_number "$POST_DATA" "jc")
                    AWG_JMIN=$(json_get_number "$POST_DATA" "jmin")
                    AWG_JMAX=$(json_get_number "$POST_DATA" "jmax")
                    AWG_S1=$(json_get_number "$POST_DATA" "s1")
                    AWG_S2=$(json_get_number "$POST_DATA" "s2")
                    AWG_H1=$(json_get_number "$POST_DATA" "h1")
                    AWG_H2=$(json_get_number "$POST_DATA" "h2")
                    AWG_H3=$(json_get_number "$POST_DATA" "h3")
                    AWG_H4=$(json_get_number "$POST_DATA" "h4")
                    [ -z "$PRIVATE_KEY" ] && { json_error "Private Key is required for AmneziaWG" 400; exit 0; }
                    [ -z "$PEER_PUBLIC_KEY" ] && { json_error "Peer Public Key is required for AmneziaWG" 400; exit 0; }
                    [ -z "$MTU" ] && MTU=1280
                    CONFIG_JSON="$CONFIG_JSON,
  \"private_key\": \"$PRIVATE_KEY\",
  \"peer_public_key\": \"$PEER_PUBLIC_KEY\",
  \"preshared_key\": \"$PRE_SHARED_KEY\",
  \"local_address\": \"$LOCAL_ADDRESS\",
  \"mtu\": $MTU"
                    # Add AmneziaWG parameters if set
                    [ -n "$AWG_JC" ] && CONFIG_JSON="$CONFIG_JSON,
  \"jc\": $AWG_JC"
                    [ -n "$AWG_JMIN" ] && CONFIG_JSON="$CONFIG_JSON,
  \"jmin\": $AWG_JMIN"
                    [ -n "$AWG_JMAX" ] && CONFIG_JSON="$CONFIG_JSON,
  \"jmax\": $AWG_JMAX"
                    [ -n "$AWG_S1" ] && CONFIG_JSON="$CONFIG_JSON,
  \"s1\": $AWG_S1"
                    [ -n "$AWG_S2" ] && CONFIG_JSON="$CONFIG_JSON,
  \"s2\": $AWG_S2"
                    [ -n "$AWG_H1" ] && CONFIG_JSON="$CONFIG_JSON,
  \"h1\": $AWG_H1"
                    [ -n "$AWG_H2" ] && CONFIG_JSON="$CONFIG_JSON,
  \"h2\": $AWG_H2"
                    [ -n "$AWG_H3" ] && CONFIG_JSON="$CONFIG_JSON,
  \"h3\": $AWG_H3"
                    [ -n "$AWG_H4" ] && CONFIG_JSON="$CONFIG_JSON,
  \"h4\": $AWG_H4"
                    ;;
                hysteria2)
                    PASSWORD=$(json_get_value "$POST_DATA" "password")
                    SNI=$(json_get_value "$POST_DATA" "sni")
                    UP_MBPS=$(json_get_number "$POST_DATA" "up_mbps")
                    DOWN_MBPS=$(json_get_number "$POST_DATA" "down_mbps")
                    [ -z "$PASSWORD" ] && { json_error "Password is required for Hysteria2" 400; exit 0; }
                    CONFIG_JSON="$CONFIG_JSON,
  \"password\": \"$PASSWORD\",
  \"sni\": \"$SNI\",
  \"up_mbps\": ${UP_MBPS:-100},
  \"down_mbps\": ${DOWN_MBPS:-100}"
                    ;;
            esac
            
            CONFIG_JSON="$CONFIG_JSON
}"
            
            # Save configuration
            echo "$CONFIG_JSON" > "$VPN_CONFIGS_DIR/$CONFIG_ID.json"
            
            log_action "CONFIG_CREATED" "ID: $CONFIG_ID, Name: $NAME, Protocol: $PROTOCOL, Server: $SERVER"
            json_success "{\"id\":\"$CONFIG_ID\",\"message\":\"Configuration created\"}"
            
        elif [ "$ACTION" = "active" ]; then
            # Actions with active VPN (without specifying specific config)
            case "$CONFIG_ID" in
                stop)
                    # Stop VPN
                    "$SINGBOX_INIT" stop >/dev/null 2>&1
                    # Remove iptables rules
                    "$SINGBOX_RULES_INIT" stop >/dev/null 2>&1
                    log_action "VPN_STOPPED" "Manual stop"
                    json_success "{\"message\":\"VPN stopped\",\"status\":\"stopped\"}"
                    ;;
                start)
                    # Check if already running
                    if check_singbox_running; then
                        json_success "{\"message\":\"VPN already running\",\"status\":\"running\"}"
                        exit 0
                    fi
                    
                    # Remove stop flag (for wrapper with auto-restart)
                    rm -f /opt/var/run/sing-box.stopped
                    
                    # Start VPN with current config (BOOT_START=0 - manual start)
                    "$SINGBOX_INIT" start 0 >/dev/null 2>&1
                    
                    # Apply iptables rules (no warmup for fast start)
                    "$SINGBOX_RULES_INIT" restart-rules >/dev/null 2>&1
                    
                    # Wait for sing-box to start
                    WAIT_COUNT=0
                    while [ $WAIT_COUNT -lt 5 ]; do
                        sleep 1
                        if check_singbox_running; then
                            log_action "VPN_STARTED" ""
                            json_success "{\"message\":\"VPN started\",\"status\":\"running\"}"
                            exit 0
                        fi
                        WAIT_COUNT=$((WAIT_COUNT + 1))
                    done
                    
                    # If not started in 5 sec - check wrapper
                    if [ -f /opt/var/run/sing-box-wrapper.pid ]; then
                        log_action "VPN_STARTING" "Wrapper active, waiting..."
                        json_success "{\"message\":\"VPN starting...\",\"status\":\"starting\"}"
                    else
                        json_error "VPN failed to start" 500
                    fi
                    ;;
                restart)
                    # Remove stop flag (for wrapper with auto-restart)
                    rm -f /opt/var/run/sing-box.stopped
                    singbox_restart
                    
                    # Wait for sing-box to start
                    WAIT_COUNT=0
                    while [ $WAIT_COUNT -lt 10 ]; do
                        sleep 1
                        if check_singbox_running; then
                            log_action "VPN_RESTARTED" ""
                            json_success "{\"message\":\"VPN restarted\",\"status\":\"running\"}"
                            exit 0
                        fi
                        WAIT_COUNT=$((WAIT_COUNT + 1))
                    done
                    json_error "VPN failed to start (timeout)" 500
                    ;;
                check-ip)
                    # Check external IP via VPN
                    CURRENT_IP=""
                    VPN_WORKING="false"

                    # Try several services
                    for service in "icanhazip.com" "ifconfig.me" "api.ipify.org"; do
                        CURRENT_IP=$(curl -s --connect-timeout 5 --max-time 10 "https://$service" 2>/dev/null)
                        [ -n "$CURRENT_IP" ] && break
                    done

                    if [ -n "$CURRENT_IP" ]; then
                        ACTIVE_CONFIG_ID=$(get_active_config)
                        VPN_SERVER_IP=""
                        if [ -n "$ACTIVE_CONFIG_ID" ] && [ -f "$VPN_CONFIGS_DIR/$ACTIVE_CONFIG_ID.json" ]; then
                            VPN_SERVER_IP=$(json_get_value "$(cat "$VPN_CONFIGS_DIR/$ACTIVE_CONFIG_ID.json")" "server")
                        fi

                        if check_singbox_running; then
                            VPN_WORKING="true"
                        fi

                        json_success "{\"current_ip\":\"$CURRENT_IP\",\"vpn_working\":$VPN_WORKING,\"vpn_server\":\"$VPN_SERVER_IP\"}"
                    else
                        json_error "Failed to determine IP" 500
                    fi
                    ;;
                autostart-enable)
                    # Enable autostart
                    touch "$AUTOSTART_FLAG"
                    log_action "AUTOSTART_ENABLED" ""
                    json_success "{\"autostart\":true,\"message\":\"Autostart enabled\"}"
                    ;;
                autostart-disable)
                    # Disable autostart
                    rm -f "$AUTOSTART_FLAG"
                    log_action "AUTOSTART_DISABLED" ""
                    json_success "{\"autostart\":false,\"message\":\"Autostart disabled\"}"
                    ;;
                autostart-status)
                    # Autostart status
                    if [ -f "$AUTOSTART_FLAG" ]; then
                        json_success "{\"autostart\":true}"
                    else
                        json_success "{\"autostart\":false}"
                    fi
                    ;;
                *)
                    json_error "Unknown action: $CONFIG_ID" 400
                    ;;
            esac
        else
            # Actions with specific configuration
            CONFIG_FILE="$VPN_CONFIGS_DIR/$ACTION.json"
            
            case "$CONFIG_ID" in
                activate)
                    # Activate configuration
                    if [ ! -f "$CONFIG_FILE" ]; then
                        json_error "Configuration not found" 404
                        exit 0
                    fi
                    
                    # Play means one server: leave multi mode (the ticks stay for next time)
                    if multi_is_on; then
                        multi_save "$(multi_state | jq -c '.mode = "single"')"
                        log_action "MULTI" "Mode: one connection (Play on $ACTION)"
                    fi

                    # Apply config in sing-box
                    if apply_shadowsocks_config "$CONFIG_FILE"; then
                        # Save as active
                        set_active_config "$ACTION"
                        
                        # Apply IPv6 setting from configuration
                        # IMPORTANT: ndmc doesn't work from CGI context, so create flag file
                        # which will be processed by cron task or on reboot
                        CONFIG_DATA=$(cat "$CONFIG_FILE")
                        IPV6_ENABLED=$(json_get_value "$CONFIG_DATA" "ipv6_enabled")
                        if [ "$IPV6_ENABLED" = "true" ]; then
                            echo "enabled" > /tmp/ipv6-pending
                        else
                            echo "disabled" > /tmp/ipv6-pending
                        fi
                        
                        # Restart VPN
                        singbox_restart
                        sleep 1
                        
                        # Quickly apply iptables rules (no warmup)
                        SKIP_WARMUP=1 "$SINGBOX_RULES_INIT" start 0 >/dev/null 2>&1
                        
                        # Check status
                        if check_ss_running; then
                            # Start lists update (if first run) and warmup in background
                            # Use dig with port 5353 (dnsmasq), as nslookup doesn't support port
                            ( dig @127.0.0.1 -p 5353 youtube.com +short +time=2 >/dev/null 2>&1; \
                              dig @127.0.0.1 -p 5353 google.com +short +time=2 >/dev/null 2>&1; \
                              # Auto-update lists on first activation (if remote-lists is empty)
                              REMOTE_LISTS_DIR="$VPN_MANAGER_HOME/remote-lists"; \
                              if [ ! -d "$REMOTE_LISTS_DIR" ] || [ -z "$(ls -A "$REMOTE_LISTS_DIR" 2>/dev/null)" ]; then \
                                  sleep 2; \
                                  /opt/etc/vpn-manager/scripts/lists-update.sh force >/dev/null 2>&1; \
                              fi; \
                              # Warmup after lists are updated (full set of domains)
                              "$SINGBOX_RULES_INIT" warmup >/dev/null 2>&1 ) &
                            
                            log_action "CONFIG_ACTIVATED" "ID: $ACTION, IPv6: $IPV6_ENABLED"
                            json_success "{\"message\":\"Configuration activated\",\"status\":\"running\"}"
                        else
                            json_error "Configuration applied but VPN failed to start" 500
                        fi
                    else
                        json_error "Failed to apply configuration" 500
                    fi
                    ;;
                    
                restart)
                    # Restart VPN with current configuration
                    singbox_restart
                    sleep 1
                    # Apply iptables rules
                    "$SINGBOX_RULES_INIT" restart >/dev/null 2>&1
                    sleep 1
                    
                    if check_ss_running; then
                        log_action "VPN_RESTARTED" "Config: $ACTION"
                        json_success "{\"message\":\"VPN restarted\",\"status\":\"running\"}"
                    else
                        json_error "VPN failed to start after restart" 500
                    fi
                    ;;
                    
                stop)
                    # Stop VPN
                    "$SINGBOX_INIT" stop >/dev/null 2>&1
                    # Remove iptables rules
                    "$SINGBOX_RULES_INIT" stop >/dev/null 2>&1
                    log_action "VPN_STOPPED" ""
                    json_success "{\"message\":\"VPN stopped\"}"
                    ;;
                    
                start)
                    # Start VPN
                    "$SINGBOX_INIT" start 0 >/dev/null 2>&1
                    sleep 1
                    # Apply iptables rules
                    "$SINGBOX_RULES_INIT" start 0 >/dev/null 2>&1
                    sleep 1
                    
                    if check_ss_running; then
                        log_action "VPN_STARTED" ""
                        json_success "{\"message\":\"VPN started\",\"status\":\"running\"}"
                    else
                        json_error "VPN failed to start" 500
                    fi
                    ;;
                    
                test)
                    # Test configuration (ping server)
                    if [ ! -f "$CONFIG_FILE" ]; then
                        json_error "Configuration not found" 404
                        exit 0
                    fi
                    
                    CONFIG_DATA=$(cat "$CONFIG_FILE")
                    SERVER=$(json_get_value "$CONFIG_DATA" "server")
                    
                    if check_server_ping "$SERVER" 5; then
                        json_success "{\"reachable\":true,\"server\":\"$SERVER\"}"
                    else
                        json_success "{\"reachable\":false,\"server\":\"$SERVER\"}"
                    fi
                    ;;
                    
                check-ip)
                    # Check external IP via VPN
                    # Get IP through check service
                    CURRENT_IP=""
                    VPN_WORKING="false"
                    
                    # Try several services
                    for service in "icanhazip.com" "ifconfig.me" "api.ipify.org"; do
                        CURRENT_IP=$(curl -s --connect-timeout 5 --max-time 10 "https://$service" 2>/dev/null)
                        [ -n "$CURRENT_IP" ] && break
                    done
                    
                    if [ -n "$CURRENT_IP" ]; then
                        # Check if IP differs from ISP IP
                        # Get VPN server IP for comparison
                        ACTIVE_CONFIG=$(get_active_config)
                        VPN_SERVER_IP=""
                        if [ -n "$ACTIVE_CONFIG" ] && [ -f "$VPN_CONFIGS_DIR/$ACTIVE_CONFIG.json" ]; then
                            VPN_SERVER_IP=$(json_get_value "$(cat "$VPN_CONFIGS_DIR/$ACTIVE_CONFIG.json")" "server")
                        fi
                        
                        # If IP looks like VPN server IP or sing-box is running
                        if check_ss_running; then
                            VPN_WORKING="true"
                        fi
                        
                        json_success "{\"current_ip\":\"$CURRENT_IP\",\"vpn_working\":$VPN_WORKING,\"vpn_server\":\"$VPN_SERVER_IP\"}"
                    else
                        json_error "Failed to determine IP" 500
                    fi
                    ;;
                    
                *)
                    json_error "Unknown action: $CONFIG_ID" 400
                    ;;
            esac
        fi
        ;;
        
    PUT)
        # Update configuration
        if [ -z "$ACTION" ]; then
            json_error "Configuration ID not specified" 400
            exit 0
        fi
        
        CONFIG_FILE="$VPN_CONFIGS_DIR/$ACTION.json"
        if [ ! -f "$CONFIG_FILE" ]; then
            json_error "Configuration not found" 404
            exit 0
        fi
        
        POST_DATA=$(read_post_data)
        NOW=$(date '+%Y-%m-%dT%H:%M:%S')
        
        # Use jq for correct JSON update
        TMP_FILE="/tmp/vpn_config_update_$$"
        TMP_POST="/tmp/vpn_post_data_$$"
        
        # Check that POST_DATA is valid JSON
        if ! echo "$POST_DATA" | jq -e . >/dev/null 2>&1; then
            json_error "Invalid data" 400
            exit 0
        fi
        
        # Save POST_DATA to temp file (for ash compatibility)
        echo "$POST_DATA" > "$TMP_POST"
        
        # Merge current config with new data
        jq -s '.[0] * .[1] | .updated_at = "'"$NOW"'" | if .udp_over_tcp == false then del(.udp_over_tcp) else . end' "$CONFIG_FILE" "$TMP_POST" > "$TMP_FILE" 2>/dev/null
        rm -f "$TMP_POST"
        
        if [ -s "$TMP_FILE" ] && jq -e . "$TMP_FILE" >/dev/null 2>&1; then
            mv "$TMP_FILE" "$CONFIG_FILE"
        else
            rm -f "$TMP_FILE"
            json_error "Configuration update error" 500
            exit 0
        fi
        
        # If this is active config - reapply
        ACTIVE=$(get_active_config)
        REAPPLIED="false"
        if [ "$ACTIVE" = "$ACTION" ]; then
            # Tag must be "vpn" to match route.final and DNS rules
            if apply_singbox_outbound "$CONFIG_FILE" "vpn"; then
                singbox_restart
                REAPPLIED="true"
                
                # Apply IPv6 setting if changed
                # IMPORTANT: ndmc doesn't work from CGI context, create flag file
                CONFIG_DATA=$(cat "$CONFIG_FILE")
                IPV6_ENABLED=$(json_get_value "$CONFIG_DATA" "ipv6_enabled")
                if [ "$IPV6_ENABLED" = "true" ]; then
                    echo "enabled" > /tmp/ipv6-pending
                else
                    echo "disabled" > /tmp/ipv6-pending
                fi
            fi
        fi
        
        log_action "CONFIG_UPDATED" "ID: $ACTION"
        json_success "{\"message\":\"Configuration updated\",\"reapplied\":$REAPPLIED}"
        ;;
        
    DELETE)
        # Delete configuration
        if [ -z "$ACTION" ]; then
            json_error "Configuration ID not specified" 400
            exit 0
        fi
        
        CONFIG_FILE="$VPN_CONFIGS_DIR/$ACTION.json"
        if [ ! -f "$CONFIG_FILE" ]; then
            json_error "Configuration not found" 404
            exit 0
        fi
        
        # Check if configuration is active AND VPN is running
        ACTIVE=$(get_active_config)
        if [ "$ACTIVE" = "$ACTION" ]; then
            # If VPN is running - cannot delete active configuration
            if check_singbox_running; then
                json_error "Cannot delete active configuration while VPN is running. Stop VPN first." 400
                exit 0
            fi
            # VPN stopped - clear active configuration
            rm -f "$VPN_ACTIVE_FILE"
        fi
        
        rm -f "$CONFIG_FILE"
        log_action "CONFIG_DELETED" "ID: $ACTION"
        multi_resync >/dev/null 2>&1
        json_success "{\"message\":\"Configuration deleted\"}"
        ;;
        
    *)
        json_error "Method not supported" 405
        ;;
esac
