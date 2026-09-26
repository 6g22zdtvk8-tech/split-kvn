#!/bin/sh
# API for managing IP subnet lists for VPN routing
# Support for two types: TCP+UDP and UDP-only

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

# Authorization check
if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Subnet files
SUBNETS_TCPUDP_FILE="$VPN_MANAGER_HOME/vpn-subnets.txt"
SUBNETS_UDPONLY_FILE="$VPN_MANAGER_HOME/vpn-subnets-udp.txt"

# Remote lists (FEAT-011)
REMOTE_SUBNETS_TCPUDP="$VPN_MANAGER_HOME/remote-lists/tcp_udp_subnets.txt"
REMOTE_SUBNETS_UDPONLY="$VPN_MANAGER_HOME/remote-lists/udp_subnets.txt"

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

# Get remote file by type
get_remote_subnets_file() {
    local type="$1"
    if [ "$type" = "udponly" ]; then
        echo "$REMOTE_SUBNETS_UDPONLY"
    else
        echo "$REMOTE_SUBNETS_TCPUDP"
    fi
}

# Get type from query string
get_subnet_type() {
    echo "$QUERY_STRING" | sed -n 's/.*type=\([^&]*\).*/\1/p'
}

# Get file by type
get_subnets_file() {
    local type="$1"
    if [ "$type" = "udponly" ]; then
        echo "$SUBNETS_UDPONLY_FILE"
    else
        echo "$SUBNETS_TCPUDP_FILE"
    fi
}

# Get ipset name by type
get_ipset_name() {
    local type="$1"
    if [ "$type" = "udponly" ]; then
        echo "vpn_subnets_udp"
    else
        echo "vpn_subnets"
    fi
}

# Get IPv6 ipset name by type
get_ipset6_name() {
    local type="$1"
    if [ "$type" = "udponly" ]; then
        echo "vpn_subnets6_udp"
    else
        echo "vpn_subnets6"
    fi
}

# Validate CIDR subnet
validate_cidr() {
    local line="$1"
    
    # Skip empty lines and comments
    [ -z "$(echo "$line" | tr -d '[:space:]')" ] && return 0
    echo "$line" | grep -qE '^[[:space:]]*#' && return 0
    
    # IPv4 CIDR
    if echo "$line" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$'; then
        return 0
    fi
    
    # IPv6 CIDR
    if echo "$line" | grep -qE '^[0-9a-fA-F:]+/[0-9]{1,3}$'; then
        return 0
    fi
    
    return 1
}

# Update ipset from subnets file (FEAT-011: with remote-lists support)
update_ipset_for_type() {
    local type="$1"
    local subnets_file=$(get_subnets_file "$type")
    local remote_file=$(get_remote_subnets_file "$type")
    local ipset_name=$(get_ipset_name "$type")
    local ipset6_name=$(get_ipset6_name "$type")
    
    # Create ipset if not exists
    # No timeout: subnets stay until removed. With "timeout 86400" (B11) a subnet added
    # in the panel dropped out after a day until the rules were rebuilt; S98singbox-rules
    # creates these sets without one too
    ipset create $ipset_name hash:net 2>/dev/null || true
    ipset create $ipset6_name hash:net family inet6 2>/dev/null || true
    
    # Flush current entries
    ipset flush $ipset_name 2>/dev/null || true
    ipset flush $ipset6_name 2>/dev/null || true
    
    local count=0
    
    # Merge local + remote (if enabled), remove comments and duplicates
    (
        [ -f "$subnets_file" ] && cat "$subnets_file"
        # Remote files used only if auto-update is enabled
        if is_auto_update_enabled && [ -f "$remote_file" ]; then
            cat "$remote_file"
        fi
    ) | grep -v '^#' | grep -v '^$' | tr -d '[:space:]' | sort -u | while IFS= read -r subnet; do
        [ -z "$subnet" ] && continue
        
        # IPv4
        if echo "$subnet" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$'; then
            ipset add $ipset_name "$subnet" 2>/dev/null && count=$((count + 1))
        # IPv6
        elif echo "$subnet" | grep -qE '^[0-9a-fA-F:]+/[0-9]{1,3}$'; then
            ipset add $ipset6_name "$subnet" 2>/dev/null && count=$((count + 1))
        fi
    done
    
    # Get total entries count from ipset
    local total=$(ipset list $ipset_name 2>/dev/null | grep -c '^[0-9]')
    local total6=$(ipset list $ipset6_name 2>/dev/null | grep -c '^[0-9a-fA-F]')
    echo $((total + total6))
    return 0
}

# List set (B1): "world" (default, the lists above) or "russia" (?listset=russia).
# The Russia set has its own files and ipsets, loaded by direct-lists.sh without a gap.
LIST_SET=$(echo "$QUERY_STRING" | sed -n 's/.*listset=\([a-z]*\).*/\1/p')
if [ "$LIST_SET" = "russia" ]; then
    SUBNETS_TCPUDP_FILE="$VPN_MANAGER_HOME/direct-subnets.txt"
    SUBNETS_UDPONLY_FILE="$VPN_MANAGER_HOME/direct-subnets-udp.txt"
    # Prints the number of entries now in the set, like the World version
    update_ipset_for_type() {
        local s4=direct_subnets s6=direct_subnets6
        [ "$1" = "udponly" ] && s4=direct_subnets_udp s6=direct_subnets6_udp
        direct_lists subnets
        echo $(( $(ipset list $s4 2>/dev/null | grep -c '^[0-9]') + $(ipset list $s6 2>/dev/null | grep -c '^[0-9a-fA-F]*:') ))
    }
fi

ACTION=$(echo "$PATH_INFO" | sed 's/^\///' | cut -d'/' -f1)
SUBNET_TYPE=$(get_subnet_type)
[ -z "$SUBNET_TYPE" ] && SUBNET_TYPE="tcpudp"

case "$REQUEST_METHOD" in
    GET)
        case "$ACTION" in
            ""|list)
                # Get subnets list content
                SUBNETS_FILE=$(get_subnets_file "$SUBNET_TYPE")
                
                if [ -f "$SUBNETS_FILE" ]; then
                    LINES=$(wc -l < "$SUBNETS_FILE")
                    SUBNETS_COUNT=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$SUBNETS_FILE" 2>/dev/null || echo 0)
                    
                    echo "Content-Type: application/json"
                    echo ""
                    # jq, not awk: busybox awk on the router does not escape quotes (B11)
                    jq -R -s -c --arg t "$SUBNET_TYPE" --arg f "$SUBNETS_FILE" \
                        --arg lines "$LINES" --arg n "$SUBNETS_COUNT" \
                        'def num($v): ($v | split("\n")[0] | ltrimstr(" ") | if . == "" then 0 else tonumber end);
                         {success: true, data: {type: $t, content: ., lines: num($lines),
                          subnets_count: num($n), file: $f}}' "$SUBNETS_FILE"
                else
                    json_success "{\"type\":\"$SUBNET_TYPE\",\"content\":\"\",\"lines\":0,\"subnets_count\":0,\"file\":\"$SUBNETS_FILE\",\"exists\":false}"
                fi
                ;;
                
            stats)
                # Statistics for both types
                TCPUDP_COUNT=0
                UDPONLY_COUNT=0
                IPSET_TCPUDP=0
                IPSET_UDPONLY=0
                
                if [ -f "$SUBNETS_TCPUDP_FILE" ]; then
                    TCPUDP_COUNT=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$SUBNETS_TCPUDP_FILE" 2>/dev/null || echo 0)
                fi
                
                if [ -f "$SUBNETS_UDPONLY_FILE" ]; then
                    UDPONLY_COUNT=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$SUBNETS_UDPONLY_FILE" 2>/dev/null || echo 0)
                fi
                
                IPSET_TCPUDP=$(ipset list vpn_subnets 2>/dev/null | grep -c '^[0-9]' || echo 0)
                IPSET_UDPONLY=$(ipset list vpn_subnets_udp 2>/dev/null | grep -c '^[0-9]' || echo 0)
                
                json_success "{\"tcpudp\":{\"subnets\":$TCPUDP_COUNT,\"ipset_entries\":$IPSET_TCPUDP},\"udponly\":{\"subnets\":$UDPONLY_COUNT,\"ipset_entries\":$IPSET_UDPONLY}}"
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
        [ -n "$BODY_TYPE" ] && SUBNET_TYPE="$BODY_TYPE"
        
        case "$ACTION" in
            ""|save)
                # Save subnets list
                # Use jq for reliable parsing (sed breaks on edge cases)
                CONTENT=$(echo "$POST_DATA" | jq -r '.content // ""')
                
                SUBNETS_FILE=$(get_subnets_file "$SUBNET_TYPE")
                
                # Validation: count invalid lines but DO NOT block save.
                # Invalid lines stay in the editor (so user can see/fix them),
                # but they are filtered out when populating ipset.
                INVALID_TMP="/tmp/subnets_invalid_$$"
                rm -f "$INVALID_TMP"
                
                echo "$CONTENT" | while IFS= read -r line; do
                    [ -z "$(echo "$line" | tr -d '[:space:]')" ] && continue
                    case "$line" in \#*) continue ;; esac
                    if ! validate_cidr "$line"; then
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
                if [ -f "$SUBNETS_FILE" ]; then
                    BACKUP_DIR="$VPN_MANAGER_HOME/backups"
                    mkdir -p "$BACKUP_DIR"
                    BACKUP_SUFFIX=$([ "$SUBNET_TYPE" = "udponly" ] && echo "udp" || echo "tcpudp")
                    BACKUP_FILE="$BACKUP_DIR/subnets_${BACKUP_SUFFIX}_$(date +%Y%m%d_%H%M%S).bak"
                    cp "$SUBNETS_FILE" "$BACKUP_FILE"
                    ls -1t "$BACKUP_DIR"/subnets_${BACKUP_SUFFIX}_*.bak 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null
                fi
                
                # Save
                mkdir -p "$(dirname "$SUBNETS_FILE")"
                echo "$CONTENT" > "$SUBNETS_FILE"
                
                RULES_APPLIED="false"
                SINGBOX_RESTARTED="false"
                
                # Update ipset (for LAN clients)
                LOADED=$(update_ipset_for_type "$SUBNET_TYPE")
                if [ -n "$LOADED" ]; then
                    RULES_APPLIED="true"
                fi
                
                # Update sing-box rules for VPN clients (ss-server-in)
                if update_vpnclient_rules; then
                    # Restart sing-box to apply new rules
                    if check_singbox_running; then
                        singbox_restart
                        SINGBOX_RESTARTED="true"
                    fi
                fi
                
                SUBNETS_SAVED=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#' "$SUBNETS_FILE" 2>/dev/null | tr -d '\n\r' || echo 0)
                [ -z "$SUBNETS_SAVED" ] && SUBNETS_SAVED=0
                
                log_action "SUBNETS_SAVED" "Type: $SUBNET_TYPE, Count: $SUBNETS_SAVED, Skipped: $SKIPPED_COUNT, Loaded to ipset: $LOADED, singbox_restarted: $SINGBOX_RESTARTED"
                json_success "{\"message\":\"Subnets list saved\",\"type\":\"$SUBNET_TYPE\",\"subnets_count\":$SUBNETS_SAVED,\"ipset_loaded\":$LOADED,\"rules_applied\":$RULES_APPLIED,\"singbox_restarted\":$SINGBOX_RESTARTED,\"skipped_count\":$SKIPPED_COUNT,\"skipped_sample\":\"$SKIPPED_SAMPLE\"}"
                ;;
                
            reload)
                # Reload ipset
                LOADED_TCPUDP=$(update_ipset_for_type "tcpudp")
                LOADED_UDPONLY=$(update_ipset_for_type "udponly")
                
                # Update sing-box rules for VPN clients
                SINGBOX_RESTARTED="false"
                if update_vpnclient_rules && check_singbox_running; then
                    singbox_restart
                    SINGBOX_RESTARTED="true"
                fi
                
                log_action "SUBNETS_RELOAD" "TCP+UDP: $LOADED_TCPUDP, UDP-only: $LOADED_UDPONLY, singbox_restarted: $SINGBOX_RESTARTED"
                json_success "{\"message\":\"ipset updated\",\"tcpudp_loaded\":$LOADED_TCPUDP,\"udponly_loaded\":$LOADED_UDPONLY,\"singbox_restarted\":$SINGBOX_RESTARTED}"
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

