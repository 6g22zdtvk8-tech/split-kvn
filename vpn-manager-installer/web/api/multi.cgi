#!/bin/sh
# Several VPN connections at once (multi mode): one main server plus hot reserve.
#   GET  /api/multi.cgi            → state with live per-server status
#   POST /api/multi.cgi/mode       {"mode":"multi"|"single"}
#   POST /api/multi.cgi/members    {"members":[ids],"subscriptions":[ids],"primary":"id"?}
#   POST /api/multi.cgi/primary    {"id":"id"}           (no sing-box restart)
#   POST /api/multi.cgi/check      re-check every server now
#   POST /api/multi.cgi/check-one  {"id":"id"} re-check one server now
#   POST /api/multi.cgi/notices    clear the notices about vanished servers (B28)

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

ACTION=$(echo "$PATH_INFO" | sed 's/^\///' | cut -d'/' -f1)

respond_state() {
    json_success "$(multi_status_json)"
}

case "$REQUEST_METHOD" in
    GET)
        respond_state
        ;;
    POST)
        BODY=$(read_post_data)
        [ -n "$BODY" ] || BODY='{}'
        printf '%s' "$BODY" | jq -e 'type == "object"' >/dev/null 2>&1 || { json_error "Invalid JSON" 400; exit 0; }
        STATE=$(multi_state)

        case "$ACTION" in
            mode)
                MODE=$(printf '%s' "$BODY" | jq -r '.mode // empty')
                case "$MODE" in
                    multi)
                        # Nothing ticked yet: start from the server that runs now
                        if [ "$(multi_effective "$STATE" | jq '.ids | length')" -eq 0 ]; then
                            ACTIVE=$(get_active_config)
                            [ -n "$ACTIVE" ] && [ -f "$VPN_CONFIGS_DIR/$ACTIVE.json" ] || { json_error "multi.errors.empty" 400; exit 0; }
                            STATE=$(printf '%s' "$STATE" | jq -c --arg a "$ACTIVE" '.members = [$a] | .primary = $a')
                        fi
                        multi_save "$(printf '%s' "$STATE" | jq -c '.mode = "multi"')" || { json_error "Cannot save" 500; exit 0; }
                        if ! apply_multi_config; then
                            multi_save "$STATE"
                            json_error "multi.errors.apply" 500; exit 0
                        fi
                        multi_restart_vpn || { json_error "multi.errors.start" 500; exit 0; }
                        log_action "MULTI" "Mode: several connections"
                        ;;
                    single)
                        multi_save "$(printf '%s' "$STATE" | jq -c '.mode = "single"')" || { json_error "Cannot save" 500; exit 0; }
                        # Back to one server: the main one keeps running
                        ACTIVE=$(printf '%s' "$STATE" | jq -r '.primary // empty')
                        [ -n "$ACTIVE" ] && [ -f "$VPN_CONFIGS_DIR/$ACTIVE.json" ] || ACTIVE=$(get_active_config)
                        if [ -n "$ACTIVE" ] && [ -f "$VPN_CONFIGS_DIR/$ACTIVE.json" ]; then
                            apply_shadowsocks_config "$VPN_CONFIGS_DIR/$ACTIVE.json" || { json_error "multi.errors.apply" 500; exit 0; }
                            set_active_config "$ACTIVE"
                            multi_restart_vpn || { json_error "multi.errors.start" 500; exit 0; }
                        fi
                        log_action "MULTI" "Mode: one connection ($ACTIVE)"
                        ;;
                    *)
                        json_error "Unknown mode" 400; exit 0
                        ;;
                esac
                respond_state
                ;;

            members)
                NEW=$(printf '%s' "$STATE" | jq -c --argjson b "$BODY" '
                    .members = ([$b.members[]? | strings]) | .subscriptions = ([$b.subscriptions[]? | strings])
                    | (if ($b.primary | type) == "string" and $b.primary != "" then .primary = $b.primary else . end)')
                # Missing configs are refused outright (WireGuard/AmneziaWG take part as endpoints)
                BAD=$(multi_catalog | jq -r --argjson st "$NEW" '
                    (map({key: .id, value: .protocol}) | from_entries) as $p
                    | [$st.members[] | if $p[.] == null then "notFound" else empty end] | first // empty')
                [ -z "$BAD" ] || { json_error "multi.errors.$BAD" 400; exit 0; }
                EFF=$(multi_effective "$NEW")
                [ "$(printf '%s' "$EFF" | jq '.ids | length')" -gt 0 ] || { json_error "multi.errors.empty" 400; exit 0; }
                # Ticked one by one beyond the limit: refuse. A big subscription is cut
                # to the limit instead, and the panel says how many were left out.
                [ "$(printf '%s' "$NEW" | jq '.members | unique | length')" -le "$MULTI_LIMIT" ] || { json_error "multi.errors.limit" 400; exit 0; }
                multi_save "$NEW" || { json_error "Cannot save" 500; exit 0; }
                if [ "$(printf '%s' "$NEW" | jq -r '.mode')" = "multi" ]; then
                    apply_multi_config || { multi_save "$STATE"; json_error "multi.errors.apply" 500; exit 0; }
                    multi_restart_vpn || { json_error "multi.errors.start" 500; exit 0; }
                fi
                respond_state
                ;;

            primary)
                ID=$(printf '%s' "$BODY" | jq -r '.id // empty')
                multi_effective "$STATE" | jq -e --arg id "$ID" '.ids | index($id)' >/dev/null 2>&1 \
                    || { json_error "multi.errors.notFound" 400; exit 0; }
                multi_save "$(printf '%s' "$STATE" | jq -c --arg id "$ID" '.primary = $id')" || { json_error "Cannot save" 500; exit 0; }
                set_active_config "$ID"
                multi_is_on && multi_set_primary_live "$ID"
                log_action "MULTI" "Main server: $ID"
                respond_state
                ;;

            notices)
                rm -f "$SERVER_NOTICES"
                respond_state
                ;;

            check)
                # Re-test the whole group now and remember who did not answer
                multi_check_all
                respond_state
                ;;

            check-one)
                ID=$(printf '%s' "$BODY" | jq -r '.id // empty')
                multi_effective "$STATE" | jq -e --arg id "$ID" '.ids | index($id)' >/dev/null 2>&1 \
                    || { json_error "multi.errors.notFound" 400; exit 0; }
                multi_check_one "$ID"
                respond_state
                ;;

            *)
                json_error "Unknown action" 400
                ;;
        esac
        ;;
    *)
        json_error "Method not allowed" 405
        ;;
esac
