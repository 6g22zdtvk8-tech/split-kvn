#!/bin/sh
# Delayed Keenetic setup via RCI API (port 79) with ndmc fallback
# Started via cron every minute until successful execution
# All logging via syslog

export PATH=/opt/sbin:/opt/bin:/usr/sbin:/usr/bin:/sbin:/bin

SCRIPT_NAME="ndmc-postinstall.sh"
MARKER_FILE="/opt/etc/.ndmc-postinstall-done"
RCI_URL="http://127.0.0.1:79/rci"

log() {
    logger -t ndmc-postinstall "$1"
}

keenetic_cmd() {
    local cmd="$1"
    local result
    result=$(curl -s --connect-timeout 2 --max-time 5 -X POST "$RCI_URL/" \
        -H "Content-Type: application/json" \
        -d "[{\"parse\": \"$cmd\"}]" 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$result" ]; then
        return 0
    fi
    ndmc -c "$cmd" 2>/dev/null
}

# If already done — remove from cron and exit
if [ -f "$MARKER_FILE" ]; then
    crontab -l 2>/dev/null | grep -v "$SCRIPT_NAME" | crontab -
    exit 0
fi

log "=== Starting $SCRIPT_NAME ==="

# Check readiness: try RCI first, then ndmc
if curl -s --connect-timeout 2 --max-time 3 "$RCI_URL/show/version" >/dev/null 2>&1; then
    log "RCI API ready"
elif ndmc -c 'show version' >/dev/null 2>&1; then
    log "ndmc ready (RCI unavailable)"
else
    log "Neither RCI nor ndmc ready, will retry in a minute"
    exit 0
fi

# === Disable IPv6 ===
log "Disabling IPv6..."
keenetic_cmd 'interface ISP no ipv6 address auto' 2>&1 | logger -t ndmc-postinstall
keenetic_cmd 'interface ISP no ipv6 prefix auto' 2>&1 | logger -t ndmc-postinstall
keenetic_cmd 'interface ISP no ipv6 name-servers auto' 2>&1 | logger -t ndmc-postinstall
keenetic_cmd 'no ipv6 subnet Default' 2>&1 | logger -t ndmc-postinstall
keenetic_cmd 'no ipv6 local-prefix default' 2>&1 | logger -t ndmc-postinstall

# === Open port 8388 ===
log "Opening port 8388..."
keenetic_cmd 'ip static tcpudp ISP 8388 127.0.0.1 !8388' 2>&1 | logger -t ndmc-postinstall

# === Save configuration ===
log "Saving..."
keenetic_cmd 'system configuration save' 2>&1 | logger -t ndmc-postinstall

sleep 2

# === Check: is 8388 in config? ===
log "Checking..."
check_result=$(curl -s --connect-timeout 2 --max-time 5 "$RCI_URL/ip/static" 2>/dev/null)
if [ -n "$check_result" ] && echo "$check_result" | grep -q '8388'; then
    log "OK: Port 8388 found in config (RCI)"
    touch "$MARKER_FILE"
    crontab -l 2>/dev/null | grep -v "$SCRIPT_NAME" | crontab -
    log "Script removed from crontab"
    
    if [ -x /opt/etc/init.d/S98singbox-rules ]; then
        log "Updating segments cache..."
        /opt/etc/init.d/S98singbox-rules update-cache 2>&1 | logger -t ndmc-postinstall
    fi
elif ndmc -c 'show running-config' 2>/dev/null | grep -q '8388'; then
    log "OK: Port 8388 found in config (ndmc)"
    touch "$MARKER_FILE"
    crontab -l 2>/dev/null | grep -v "$SCRIPT_NAME" | crontab -
    log "Script removed from crontab"
    
    if [ -x /opt/etc/init.d/S98singbox-rules ]; then
        log "Updating segments cache..."
        /opt/etc/init.d/S98singbox-rules update-cache 2>&1 | logger -t ndmc-postinstall
    fi
else
    log "WARN: Port 8388 not found, will retry in a minute"
fi

log "=== Done ==="
