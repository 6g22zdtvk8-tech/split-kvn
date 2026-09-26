#!/bin/sh
# =============================================================================
# sing-box VPN Uninstaller for Keenetic
# Version: 2.0.0
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

VERSION="2.0.0"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_root() {
    [ "$(id -u)" != "0" ] && { log_error "Run as root"; exit 1; }
}

# =============================================================================
# Stop services
# =============================================================================

stop_services() {
    log_info "Stopping services..."
    
    # Stop sing-box
    if [ -f /opt/etc/init.d/S99sing-box ]; then
        /opt/etc/init.d/S99sing-box stop 2>/dev/null || true
        log_ok "sing-box stopped"
    fi
    
    # Stop iptables rules
    if [ -f /opt/etc/init.d/S98singbox-rules ]; then
        /opt/etc/init.d/S98singbox-rules stop 2>/dev/null || true
        log_ok "iptables rules removed"
    fi
    
    # Stop lighttpd on port 8001 (VPN Manager)
    if [ -f /opt/etc/init.d/S80lighttpd ]; then
        /opt/etc/init.d/S80lighttpd stop 2>/dev/null || true
        log_ok "lighttpd stopped"
    fi
}

# =============================================================================
# Delete files
# =============================================================================

remove_files() {
    log_info "Removing files..."
    
    # Init scripts
    rm -f /opt/etc/init.d/S99sing-box
    rm -f /opt/etc/init.d/S98singbox-rules
    rm -f /opt/etc/init.d/S00log-ram
    # The system log goes back to a plain file on the drive
    if [ -L /opt/var/log/messages ]; then
        rm -f /opt/var/log/messages
        touch /opt/var/log/messages
        [ -x /opt/etc/init.d/S01syslog-ng ] && /opt/etc/init.d/S01syslog-ng restart >/dev/null 2>&1
    fi
    log_ok "Init scripts removed"
    
    # sing-box config (optional)
    if [ -d /opt/etc/sing-box ]; then
        if [ "$KEEP_CONFIG" != "yes" ]; then
            rm -rf /opt/etc/sing-box
            log_ok "sing-box configuration removed"
        else
            log_warn "sing-box configuration saved: /opt/etc/sing-box"
        fi
    fi
    
    # VPN Manager
    if [ -d /opt/etc/vpn-manager ]; then
        if [ "$KEEP_CONFIG" != "yes" ]; then
            rm -rf /opt/etc/vpn-manager
            log_ok "VPN Manager configuration removed"
        else
            log_warn "VPN Manager configuration saved: /opt/etc/vpn-manager"
        fi
    fi
    
    # Web interface
    rm -rf /opt/share/www/vpn-manager
    log_ok "Web interface removed"
    
    # dnsmasq configs
    rm -f /opt/etc/dnsmasq.d/vpn-domains.conf
    rm -f /opt/etc/dnsmasq.d/vpn-domains-udp.conf
    rm -f /opt/etc/dnsmasq.d/direct-domains.conf /opt/etc/dnsmasq.d/direct-domains-udp.conf
    rm -f /opt/etc/dnsmasq.d/panel-name.conf    # the home panel name (B8)
    log_ok "dnsmasq configs removed"
    
    # lighttpd config for VPN Manager
    rm -f /opt/etc/lighttpd/conf.d/99-vpn-manager.conf
    log_ok "lighttpd config for VPN Manager removed"
    
    # Logs
    rm -rf /opt/var/log/vpn-manager
    rm -f /opt/var/log/sing-box.log
    log_ok "Logs removed"
    
    # logrotate config and script
    rm -f /opt/etc/logrotate.d/sing-box
    rm -f /opt/etc/logrotate.d/vpn-manager
    rm -f /opt/etc/singbox-logrotate.sh
    rm -f /opt/etc/cron.daily/vpn-manager-logs
    
    # Cron jobs
    local crontab_file="/opt/var/spool/cron/crontabs/root"
    if [ -f "$crontab_file" ]; then
        grep -v "singbox-logrotate" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
        mv "${crontab_file}.tmp" "$crontab_file" 2>/dev/null || true
    fi
    if [ -f /opt/etc/crontab ]; then
        sed -i '/sing-box-cleanup/d' /opt/etc/crontab 2>/dev/null || true
        sed -i '/vpn-manager-logs/d' /opt/etc/crontab 2>/dev/null || true
    fi
    log_ok "Cron jobs removed"
}

# =============================================================================
# Clear ipset and routing
# =============================================================================

cleanup_network() {
    log_info "Cleaning up network settings..."
    
    # Delete ipset
    for set in vpn_domains vpn_domains6 vpn_domains_udp vpn_domains6_udp vpn_devices \
               vpn_subnets vpn_subnets6 vpn_subnets_udp vpn_subnets6_udp vpn_servers vpn_servers6 \
               direct_domains direct_domains6 direct_domains_udp direct_domains6_udp \
               direct_subnets direct_subnets6 direct_subnets_udp direct_subnets6_udp; do
        ipset destroy $set 2>/dev/null || true
    done
    log_ok "ipset removed"
    
    # Delete routing rules
    ip rule del fwmark 0x1 lookup 100 2>/dev/null || true
    ip route del local default dev lo table 100 2>/dev/null || true
    ip -6 rule del fwmark 0x1 lookup 100 2>/dev/null || true
    ip -6 route del local default dev lo table 100 2>/dev/null || true
    log_ok "Routing rules removed"
}

# =============================================================================
# Remove packages (optional)
# =============================================================================

remove_packages() {
    if [ "$REMOVE_PACKAGES" = "yes" ]; then
        log_info "Removing packages..."
        
        opkg remove sing-box-go 2>/dev/null && log_ok "sing-box-go removed" || true
        
        # Don't remove common packages (dnsmasq, iptables, ipset) - they may be used by others
        log_warn "Common packages (dnsmasq, iptables, ipset, lighttpd) not removed - may be used by other services"
    fi
}

# =============================================================================
# Restart dnsmasq
# =============================================================================

restart_dnsmasq() {
    log_info "Restarting dnsmasq..."
    
    if [ -f /opt/etc/init.d/S56dnsmasq ]; then
        /opt/etc/init.d/S56dnsmasq restart 2>/dev/null || true
        log_ok "dnsmasq restarted"
    fi
}

# =============================================================================
# Main
# =============================================================================

print_help() {
    echo "sing-box VPN Uninstaller v$VERSION"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --keep-config     Keep configuration files"
    echo "  --remove-packages Remove packages (sing-box-go)"
    echo "  --yes             Don't ask for confirmation"
    echo "  --help            Show this help"
    echo ""
}

KEEP_CONFIG="no"
REMOVE_PACKAGES="no"
AUTO_YES="no"

for arg in "$@"; do
    case "$arg" in
        --keep-config) KEEP_CONFIG="yes" ;;
        --remove-packages) REMOVE_PACKAGES="yes" ;;
        --yes|-y) AUTO_YES="yes" ;;
        --help|-h) print_help; exit 0 ;;
    esac
done

echo ""
echo -e "${RED}============================================${NC}"
echo -e "${RED}   sing-box VPN Uninstaller v$VERSION${NC}"
echo -e "${RED}============================================${NC}"
echo ""

check_root

if [ "$AUTO_YES" != "yes" ]; then
    echo -e "${YELLOW}WARNING: This will remove sing-box VPN and VPN Manager!${NC}"
    echo ""
    [ "$KEEP_CONFIG" = "yes" ] && echo "  - Configurations will be SAVED"
    [ "$KEEP_CONFIG" = "no" ] && echo "  - Configurations will be DELETED"
    [ "$REMOVE_PACKAGES" = "yes" ] && echo "  - Package sing-box-go will be removed"
    echo ""
    printf "Continue? [y/N]: "
    read answer
    case "$answer" in
        [Yy]*) ;;
        *) echo "Cancelled."; exit 0 ;;
    esac
fi

echo ""
log_info "=== Stopping services ==="
stop_services
echo ""

log_info "=== Network cleanup ==="
cleanup_network
echo ""

log_info "=== Removing files ==="
remove_files
echo ""

if [ "$REMOVE_PACKAGES" = "yes" ]; then
    log_info "=== Removing packages ==="
    remove_packages
    echo ""
fi

log_info "=== Restarting dnsmasq ==="
restart_dnsmasq
echo ""

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   Uninstallation complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
[ "$KEEP_CONFIG" = "yes" ] && echo -e "Configurations saved in:"
[ "$KEEP_CONFIG" = "yes" ] && echo -e "  - /opt/etc/sing-box/"
[ "$KEEP_CONFIG" = "yes" ] && echo -e "  - /opt/etc/vpn-manager/"
echo ""

