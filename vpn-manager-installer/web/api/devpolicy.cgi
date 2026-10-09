#!/bin/sh
# =============================================================================
# Device policies API (B36)
#   GET  /api/devpolicy.cgi          status: firmware component, policies, ports
#   POST /api/devpolicy.cgi/apply    {"key":"split"}? create or update the firmware connection and
#                                    policy (one, or all without key)
#   POST /api/devpolicy.cgi/remove   {"key":"split"} delete the connection and policy from the router
#   POST /api/devpolicy.cgi/ports    {"ports":{"fullvpn":21081,...}} — change the local ports
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

POLICY_SCRIPT="$VPN_MANAGER_HOME/scripts/keenetic-policies.sh"
# Ports the router itself already uses for us; the rest is checked live
RESERVED_PORTS="22 23 53 67 68 79 80 222 443 1900 2080 2098 5351 5353 5453 8001 8080 8081 8388 9090"

ACTION=$(echo "${PATH_INFO:-}" | cut -d'/' -f2)

status_json() {
    [ -x "$POLICY_SCRIPT" ] || { echo '{"component":false,"policies":[],"missing_script":true}'; return; }
    "$POLICY_SCRIPT" status 2>/dev/null || echo '{"component":false,"policies":[]}'
}

apply_firmware() {
    "$POLICY_SCRIPT" apply ${1:+"$1"} --quiet >/dev/null 2>&1
    local rc=$?
    # the segment rules learn the marks of our policies
    [ $rc -eq 0 ] && /opt/etc/init.d/S98singbox-rules reload >/dev/null 2>&1
    return $rc
}

# ports of the VPN server, one per connection type (B38)
vpnserver_ports() {
    jq -r '[(.server_port // 8388), (.reality.port // 8443), (.tls.ws_port // 8444), (.tls.xhttp_port // 8445)] | map(tostring) | join(" ")' \
        "$VPN_MANAGER_HOME/vpnserver-credentials.json" 2>/dev/null || echo "8388 8443 8444 8445"
}

# port busy for something other than our own policy inbounds (so two policies can swap ports)
port_taken() {
    local port="$1" ours="$2"
    case " $ours " in *" $port "*) return 1 ;; esac
    netstat -tln 2>/dev/null | awk '{print $4}' | grep -q ":$port\$"
}

set_ports() {
    local body ports cur p v seen=" "
    body=$(read_post_data)
    ports=$(printf '%s' "$body" | jq -c '.ports // empty' 2>/dev/null)
    [ -n "$ports" ] || { json_error "Missing ports" 400; return; }
    cur=$(device_policy_ports_json)
    for p in $DEVICE_POLICIES; do
        v=$(printf '%s' "$ports" | jq -r --arg p "$p" '.[$p] // empty')
        [ -n "$v" ] || v=$(printf '%s' "$cur" | jq -r --arg p "$p" '.[$p]')
        case "$v" in ''|*[!0-9]*) json_error "Port for $p is not a number" 400; return ;; esac
        if [ "$v" -lt 1024 ] || [ "$v" -gt 65535 ]; then json_error "Port $v: allowed 1024-65535" 400; return; fi
        case " $RESERVED_PORTS " in *" $v "*) json_error "Port $v is used by the router" 400; return ;; esac
        # the VPN-server ports of every connection type (B38), even while a type has no users
        case " $(vpnserver_ports) " in *" $v "*) json_error "Port $v is used by the VPN server" 400; return ;; esac
        case "$seen" in *" $v "*) json_error "Port $v is given twice" 400; return ;; esac
        if port_taken "$v" "$(printf '%s' "$cur" | jq -r '[.[]] | map(tostring) | join(" ")')"; then
            json_error "Port $v is busy" 409; return
        fi
        seen="$seen$v "
    done
    local new=$(for p in $DEVICE_POLICIES; do
            v=$(printf '%s' "$ports" | jq -r --arg p "$p" '.[$p] // empty')
            [ -n "$v" ] || v=$(printf '%s' "$cur" | jq -r --arg p "$p" '.[$p]')
            printf '{"%s":%s}\n' "$p" "$v"
        done | jq -cs 'add')
    local tmp="$SETTINGS_FILE.tmp.$$" settings_prev="/tmp/devpolicy.settings.$$"
    cp "$SETTINGS_FILE" "$settings_prev" 2>/dev/null
    if jq --argjson p "$new" '.device_policy_ports = $p' "$SETTINGS_FILE" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
        cat "$tmp" > "$SETTINGS_FILE"
    fi
    rm -f "$tmp"
    log_action "DEVICE_POLICY" "Ports: $new"
    # sing-box: new inbound ports (checked first; on failure the old config stays)
    local prev="/tmp/devpolicy.prev.$$"
    cp "$SINGBOX_CONFIG" "$prev" 2>/dev/null
    if update_vpnclient_rules && singbox_config_ok; then
        cmp -s "$prev" "$SINGBOX_CONFIG" || { check_singbox_running && singbox_restart; }
    else
        cat "$prev" > "$SINGBOX_CONFIG"
        [ -s "$settings_prev" ] && cat "$settings_prev" > "$SETTINGS_FILE"
        rm -f "$prev" "$settings_prev"
        json_error "sing-box did not accept the new ports, nothing changed" 500
        return
    fi
    rm -f "$prev" "$settings_prev"
    # the firmware connections point at the new ports
    apply_firmware
    json_success "$(status_json)"
}

case "$REQUEST_METHOD" in
    GET)
        json_success "$(status_json)"
        ;;
    POST)
        case "$ACTION" in
            apply)
                KEY=$(read_post_data | jq -r '.key // empty' 2>/dev/null)
                case " $DEVICE_POLICIES " in *" $KEY "*|"  "*) ;; *) [ -n "$KEY" ] && { json_error "Unknown policy" 400; exit 0; } ;; esac
                apply_firmware "$KEY"
                rc=$?
                if [ $rc -eq 2 ]; then
                    json_error "component_missing" 409
                elif [ $rc -ne 0 ]; then
                    json_error "Could not create the policies in the router" 500
                else
                    log_action "DEVICE_POLICY" "Firmware connections and policies created/updated"
                    json_success "$(status_json)"
                fi
                ;;
            remove)
                KEY=$(read_post_data | jq -r '.key // empty' 2>/dev/null)
                case " $DEVICE_POLICIES " in *" $KEY "*) ;; *) json_error "Unknown policy" 400; exit 0 ;; esac
                if "$POLICY_SCRIPT" remove "$KEY" >/dev/null 2>&1; then
                    /opt/etc/init.d/S98singbox-rules reload >/dev/null 2>&1
                    log_action "DEVICE_POLICY" "Removed from the router: $KEY"
                    json_success "$(status_json)"
                else
                    json_error "Could not remove from the router" 500
                fi
                ;;
            ports) set_ports ;;
            *) json_error "Unknown action" 400 ;;
        esac
        ;;
    *)
        json_error "Method not supported" 405
        ;;
esac
