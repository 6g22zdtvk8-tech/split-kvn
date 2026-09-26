#!/bin/sh
# API for managing domain lists for VPN routing
# Support for two types: TCP+UDP and UDP-only

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

# Authorization check
if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Domain files
DOMAINS_TCPUDP_FILE="$VPN_MANAGER_HOME/vpn-domains.txt"
DOMAINS_UDPONLY_FILE="$VPN_MANAGER_HOME/vpn-domains-udp.txt"

# dnsmasq configs
DNSMASQ_TCPUDP="/opt/etc/dnsmasq.d/vpn-domains.conf"
DNSMASQ_UDPONLY="/opt/etc/dnsmasq.d/vpn-domains-udp.conf"

# Settings file for auto_update_lists check
SETTINGS_FILE="$VPN_MANAGER_HOME/settings.json"

# Check if auto-update is enabled (FEAT-011)
is_auto_update_enabled() {
    if [ -f "$SETTINGS_FILE" ]; then
        local enabled=$(jq 'if .auto_update_lists == null then true else .auto_update_lists end' "$SETTINGS_FILE" 2>/dev/null)
        [ "$enabled" = "true" ]
    else
        return 0  # By default enabled
    fi
}

# Get type from query string
get_domain_type() {
    echo "$QUERY_STRING" | sed -n 's/.*type=\([^&]*\).*/\1/p'
}

# Get file by type
get_domains_file() {
    local type="$1"
    if [ "$type" = "udponly" ]; then
        echo "$DOMAINS_UDPONLY_FILE"
    else
        echo "$DOMAINS_TCPUDP_FILE"
    fi
}

# Get dnsmasq config by type
get_dnsmasq_file() {
    local type="$1"
    if [ "$type" = "udponly" ]; then
        echo "$DNSMASQ_UDPONLY"
    else
        echo "$DNSMASQ_TCPUDP"
    fi
}

# Get ipset name by type
get_ipset_name() {
    local type="$1"
    if [ "$type" = "udponly" ]; then
        echo "vpn_domains_udp"
    else
        echo "vpn_domains"
    fi
}

# Update dnsmasq config from domains file
update_dnsmasq_for_type() {
    local type="$1"
    local domains_file=$(get_domains_file "$type")
    local dnsmasq_file=$(get_dnsmasq_file "$type")
    local ipset_name=$(get_ipset_name "$type")
    # IPv6 twin: vpn_domains → vpn_domains6, vpn_domains_udp → vpn_domains6_udp
    # (B11: only the IPv4 set was written here, the other generators write both)
    local ipset6_name=$(echo "$ipset_name" | sed 's/_domains/_domains6/')
    
    # Determine remote file for merge (FEAT-011)
    local remote_file=""
    if [ "$type" = "udponly" ]; then
        remote_file="$VPN_MANAGER_HOME/remote-lists/udp_domains.txt"
    else
        remote_file="$VPN_MANAGER_HOME/remote-lists/tcp_udp_domains.txt"
    fi
    
    mkdir -p "$(dirname "$dnsmasq_file")"
    > "$dnsmasq_file"
    
    # Merge local + remote (if enabled), remove comments and duplicates.
    # Defense in depth: silently skip lines that fail validate_domain
    # (e.g. URLs with schemes, lines with embedded spaces, garbage from remote sources).
    # If we let them through, dnsmasq will reject the whole file and lose all routing.
    (
        [ -f "$domains_file" ] && cat "$domains_file"
        # Remote files used only if auto-update is enabled
        if is_auto_update_enabled && [ -f "$remote_file" ]; then
            cat "$remote_file"
        fi
    ) | grep -v '^#' | grep -v '^$' | sed 's/[[:space:]]//g' | sort -u | while IFS= read -r line; do
        [ -z "$line" ] && continue
        
        # Validate before stripping wildcard (validate_domain accepts both)
        validate_domain "$line" || continue
        
        # Remove wildcard prefix
        line=$(echo "$line" | sed 's/^\*\.//')
        line=$(echo "$line" | sed 's/^\*//')
        
        [ -n "$line" ] && echo "ipset=/$line/$ipset_name,$ipset6_name" >> "$dnsmasq_file"
    done

    # B1: the second set leaves out entries World has, so it follows every World change
    # (otherwise a site just added to World could stay in both configs until the next
    # lists update and go direct). Callers restart dnsmasq once afterwards.
    [ "$LIST_SET" = "russia" ] || direct_lists dnsmasq

    return 0
}

# List set (B1): "world" (default, the lists above) or "russia" (?listset=russia).
# The Russia set has its own files and ipsets; its dnsmasq config is built by direct-lists.sh.
LIST_SET=$(echo "$QUERY_STRING" | sed -n 's/.*listset=\([a-z]*\).*/\1/p')
if [ "$LIST_SET" = "russia" ]; then
    DOMAINS_TCPUDP_FILE="$VPN_MANAGER_HOME/direct-domains.txt"
    DOMAINS_UDPONLY_FILE="$VPN_MANAGER_HOME/direct-domains-udp.txt"
    get_ipset_name() {
        if [ "$1" = "udponly" ]; then echo "direct_domains_udp"; else echo "direct_domains"; fi
    }
    update_dnsmasq_for_type() {
        direct_lists dnsmasq
    }
fi

ACTION=$(echo "$PATH_INFO" | sed 's/^\///' | cut -d'/' -f1)
DOMAIN_TYPE=$(get_domain_type)
[ -z "$DOMAIN_TYPE" ] && DOMAIN_TYPE="tcpudp"

case "$REQUEST_METHOD" in
    GET)
        case "$ACTION" in
            ""|list)
                # Get domains list content
                DOMAINS_FILE=$(get_domains_file "$DOMAIN_TYPE")
                
                if [ -f "$DOMAINS_FILE" ]; then
                    LINES=$(wc -l < "$DOMAINS_FILE")
                    DOMAINS_COUNT=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$DOMAINS_FILE" 2>/dev/null || echo 0)
                    WILDCARD_COUNT=$(grep -c '^\*' "$DOMAINS_FILE" 2>/dev/null || echo 0)
                    
                    echo "Content-Type: application/json"
                    echo ""
                    # jq, not awk: busybox awk on the router does not escape quotes, and
                    # one " anywhere in the file broke the JSON — the list showed empty (B11)
                    jq -R -s -c --arg t "$DOMAIN_TYPE" --arg f "$DOMAINS_FILE" \
                        --arg lines "$LINES" --arg d "$DOMAINS_COUNT" --arg w "$WILDCARD_COUNT" \
                        'def num($v): ($v | split("\n")[0] | ltrimstr(" ") | if . == "" then 0 else tonumber end);
                         {success: true, data: {type: $t, content: ., lines: num($lines),
                          domains_count: num($d), wildcard_count: num($w), file: $f}}' "$DOMAINS_FILE"
                else
                    json_success "{\"type\":\"$DOMAIN_TYPE\",\"content\":\"\",\"lines\":0,\"domains_count\":0,\"wildcard_count\":0,\"file\":\"$DOMAINS_FILE\",\"exists\":false}"
                fi
                ;;
                
            stats)
                # Statistics for both types
                TCPUDP_COUNT=0
                UDPONLY_COUNT=0
                IPSET_TCPUDP=0
                IPSET_UDPONLY=0
                
                if [ -f "$DOMAINS_TCPUDP_FILE" ]; then
                    TCPUDP_COUNT=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$DOMAINS_TCPUDP_FILE" 2>/dev/null || echo 0)
                fi
                
                if [ -f "$DOMAINS_UDPONLY_FILE" ]; then
                    UDPONLY_COUNT=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$DOMAINS_UDPONLY_FILE" 2>/dev/null || echo 0)
                fi
                
                IPSET_TCPUDP=$(ipset list vpn_domains 2>/dev/null | grep -c '^[0-9]' || echo 0)
                IPSET_UDPONLY=$(ipset list vpn_domains_udp 2>/dev/null | grep -c '^[0-9]' || echo 0)
                
                json_success "{\"tcpudp\":{\"domains\":$TCPUDP_COUNT,\"ipset_entries\":$IPSET_TCPUDP},\"udponly\":{\"domains\":$UDPONLY_COUNT,\"ipset_entries\":$IPSET_UDPONLY}}"
                ;;
                
            ipset-status)
                # Dump current ipset entries (for the IPSet viewer popup)
                # Returns up to MAX_LINES per set to avoid huge JSON payloads.
                MAX_LINES=2000
                
                dump_set() {
                    local set_name="$1"
                    local raw=$(ipset list "$set_name" 2>/dev/null)
                    if [ -z "$raw" ]; then
                        echo "{\"exists\":false,\"count\":0,\"entries\":[]}"
                        return
                    fi
                    # Members start after "Members:" line; each entry is on its own line.
                    local members=$(echo "$raw" | sed -n '/^Members:/,$p' | tail -n +2 | grep -v '^[[:space:]]*$')
                    local total=$(echo "$members" | grep -c . | tr -d ' \n\r')
                    [ -z "$total" ] && total=0
                    local truncated="false"
                    if [ "$total" -gt "$MAX_LINES" ]; then
                        members=$(echo "$members" | head -n "$MAX_LINES")
                        truncated="true"
                    fi
                    # Build JSON array of strings via jq
                    local entries_json=$(echo "$members" | jq -Rsc 'split("\n") | map(select(length > 0))')
                    [ -z "$entries_json" ] && entries_json="[]"
                    echo "{\"exists\":true,\"count\":$total,\"truncated\":$truncated,\"entries\":$entries_json}"
                }
                
                # World lists fill the vpn_* sets, the Russia set (?listset=russia) the direct_* ones
                P="vpn"
                [ "$LIST_SET" = "russia" ] && P="direct"
                D4_TCPUDP=$(dump_set "${P}_domains")
                D4_UDPONLY=$(dump_set "${P}_domains_udp")
                D6_TCPUDP=$(dump_set "${P}_domains6")
                D6_UDPONLY=$(dump_set "${P}_domains6_udp")
                S4_TCPUDP=$(dump_set "${P}_subnets")
                S4_UDPONLY=$(dump_set "${P}_subnets_udp")
                S6_TCPUDP=$(dump_set "${P}_subnets6")
                S6_UDPONLY=$(dump_set "${P}_subnets6_udp")
                
                # Detect if a warmup is currently running (PID file written by the warmup endpoint)
                WARMUP_RUNNING="false"
                WARMUP_PID_FILE="/tmp/vpn-manager-warmup.pid"
                if [ -f "$WARMUP_PID_FILE" ]; then
                    WPID=$(cat "$WARMUP_PID_FILE" 2>/dev/null)
                    if [ -n "$WPID" ] && [ -d "/proc/$WPID" ]; then
                        WARMUP_RUNNING="true"
                    else
                        rm -f "$WARMUP_PID_FILE"
                    fi
                fi
                
                # CGI requires HTTP headers + blank line BEFORE the body.
                # Without these lighttpd treats the whole JSON as one giant header
                # and rejects with "response headers too large" → frontend gets 500.
                echo "Content-Type: application/json"
                echo ""
                printf '{"success":true,"data":{"list_set":"%s","%s_domains":%s,"%s_domains_udp":%s,"%s_domains6":%s,"%s_domains6_udp":%s,"%s_subnets":%s,"%s_subnets_udp":%s,"%s_subnets6":%s,"%s_subnets6_udp":%s,"warmup_running":%s,"max_lines":%d}}\n' \
                    "${LIST_SET:-world}" "$P" "$D4_TCPUDP" "$P" "$D4_UDPONLY" "$P" "$D6_TCPUDP" "$P" "$D6_UDPONLY" \
                    "$P" "$S4_TCPUDP" "$P" "$S4_UDPONLY" "$P" "$S6_TCPUDP" "$P" "$S6_UDPONLY" "$WARMUP_RUNNING" "$MAX_LINES"
                ;;

            ipset-export)
                # Full snapshot of all 8 ipsets as a downloadable plain-text file.
                # Unlike /ipset-status this is NOT truncated — meant for diagnostics
                # / offline inspection when the modal preview cuts at MAX_LINES.
                # Optional ?set=<name> exports only one ipset; default = all.
                # "set=" only as a whole parameter: a bare "set=" also matched the end of "listset=russia"
                EXPORT_SET=$(echo "&$QUERY_STRING" | sed -n 's/.*&set=\([^&]*\).*/\1/p')
                STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null)
                [ -z "$STAMP" ] && STAMP="snapshot"
                if [ -n "$EXPORT_SET" ]; then
                    FNAME="ipset-${EXPORT_SET}-${STAMP}.txt"
                    EXPORT_LIST="$EXPORT_SET"
                else
                    # World lists fill the vpn_* sets, the Russia set (?listset=russia) the direct_* ones
                    P="vpn"
                    [ "$LIST_SET" = "russia" ] && P="direct"
                    FNAME="ipset-snapshot-${P}-${STAMP}.txt"
                    EXPORT_LIST="${P}_domains ${P}_domains_udp ${P}_domains6 ${P}_domains6_udp ${P}_subnets ${P}_subnets_udp ${P}_subnets6 ${P}_subnets6_udp"
                fi

                # CGI headers (Content-Disposition triggers browser "Save as…")
                echo "Content-Type: text/plain; charset=utf-8"
                echo "Content-Disposition: attachment; filename=\"$FNAME\""
                echo ""

                echo "# IPSet snapshot generated at $(date -Is 2>/dev/null || date)"
                echo "# router: $(uname -n 2>/dev/null)"
                echo ""
                for SET in $EXPORT_LIST; do
                    echo "# === $SET ==="
                    RAW=$(ipset list "$SET" 2>/dev/null)
                    if [ -z "$RAW" ]; then
                        echo "# (set not loaded)"
                        echo ""
                        continue
                    fi
                    # Print ipset header (Type/Header/Size in memory/References) for context,
                    # then the full Members list with no truncation.
                    echo "$RAW" | sed -n '1,/^Members:/p' | sed 's/^/# /'
                    echo "$RAW" | sed -n '/^Members:/,$p' | tail -n +2 | grep -v '^[[:space:]]*$'
                    echo ""
                done
                ;;

            search)
                # Search domain in both lists
                QUERY=$(echo "$QUERY_STRING" | sed -n 's/.*q=\([^&]*\).*/\1/p')
                if [ -z "$QUERY" ]; then
                    json_error "errors.paramQRequired" 400
                    exit 0
                fi
                
                RESULTS_TCPUDP=""
                RESULTS_UDPONLY=""
                
                if [ -f "$DOMAINS_TCPUDP_FILE" ]; then
                    RESULTS_TCPUDP=$(grep -i "$QUERY" "$DOMAINS_TCPUDP_FILE" 2>/dev/null | head -25 | sed 's/"/\\"/g' | awk '{printf "\"%s\",", $0}' | sed 's/,$//')
                fi
                
                if [ -f "$DOMAINS_UDPONLY_FILE" ]; then
                    RESULTS_UDPONLY=$(grep -i "$QUERY" "$DOMAINS_UDPONLY_FILE" 2>/dev/null | head -25 | sed 's/"/\\"/g' | awk '{printf "\"%s\",", $0}' | sed 's/,$//')
                fi
                
                json_success "{\"query\":\"$QUERY\",\"tcpudp\":[$RESULTS_TCPUDP],\"udponly\":[$RESULTS_UDPONLY]}"
                ;;
                
            *)
                json_error "Unknown action" 404
                ;;
        esac
        ;;
        
    POST)
        POST_DATA=$(read_post_data)
        
        # Get type from request body or query string
        BODY_TYPE=$(json_get_value "$POST_DATA" "type")
        [ -n "$BODY_TYPE" ] && DOMAIN_TYPE="$BODY_TYPE"
        
        case "$ACTION" in
            ""|save)
                # Save domains list
                # Use jq for reliable parsing (sed breaks on edge cases)
                CONTENT=$(echo "$POST_DATA" | jq -r '.content // ""')
                
                # Empty content allowed (list clearing)
                
                DOMAINS_FILE=$(get_domains_file "$DOMAIN_TYPE")
                
                # Validation: count invalid lines but DO NOT block save.
                # Invalid lines are kept in the editor file (so user can fix them),
                # but they will be filtered out when generating dnsmasq/ipset configs.
                # Frontend gets skipped_count + sample to show a non-blocking warning.
                INVALID_TMP="/tmp/domains_invalid_$$"
                rm -f "$INVALID_TMP"
                
                echo "$CONTENT" | while IFS= read -r line; do
                    [ -z "$(echo "$line" | tr -d '[:space:]')" ] && continue
                    case "$line" in \#*) continue ;; esac
                    if ! validate_domain "$line"; then
                        echo "$line" >> "$INVALID_TMP"
                    fi
                done
                
                SKIPPED_COUNT=0
                SKIPPED_SAMPLE=""
                if [ -f "$INVALID_TMP" ] && [ -s "$INVALID_TMP" ]; then
                    SKIPPED_COUNT=$(wc -l < "$INVALID_TMP" | tr -d ' \n\r')
                    SKIPPED_SAMPLE=$(head -3 "$INVALID_TMP" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' '|' | sed 's/|$//')
                fi
                rm -f "$INVALID_TMP"
                
                # Backup
                if [ -f "$DOMAINS_FILE" ]; then
                    BACKUP_DIR="$VPN_MANAGER_HOME/backups"
                    mkdir -p "$BACKUP_DIR"
                    BACKUP_SUFFIX=$([ "$DOMAIN_TYPE" = "udponly" ] && echo "udp" || echo "tcpudp")
                    BACKUP_FILE="$BACKUP_DIR/domains_${BACKUP_SUFFIX}_$(date +%Y%m%d_%H%M%S).bak"
                    cp "$DOMAINS_FILE" "$BACKUP_FILE"
                    ls -1t "$BACKUP_DIR"/domains_${BACKUP_SUFFIX}_*.bak 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null
                fi
                
                # Save
                mkdir -p "$(dirname "$DOMAINS_FILE")"
                echo "$CONTENT" > "$DOMAINS_FILE"
                
                SINGBOX_APPLIED="false"
                SINGBOX_RESTARTED="false"
                
                # Flush ipset to remove old IPs from deleted domains
                IPSET_NAME=$(get_ipset_name "$DOMAIN_TYPE")
                ipset flush "$IPSET_NAME" 2>/dev/null || true
                
                # Update dnsmasq (for LAN clients)
                if update_dnsmasq_for_type "$DOMAIN_TYPE"; then
                    dnsmasq_restart
                    SINGBOX_APPLIED="true"
                fi
                
                # Update sing-box rules for VPN clients (ss-server-in)
                if update_vpnclient_rules; then
                    # Restart sing-box to apply new rules
                    if check_singbox_running; then
                        singbox_restart
                        SINGBOX_RESTARTED="true"
                    fi
                fi
                
                DOMAINS_SAVED=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$DOMAINS_FILE" 2>/dev/null | tr -d '\n\r' || echo 0)
                [ -z "$DOMAINS_SAVED" ] && DOMAINS_SAVED=0
                
                log_action "DOMAINS_SAVED" "Type: $DOMAIN_TYPE, Count: $DOMAINS_SAVED, Skipped: $SKIPPED_COUNT, singbox_restarted: $SINGBOX_RESTARTED"
                json_success "{\"message\":\"Domains list saved\",\"type\":\"$DOMAIN_TYPE\",\"domains_count\":$DOMAINS_SAVED,\"singbox_applied\":$SINGBOX_APPLIED,\"singbox_restarted\":$SINGBOX_RESTARTED,\"skipped_count\":$SKIPPED_COUNT,\"skipped_sample\":\"$SKIPPED_SAMPLE\"}"
                ;;
                
            add)
                # Add single domain
                DOMAIN=$(json_get_value "$POST_DATA" "domain")
                
                if [ -z "$DOMAIN" ]; then
                    json_error "Domain is required" 400
                    exit 0
                fi
                
                DOMAINS_FILE=$(get_domains_file "$DOMAIN_TYPE")
                mkdir -p "$(dirname "$DOMAINS_FILE")"
                
                # Remove wildcard
                DOMAIN=$(echo "$DOMAIN" | sed 's/^\*\.*//')
                
                # Check duplicate
                if [ -f "$DOMAINS_FILE" ] && grep -qE "^\*?\.?${DOMAIN}$" "$DOMAINS_FILE" 2>/dev/null; then
                    json_error "errors.domainExists" 400
                    exit 0
                fi
                
                echo "$DOMAIN" >> "$DOMAINS_FILE"
                
                update_dnsmasq_for_type "$DOMAIN_TYPE"
                dnsmasq_restart
                
                # Update sing-box rules for VPN clients
                if update_vpnclient_rules && check_singbox_running; then
                    singbox_restart
                fi
                
                log_action "DOMAIN_ADDED" "Type: $DOMAIN_TYPE, Domain: $DOMAIN"
                json_success "{\"message\":\"Domain added to $DOMAIN_TYPE\",\"domain\":\"$DOMAIN\",\"type\":\"$DOMAIN_TYPE\"}"
                ;;
                
            warmup)
                # Manual DNS warm-up: re-resolve every domain in the lists to populate ipset.
                # Heavy operation — run in background, return immediately.
                WARMUP_PID_FILE="/tmp/vpn-manager-warmup.pid"
                
                # If already running, refuse — don't double-trigger
                if [ -f "$WARMUP_PID_FILE" ]; then
                    OLD_PID=$(cat "$WARMUP_PID_FILE" 2>/dev/null)
                    if [ -n "$OLD_PID" ] && [ -d "/proc/$OLD_PID" ]; then
                        json_error "errors.warmupAlreadyRunning" 409
                        exit 0
                    else
                        rm -f "$WARMUP_PID_FILE"
                    fi
                fi
                
                if [ ! -x "/opt/etc/init.d/S98singbox-rules" ]; then
                    json_error "errors.warmupScriptMissing" 500
                    exit 0
                fi
                
                # Spawn warmup detached: it writes its own pid then runs warmup_domains.
                (
                    echo $$ > "$WARMUP_PID_FILE"
                    /opt/etc/init.d/S98singbox-rules warmup >/dev/null 2>&1
                    rm -f "$WARMUP_PID_FILE"
                ) &
                
                log_action "DOMAINS_WARMUP" "Manual warmup triggered"
                json_success "{\"message\":\"Warmup started\",\"running\":true}"
                ;;
                
            reload)
                # Reload dnsmasq
                update_dnsmasq_for_type "tcpudp"
                update_dnsmasq_for_type "udponly"
                dnsmasq_restart
                
                # Update sing-box rules for VPN clients
                SINGBOX_RESTARTED="false"
                if update_vpnclient_rules && check_singbox_running; then
                    singbox_restart
                    SINGBOX_RESTARTED="true"
                fi
                
                log_action "DNSMASQ_RELOAD" "Restart dnsmasq, singbox_restarted: $SINGBOX_RESTARTED"
                json_success "{\"message\":\"dnsmasq restarted\",\"singbox_restarted\":$SINGBOX_RESTARTED}"
                ;;
                
            *)
                json_error "Unknown action" 404
                ;;
        esac
        ;;
        
    *)
        json_error "Method not supported" 405
        ;;
esac
