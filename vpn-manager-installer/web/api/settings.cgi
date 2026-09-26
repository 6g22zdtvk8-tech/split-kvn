#!/bin/sh
# =============================================================================
# VPN Manager Settings API
# Settings management: web interface port, etc.
# =============================================================================

# Include common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Paths
SETTINGS_FILE="/opt/etc/vpn-manager/settings.json"
LIGHTTPD_PORT_CONF="/opt/etc/lighttpd/conf.d/00-vpn-manager-base.conf"
LIGHTTPD_INIT="/opt/etc/init.d/S80lighttpd"

# Default values
DEFAULT_WEB_PORT=8001
DEFAULT_LISTS_SOURCE="https://raw.githubusercontent.com/6g22zdtvk8-tech/split-kvn-lists/main"
DEFAULT_DNSMASQ_PORT=5353

# Reserved ports (cannot be used for web interface)
RESERVED_PORTS="22 53 80 222 443 5353 8080 8388"

# =============================================================================
# Functions
# =============================================================================

# Initialize settings file
init_settings() {
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo "{\"web_port\":$DEFAULT_WEB_PORT}" > "$SETTINGS_FILE"
        chmod 644 "$SETTINGS_FILE"
    fi
}

# Get current settings
get_settings() {
    init_settings
    
    local settings=$(cat "$SETTINGS_FILE" 2>/dev/null)
    
    # Get actual port from lighttpd config
    local current_port=$DEFAULT_WEB_PORT
    if [ -f "$LIGHTTPD_PORT_CONF" ]; then
        current_port=$(grep -oE 'server.port\s*=\s*[0-9]+' "$LIGHTTPD_PORT_CONF" 2>/dev/null | grep -oE '[0-9]+' || echo "$DEFAULT_WEB_PORT")
    fi
    
    # Get lists source URL (FEAT-200)
    local lists_source=$(jq -r '.lists_source_url // empty' "$SETTINGS_FILE" 2>/dev/null)
    [ -z "$lists_source" ] && lists_source="$DEFAULT_LISTS_SOURCE"
    
    # Get dnsmasq port (FEAT-202)
    local dnsmasq_port=$(jq -r '.dnsmasq_port // empty' "$SETTINGS_FILE" 2>/dev/null)
    [ -z "$dnsmasq_port" ] && dnsmasq_port="$DEFAULT_DNSMASQ_PORT"
    
    # Get USDT wallet (project-level config)
    local usdt_wallet=$(jq -r '.usdt_wallet // empty' "$SETTINGS_FILE" 2>/dev/null)
    local usdt_field=""
    [ -n "$usdt_wallet" ] && usdt_field=",\"usdt_wallet\":\"$usdt_wallet\""
    
    # Return settings with actual port (without quotes for boolean)
    json_success "{\"web_port\":$current_port,\"default_port\":$DEFAULT_WEB_PORT,\"reserved_ports\":\"$RESERVED_PORTS\",\"lists_source_url\":\"$lists_source\",\"default_lists_source\":\"$DEFAULT_LISTS_SOURCE\",\"dnsmasq_port\":$dnsmasq_port,\"default_dnsmasq_port\":$DEFAULT_DNSMASQ_PORT,\"verbose_log_until\":$(verbose_log_until),\"list_binding\":{\"split\":\"$(list_binding split)\",\"vpnprimary\":\"$(list_binding vpnprimary)\"},\"vpn_lan_access\":\"$(vpn_lan_access_setting)\",\"vpn_lan_access_active\":\"$(vpn_lan_access)\",\"vpn_panel_name\":\"$VPN_PANEL_NAME\",\"vpn_panel_ip\":\"$VPN_PANEL_IP\",\"panel_password_set\":$(panel_password_set && echo true || echo false)$usdt_field}"
}

# Which list set each split mode uses (B1): Direct primary sends its set via VPN,
# VPN primary sends its set direct. The two must differ. Applied at once: marking
# rules are rebuilt without a gap, VPN-server rules need a sing-box restart.
set_list_binding() {
    local split="$1" vpnp="$2"
    case "$split" in world|russia) ;; *) json_error "Invalid set for Direct primary: $split" 400; return ;; esac
    case "$vpnp" in world|russia) ;; *) json_error "Invalid set for VPN primary: $vpnp" 400; return ;; esac
    if [ "$split" = "$vpnp" ]; then
        json_error "errors.listBindingSame" 400
        return
    fi

    init_settings
    local tmp="$SETTINGS_FILE.tmp.$$"
    if jq --arg s "$split" --arg v "$vpnp" '.list_binding = {split: $s, vpnprimary: $v}' "$SETTINGS_FILE" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
        # cat, not mv: keeps the file's owner and mode (settings.json is private)
        cat "$tmp" > "$SETTINGS_FILE"
        rm -f "$tmp"
    else
        rm -f "$tmp"
        json_error "errors.settingsSave" 500
        return
    fi

    "$SINGBOX_RULES_INIT" restart-rules >/dev/null 2>&1
    if update_vpnclient_rules && check_singbox_running; then
        singbox_restart
    fi

    log_action "LIST_BINDING" "Direct primary: $split, VPN primary: $vpnp"
    json_success "{\"list_binding\":{\"split\":\"$split\",\"vpnprimary\":\"$vpnp\"}}"
}

# Access of VPN-server clients to the panel and the home network (B8): off / panel / lan.
# Needs the panel password: over the VPN the panel would otherwise be open to anyone
# holding a VPN-server account. Applied by rebuilding the VPN-server rules and
# restarting sing-box.
set_vpn_lan_access() {
    local mode="$1"
    case "$mode" in
        off|panel|lan) ;;
        *) json_error "Invalid mode" 400; return ;;
    esac
    if [ "$mode" != off ] && ! panel_password_set; then
        json_error "errors.vpnLanAccessNeedsPassword" 409
        return
    fi

    init_settings
    local prev_settings="/tmp/vpn-lan-settings.prev.$$" prev_config="/tmp/vpn-lan-singbox.prev.$$"
    cp "$SETTINGS_FILE" "$prev_settings" 2>/dev/null
    cp "$SINGBOX_CONFIG" "$prev_config" 2>/dev/null

    # A choice made with a password drops the "no password, risk accepted" mark
    local tmp="$SETTINGS_FILE.tmp.$$"
    if jq --arg m "$mode" '.vpn_lan_access = $m | del(.vpn_lan_access_no_password)' "$SETTINGS_FILE" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
        # cat, not mv: keeps the file's owner and mode (settings.json is private)
        cat "$tmp" > "$SETTINGS_FILE"
        rm -f "$tmp"
    else
        rm -f "$tmp" "$prev_settings" "$prev_config"
        json_error "errors.settingsSave" 500
        return
    fi

    # Rebuild, and let sing-box check the result before it is started with it.
    # On any failure both files go back and sing-box keeps running as it was.
    if ! update_vpnclient_rules || ! singbox_config_ok; then
        [ -s "$prev_settings" ] && cat "$prev_settings" > "$SETTINGS_FILE"
        [ -s "$prev_config" ] && cat "$prev_config" > "$SINGBOX_CONFIG"
        rm -f "$prev_settings" "$prev_config"
        log_action "VPN_LAN_ACCESS" "Rebuild for '$mode' failed, previous settings restored"
        json_error "errors.vpnLanAccessFailed" 500
        return
    fi
    rm -f "$prev_settings" "$prev_config"
    check_singbox_running && singbox_restart

    log_action "VPN_LAN_ACCESS" "VPN-server clients: $mode"
    json_success "{\"vpn_lan_access\":\"$mode\"}"
}

# Verbose sing-box logging for troubleshooting: every connection gets logged for an
# hour, then syslog-rotate.sh (cron, every 10 minutes) switches back to warn.
# Changing the level restarts sing-box.
set_verbose_log() {
    if [ "$1" = "true" ]; then
        echo $(( $(date +%s) + 3600 )) > "$SINGBOX_VERBOSE_FLAG"
        if ! singbox_set_log_level info; then
            rm -f "$SINGBOX_VERBOSE_FLAG"
            json_error "Failed to change sing-box log level" 500
            return
        fi
    else
        rm -f "$SINGBOX_VERBOSE_FLAG"
        singbox_set_log_level warn
    fi
    log_action "VERBOSE_LOG" "Verbose sing-box log: $1"
    json_success "{\"verbose_log_until\":$(verbose_log_until)}"
}


# Validate port
validate_port() {
    local port="$1"
    
    # Check that it's a number
    if ! echo "$port" | grep -qE '^[0-9]+$'; then
        echo "Port must be a number"
        return 1
    fi
    
    # Check range
    if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then
        echo "Port must be in range 1024-65535"
        return 1
    fi
    
    # Check reserved ports
    for reserved in $RESERVED_PORTS; do
        if [ "$port" = "$reserved" ]; then
            echo "Port $port is reserved by system"
            return 1
        fi
    done
    
    return 0
}

# Change web interface port
change_web_port() {
    local new_port="$1"
    
    # Validation
    local error=$(validate_port "$new_port")
    if [ $? -ne 0 ]; then
        json_error "$error" 400
        return
    fi
    
    # Get current port
    local current_port=$DEFAULT_WEB_PORT
    if [ -f "$LIGHTTPD_PORT_CONF" ]; then
        current_port=$(grep -oE 'server.port\s*=\s*[0-9]+' "$LIGHTTPD_PORT_CONF" 2>/dev/null | grep -oE '[0-9]+' || echo "$DEFAULT_WEB_PORT")
    fi
    
    # If port hasn't changed
    if [ "$new_port" = "$current_port" ]; then
        json_success "{\"message\":\"Port unchanged\",\"port\":$new_port}"
        return
    fi
    
    # Update lighttpd config
    if [ -f "$LIGHTTPD_PORT_CONF" ]; then
        sed -i "s/server.port\s*=\s*[0-9]*/server.port = $new_port/" "$LIGHTTPD_PORT_CONF"
    else
        # Create config if not exists
        mkdir -p "$(dirname "$LIGHTTPD_PORT_CONF")"
        cat > "$LIGHTTPD_PORT_CONF" << EOF
# VPN Manager: port $new_port
server.port = $new_port
EOF
    fi
    
    # Save to settings.json
    init_settings
    local tmp_settings=$(mktemp)
    jq ".web_port = $new_port" "$SETTINGS_FILE" > "$tmp_settings" 2>/dev/null
    if [ -s "$tmp_settings" ]; then
        mv "$tmp_settings" "$SETTINGS_FILE"
    else
        rm -f "$tmp_settings"
        echo "{\"web_port\":$new_port}" > "$SETTINGS_FILE"
    fi
    
    log_action "WEB_PORT_CHANGED" "Port changed from $current_port to $new_port"
    
    # Restart lighttpd in background (with delay so response can be sent).
    # B8 first: the "panel only" rule for VPN-server clients names the panel port; it
    # is rebuilt here, before lighttpd goes down, so the restart cannot cut it short.
    (
        vpn_lan_rebuild >/dev/null 2>&1
        sleep 2
        if [ -x "$LIGHTTPD_INIT" ]; then
            "$LIGHTTPD_INIT" restart >/dev/null 2>&1
        fi
    ) &

    # Get router IP for new URL
    local router_ip=$(ip addr show br0 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1 | awk '{print $2}')
    [ -z "$router_ip" ] && router_ip="192.168.1.1"
    
    json_success "{\"message\":\"Port changed to $new_port\",\"port\":$new_port,\"old_port\":$current_port,\"new_url\":\"http://$router_ip:$new_port\"}"
}

# Set remote lists source URL (FEAT-200)
set_lists_source() {
    local new_url="$1"
    
    # Basic validation
    if [ -z "$new_url" ]; then
        json_error "URL cannot be empty" 400
        return
    fi
    
    # Check that URL starts with http:// or https://
    if ! echo "$new_url" | grep -qE '^https?://'; then
        json_error "URL must start with http:// or https://" 400
        return
    fi
    
    # Remove trailing slash
    new_url=$(echo "$new_url" | sed 's:/*$::')
    
    init_settings
    local tmp_settings=$(mktemp)
    jq --arg url "$new_url" '.lists_source_url = $url' "$SETTINGS_FILE" > "$tmp_settings" 2>/dev/null
    if [ -s "$tmp_settings" ] && jq empty "$tmp_settings" 2>/dev/null; then
        mv "$tmp_settings" "$SETTINGS_FILE"
        log_action "LISTS_SOURCE_CHANGED" "Lists source URL changed to: $new_url"
        json_success "{\"lists_source_url\":\"$new_url\"}"
    else
        rm -f "$tmp_settings"
        json_error "Failed to save settings" 500
    fi
}

# Reset lists source URL to default (FEAT-200)
reset_lists_source() {
    init_settings
    local tmp_settings=$(mktemp)
    jq --arg url "$DEFAULT_LISTS_SOURCE" '.lists_source_url = $url' "$SETTINGS_FILE" > "$tmp_settings" 2>/dev/null
    if [ -s "$tmp_settings" ] && jq empty "$tmp_settings" 2>/dev/null; then
        mv "$tmp_settings" "$SETTINGS_FILE"
        log_action "LISTS_SOURCE_RESET" "Lists source URL reset to default: $DEFAULT_LISTS_SOURCE"
        json_success "{\"lists_source_url\":\"$DEFAULT_LISTS_SOURCE\"}"
    else
        rm -f "$tmp_settings"
        json_error "Failed to reset settings" 500
    fi
}

# =============================================================================
# dnsmasq Port Management (FEAT-202) — DANGER ZONE
# =============================================================================

change_dnsmasq_port() {
    local new_port="$1"
    
    # CRITICAL validation
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
    
    # Get current port from settings
    init_settings
    local old_port=$(jq -r '.dnsmasq_port // 5353' "$SETTINGS_FILE" 2>/dev/null)
    
    # If port hasn't changed
    if [ "$new_port" = "$old_port" ]; then
        json_success "{\"message\":\"Port unchanged\",\"port\":$new_port}"
        return
    fi
    
    # Note: Port availability check removed because:
    # - dnsmasq and avahi-daemon can coexist on same port (SO_REUSEPORT)
    # - Real conflicts will be detected when dnsmasq restarts (fails to bind)
    # - User takes responsibility (Danger Zone warning)
    
    # =========================================================================
    # Point of no return: update all configs
    # =========================================================================
    
    # 1. Update settings.json
    local tmp_settings=$(mktemp)
    jq ".dnsmasq_port = $new_port" "$SETTINGS_FILE" > "$tmp_settings" 2>/dev/null
    if [ -s "$tmp_settings" ] && jq empty "$tmp_settings" 2>/dev/null; then
        mv "$tmp_settings" "$SETTINGS_FILE"
    else
        rm -f "$tmp_settings"
        json_error "Failed to update settings.json" 500
        return
    fi
    
    # 2. Update dnsmasq config
    local dnsmasq_conf="/opt/etc/dnsmasq.d/00-upstream-dns.conf"
    if [ -f "$dnsmasq_conf" ]; then
        sed -i "s/^port=.*/port=$new_port/" "$dnsmasq_conf"
    fi
    
    # 3. Update sing-box DNS addresses
    local singbox_config="/opt/etc/sing-box/config.json"
    if [ -f "$singbox_config" ]; then
        # Replace all occurrences: 127.0.0.1:OLD_PORT -> 127.0.0.1:NEW_PORT
        # Using sed for simplicity and reliability
        sed -i "s/127\\.0\\.0\\.1:$old_port/127.0.0.1:$new_port/g" "$singbox_config"
    fi
    
    # 4. Update S98singbox-rules (iptables DNS redirect rules)
    local rules_script="/opt/etc/init.d/S98singbox-rules"
    if [ -f "$rules_script" ]; then
        sed -i "s/--to-ports $old_port/--to-ports $new_port/g" "$rules_script"
        chmod +x "$rules_script"
    fi
    
    log_action "DNSMASQ_PORT_CHANGED" "Port changed from $old_port to $new_port"
    
    # 5. Restart services (synchronous so response is sent only after restart completes)
    # Order: stop sing-box → restart dnsmasq → apply iptables → start sing-box
    /opt/etc/init.d/S99sing-box stop >/dev/null 2>&1
    sleep 1
    /opt/etc/init.d/S56dnsmasq restart >/dev/null 2>&1
    sleep 2
    /opt/etc/init.d/S98singbox-rules restart >/dev/null 2>&1
    sleep 1
    /opt/etc/init.d/S99sing-box start >/dev/null 2>&1
    sleep 2
    
    json_success "{\"message\":\"dnsmasq port changed to $new_port\",\"port\":$new_port,\"old_port\":$old_port}"
}

# =============================================================================
# Process requests
# =============================================================================

PATH_INFO="${PATH_INFO:-}"
ACTION=$(echo "$PATH_INFO" | cut -d'/' -f2)

case "$REQUEST_METHOD" in
    GET)
        case "$ACTION" in
            ""|settings)
                get_settings
                ;;
            *)
                json_error "Unknown action: $ACTION" 400
                ;;
        esac
        ;;
        
    POST)
        case "$ACTION" in
            port)
                POST_DATA=$(read_post_data)
                NEW_PORT=$(echo "$POST_DATA" | jq -r 'if .port != null then .port else empty end')
                if [ -z "$NEW_PORT" ]; then
                    json_error "Port not specified" 400
                else
                    change_web_port "$NEW_PORT"
                fi
                ;;
            lists-source)
                POST_DATA=$(read_post_data)
                NEW_URL=$(echo "$POST_DATA" | jq -r 'if .url != null then .url else empty end')
                if [ -z "$NEW_URL" ]; then
                    json_error "URL not specified" 400
                else
                    set_lists_source "$NEW_URL"
                fi
                ;;
            lists-source-reset)
                reset_lists_source
                ;;
            verbose-log)
                POST_DATA=$(read_post_data)
                set_verbose_log "$(echo "$POST_DATA" | jq -r 'if .enabled == true then "true" else "false" end')"
                ;;
            list-binding)
                POST_DATA=$(read_post_data)
                set_list_binding "$(echo "$POST_DATA" | jq -r '.split // empty')" \
                                 "$(echo "$POST_DATA" | jq -r '.vpnprimary // empty')"
                ;;
            vpn-lan-access)
                POST_DATA=$(read_post_data)
                set_vpn_lan_access "$(echo "$POST_DATA" | jq -r '.mode // empty')"
                ;;
            dnsmasq-port)
                POST_DATA=$(read_post_data)
                NEW_PORT=$(echo "$POST_DATA" | jq -r 'if .port != null then .port else empty end')
                if [ -z "$NEW_PORT" ]; then
                    json_error "Port not specified" 400
                else
                    change_dnsmasq_port "$NEW_PORT"
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
