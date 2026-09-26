#!/bin/sh
# =============================================================================
# VPN Manager Update API (B2)
# Reads what the self-update script recorded, and lets the owner drive it:
# turn the nightly check on or off, point it at a source, check now, install now.
# The script itself does the work; this file only asks it and reports back.
# =============================================================================

# Include common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

SETTINGS_FILE="/opt/etc/vpn-manager/settings.json"
UPDATE_SCRIPT="/opt/etc/vpn-manager/scripts/update-check.sh"
RUN_FLAG="/opt/tmp/vpn-manager-update/running"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

settings_get() {
    [ -f "$SETTINGS_FILE" ] && jq -r "$1 // empty" "$SETTINGS_FILE" 2>/dev/null
}

settings_set_arg() {
    # settings_set_arg <jq assignment using $v> <value>
    local tmp
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    [ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"
    tmp=$(mktemp) || return 1
    if jq --arg v "$2" "$1" "$SETTINGS_FILE" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
        mv "$tmp" "$SETTINGS_FILE"
        chmod 644 "$SETTINGS_FILE"
        return 0
    fi
    rm -f "$tmp"
    return 1
}

settings_set() {
    # settings_set <jq assignment>
    local tmp
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    [ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"
    tmp=$(mktemp) || return 1
    if jq "$1" "$SETTINGS_FILE" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
        mv "$tmp" "$SETTINGS_FILE"
        chmod 644 "$SETTINGS_FILE"
        return 0
    fi
    rm -f "$tmp"
    return 1
}

# An update takes minutes and must not die with the web request, so "install now"
# starts it detached and the panel polls this same endpoint for the outcome.
is_running() {
    [ -f "$RUN_FLAG" ] || return 1
    local pid; pid=$(cat "$RUN_FLAG" 2>/dev/null)
    [ -n "$pid" ] && [ -d "/proc/$pid" ] && return 0
    rm -f "$RUN_FLAG"
    return 1
}

current_state() {
    local state enabled source running
    if [ -x "$UPDATE_SCRIPT" ]; then
        state=$("$UPDATE_SCRIPT" status 2>/dev/null)
    fi
    [ -z "$state" ] && state='{}'
    echo "$state" | jq empty 2>/dev/null || state='{}'

    # Default is on (owner's decision 20.09), so a missing key reads as true.
    # Read the boolean explicitly: jq's "//" treats false like null, so the usual
    # settings_get would report an explicitly disabled switch as enabled.
    enabled=$(jq -r 'if .auto_update == null then "" else (.auto_update | tostring) end' "$SETTINGS_FILE" 2>/dev/null)
    [ "$enabled" = "false" ] || enabled="true"
    source=$(settings_get '.update_source_url')
    if is_running; then running="true"; else running="false"; fi

    echo "$state" | jq --arg en "$enabled" --arg src "$source" --arg run "$running" \
        '. + {auto_update: ($en == "true"), source: $src, running: ($run == "true"),
              installed: (.current // ""),
              held: ((.rollout // "") == "hold")}'
}

require_script() {
    if [ ! -x "$UPDATE_SCRIPT" ]; then
        json_error "Update script is not installed" 500
        exit 0
    fi
}

# -----------------------------------------------------------------------------
# Actions
# -----------------------------------------------------------------------------

do_check_now() {
    require_script
    "$UPDATE_SCRIPT" check >/dev/null 2>&1
    json_success "$(current_state)"
}

do_apply_now() {
    require_script

    if is_running; then
        json_error "An update is already running" 409
        return
    fi

    local source; source=$(settings_get '.update_source_url')
    if [ -z "$source" ]; then
        json_error "Update source is not set" 400
        return
    fi

    # --force: the owner pressed the button, so a release still on hold is
    # installed too. That is the whole point of the button.
    mkdir -p "$(dirname "$RUN_FLAG")"
    ( "$UPDATE_SCRIPT" apply --force >/dev/null 2>&1; rm -f "$RUN_FLAG" ) &
    echo $! > "$RUN_FLAG"

    json_success "$(current_state)"
}

do_toggle() {
    local enabled="$1"
    if [ "$enabled" != "true" ] && [ "$enabled" != "false" ]; then
        json_error "enabled must be true or false" 400
        return
    fi
    if settings_set ".auto_update = $enabled"; then
        json_success "$(current_state)"
    else
        json_error "Could not save the setting" 500
    fi
}

do_set_source() {
    local url="$1"
    # Empty is allowed on purpose: it is how the feature is switched off entirely.
    if [ -n "$url" ]; then
        case "$url" in
            https://*) : ;;
            *) json_error "Source must be an https:// address" 400; return ;;
        esac
    fi
    # Passed to jq as data, never spliced into the expression: a crafted "URL"
    # could otherwise rewrite any other setting.
    if settings_set_arg '.update_source_url = $v' "$url"; then
        json_success "$(current_state)"
    else
        json_error "Could not save the setting" 500
    fi
}

# -----------------------------------------------------------------------------
# Routing
# -----------------------------------------------------------------------------

# Same convention as the other endpoints: the action is the path after the
# script name, e.g. /update.cgi/check — not a query parameter.
ACTION=$(echo "$PATH_INFO" | cut -d'/' -f2)

case "$REQUEST_METHOD" in
    GET)
        json_success "$(current_state)"
        ;;
    POST)
        case "$ACTION" in
            check)
                do_check_now
                ;;
            apply)
                do_apply_now
                ;;
            toggle)
                POST_DATA=$(read_post_data)
                do_toggle "$(echo "$POST_DATA" | jq -r 'if .enabled == true then "true" else "false" end')"
                ;;
            source)
                POST_DATA=$(read_post_data)
                do_set_source "$(echo "$POST_DATA" | jq -r '.url // ""')"
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
