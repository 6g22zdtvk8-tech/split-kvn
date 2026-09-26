#!/bin/sh
# =============================================================================
# VPN Manager Lists Auto-Update API (FEAT-011)
# Auto-update management for domain and subnet lists
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
REMOTE_LISTS_DIR="/opt/etc/vpn-manager/remote-lists"
LISTS_UPDATE_SCRIPT="/opt/etc/vpn-manager/scripts/lists-update.sh"
CRONTAB_FILE="/opt/var/spool/cron/crontabs/root"

# Default lists source (fallback if not in settings)
DEFAULT_LISTS_SOURCE="https://raw.githubusercontent.com/6g22zdtvk8-tech/split-kvn-lists/main"

# Values By default
DEFAULT_AUTO_UPDATE=true
DEFAULT_UPDATE_INTERVAL=24

# =============================================================================
# Functions
# =============================================================================

# Initialize auto-update settings
init_lists_settings() {
    mkdir -p "$(dirname "$SETTINGS_FILE")"
    
    # Create default file ONLY if truly missing
    if [ ! -f "$SETTINGS_FILE" ]; then
        echo '{"auto_update_lists":true}' > "$SETTINGS_FILE"
        chmod 644 "$SETTINGS_FILE"
    fi
}

# Safe read from settings.json with defaults (never writes)
read_setting() {
    local key="$1"
    local default="$2"
    if [ -s "$SETTINGS_FILE" ]; then
        # not "// empty": that turns a stored false into the default (B11)
        local val=$(jq -r --arg k "$key" 'if .[$k] == null then empty else .[$k] end' "$SETTINGS_FILE" 2>/dev/null)
        [ -n "$val" ] && echo "$val" || echo "$default"
    else
        echo "$default"
    fi
}

# Check if auto-update is enabled
is_auto_update_enabled() {
    if [ -f "$SETTINGS_FILE" ]; then
        local enabled=$(jq 'if .auto_update_lists == null then true else .auto_update_lists end' "$SETTINGS_FILE" 2>/dev/null)
        [ "$enabled" = "true" ]
    else
        return 0  # By default enabled
    fi
}

# Parse cron interval (returns hours: 3, 6, 12, 24 or 0 if not found/disabled)
get_cron_interval() {
    if [ ! -f "$CRONTAB_FILE" ]; then
        echo "$DEFAULT_UPDATE_INTERVAL"
        return
    fi
    
    # Find lists-update line in cron
    local cron_line=$(grep 'lists-update.sh' "$CRONTAB_FILE" 2>/dev/null | head -1)
    
    if [ -z "$cron_line" ]; then
        # No cron job = auto-update disabled
        echo "0"
        return
    fi
    
    # Parse cron expression
    case "$cron_line" in
        "0 */3 "*) echo "3" ;;
        "0 */6 "*) echo "6" ;;
        "0 */12 "*) echo "12" ;;
        "0 4 "*) echo "24" ;;
        *) echo "$DEFAULT_UPDATE_INTERVAL" ;;
    esac
}

# Get auto-update status
get_status() {
    init_lists_settings
    
    local enabled=$(read_setting "auto_update_lists" "true")
    
    # Read interval from cron (source of truth)
    local interval=$(get_cron_interval)
    [ -z "$interval" ] && interval="$DEFAULT_UPDATE_INTERVAL"
    
    # If interval is 0 (no cron job), auto-update is actually disabled
    if [ "$interval" = "0" ]; then
        enabled="false"
        interval="$DEFAULT_UPDATE_INTERVAL"
    fi
    
    local last_update=$(read_setting "last_lists_update" "")
    local source_url=$(read_setting "lists_source_url" "$DEFAULT_LISTS_SOURCE")
    
    # Check remote files presence
    local remote_files_count=0
    [ -d "$REMOTE_LISTS_DIR" ] && remote_files_count=$(ls -1 "$REMOTE_LISTS_DIR"/*.txt 2>/dev/null | wc -l)
    [ -z "$remote_files_count" ] && remote_files_count=0
    
    # Build response with jq for guaranteed valid JSON
    jq -n \
        --argjson enabled "$enabled" \
        --argjson interval "$interval" \
        --arg last_update "$last_update" \
        --argjson remote_files_count "$remote_files_count" \
        --arg source "$source_url" \
        '{
            auto_update_enabled: $enabled,
            update_interval: $interval,
            last_update: (if $last_update == "" then null else $last_update end),
            remote_files_count: $remote_files_count,
            source: $source,
            available_intervals: [3, 6, 12, 24]
        }'
}

# Enable/disable auto-update
toggle_auto_update() {
    local enabled="$1"
    
    # Validation
    if [ "$enabled" != "true" ] && [ "$enabled" != "false" ]; then
        json_error "errors.invalidValue" 400
        return
    fi
    
    init_lists_settings
    
    # Update settings (only auto_update_lists flag, not interval)
    local tmp_file="/tmp/settings-toggle.json"
    jq --argjson enabled "$enabled" '.auto_update_lists = $enabled' "$SETTINGS_FILE" > "$tmp_file" 2>/dev/null
    
    # Validate output is valid JSON before overwriting
    if [ -s "$tmp_file" ] && jq empty "$tmp_file" 2>/dev/null; then
        mv "$tmp_file" "$SETTINGS_FILE"
        log_action "LISTS_AUTO_UPDATE" "Auto-update $([ "$enabled" = "true" ] && echo "enabled" || echo "disabled")"
        
        # Update cron (will add/remove job based on enabled flag and current interval)
        local current_interval=$(get_cron_interval)
        [ "$current_interval" = "0" ] && current_interval="$DEFAULT_UPDATE_INTERVAL"
        update_cron_job "$enabled" "$current_interval"
        
        # Apply rules: regenerate dnsmasq and update ipset
        apply_rules_after_toggle
        
        echo "{\"success\":true,\"auto_update_enabled\":$enabled}"
    else
        rm -f "$tmp_file"
        json_error "errors.settingsSave" 500
    fi
}

# Apply rules after toggling auto_update
apply_rules_after_toggle() {
    local enabled=$(jq -r 'if .auto_update_lists == null then true else .auto_update_lists end' "$SETTINGS_FILE" 2>/dev/null)
    
    # Regenerate dnsmasq configs for domains
    regenerate_dnsmasq_configs
    
    # Restart dnsmasq
    /opt/etc/init.d/S56dnsmasq restart >/dev/null 2>&1
    
    # If auto-update disabled - flush ipsets to remove old cached IPs
    if [ "$enabled" = "false" ]; then
        # Check if local lists are also empty
        local count1=$(grep -v '^#' "$VPN_MANAGER_HOME/vpn-domains.txt" 2>/dev/null | grep -c . 2>/dev/null) || count1=0
        local count2=$(grep -v '^#' "$VPN_MANAGER_HOME/vpn-domains-udp.txt" 2>/dev/null | grep -c . 2>/dev/null) || count2=0
        [ -z "$count1" ] && count1=0
        [ -z "$count2" ] && count2=0
        
        if [ "$count1" -eq 0 ] && [ "$count2" -eq 0 ]; then
            # No local domains - flush domain ipsets
            ipset flush vpn_domains 2>/dev/null || true
            ipset flush vpn_domains_udp 2>/dev/null || true
            ipset flush vpn_domains6 2>/dev/null || true
            ipset flush vpn_domains6_udp 2>/dev/null || true
            log_action "LISTS_TOGGLE" "Auto-update disabled, no local domains - ipsets flushed"
        fi
    fi
    
    # Update ipset for subnets (S98singbox-rules will re-read files)
    /opt/etc/init.d/S98singbox-rules reload-subnets >/dev/null 2>&1
    direct_lists subnets

    # Update sing-box route rules for VPN clients (ss-server-in)
    if update_vpnclient_rules; then
        # Restart sing-box to apply new rules
        if check_singbox_running; then
            singbox_restart
        fi
    fi
}

# Regenerate dnsmasq configs for domains (similar to update_dnsmasq_for_type from domains.cgi)
regenerate_dnsmasq_configs() {
    local dnsmasq_tcpudp="/opt/etc/dnsmasq.d/vpn-domains.conf"
    local dnsmasq_udponly="/opt/etc/dnsmasq.d/vpn-domains-udp.conf"
    local domains_tcpudp="$VPN_MANAGER_HOME/vpn-domains.txt"
    local domains_udponly="$VPN_MANAGER_HOME/vpn-domains-udp.txt"
    local remote_tcpudp="$REMOTE_LISTS_DIR/tcp_udp_domains.txt"
    local remote_udponly="$REMOTE_LISTS_DIR/udp_domains.txt"
    
    # TCP+UDP domains
    > "$dnsmasq_tcpudp"
    (
        [ -f "$domains_tcpudp" ] && cat "$domains_tcpudp"
        if is_auto_update_enabled && [ -f "$remote_tcpudp" ]; then
            cat "$remote_tcpudp"
        fi
    ) | grep -v '^#' | grep -v '^$' | sed 's/[[:space:]]//g' | sed 's/^\*\.//' | sort -u | while read -r domain; do
        [ -n "$domain" ] && echo "ipset=/$domain/vpn_domains,vpn_domains6" >> "$dnsmasq_tcpudp"
    done
    
    # UDP-only domains
    > "$dnsmasq_udponly"
    (
        [ -f "$domains_udponly" ] && cat "$domains_udponly"
        if is_auto_update_enabled && [ -f "$remote_udponly" ]; then
            cat "$remote_udponly"
        fi
    ) | grep -v '^#' | grep -v '^$' | sed 's/[[:space:]]//g' | sed 's/^\*\.//' | sort -u | while read -r domain; do
        [ -n "$domain" ] && echo "ipset=/$domain/vpn_domains_udp,vpn_domains6_udp" >> "$dnsmasq_udponly"
    done

    # B1: "Russia" list set (its remote part also follows the auto-update switch)
    direct_lists dnsmasq
}

# Change update interval
set_interval() {
    local interval="$1"
    
    # Validation
    case "$interval" in
        3|6|12|24) ;;
        *)
            json_error "errors.invalidInterval" 400
            return
            ;;
    esac
    
    init_lists_settings
    
    # No longer save interval to settings.json, only to cron
    log_action "LISTS_UPDATE_INTERVAL" "Interval set to $interval hours"
    
    # Update cron (read enabled state from settings.json)
    local enabled=$(jq -r 'if .auto_update_lists == null then true else .auto_update_lists end' "$SETTINGS_FILE" 2>/dev/null)
    update_cron_job "$enabled" "$interval"
    
    echo "{\"success\":true,\"update_interval\":$interval}"
}

# Update cron job
update_cron_job() {
    local enabled="$1"
    local interval="$2"
    
    # Delete old job
    if [ -f "$CRONTAB_FILE" ]; then
        grep -v 'lists-update.sh' "$CRONTAB_FILE" > "${CRONTAB_FILE}.tmp" 2>/dev/null
        mv "${CRONTAB_FILE}.tmp" "$CRONTAB_FILE"
    fi
    
    # Add new if enabled
    if [ "$enabled" = "true" ]; then
        local cron_expr
        case "$interval" in
            3)  cron_expr="0 */3 * * *" ;;
            6)  cron_expr="0 */6 * * *" ;;
            12) cron_expr="0 */12 * * *" ;;
            24) cron_expr="0 4 * * *" ;;
            *)  cron_expr="0 4 * * *" ;;
        esac
        
        echo "$cron_expr $LISTS_UPDATE_SCRIPT update >/dev/null 2>&1" >> "$CRONTAB_FILE"
    fi
    
    # IMPORTANT: cron requires permissions 600 on crontab
    chmod 600 "$CRONTAB_FILE"
    
    # Reload cron
    /opt/etc/init.d/S10cron restart >/dev/null 2>&1 || true
}

# Get remote files content
get_remote_files() {
    local last_update=$(jq -r '.last_lists_update // null' "$SETTINGS_FILE" 2>/dev/null)

    # World set: remote-lists/*.txt; Russia set (?listset=russia): remote-lists/direct/,
    # downloaded by direct-lists.sh from the same source as direct_<file>
    local list_set="world" dir="$REMOTE_LISTS_DIR" prefix=""
    case "$QUERY_STRING" in
        *listset=russia*) list_set="russia"; dir="$REMOTE_LISTS_DIR/direct"; prefix="direct_" ;;
    esac

    # Read files
    local tcp_udp_domains=""
    local udp_domains=""
    local tcp_udp_subnets=""
    local udp_subnets=""

    [ -f "$dir/tcp_udp_domains.txt" ] && tcp_udp_domains=$(cat "$dir/tcp_udp_domains.txt" 2>/dev/null)
    [ -f "$dir/udp_domains.txt" ] && udp_domains=$(cat "$dir/udp_domains.txt" 2>/dev/null)
    [ -f "$dir/tcp_udp_subnets.txt" ] && tcp_udp_subnets=$(cat "$dir/tcp_udp_subnets.txt" 2>/dev/null)
    [ -f "$dir/udp_subnets.txt" ] && udp_subnets=$(cat "$dir/udp_subnets.txt" 2>/dev/null)
    
    # Count lines
    # grep -c prints 0 and fails on an empty file: "|| echo 0" would add a second 0
    # and break the JSON (the Russia set often has empty files)
    local tcp_udp_domains_count=$(echo "$tcp_udp_domains" | grep -c . 2>/dev/null)
    local udp_domains_count=$(echo "$udp_domains" | grep -c . 2>/dev/null)
    local tcp_udp_subnets_count=$(echo "$tcp_udp_subnets" | grep -c . 2>/dev/null)
    local udp_subnets_count=$(echo "$udp_subnets" | grep -c . 2>/dev/null)
    : "${tcp_udp_domains_count:=0}" "${udp_domains_count:=0}" "${tcp_udp_subnets_count:=0}" "${udp_subnets_count:=0}"
    
    # Escape for JSON
    tcp_udp_domains=$(echo "$tcp_udp_domains" | jq -Rs .)
    udp_domains=$(echo "$udp_domains" | jq -Rs .)
    tcp_udp_subnets=$(echo "$tcp_udp_subnets" | jq -Rs .)
    udp_subnets=$(echo "$udp_subnets" | jq -Rs .)
    
    local source_url=$(jq -r '.lists_source_url // empty' "$SETTINGS_FILE" 2>/dev/null)
    [ -z "$source_url" ] && source_url="$DEFAULT_LISTS_SOURCE"
    source_url=$(echo "$source_url" | sed 's/"/\\"/g')
    
    cat << EOF
{
  "last_update": $([ "$last_update" = "null" ] && echo "null" || echo "\"$last_update\""),
  "source": "$source_url",
  "list_set": "$list_set",
  "file_prefix": "$prefix",
  "files": {
    "tcp_udp_domains": {
      "content": $tcp_udp_domains,
      "count": $tcp_udp_domains_count
    },
    "udp_domains": {
      "content": $udp_domains,
      "count": $udp_domains_count
    },
    "tcp_udp_subnets": {
      "content": $tcp_udp_subnets,
      "count": $tcp_udp_subnets_count
    },
    "udp_subnets": {
      "content": $udp_subnets,
      "count": $udp_subnets_count
    }
  }
}
EOF
}

# Transfer remote lists into local files (FEAT: "перенести в локальные")
# Args: $1 = kind (domains|subnets|all), $2 = mode (replace|append)
# After transfer, auto-update is disabled (user takes ownership of the lists).
transfer_to_local() {
    local kind="$1"
    local mode="$2"
    
    case "$kind" in
        domains|subnets|all) ;;
        *) json_error "errors.invalidValue" 400; return ;;
    esac
    
    case "$mode" in
        replace|append) ;;
        *) json_error "errors.invalidValue" 400; return ;;
    esac
    
    # remote_file:local_file pairs, both list sets (B1): the World files and the second
    # set's direct_* files. Auto-update is switched off below for both sets, so the
    # second set must be copied too, or its downloaded entries would be dropped.
    local R="$REMOTE_LISTS_DIR" H="$VPN_MANAGER_HOME" D="$REMOTE_LISTS_DIR/direct"
    local domain_pairs="$R/tcp_udp_domains.txt:$H/vpn-domains.txt $R/udp_domains.txt:$H/vpn-domains-udp.txt $D/tcp_udp_domains.txt:$H/direct-domains.txt $D/udp_domains.txt:$H/direct-domains-udp.txt"
    local subnet_pairs="$R/tcp_udp_subnets.txt:$H/vpn-subnets.txt $R/udp_subnets.txt:$H/vpn-subnets-udp.txt $D/tcp_udp_subnets.txt:$H/direct-subnets.txt $D/udp_subnets.txt:$H/direct-subnets-udp.txt"
    local pairs=""
    if [ "$kind" = "domains" ]; then
        pairs="$domain_pairs"
    elif [ "$kind" = "subnets" ]; then
        pairs="$subnet_pairs"
    else
        pairs="$domain_pairs $subnet_pairs"
    fi
    
    local total_transferred=0
    local files_processed=0
    local missing_remote=0
    
    for pair in $pairs; do
        local remote_file=$(echo "$pair" | cut -d: -f1)
        local local_file=$(echo "$pair" | cut -d: -f2)
        
        if [ ! -f "$remote_file" ]; then
            missing_remote=$((missing_remote + 1))
            continue
        fi
        
        mkdir -p "$(dirname "$local_file")"
        
        # Backup local file before mutation
        if [ -f "$local_file" ] && [ -s "$local_file" ]; then
            local backup_dir="$VPN_MANAGER_HOME/backups"
            mkdir -p "$backup_dir"
            local backup_name="$(basename "$local_file" .txt)_pre_transfer_$(date +%Y%m%d_%H%M%S).bak"
            cp "$local_file" "$backup_dir/$backup_name"
            ls -1t "$backup_dir/$(basename "$local_file" .txt)_pre_transfer_"*.bak 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null
        fi
        
        if [ "$mode" = "replace" ]; then
            cp "$remote_file" "$local_file"
        else
            # Append: merge then dedupe (keep comments + valid entries)
            local tmp_merged=$(mktemp)
            {
                [ -f "$local_file" ] && cat "$local_file"
                echo ""
                echo "# Transferred from remote on $(date '+%Y-%m-%d %H:%M:%S')"
                cat "$remote_file"
            } > "$tmp_merged"
            mv "$tmp_merged" "$local_file"
        fi
        
        chmod 644 "$local_file"
        local cnt=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$local_file" 2>/dev/null | tr -d ' \n\r' || echo 0)
        [ -z "$cnt" ] && cnt=0
        total_transferred=$((total_transferred + cnt))
        files_processed=$((files_processed + 1))
    done
    
    if [ "$files_processed" = "0" ]; then
        json_error "errors.noRemoteFiles" 404
        return
    fi
    
    # Disable auto-update — user now owns the lists locally
    init_lists_settings
    local tmp_set=$(mktemp)
    jq '.auto_update_lists = false' "$SETTINGS_FILE" > "$tmp_set" 2>/dev/null
    if [ -s "$tmp_set" ] && jq empty "$tmp_set" 2>/dev/null; then
        mv "$tmp_set" "$SETTINGS_FILE"
    else
        rm -f "$tmp_set"
    fi
    update_cron_job "false" "$DEFAULT_UPDATE_INTERVAL"
    
    # Re-apply routing rules so the freshly-merged local lists become effective immediately
    apply_rules_after_toggle
    
    log_action "LISTS_TRANSFER" "kind=$kind mode=$mode files=$files_processed entries=$total_transferred"
    echo "{\"success\":true,\"kind\":\"$kind\",\"mode\":\"$mode\",\"files_processed\":$files_processed,\"missing_remote\":$missing_remote,\"total_entries\":$total_transferred,\"auto_update_disabled\":true}"
}

# Manual update lists
trigger_update() {
    # Check script exists
    if [ ! -x "$LISTS_UPDATE_SCRIPT" ]; then
        json_error "errors.updateScriptNotFound" 500
        return
    fi
    
    # Start update
    log_action "LISTS_MANUAL_UPDATE" "Manual update triggered"
    
    # Start in background and return status
    local output=$("$LISTS_UPDATE_SCRIPT" update 2>&1)
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        local last_update=$(jq -r '.last_lists_update // null' "$SETTINGS_FILE" 2>/dev/null)
        local domains_count=0
        local subnets_count=0
        [ -f "$REMOTE_LISTS_DIR/tcp_udp_domains.txt" ] && domains_count=$(wc -l < "$REMOTE_LISTS_DIR/tcp_udp_domains.txt" 2>/dev/null | tr -d ' ')
        [ -f "$REMOTE_LISTS_DIR/tcp_udp_subnets.txt" ] && subnets_count=$(wc -l < "$REMOTE_LISTS_DIR/tcp_udp_subnets.txt" 2>/dev/null | tr -d ' ')
        echo "{\"success\":true,\"message\":\"Update completed\",\"last_update\":\"$last_update\",\"domains\":$domains_count,\"subnets\":$subnets_count}"
    else
        local safe_output=$(echo "$output" | tr -d '"' | tr '\n' ' ' | head -c 200)
        echo "{\"success\":false,\"message\":\"$safe_output\"}"
    fi
}

# =============================================================================
# Request routing
# =============================================================================

# Determine method and path
METHOD="$REQUEST_METHOD"
# Extract action from PATH_INFO
ACTION=$(echo "$PATH_INFO" | sed 's|^/||' | cut -d'/' -f1)

case "$METHOD" in
    GET)
        case "$ACTION" in
            status|"")
                json_response
                get_status
                ;;
            files)
                # Get remote files content
                json_response
                get_remote_files
                ;;
            toggle)
                # Enable/disable auto-update via query string: ?enabled=true or ?enabled=false
                ENABLED=$(echo "$QUERY_STRING" | sed -n 's/.*enabled=\([^&]*\).*/\1/p')
                if [ "$ENABLED" != "true" ] && [ "$ENABLED" != "false" ]; then
                    json_error "errors.enabledRequired" 400
                else
                    json_response
                    toggle_auto_update "$ENABLED"
                fi
                ;;
            interval)
                # Change interval via query string: ?interval=24
                INTERVAL=$(echo "$QUERY_STRING" | sed -n 's/.*interval=\([0-9]*\).*/\1/p')
                if [ -z "$INTERVAL" ]; then
                    json_error "errors.intervalRequired" 400
                else
                    json_response
                    set_interval "$INTERVAL"
                fi
                ;;
            *)
                json_error "Unknown action: $ACTION" 404
                ;;
        esac
        ;;
    POST)
        case "$ACTION" in
            update)
                # Manual update
                json_response
                trigger_update
                ;;
            transfer)
                # Transfer remote lists into local files (and disable auto-update)
                # Body: {"kind":"domains|subnets|all","mode":"replace|append"}
                POST_DATA=$(read_post_data)
                KIND=$(echo "$POST_DATA" | jq -r '.kind // "domains"')
                MODE=$(echo "$POST_DATA" | jq -r '.mode // "append"')
                json_response
                transfer_to_local "$KIND" "$MODE"
                ;;
            *)
                json_error "Unknown action: $ACTION" 404
                ;;
        esac
        ;;
    *)
        json_error "Method not allowed" 405
        ;;
esac
