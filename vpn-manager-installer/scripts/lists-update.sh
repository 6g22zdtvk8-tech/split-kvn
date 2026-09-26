#!/bin/sh
# FEAT-011: Auto-update domain and subnet lists
# Downloads files from GitHub repository via sing-box VPN outbound
# All logging via syslog

# Set PATH for cron compatibility
export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

# Paths
VPN_MANAGER_DIR="/opt/etc/vpn-manager"
REMOTE_LISTS_DIR="$VPN_MANAGER_DIR/remote-lists"
SETTINGS_FILE="$VPN_MANAGER_DIR/settings.json"
SINGBOX_CONFIG="/opt/etc/sing-box/config.json"

# Default remote lists source (can be overridden in settings.json)
DEFAULT_LISTS_SOURCE="https://raw.githubusercontent.com/6g22zdtvk8-tech/split-kvn-lists/main"

# Read lists source from settings (FEAT-200)
if [ -f "$SETTINGS_FILE" ]; then
    LISTS_SOURCE=$(jq -r '.lists_source_url // empty' "$SETTINGS_FILE" 2>/dev/null)
fi
[ -z "$LISTS_SOURCE" ] && LISTS_SOURCE="$DEFAULT_LISTS_SOURCE"

# Alias for backward compatibility
GITHUB_BASE="$LISTS_SOURCE"

# Files to download
REMOTE_FILES="tcp_udp_domains.txt udp_domains.txt tcp_udp_subnets.txt udp_subnets.txt"

# VPN outbound tag in sing-box
VPN_OUTBOUND="vpn"

# Download timeout per file (seconds)
DOWNLOAD_TIMEOUT=30

# Logging via syslog
log() {
    logger -t lists-update "$1"
    # Also to stdout if interactive. The if, not "&&": run from cron or the panel
    # there is no terminal, the test fails, and the script's exit code (the last
    # log line) came out 1 even after a successful update (B11)
    if [ -t 1 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    fi
}

# Validate that a string is a plain domain suitable for dnsmasq ipset directive.
# Wildcards must already be stripped by the caller (sed 's/^\*\.//;s/^\*//').
# Rejects: URLs with schemes, lines with embedded spaces or special chars,
# anything that would break dnsmasq parser and take down DNS routing.
is_valid_domain_for_dnsmasq() {
    local d="$1"
    [ -z "$d" ] && return 1
    # Plain domain: a-z, 0-9, dot, hyphen; must start/end with alphanum
    echo "$d" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$'
}

# Check if sing-box is running
check_singbox_running() {
    if ! pidof sing-box >/dev/null 2>&1; then
        log "ERROR: sing-box is not running"
        return 1
    fi
    return 0
}

# Check if there is an active VPN configuration
check_vpn_active() {
    local active_file="$VPN_MANAGER_DIR/active-config"
    if [ ! -f "$active_file" ] || [ -z "$(cat "$active_file" 2>/dev/null)" ]; then
        log "WARNING: No active VPN configuration"
        return 1
    fi
    return 0
}

# Download file via sing-box VPN outbound
download_file() {
    local filename="$1"
    local url="$GITHUB_BASE/$filename"
    local output="$REMOTE_LISTS_DIR/$filename"
    local tmp_file="/tmp/lists-update-$filename"
    
    log "Downloading $filename..."
    
    # Try via sing-box VPN outbound (most direct way)
    if sing-box tools fetch -c "$SINGBOX_CONFIG" -o "$VPN_OUTBOUND" "$url" > "$tmp_file" 2>/dev/null; then
        # Check that file is not empty and not HTML error
        if [ -s "$tmp_file" ] && ! grep -q '<html' "$tmp_file" 2>/dev/null; then
            mv "$tmp_file" "$output"
            log "OK: $filename downloaded via VPN ($(wc -l < "$output") lines)"
            return 0
        fi
    fi
    
    rm -f "$tmp_file"
    
    # Fallback: try directly (if GitHub is accessible without VPN)
    log "VPN didn't work, trying directly..."
    if curl -s --max-time "$DOWNLOAD_TIMEOUT" -o "$tmp_file" "$url" 2>/dev/null; then
        if [ -s "$tmp_file" ] && ! grep -q '<html' "$tmp_file" 2>/dev/null; then
            mv "$tmp_file" "$output"
            log "OK: $filename downloaded directly ($(wc -l < "$output") lines)"
            return 0
        fi
    fi
    
    rm -f "$tmp_file"
    log "ERROR: Failed to download $filename"
    return 1
}

# Download all files
download_all() {
    local success=0
    local failed=0
    
    # Create directory if not exists
    mkdir -p "$REMOTE_LISTS_DIR"
    
    for file in $REMOTE_FILES; do
        if download_file "$file"; then
            success=$((success + 1))
        else
            failed=$((failed + 1))
        fi
    done
    
    log "Downloaded: $success, errors: $failed"
    
    [ $failed -eq 0 ]
}

# Update last update time
update_timestamp() {
    local now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    
    # Ensure settings.json exists and is valid JSON
    if [ ! -s "$SETTINGS_FILE" ] || ! jq empty "$SETTINGS_FILE" 2>/dev/null; then
        echo '{}' > "$SETTINGS_FILE"
    fi
    
    if [ -f "$SETTINGS_FILE" ]; then
        local tmp_file="/tmp/settings-update.json"
        jq --arg ts "$now" '.last_lists_update = $ts' "$SETTINGS_FILE" > "$tmp_file" 2>/dev/null
        if [ -s "$tmp_file" ] && jq empty "$tmp_file" 2>/dev/null; then
            mv "$tmp_file" "$SETTINGS_FILE"
        else
            rm -f "$tmp_file"
        fi
    fi
    
    log "Update time: $now"
}

# Regenerate dnsmasq configs (merged local + remote)
regenerate_dnsmasq_configs() {
    local dnsmasq_tcpudp="/opt/etc/dnsmasq.d/vpn-domains.conf"
    local dnsmasq_udponly="/opt/etc/dnsmasq.d/vpn-domains-udp.conf"
    local domains_tcpudp="$VPN_MANAGER_DIR/vpn-domains.txt"
    local domains_udponly="$VPN_MANAGER_DIR/vpn-domains-udp.txt"
    local remote_tcpudp="$REMOTE_LISTS_DIR/tcp_udp_domains.txt"
    local remote_udponly="$REMOTE_LISTS_DIR/udp_domains.txt"
    
    # TCP+UDP domains
    cat > "$dnsmasq_tcpudp" << 'EOF'
# Automatically generated by lists-update.sh
# TCP+UDP domains → ipset vpn_domains
# All traffic (TCP and UDP) to these domains goes via VPN
# Sources: vpn-domains.txt (local) + remote-lists/tcp_udp_domains.txt (auto)

EOF
    
    local count=0
    (
        [ -f "$domains_tcpudp" ] && cat "$domains_tcpudp"
        if is_auto_update_enabled && [ -f "$remote_tcpudp" ]; then
            cat "$remote_tcpudp"
        fi
    ) | grep -v '^#' | grep -v '^$' | sed 's/[[:space:]]//g' | sed 's/^\*\.//' | sed 's/^\*//' | sort -u | while read -r domain; do
        if [ -n "$domain" ] && is_valid_domain_for_dnsmasq "$domain"; then
            echo "ipset=/$domain/vpn_domains,vpn_domains6" >> "$dnsmasq_tcpudp"
            count=$((count + 1))
        fi
    done
    
    # Fallback to test domains if empty
    if [ ! -s "$dnsmasq_tcpudp" ] || ! grep -q '^ipset=' "$dnsmasq_tcpudp"; then
        cat >> "$dnsmasq_tcpudp" << 'EOF'
# Test domains
ipset=/icanhazip.com/vpn_domains,vpn_domains6
ipset=/wtfismyip.com/vpn_domains,vpn_domains6
ipset=/2ip.ru/vpn_domains,vpn_domains6
EOF
        log "No TCP+UDP domains found, using test domains"
    else
        log "TCP+UDP domains: $(grep -c '^ipset=' "$dnsmasq_tcpudp")"
    fi
    
    # UDP-only domains
    cat > "$dnsmasq_udponly" << 'EOF'
# Automatically generated by lists-update.sh
# UDP-only domains → ipset vpn_domains_udp
# Only UDP traffic to these domains goes via VPN (TCP directly)
# Sources: vpn-domains-udp.txt (local) + remote-lists/udp_domains.txt (auto)

EOF
    
    (
        [ -f "$domains_udponly" ] && cat "$domains_udponly"
        if is_auto_update_enabled && [ -f "$remote_udponly" ]; then
            cat "$remote_udponly"
        fi
    ) | grep -v '^#' | grep -v '^$' | sed 's/[[:space:]]//g' | sed 's/^\*\.//' | sed 's/^\*//' | sort -u | while read -r domain; do
        if [ -n "$domain" ] && is_valid_domain_for_dnsmasq "$domain"; then
            echo "ipset=/$domain/vpn_domains_udp,vpn_domains6_udp" >> "$dnsmasq_udponly"
        fi
    done
    
    # Fallback to test domains if empty
    if [ ! -s "$dnsmasq_udponly" ] || ! grep -q '^ipset=' "$dnsmasq_udponly"; then
        cat >> "$dnsmasq_udponly" << 'EOF'
# Telegram (UDP for calls/video)
ipset=/telegram.org/vpn_domains_udp,vpn_domains6_udp
ipset=/t.me/vpn_domains_udp,vpn_domains6_udp
ipset=/telegram.me/vpn_domains_udp,vpn_domains6_udp
EOF
        log "No UDP-only domains found, using test domains"
    else
        log "UDP-only domains: $(grep -c '^ipset=' "$dnsmasq_udponly")"
    fi
}

# Update VPN client routing rules in sing-box (for ss-server-in)
update_vpnclient_routing() {
    log "Updating VPN client routing rules..."
    
    # Find common.sh (try multiple locations)
    local common_sh=""
    for path in "/opt/share/www/vpn-manager/api/common.sh" \
                "/opt/etc/vpn-manager/web/api/common.sh" \
                "/opt/vpn-manager-installer/web/api/common.sh"; do
        if [ -f "$path" ]; then
            common_sh="$path"
            break
        fi
    done
    
    if [ -z "$common_sh" ]; then
        log "WARNING: common.sh not found, skipping VPN client routing update"
        return 1
    fi
    
    # Source common.sh and call update_vpnclient_rules
    (
        cd "$(dirname "$common_sh")"
        . "$common_sh"
        
        if command -v update_vpnclient_rules >/dev/null 2>&1; then
            if update_vpnclient_rules; then
                log "VPN client routing rules updated"
                # Restart sing-box to apply new rules
                if command -v singbox_restart >/dev/null 2>&1; then
                    singbox_restart
                    log "sing-box restarted"
                fi
                return 0
            else
                log "WARNING: Failed to update VPN client routing rules"
                return 1
            fi
        else
            log "WARNING: update_vpnclient_rules function not found"
            return 1
        fi
    )
}

# Apply changes (regenerate dnsmasq, warmup, etc.)
apply_changes() {
    log "Applying changes..."
    
    # FEAT-011: Regenerate dnsmasq configs (merged local + remote)
    regenerate_dnsmasq_configs

    # B1: "Russia" list set — its remote files, dnsmasq config and subnets
    local dl="$VPN_MANAGER_DIR/scripts/direct-lists.sh"
    if [ -x "$dl" ]; then
        "$dl" download
        "$dl" dnsmasq
        "$dl" subnets
    fi

    # Restart dnsmasq
    /opt/etc/init.d/S56dnsmasq restart >/dev/null 2>&1
    log "dnsmasq restarted"
    
    # Update VPN client routing rules (BUG-FIX: ss-server-in must use merged lists)
    update_vpnclient_routing
    
    # Warmup (populate ipset)
    if [ -x "/opt/etc/init.d/S98singbox-rules" ]; then
        /opt/etc/init.d/S98singbox-rules warmup >/dev/null 2>&1
    fi
    
    log "Changes applied"
}

# Check if auto-update is enabled
is_auto_update_enabled() {
    if [ -f "$SETTINGS_FILE" ]; then
        # "// true" would read a stored false as true (B11)
        local enabled=$(jq -r 'if .auto_update_lists == null then true else .auto_update_lists end' "$SETTINGS_FILE" 2>/dev/null)
        [ "$enabled" = "true" ]
    else
        return 0
    fi
}

# Main update function
do_update() {
    log "=== Starting lists update ==="
    
    if ! check_vpn_active; then
        log "Skipping update: VPN not active"
        return 1
    fi
    
    if ! check_singbox_running; then
        log "Skipping update: sing-box not running"
        return 1
    fi
    
    if download_all; then
        update_timestamp
        apply_changes
        log "=== Update completed successfully ==="
        return 0
    else
        log "=== Update completed with errors ==="
        return 1
    fi
}

# The lists moved to a new repository (26.09.2026). A router still set to the previous
# default is moved over once. The previous address is matched by its SHA-256, not spelled
# out; a source the user typed in stays as is.
PREV_SOURCE_SHA256="f77a8d888201d2695e1b7295c35cd774a4c2f3964229df2a9beeadce53b83d92"
CUR_SOURCE=$(jq -r '.lists_source_url // empty' "$SETTINGS_FILE" 2>/dev/null)
if [ -n "$CUR_SOURCE" ] && [ "$(printf '%s' "$CUR_SOURCE" | sha256sum | cut -d' ' -f1)" = "$PREV_SOURCE_SHA256" ]; then
    tmp_s="$SETTINGS_FILE.tmp"
    if jq --arg u "$DEFAULT_LISTS_SOURCE" '.lists_source_url = $u' "$SETTINGS_FILE" > "$tmp_s" 2>/dev/null && [ -s "$tmp_s" ]; then
        mv "$tmp_s" "$SETTINGS_FILE"
        LISTS_SOURCE="$DEFAULT_LISTS_SOURCE"
        log "Lists source moved to the new repository: $DEFAULT_LISTS_SOURCE"
    else
        rm -f "$tmp_s"
    fi
fi

# Process arguments
case "$1" in
    update|"")
        do_update
        ;;
    force)
        log "=== Force update ==="
        if download_all; then
            update_timestamp
            apply_changes
            log "=== Update completed successfully ==="
        else
            log "=== Update completed with errors ==="
            exit 1
        fi
        ;;
    check)
        check_vpn_active && check_singbox_running && echo "OK" || echo "UNAVAILABLE"
        ;;
    status)
        if [ -f "$SETTINGS_FILE" ]; then
            jq -r '.last_lists_update // "never"' "$SETTINGS_FILE"
        else
            echo "never"
        fi
        ;;
    *)
        echo "Usage: $0 {update|force|check|status}"
        exit 1
        ;;
esac
