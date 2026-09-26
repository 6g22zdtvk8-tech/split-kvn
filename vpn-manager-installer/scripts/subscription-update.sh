#!/bin/sh
# VPN subscription auto-update script
# Started from cron - all logging via syslog

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"

VPN_MANAGER_HOME="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}"
SUBSCRIPTIONS_FILE="$VPN_MANAGER_HOME/subscriptions.json"
VPN_CONFIGS_DIR="$VPN_MANAGER_HOME/configs"
ROUTER_HWID_FILE="$VPN_MANAGER_HOME/router-hwid"

# Logging via syslog
log() {
    logger -t subscription-update "$1"
}

# Get or generate persistent router HWID
get_router_hwid() {
    if [ -f "$ROUTER_HWID_FILE" ] && [ -s "$ROUTER_HWID_FILE" ]; then
        cat "$ROUTER_HWID_FILE"
        return 0
    fi
    local hwid
    hwid=$(cat /dev/urandom 2>/dev/null | tr -dc 'a-f0-9' | head -c 16)
    [ -z "$hwid" ] && hwid=$(date +%s | md5sum 2>/dev/null | head -c 16)
    [ -z "$hwid" ] && hwid="vpnmanager000001"
    mkdir -p "$(dirname "$ROUTER_HWID_FILE")"
    echo "$hwid" > "$ROUTER_HWID_FILE"
    echo "$hwid"
}

# Check if content is a stub (dummy response with 0.0.0.0 server)
is_stub_content() {
    local content="$1"
    local trimmed=$(echo "$content" | tr -d '[:space:]')
    [ -z "$trimmed" ] && return 0
    local decoded
    decoded=$(echo "$trimmed" | base64 -d 2>/dev/null)
    echo "$decoded" | grep -q '@0\.0\.0\.0:' && return 0
    return 1
}

# Check subscriptions file
if [ ! -f "$SUBSCRIPTIONS_FILE" ]; then
    exit 0
fi

log "=== Starting subscription update check ==="

# Get current time in hours since epoch
CURRENT_HOUR=$(( $(date +%s) / 3600 ))

# Process each subscription with auto_update=true
jq -c '.subscriptions[] | select(.auto_update == true)' "$SUBSCRIPTIONS_FILE" 2>/dev/null | while read -r sub; do
    SUB_ID=$(echo "$sub" | jq -r '.id')
    SUB_NAME=$(echo "$sub" | jq -r '.name')
    SUB_URL=$(echo "$sub" | jq -r '.url')
    UPDATE_INTERVAL=$(echo "$sub" | jq -r '.update_interval // 3')
    UPDATED_AT=$(echo "$sub" | jq -r '.updated_at // ""')
    
    # Calculate when next update
    if [ -n "$UPDATED_AT" ]; then
        # Convert updated_at to timestamp
        # BusyBox/Entware date rejects ISO "2026-09-13T12:00:04"; without the T it parses.
        # A parse failure made every subscription look overdue and refresh hourly.
        UPDATED_TS=$(date -d "$(echo "$UPDATED_AT" | tr 'T' ' ')" +%s 2>/dev/null || echo 0)
        UPDATED_HOUR=$(( UPDATED_TS / 3600 ))
        HOURS_SINCE_UPDATE=$(( CURRENT_HOUR - UPDATED_HOUR ))
        
        if [ "$HOURS_SINCE_UPDATE" -lt "$UPDATE_INTERVAL" ]; then
            log "[$SUB_NAME] Skip: updated $HOURS_SINCE_UPDATE hours ago, interval is $UPDATE_INTERVAL hours"
            continue
        fi
    fi
    
    log "[$SUB_NAME] Updating subscription..."
    
    # Normalize URL (ssconf:// -> https://)
    case "$SUB_URL" in
        ssconf://*)
            FETCH_URL="https://${SUB_URL#ssconf://}"
            ;;
        *)
            FETCH_URL="$SUB_URL"
            ;;
    esac
    
    # Download subscription — direct first, then via VPN SOCKS5 if direct fails.
    # If the response is a stub (HWID-protected subscription), retry with Happ UA + router HWID.
    ROUTER_HWID=$(get_router_hwid)
    HAPP_UA="Happ/4.9.0/linux/$ROUTER_HWID"
    USED_VPN=0

    CONTENT=$(curl -sL --connect-timeout 10 --max-time 30 \
                   -H "User-Agent: VPN-Manager/1.0" \
                   "$FETCH_URL" 2>/dev/null)

    # If stub response — retry with Happ UA + router HWID
    if [ -n "$CONTENT" ] && is_stub_content "$CONTENT"; then
        log "[$SUB_NAME] Stub response, retrying with Happ UA + router HWID..."
        CONTENT=$(curl -sL --connect-timeout 10 --max-time 30 \
                       -H "User-Agent: $HAPP_UA" \
                       -H "x-hwid: $ROUTER_HWID" \
                       "$FETCH_URL" 2>/dev/null)
    fi

    if [ -z "$CONTENT" ] && [ -f "$VPN_MANAGER_HOME/active-config" ] && [ -s "$VPN_MANAGER_HOME/active-config" ]; then
        log "[$SUB_NAME] Direct fetch failed, trying via VPN SOCKS5..."
        CONTENT=$(curl -sL --connect-timeout 15 --max-time 45 \
                       --socks5-hostname 127.0.0.1:2080 \
                       -H "User-Agent: VPN-Manager/1.0" \
                       "$FETCH_URL" 2>/dev/null)
        if [ -n "$CONTENT" ] && is_stub_content "$CONTENT"; then
            log "[$SUB_NAME] Stub via VPN, retrying with Happ UA + router HWID..."
            CONTENT=$(curl -sL --connect-timeout 15 --max-time 45 \
                           --socks5-hostname 127.0.0.1:2080 \
                           -H "User-Agent: $HAPP_UA" \
                           -H "x-hwid: $ROUTER_HWID" \
                           "$FETCH_URL" 2>/dev/null)
        fi
        [ -n "$CONTENT" ] && USED_VPN=1
    fi

    if [ -z "$CONTENT" ]; then
        log "[$SUB_NAME] ERROR: Failed to fetch subscription (direct and VPN both failed)"
        continue
    fi
    
    [ "$USED_VPN" = "1" ] && log "[$SUB_NAME] Fetched via VPN SOCKS5 fallback"
    
    # Decode if base64
    TRIMMED=$(echo "$CONTENT" | tr -d '[:space:]')
    if echo "$TRIMMED" | grep -qE '^[A-Za-z0-9+/=]+$'; then
        DECODED=$(echo "$TRIMMED" | base64 -d 2>/dev/null)
        if [ -n "$DECODED" ] && echo "$DECODED" | grep -qE '^(ss|vless|vmess|trojan|wireguard)://'; then
            CONTENT="$DECODED"
        fi
    fi
    
    # Count servers
    NEW_COUNT=0

    # Check SIP008 format
    if echo "$CONTENT" | jq -e '.servers' >/dev/null 2>&1; then
        NEW_COUNT=$(echo "$CONTENT" | jq '.servers | length' 2>/dev/null || echo 0)
    elif echo "$CONTENT" | grep -q "^proxies:"; then
        # Clash YAML format — count proxy entries by "- name:" or "- type:" markers
        NEW_COUNT=$(echo "$CONTENT" | grep -cE '^\s*-\s*(name|type):' || echo 0)
    else
        # Count lines with valid protocol URIs
        NEW_COUNT=$(echo "$CONTENT" | grep -cE '^(ss|vless|vmess|trojan|wireguard)://' || echo 0)
    fi

    case "$NEW_COUNT" in ''|*[!0-9]*) NEW_COUNT=0 ;; esac
    if [ "$NEW_COUNT" -eq 0 ]; then
        log "[$SUB_NAME] ERROR: No servers found in response, keeping existing servers"
        continue
    fi
    
    log "[$SUB_NAME] Found $NEW_COUNT servers, calling API to refresh..."
    
    # Run the panel's refresh directly as a process, not over HTTP: it works with the
    # panel password on, and no network client can pose as this internal call.
    # The CGI prints HTTP headers first; drop them up to the blank line.
    REFRESH_RESULT=$(VPN_MANAGER_INTERNAL=1 REMOTE_ADDR= REQUEST_METHOD=POST \
                     PATH_INFO="/$SUB_ID/refresh" QUERY_STRING= CONTENT_LENGTH=0 \
                     sh /opt/share/www/vpn-manager/api/subscriptions.cgi </dev/null 2>/dev/null \
                     | sed '1,/^\r*$/d')
    
    if echo "$REFRESH_RESULT" | grep -q '"success":true'; then
        log "[$SUB_NAME] SUCCESS: Subscription updated with $NEW_COUNT servers"
    else
        ERROR_MSG=$(echo "$REFRESH_RESULT" | jq -r '.error // "unknown error"' 2>/dev/null)
        log "[$SUB_NAME] ERROR: $ERROR_MSG"
    fi
done

log "=== Subscription update check completed ==="
