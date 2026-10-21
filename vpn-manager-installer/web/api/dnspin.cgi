#!/bin/sh
# =============================================================================
# Domains with their own DNS servers (panel: Domains → "DNS via Google")
#   GET  /api/dnspin.cgi   {domains: "text", servers: ["8.8.8.8","4.2.2.2"]}
#   POST /api/dnspin.cgi   {domains: "text", servers: [..]} — save and apply
# Some providers' resolvers answer NXDOMAIN for live domains (Moi Nalog, Gosuslugi
# for one user, 21.10.2026); these domains are always asked from the servers below.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

PIN_FILE="$VPN_MANAGER_HOME/dns-pinned-domains.txt"
FALLBACK="$VPN_MANAGER_HOME/scripts/dns-upstream-fallback.sh"
DEFAULT_SERVERS='["8.8.8.8","4.2.2.2"]'

state_json() {
    local text="" servers
    [ -f "$PIN_FILE" ] && text=$(cat "$PIN_FILE")
    servers=$(jq -c --argjson d "$DEFAULT_SERVERS" '.dns_pinned_servers // $d' "$SETTINGS_FILE" 2>/dev/null)
    [ -n "$servers" ] || servers="$DEFAULT_SERVERS"
    jq -cn --arg t "$text" --argjson s "$servers" --argjson d "$DEFAULT_SERVERS" '{domains: $t, servers: $s, default_servers: $d}'
}

case "$REQUEST_METHOD" in
    GET)
        json_success "$(state_json)"
        ;;
    POST)
        BODY=$(read_post_data)
        printf '%s' "$BODY" | jq -e 'type == "object"' >/dev/null 2>&1 || { json_error "Invalid JSON" 400; exit 0; }
        # servers: one or two IPv4 addresses (router jq has no regex: checked in shell)
        SRV_LIST=$(printf '%s' "$BODY" | jq -r '.servers[]? | strings' 2>/dev/null | tr -d ' \t\r' | grep -v '^$' | awk '!seen[$0]++')
        N=$(printf '%s\n' "$SRV_LIST" | grep -c .)
        [ "$N" -ge 1 ] && [ "$N" -le 2 ] || { json_error "dnspin.errors.servers" 400; exit 0; }
        for ip in $SRV_LIST; do
            echo "$ip" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || { json_error "dnspin.errors.server" 400; exit 0; }
            for o in $(echo "$ip" | tr . ' '); do [ "$o" -le 255 ] || { json_error "dnspin.errors.server" 400; exit 0; }; done
        done
        SERVERS=$(printf '%s\n' "$SRV_LIST" | jq -R . | jq -cs .)
        # domains: one per line, comments allowed
        TEXT=$(printf '%s' "$BODY" | jq -r '.domains // ""' | tr -d '\r')
        BADD=$(printf '%s\n' "$TEXT" | sed 's/#.*//; s/[[:space:]]//g' | grep -v '^$' | grep -v -E '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' | head -1)
        [ -z "$BADD" ] || { json_error "dnspin.errors.domain:$BADD" 400; exit 0; }
        tmp="$SETTINGS_FILE.tmp.$$"
        if jq --argjson s "$SERVERS" '.dns_pinned_servers = $s' "$SETTINGS_FILE" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
            cat "$tmp" > "$SETTINGS_FILE"
        fi
        rm -f "$tmp"
        printf '%s\n' "$TEXT" > "$PIN_FILE"
        [ -x "$FALLBACK" ] && "$FALLBACK" pinned >/dev/null 2>&1
        log_action "DNS_PINNED" "Domains with own DNS: $(sed 's/#.*//' "$PIN_FILE" | grep -c '[a-z]'), servers $SERVERS"
        json_success "$(state_json)"
        ;;
    *)
        json_error "Method not supported" 405
        ;;
esac
