#!/bin/sh
# =============================================================================
# Logs API — view and manage unified syslog
# All logs are in /opt/var/log/syslog, filtered by tag
# =============================================================================

# Include common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Unified syslog file. It lives in RAM (S00log-ram); /opt/var/log/messages is a
# symlink to it. Installs from before S00log-ram still keep it on the drive.
SYSLOG_FILE="/tmp/log/messages"
[ -f "$SYSLOG_FILE" ] || SYSLOG_FILE="/opt/var/log/messages"

# Available log tags (for filtering)
LOG_TAGS="sing-box singbox-boot singbox-rules vpn-manager vpn-manager-autoinstall vpn-manager-installer vpn-manager-api subscription-update lists-update ndmc-postinstall syslog-rotate lighttpd net-diag"

# Maximum lines to output
MAX_LINES=200

# Syslog rotation script
SYSLOG_ROTATE_SCRIPT="/opt/bin/syslog-rotate.sh"

# =============================================================================
# Functions
# =============================================================================

get_log_list() {
    local total_size=0
    local syslog_size=0
    local syslog_lines=0
    local syslog_modified=0
    
    if [ -f "$SYSLOG_FILE" ]; then
        syslog_size=$(stat -c %s "$SYSLOG_FILE" 2>/dev/null || echo "0")
        syslog_lines=$(wc -l < "$SYSLOG_FILE" 2>/dev/null || echo "0")
        syslog_modified=$(stat -c %Y "$SYSLOG_FILE" 2>/dev/null || echo "0")
        total_size=$syslog_size
    fi
    
    local first="true"
    
    printf '{"logs":['
    
    # Main syslog entry
    printf '{"name":"syslog","path":"%s","exists":%s,"size":%s,"lines":%s,"modified":%s}' \
        "$SYSLOG_FILE" \
        "$([ -f "$SYSLOG_FILE" ] && echo "true" || echo "false")" \
        "$syslog_size" \
        "$syslog_lines" \
        "$syslog_modified"
    
    # Virtual entries for each tag (show line counts)
    for tag in $LOG_TAGS; do
        local count=0
        if [ -f "$SYSLOG_FILE" ]; then
            count=$(grep -c "$tag" "$SYSLOG_FILE" 2>/dev/null | tr -d '\n\r' || echo "0")
        fi
        # Ensure count is a valid number
        [ -z "$count" ] && count=0
        
        printf ',{"name":"%s","path":"%s","exists":true,"size":0,"lines":%d,"is_filter":true}' \
            "$tag" "$SYSLOG_FILE" "$count"
    done
    
    printf '],"total_size":%s,"syslog_lines":%s}' "$total_size" "$syslog_lines"
}

get_log_content() {
    local log_name="$1"
    local lines="${2:-$MAX_LINES}"
    
    if [ ! -f "$SYSLOG_FILE" ]; then
        printf '{"name":"%s","exists":false,"content":"Syslog file does not exist","lines":0}' "$log_name"
        return
    fi
    
    local total_lines=0
    local size=0
    
    if command -v stat >/dev/null 2>&1; then
        size=$(stat -c %s "$SYSLOG_FILE" 2>/dev/null | tr -d ' \n\r' || echo "0")
    else
        size=$(ls -l "$SYSLOG_FILE" 2>/dev/null | awk '{print $5}' | tr -d ' \n\r' || echo "0")
    fi
    [ -z "$size" ] && size=0
    
    if [ "$log_name" = "syslog" ] || [ "$log_name" = "all" ]; then
        total_lines=$(wc -l < "$SYSLOG_FILE" 2>/dev/null | tr -d ' \n\r' || echo "0")
        [ -z "$total_lines" ] && total_lines=0
        
        tail -n "$lines" "$SYSLOG_FILE" 2>/dev/null | \
            tr -d '\000-\010\013-\037\177' | \
            sed 's/\[[0-9;]*[mKHJ]//g' | \
            jq -Rs --arg name "$log_name" --arg path "$SYSLOG_FILE" \
                --argjson lines "$lines" --argjson total_lines "$total_lines" --argjson size "$size" \
                '{name: $name, path: $path, exists: true, content: ., lines: $lines, total_lines: $total_lines, size: $size}'
    else
        total_lines=$(grep -c "$log_name" "$SYSLOG_FILE" 2>/dev/null | tr -d ' \n\r' || echo "0")
        [ -z "$total_lines" ] && total_lines=0
        
        grep "$log_name" "$SYSLOG_FILE" 2>/dev/null | tail -n "$lines" | \
            tr -d '\000-\010\013-\037\177' | \
            sed 's/\[[0-9;]*[mKHJ]//g' | \
            jq -Rs --arg name "$log_name" --arg path "$SYSLOG_FILE" \
                --argjson lines "$lines" --argjson total_lines "$total_lines" --argjson size "$size" \
                '{name: $name, path: $path, exists: true, content: ., lines: $lines, total_lines: $total_lines, size: $size}'
    fi
}

clear_syslog() {
    if [ -f "$SYSLOG_FILE" ]; then
        # Truncate in place: syslog-ng keeps appending to the same file, and the
        # symlink on the drive keeps pointing at it
        : > "$SYSLOG_FILE"
        
        # Сигнал syslog-ng для переоткрытия файлов (стандартный механизм)
        if [ -f /opt/var/run/syslog-ng.pid ]; then
            kill -HUP $(cat /opt/var/run/syslog-ng.pid) 2>/dev/null || true
        fi
        
        # Небольшая пауза чтобы syslog-ng успел переоткрыть файл
        sleep 1
        
        vpn_log "INFO" "Syslog cleared via UI" "vpn-manager"
        json_success '{"message":"Syslog cleared"}'
    else
        json_error "Syslog file does not exist" 404
    fi
}

rotate_syslog() {
    local rotated=false
    
    if [ -x "$SYSLOG_ROTATE_SCRIPT" ]; then
        "$SYSLOG_ROTATE_SCRIPT" >/dev/null 2>&1
        rotated=true
    elif [ -f "$SYSLOG_FILE" ]; then
        # Fallback: manual rotation
        local lines=$(wc -l < "$SYSLOG_FILE" 2>/dev/null || echo 0)
        if [ "$lines" -gt 2000 ]; then
            tail -n 2000 "$SYSLOG_FILE" > "${SYSLOG_FILE}.tmp" && cat "${SYSLOG_FILE}.tmp" > "$SYSLOG_FILE"
            rm -f "${SYSLOG_FILE}.tmp"
            rotated=true
        fi
    fi
    
    if [ "$rotated" = "true" ]; then
        # Сигнал syslog-ng для переоткрытия файлов
        if [ -f /opt/var/run/syslog-ng.pid ]; then
            kill -HUP $(cat /opt/var/run/syslog-ng.pid) 2>/dev/null || true
        fi
        sleep 1
        vpn_log "INFO" "Syslog rotated via UI" "vpn-manager"
    fi
    
    json_success '{"message":"Syslog rotated"}'
}

# =============================================================================
# Process requests
# =============================================================================

PATH_INFO="${PATH_INFO:-}"
ACTION=$(echo "$PATH_INFO" | cut -d'/' -f2)
PARAM=$(echo "$PATH_INFO" | cut -d'/' -f3)

case "$REQUEST_METHOD" in
    GET)
        # Whole log as a text file: it lives in RAM and is gone after a reboot
        if [ "$ACTION" = "download" ]; then
            echo "Content-Type: text/plain; charset=utf-8"
            echo "Content-Disposition: attachment; filename=\"router-log-$(date +%Y%m%d-%H%M%S).txt\""
            echo "Cache-Control: no-store"
            echo ""
            [ -f "$SYSLOG_FILE" ] && tr -d '\000-\010\013-\037\177' < "$SYSLOG_FILE" | sed 's/\[[0-9;]*[mKHJ]//g'
            exit 0
        fi

        # Output HTTP headers
        echo "Content-Type: application/json"
        echo ""
        
        case "$ACTION" in
            ""|list)
                # List available log filters with sizes
                printf '{"success":true,"data":'
                get_log_list
                printf '}'
                ;;
            *)
                # Get content of specific log (or filter by tag)
                LINES=$(echo "$QUERY_STRING" | grep -oE 'lines=[0-9]+' | cut -d= -f2)
                get_log_content "$ACTION" "${LINES:-$MAX_LINES}"
                ;;
        esac
        ;;
        
    POST)
        case "$ACTION" in
            clear|clear-all)
                # Clear syslog
                clear_syslog
                ;;
            rotate)
                # Rotate syslog
                rotate_syslog
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
