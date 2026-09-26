#!/bin/sh
# =============================================================================
# sing-box VPN Installer for Keenetic
# Version: 2.0.0
# =============================================================================

# Not use set -e, handle errors manually

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

VERSION="2.12.0"  # AmneziaWG support, sing-box Extended
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Paths
SINGBOX_CONFIG="/opt/etc/sing-box/config.json"
DNSMASQ_VPN_CONF="/opt/etc/dnsmasq.d/vpn-domains.conf"
DNSMASQ_VPN_UDP_CONF="/opt/etc/dnsmasq.d/vpn-domains-udp.conf"
INIT_RULES="/opt/etc/init.d/S98singbox-rules"
VPN_MANAGER_HOME="/opt/etc/vpn-manager"

# Update mode: refresh the code only, keep everything the router has earned —
# the panel password, settings, subscriptions, lists, the sing-box config and the
# VPN-server credentials. Set by the "update" subcommand, never on a fresh install.
UPDATE_MODE=0
AUTO_INSTALL_MARKER="/opt/etc/.vpn-manager-installed"
AUTO_INSTALL_SCRIPT="/opt/etc/init.d/S01autoinstall"

# Files domains — in working directory VPN Manager (for web interface)
DOMAINS_FILE="$VPN_MANAGER_HOME/vpn-domains.txt"
DOMAINS_UDP_FILE="$VPN_MANAGER_HOME/vpn-domains-udp.txt"
SUBNETS_FILE="$VPN_MANAGER_HOME/vpn-subnets.txt"
SUBNETS_UDP_FILE="$VPN_MANAGER_HOME/vpn-subnets-udp.txt"
# Source files from distribution
DOMAINS_FILE_SRC="$SCRIPT_DIR/config/vpn-domains.txt"
DOMAINS_UDP_FILE_SRC="$SCRIPT_DIR/config/vpn-domains-udp.txt"
SUBNETS_FILE_SRC="$SCRIPT_DIR/config/vpn-subnets.txt"
SUBNETS_UDP_FILE_SRC="$SCRIPT_DIR/config/vpn-subnets-udp.txt"
# FEAT-011: Remote lists (downloaded automatically)
REMOTE_LISTS_DIR="$VPN_MANAGER_HOME/remote-lists"
REMOTE_DOMAINS_FILE="$REMOTE_LISTS_DIR/tcp_udp_domains.txt"
REMOTE_DOMAINS_UDP_FILE="$REMOTE_LISTS_DIR/udp_domains.txt"
REMOTE_SUBNETS_FILE="$REMOTE_LISTS_DIR/tcp_udp_subnets.txt"
REMOTE_SUBNETS_UDP_FILE="$REMOTE_LISTS_DIR/udp_subnets.txt"

# =============================================================================
# Functions
# =============================================================================

log_info() { printf "${BLUE}[INFO]${NC} %s\n" "$1"; }
log_ok() { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
log_warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
log_error() { printf "${RED}[ERROR]${NC} %s\n" "$1"; }

# =============================================================================
# FEAT-011: Merge local and remote lists
# =============================================================================

# Check auto-update is enabled
is_auto_update_enabled() {
    local settings_file="$VPN_MANAGER_HOME/settings.json"
    if [ -f "$settings_file" ]; then
        # Correct check: jq '// true' treats false "falsy"
        local enabled=$(jq 'if .auto_update_lists == null then true else .auto_update_lists end' "$settings_file" 2>/dev/null)
        [ "$enabled" = "true" ]
    else
        # By default enabled
        return 0
    fi
}

# Get merged domain list (local + remote, deduplicated)
# $1 = local_file, $2 = remote_file
get_merged_list() {
    local local_file="$1"
    local remote_file="$2"
    
    # Collect lines from both fileov, filter comments and empty, deduplicate
    {
        [ -f "$local_file" ] && cat "$local_file"
        # Remote files use only if auto-update enabled
        if is_auto_update_enabled && [ -f "$remote_file" ]; then
            cat "$remote_file"
        fi
    } 2>/dev/null | grep -v '^#' | grep -v '^$' | tr -d ' \t\r' | sort -u
}

# Get merged TCP+UDP domains
get_merged_domains() {
    get_merged_list "$DOMAINS_FILE" "$REMOTE_DOMAINS_FILE"
}

# Get merged UDP-only domains
get_merged_domains_udp() {
    get_merged_list "$DOMAINS_UDP_FILE" "$REMOTE_DOMAINS_UDP_FILE"
}

# Get merged TCP+UDP subnets
get_merged_subnets() {
    get_merged_list "$SUBNETS_FILE" "$REMOTE_SUBNETS_FILE"
}

# Get merged UDP-only subnets
get_merged_subnets_udp() {
    get_merged_list "$SUBNETS_UDP_FILE" "$REMOTE_SUBNETS_UDP_FILE"
}

check_root() {
    [ "$(id -u)" != "0" ] && { log_error "Run as root"; exit 1; }
}

finalize_autoinstall() {
    if [ -f "$AUTO_INSTALL_SCRIPT" ]; then
        touch "$AUTO_INSTALL_MARKER"
        rm -f "$AUTO_INSTALL_SCRIPT"
        log_ok "Autoinstallation completed: created marker and removed S01autoinstall"
    fi
}

# =============================================================================
# Deferred Keenetic setup via cron
# =============================================================================
# Problem: during time auto-install ndmc may be unavailable (netfriend wizard)
# Solution: add task in cron, which will run when ndmc stano ready

schedule_ndmc_postinstall() {
    local SCRIPT_SRC="$SCRIPT_DIR/scripts/ndmc-postinstall.sh"
    local SCRIPT_DST="/opt/etc/ndmc-postinstall.sh"
    local CRONTAB_FILE="/opt/var/spool/cron/crontabs/root"
    local MARKER_FILE="/opt/etc/.ndmc-postinstall-done"
    
    # If already completed — skip
    if [ -f "$MARKER_FILE" ]; then
        log_ok "Keenetic setup already completed earlier"
        return 0
    fi
    
    # Copy script
    if [ -f "$SCRIPT_SRC" ]; then
        cp "$SCRIPT_SRC" "$SCRIPT_DST"
        chmod +x "$SCRIPT_DST"
        log_ok "Script ndmc-postinstall.sh installed"
    else
        log_warn "Script $SCRIPT_SRC not found"
        return 1
    fi
    
    # Check, there is whether already task in crontab
    if grep -q "ndmc-postinstall" "$CRONTAB_FILE" 2>/dev/null; then
        log_ok "Task already added in cron"
    else
        # Add task (every minute)
        echo "* * * * * $SCRIPT_DST" >> "$CRONTAB_FILE"
        log_ok "Task added in cron (every minute)"
    fi
    
    # IMPORTANT: fix permissions on crontab (cron requires 600)
    chmod 600 "$CRONTAB_FILE"
    
    # Restartaem cron to picked up changes
    if [ -f /opt/etc/init.d/S10cron ]; then
        /opt/etc/init.d/S10cron restart >/dev/null 2>&1
    fi
    
    log_info "IPv6 and port 8388 will be configured automatically in ~1 minute"
    log_info "Log: /opt/var/log/ndmc-postinstall.log"
}

# =============================================================================
# Version sing-box for download
# =============================================================================
SINGBOX_VERSION="1.14.1-extended-2.7.2"
# B2: where routers look for new releases (the manifest of the latest GitHub release)
DEFAULT_UPDATE_SOURCE="https://github.com/6g22zdtvk8-tech/split-kvn/releases/latest/download/manifest.json"

# architectures Keenetic:
# - aarch64: Peak, Titan (KN-1811), Giga (KN-1012), Hopper (KN-3811/3812)
# - mipsel:  Ultra (KN-1810), Viva, Giga (KN-1010/1011), Omni, Extra, 4G, Giant, Hero 4G
# - mips:    Ultra SE (KN-2510), Giga SE (KN-2410), DSL, Skipper DSL, Duo, Hopper DSL

# =============================================================================
# Install packages
# =============================================================================

install_packages() {
    log_info "Updating package list..."
    opkg update >/dev/null 2>&1
    
    log_info "Installing dependencies..."
    
    # shadowsocks-rust-server no longer needed — VPN server is built into sing-box
    # cron — for log rotation
    # openssh-sftp-server — for SFTP access (works via dropbear on port 222)
    # bind-dig — for DNS queries on non-standard port 5353 (nslookup doesn't support port)
    # syslog-ng — for centralized logging and cloud log shipping
    # coreutils-stat — for log size reporting in UI
    for pkg in iptables ipset dnsmasq-full curl jq ca-bundle coreutils-mktemp coreutils-stat cron openssh-sftp-server bind-dig tcpdump syslog-ng; do
        if ! opkg list-installed | grep -q "^$pkg "; then
            log_info "Installation $pkg..."
            opkg install $pkg >/dev/null 2>&1 || log_warn "Not managed install $pkg"
        else
            log_ok "$pkg already installed"
        fi
    done
    
    # sing-box no in standartnom repozitorii Entware, download with GitHub
    install_singbox_binary
}

# =============================================================================
# Skachivanie and installation sing-box with GitHub
# =============================================================================

install_singbox_binary() {
    if [ -f /opt/bin/sing-box ]; then
        local current_ver=$(/opt/bin/sing-box version 2>/dev/null | head -1 | awk '{print $3}')
        if [ "$current_ver" = "$SINGBOX_VERSION" ]; then
            log_ok "sing-box $SINGBOX_VERSION already installed"
            return 0
        fi
        log_info "update sing-box with $current_ver to $SINGBOX_VERSION..."
    else
        log_info "Installation sing-box $SINGBOX_VERSION..."
    fi
    
    # Detect arkhitekturu
    local arch=$(uname -m)
    local singbox_arch=""
    
    case "$arch" in
        aarch64|arm64)
            singbox_arch="linux-arm64"
            ;;
        mipsel|mipsle)
            # MIPS Little-Endian: Ultra (KN-1810), Viva, old Giga, Omni, Extra, 4G and t.d.
            singbox_arch="linux-mipsle-softfloat"
            ;;
        mips)
            # MIPS Big-Endian: Ultra SE (KN-2510), Giga SE (KN-2410), DSL-modeli
            singbox_arch="linux-mips-softfloat"
            ;;
        x86_64|amd64)
            singbox_arch="linux-amd64"
            ;;
        *)
            log_error "unsupported architecture: $arch"
            log_error "supported: aarch64, mipsel, mips"
            return 1
            ;;
    esac
    
    log_info "architecture: $arch → $singbox_arch"
    
    local tmp_dir="/opt/tmp/singbox-install"
    mkdir -p "$tmp_dir"
    cd "$tmp_dir"
    
    # Check for local archive in installer directory
    local local_archive="$SCRIPT_DIR/sing-box-${SINGBOX_VERSION}-${singbox_arch}.tar.gz"
    
    if [ -f "$local_archive" ]; then
        log_info "Using local archive: $(basename "$local_archive")"
        cp "$local_archive" sing-box.tar.gz
    else
        # Skachivaem with GitHub
        local download_url="https://github.com/shtorm-7/sing-box-extended/releases/download/v${SINGBOX_VERSION}/sing-box-${SINGBOX_VERSION}-${singbox_arch}.tar.gz"
        log_info "Skachivanie: $download_url"
        if ! curl -L -o sing-box.tar.gz "$download_url" 2>/dev/null; then
            log_error "Failed to download sing-box"
            rm -rf "$tmp_dir"
            return 1
        fi
    fi
    
    log_info "Extracting..."
    if ! tar xzf sing-box.tar.gz 2>/dev/null; then
        log_error "Failed to extract archive"
        rm -rf "$tmp_dir"
        return 1
    fi
    
    # Nakhodim binary by ozhidaemomu path (find may be unavailable in BusyBox)
    local expected_dir="sing-box-${SINGBOX_VERSION}-${singbox_arch}"
    local binary="$tmp_dir/$expected_dir/sing-box"
    if [ ! -f "$binary" ]; then
        # Fallback: search in extracted directory
        binary=$(find "$tmp_dir" -name "sing-box" -type f 2>/dev/null | head -1)
    fi
    
    if [ -z "$binary" ] || [ ! -f "$binary" ]; then
        log_error "sing-box binary not found in archive"
        rm -rf "$tmp_dir"
        return 1
    fi
    
    # Stop sing-box if running
    [ -f /opt/etc/init.d/S99sing-box ] && /opt/etc/init.d/S99sing-box stop 2>/dev/null || true
    
    # Ustanavlivaem
    chmod +x "$binary"
    cp -f "$binary" /opt/bin/sing-box
    
    # Check
    if /opt/bin/sing-box version >/dev/null 2>&1; then
        log_ok "sing-box $SINGBOX_VERSION installed"
        # Regenerate Reality keys if they were deferred
        regenerate_reality_keys_if_needed
    else
        log_error "sing-box does not work"
        rm -rf "$tmp_dir"
        return 1
    fi
    
    # Clear
    cd /opt
    rm -rf "$tmp_dir"
    
    return 0
}

# =============================================================================
# Check TUN device availability
# =============================================================================

check_tun_device() {
    log_info "Checking TUN device..."
    
    if [ -c /dev/net/tun ]; then
        log_ok "TUN device available (/dev/net/tun)"
    else
        log_error "TUN device not found (/dev/net/tun)"
        log_error "TUN mode requires /dev/net/tun in the kernel"
        return 1
    fi
}

# =============================================================================
# VLESS Server (VPN server with WebSocket)
# =============================================================================

# VPN-server built-in in sing-box how VLESS inbound with Reality TLS
VPN_SERVER_CREDS="/opt/etc/vpn-manager/vpnserver-credentials.json"
VPN_SERVER_PORT=8388

# For sovmestimosti so starym kodom
SS_SERVER_CREDS="$VPN_SERVER_CREDS"
SS_SERVER_PORT=$VPN_SERVER_PORT

generate_uuid() {
    # Generate UUID v4
    if [ -x /opt/bin/sing-box ]; then
        /opt/bin/sing-box generate uuid 2>/dev/null
    elif command -v uuidgen >/dev/null 2>&1; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        # Fallback via /dev/urandom
        cat /proc/sys/kernel/random/uuid 2>/dev/null || \
        (od -x /dev/urandom | head -1 | awk '{print $2$3"-"$4"-"$5"-"$6"-"$7$8$9}')
    fi
}

generate_reality_keypair() {
    # Generate X25519 keypair for Reality
    if [ -x /opt/bin/sing-box ]; then
        /opt/bin/sing-box generate reality-keypair 2>/dev/null
    else
        log_warn "sing-box not found, Reality key generation deferred"
        echo ""
    fi
}

generate_short_id() {
    # Generate 8-simvolnogo hex short_id
    if [ -x /opt/bin/sing-box ]; then
        /opt/bin/sing-box generate rand --hex 8 2>/dev/null
    else
        # Fallback
        head -c 4 /dev/urandom | od -A n -t x1 | tr -d ' \n'
    fi
}

setup_vpnserver() {
    log_info "Generating VPN server credentials (VLESS + WebSocket)..."
    
    # Create directory for credentials
    mkdir -p "$(dirname "$VPN_SERVER_CREDS")"
    
    # If credentials already exist, skipping
    if [ -f "$VPN_SERVER_CREDS" ]; then
        log_ok "Credentials VPN-servers already exist"
        return 0
    fi
    
    local user_uuid=$(generate_uuid)
    
    log_info "Generating user UUID..."
    
    # Keep credentials (WebSocket format)
    cat > "$VPN_SERVER_CREDS" << EOF
{
  "protocol": "vless",
  "server_port": $VPN_SERVER_PORT,
  "transport": "ws",
  "ws_path": "/vless-ws",
  "tls": false,
  "users": [
    {
      "name": "default",
      "uuid": "$user_uuid"
    }
  ],
  "created_at": "$(date -Iseconds 2>/dev/null || date)"
}
EOF
    
    chmod 600 "$VPN_SERVER_CREDS"
    
    log_ok "Credentials VPN-servers created (VLESS + WebSocket, port $VPN_SERVER_PORT)"
}

# Regenerate Reality keys (called after sing-box installation)
regenerate_reality_keys_if_needed() {
    if [ ! -f "$VPN_SERVER_CREDS" ]; then
        return 0
    fi
    
    local current_key=$(jq -r '.private_key // ""' "$VPN_SERVER_CREDS" 2>/dev/null)
    
    if [ "$current_key" = "GENERATE_AFTER_SINGBOX_INSTALL" ] && [ -x /opt/bin/sing-box ]; then
        log_info "Regenerating Reality keys..."
        
        local keypair=$(generate_reality_keypair)
        local private_key=$(echo "$keypair" | grep -i 'privatekey' | awk -F': ' '{print $2}' | tr -d ' ')
        local public_key=$(echo "$keypair" | grep -i 'publickey' | awk -F': ' '{print $2}' | tr -d ' ')
        
        if [ -n "$private_key" ] && [ -n "$public_key" ]; then
            local tmp_creds=$(mktemp)
            jq ".private_key = \"$private_key\" | .public_key = \"$public_key\"" "$VPN_SERVER_CREDS" > "$tmp_creds"
            mv "$tmp_creds" "$VPN_SERVER_CREDS"
            chmod 600 "$VPN_SERVER_CREDS"
            log_ok "Reality keys updated"
        fi
    fi
}

# Alias for sovmestimosti so starym kodom
setup_ssserver() {
    setup_vpnserver
}

# =============================================================================
# [DEPRECATED] DNS Override is no longer used
# dnsmasq now works on port 5353, iptables redirects DNS traffic
# function ostavlena for sovmestimosti, but not is called
# =============================================================================

# enable_dns_override() {
#     # Deprecated function - DNS Override not needed when using port 5353
#     # Left as reference for history
# }

# =============================================================================
# Configuration sing-box
# =============================================================================

migrate_to_tun() {
    log_info "Migrating config from TPROXY/REDIRECT to TUN mode..."
    
    local backup="${SINGBOX_CONFIG}.pre-tun.$(date +%Y%m%d%H%M%S)"
    cp "$SINGBOX_CONFIG" "$backup"
    log_ok "Old config backed up: $backup"
    
    local old_outbounds old_route_rules old_route_final
    old_outbounds=$(jq '.outbounds' "$SINGBOX_CONFIG" 2>/dev/null)
    old_route_rules=$(jq '.route.rules' "$SINGBOX_CONFIG" 2>/dev/null)
    old_route_final=$(jq -r '.route.final // "direct"' "$SINGBOX_CONFIG" 2>/dev/null)
    
    local has_ss_server
    has_ss_server=$(jq '[.inbounds[] | select(.tag == "ss-server-in")] | length' "$SINGBOX_CONFIG" 2>/dev/null)
    local ss_server_inbound=""
    if [ "$has_ss_server" -gt 0 ] 2>/dev/null; then
        ss_server_inbound=$(jq '[.inbounds[] | select(.tag == "ss-server-in")][0]' "$SINGBOX_CONFIG" 2>/dev/null)
    fi
    
    local tun_inbound='{"type":"tun","tag":"tun-in","interface_name":"singbox0","address":["172.19.0.1/30"],"mtu":1400,"auto_route":false,"stack":"gvisor"}'
    local hc_inbound='{"type":"socks","tag":"health-check-in","listen":"127.0.0.1","listen_port":2080}'
    
    local new_inbounds
    if [ -n "$ss_server_inbound" ] && [ "$ss_server_inbound" != "null" ]; then
        new_inbounds=$(jq -n --argjson tun "$tun_inbound" --argjson ss "$ss_server_inbound" --argjson hc "$hc_inbound" '[$tun, $ss, $hc]')
    else
        new_inbounds=$(jq -n --argjson tun "$tun_inbound" --argjson hc "$hc_inbound" '[$tun, $hc]')
    fi
    
    local tmp=$(mktemp)
    jq --argjson inbounds "$new_inbounds" \
       --argjson outbounds "$old_outbounds" \
       --argjson rules "$old_route_rules" \
       --arg final "$old_route_final" \
       '.inbounds = $inbounds | .outbounds = $outbounds | .route.rules = $rules | .route.final = $final | .route.auto_detect_interface = true' \
       "$SINGBOX_CONFIG" > "$tmp" && mv "$tmp" "$SINGBOX_CONFIG"
    
    log_ok "Migrated to TUN mode (outbounds and routes preserved)"
}

create_singbox_config() {
    log_info "Creating configuration sing-box..."
    
    mkdir -p /opt/etc/sing-box
    
    # Check: file exists, not empty, and valid JSON
    if [ -s "$SINGBOX_CONFIG" ] && jq empty "$SINGBOX_CONFIG" 2>/dev/null; then
        # Check if TUN inbound exists
        local has_tun
        has_tun=$(jq '[.inbounds[] | select(.type == "tun")] | length' "$SINGBOX_CONFIG" 2>/dev/null)
        if [ "$has_tun" -gt 0 ] 2>/dev/null; then
            log_warn "Configuration already exists with TUN, skipping"
            log_info "Edit: $SINGBOX_CONFIG"
            return
        fi
        # Config exists but no TUN — migrate
        migrate_to_tun
        return
    fi
    
    # If file exists but empty/invalid — backup it
    if [ -f "$SINGBOX_CONFIG" ]; then
        log_warn "Configuration empty or corrupted, recreate..."
        cp "$SINGBOX_CONFIG" "${SINGBOX_CONFIG}.broken.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    fi
    
    cat > "$SINGBOX_CONFIG" << 'EOF'
{
  "log": {
    "level": "warn",
    "timestamp": true
  },
  "experimental": {
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "secret": ""
    }
  },
  "dns": {
    "servers": [
      {
        "type": "udp",
        "tag": "bootstrap",
        "server": "127.0.0.1",
        "server_port": 5353
      },
      {
        "type": "udp",
        "tag": "local",
        "server": "127.0.0.1",
        "server_port": 5353
      },
      {
        "type": "tls",
        "tag": "remote",
        "server": "8.8.8.8"
      }
    ],
    "final": "local",
    "strategy": "ipv4_only"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "singbox0",
      "address": ["172.19.0.1/30"],
      "mtu": 1400,
      "auto_route": false,
      "stack": "gvisor"
    },
    {
      "type": "vless",
      "tag": "ss-server-in",
      "listen": "::",
      "listen_port": VPN_SERVER_PORT_PLACEHOLDER,
      "users": [
        {
          "name": "default",
          "uuid": "VPN_USER_UUID_PLACEHOLDER"
        }
      ],
      "transport": {
        "type": "ws",
        "path": "VPN_WS_PATH_PLACEHOLDER"
      }
    },
    {
      "type": "socks",
      "tag": "health-check-in",
      "listen": "127.0.0.1",
      "listen_port": 2080
    }
  ],
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    }
  ],
  "route": {
    "rules": [
      {
        "inbound": ["ss-server-in", "health-check-in"],
        "action": "sniff"
      },
      {
        "ip_is_private": true,
        "outbound": "direct"
      }
    ],
    "default_domain_resolver": "bootstrap",
    "final": "direct",
    "auto_detect_interface": true
  }
}
EOF
    
    # Substitute VLESS server credentials (VPN-server with WebSocket)
    if [ -f "$VPN_SERVER_CREDS" ]; then
        local vpn_port=$(jq -r '.server_port // 8388' "$VPN_SERVER_CREDS" 2>/dev/null)
        local vpn_uuid=$(jq -r '.users[0].uuid' "$VPN_SERVER_CREDS" 2>/dev/null)
        local vpn_ws_path=$(jq -r '.ws_path // "/vless-ws"' "$VPN_SERVER_CREDS" 2>/dev/null)
        
        [ -n "$vpn_port" ] && sed -i "s/VPN_SERVER_PORT_PLACEHOLDER/$vpn_port/" "$SINGBOX_CONFIG"
        [ -n "$vpn_uuid" ] && sed -i "s/VPN_USER_UUID_PLACEHOLDER/$vpn_uuid/" "$SINGBOX_CONFIG"
        [ -n "$vpn_ws_path" ] && sed -i "s|VPN_WS_PATH_PLACEHOLDER|$vpn_ws_path|" "$SINGBOX_CONFIG"
        log_ok "VLESS server with WebSocket added in sing-box (port $vpn_port)"
    else
        log_warn "VPN credentials not found, VPN-server not configured in sing-box"
    fi
    
    log_ok "Configuration created: $SINGBOX_CONFIG"
    log_warn "VPN-configuration while not set: enable it via VPN Manager or update config.json"
}

# =============================================================================
# Obespechit bootstrap DNS in sushchestvuyushchem config.json (ustranenie DNS-loop)
# =============================================================================

ensure_singbox_dns_bootstrap() {
    # If config already byl (old) — add/update DNS section tak,
    # to endpoint domain VPN outbound mog rezolvitsya via DoT directly (tls://8.8.8.8),
    # avoiding DNAT/interception of UDP/TCP 53.
    # Local DNS uses udp://127.0.0.1:5353 (dnsmasq) to avoid NAT loops.
    if [ ! -f "$SINGBOX_CONFIG" ]; then
        return 0
    fi

    if ! command -v jq >/dev/null 2>&1; then
        log_warn "jq not found, not mogu propatchit DNS section sing-box automatically"
        return 0
    fi

    # Use dnsmasq on port 5353 directly (avoids NAT interception loops)
    local local_dns="127.0.0.1:5353"

    local tmp_config="/tmp/singbox_config_tmp.json"
    # final outbound tag (if already configured via VPN Manager)
    local final_tag="$(jq -r '.route.final // "direct"' "$SINGBOX_CONFIG" 2>/dev/null)"
    [ -z "$final_tag" ] && final_tag="direct"

    # sing-box 1.14 format: typed servers, no "outbound" DNS rules — the VPN server
    # name resolves through route.default_domain_resolver (bootstrap)
    jq --arg final_tag "$final_tag" '
      .dns = (.dns // {})
      | .dns.servers = (
          # Drop our own tags, then add them again (other servers stay)
          ((.dns.servers // []) | map(select((.tag // "") as $t | ($t!="bootstrap" and $t!="local" and $t!="remote"))))
          as $rest
          | (
              [
                {"type":"udp","tag":"bootstrap","server":"127.0.0.1","server_port":5353},
                {"type":"udp","tag":"local","server":"127.0.0.1","server_port":5353},
                ({"type":"tls","tag":"remote","server":"8.8.8.8"}
                 + (if $final_tag=="direct" then {} else {"detour":$final_tag} end))
              ] + $rest
            )
        )
      | .dns.rules = [(.dns.rules // [])[] | select(has("outbound") | not)]
      | .dns.final = "local"
      | .dns.strategy = "ipv4_only"
      | .route.default_domain_resolver = (.route.default_domain_resolver // "bootstrap")
    ' "$SINGBOX_CONFIG" > "$tmp_config"

    # Check that result is not empty and valid JSON
    if [ -s "$tmp_config" ] && jq empty "$tmp_config" 2>/dev/null; then
        mv "$tmp_config" "$SINGBOX_CONFIG"
        chmod 644 "$SINGBOX_CONFIG"
        log_ok "sing-box DNS section updated (bootstrap and local = udp://$local_dns, final=$final_tag)"
    else
        rm -f "$tmp_config"
        log_warn "jq returned empty result, config not changed"
    fi
}

migrate_existing_singbox_config() {
    local common_sh="/opt/share/www/vpn-manager/api/common.sh"
    if [ ! -f "$common_sh" ] || [ ! -f "$SINGBOX_CONFIG" ]; then
        return 0
    fi
    if ( . "$common_sh" && ensure_valid_singbox_config ) >/dev/null 2>&1; then
        log_ok "sing-box config checked for the 1.14 format"
    else
        log_warn "sing-box config migration failed — check $SINGBOX_CONFIG"
    fi
}

# =============================================================================
# Smoke-test (without requiring VPN configuration)
# =============================================================================

smoke_test() {
    log_info "Smoke-test: DNS and basic services..."

    # 1) dnsmasq upstream should ignore /etc/resolv.conf (often contains fe80::)
    local upstream_conf="/opt/etc/dnsmasq.d/00-upstream-dns.conf"
    if [ -f "$upstream_conf" ] && grep -q '^no-resolv' "$upstream_conf"; then
        log_ok "dnsmasq upstream: no-resolv enabled"
    else
        log_warn "dnsmasq upstream: no-resolv Not enabled (possible timeouts due to fe80:: in resolv.conf)"
    fi

    # 2) Check that dnsmasq responds locally (if running)
    local lan_ip=$(ip addr show br0 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1 | awk '{print $2}')
    [ -z "$lan_ip" ] && lan_ip="192.168.1.1"

    local dnsmasq_port=5353
    if command -v jq >/dev/null 2>&1 && [ -f "$VPN_MANAGER_HOME/settings.json" ]; then
        dnsmasq_port=$(jq -r '.dnsmasq_port // 5353' "$VPN_MANAGER_HOME/settings.json" 2>/dev/null)
    fi

    if pgrep -f "dnsmasq" >/dev/null 2>&1; then
        if command -v dig >/dev/null 2>&1 && dig @127.0.0.1 -p "$dnsmasq_port" google.com +short +time=3 >/dev/null 2>&1; then
            log_ok "dnsmasq resolves on 127.0.0.1:$dnsmasq_port (google.com)"
        elif nslookup google.com "$lan_ip" >/dev/null 2>&1; then
            log_ok "dnsmasq resolves via $lan_ip (google.com)"
        else
            log_warn "dnsmasq not resolving — try: $VPN_MANAGER_HOME/scripts/dns-upstream-fallback.sh apply"
        fi
    else
        log_warn "dnsmasq not running (Smoke-test DNS skipped)"
    fi

    if [ -f "$VPN_MANAGER_HOME/dns-upstream-mode" ]; then
        local upstream_mode
        upstream_mode=$(cat "$VPN_MANAGER_HOME/dns-upstream-mode" 2>/dev/null)
        if [ "$upstream_mode" = "dot" ]; then
            log_ok "dnsmasq upstream mode: DoT (stubby on 127.0.0.1:5453)"
        else
            log_ok "dnsmasq upstream mode: plain (port 53)"
        fi
    fi

    # 3) Check that in sing-box has bootstrap DNS (DoT), needed to avoid DNS-loop after VPN activation
    if command -v jq >/dev/null 2>&1 && [ -f "$SINGBOX_CONFIG" ]; then
        if jq -e '.dns.servers[] | select(.tag=="bootstrap")' "$SINGBOX_CONFIG" >/dev/null 2>&1; then
            log_ok "sing-box: bootstrap DNS present"
        else
            log_warn "sing-box: bootstrap DNS not found (check config.json)"
        fi

        # The VPN server name must resolve through bootstrap, not through the tunnel itself
        if jq -e '.route.default_domain_resolver == "bootstrap"' "$SINGBOX_CONFIG" >/dev/null 2>&1; then
            log_ok "sing-box: VPN server names resolve via bootstrap"
        else
            log_warn "sing-box: route.default_domain_resolver is not bootstrap — possible DNS-loop"
        fi
        if [ -x /opt/bin/sing-box ] && /opt/bin/sing-box check -c "$SINGBOX_CONFIG" >/dev/null 2>&1; then
            log_ok "sing-box: config passes sing-box check"
        else
            log_warn "sing-box: config fails sing-box check — run: /opt/bin/sing-box check -c $SINGBOX_CONFIG"
        fi
    fi
}

# =============================================================================
# Init-script for sing-box
# =============================================================================

create_singbox_init() {
    log_info "Creating init-script for sing-box..."
    
    # Copy init-script from folder scripts (with ispravleniem CRLF)
    if [ -f "$SCRIPT_DIR/scripts/S99sing-box" ]; then
        sed 's/\r$//' "$SCRIPT_DIR/scripts/S99sing-box" > /opt/etc/init.d/S99sing-box
    else
        # Fallback: create inline if file not found
        cat > /opt/etc/init.d/S99sing-box << 'EOF'
#!/bin/sh
# sing-box init script with autostart support

AUTOSTART_FLAG="/opt/etc/vpn-manager/autostart-enabled"
SINGBOX_BIN="/opt/bin/sing-box"
SINGBOX_CONFIG="/opt/etc/sing-box/config.json"
PIDFILE="/opt/var/run/sing-box.pid"
DESC="Sing-box proxy"

start() {
    if [ "$BOOT_START" = "1" ] && [ ! -f "$AUTOSTART_FLAG" ]; then
        echo "$DESC: autostart disabled, skipping"
        return 0
    fi
    if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
        echo "$DESC already running"
        return 0
    fi
    echo "Starting $DESC..."
    $SINGBOX_BIN run -c "$SINGBOX_CONFIG" &
    echo $! > "$PIDFILE"
    sleep 1
    if kill -0 $(cat "$PIDFILE") 2>/dev/null; then
        echo "$DESC started"
    else
        echo "$DESC failed to start"
        rm -f "$PIDFILE"
        return 1
    fi
}

stop() {
    if [ -f "$PIDFILE" ]; then
        echo "Stopping $DESC..."
        kill $(cat "$PIDFILE") 2>/dev/null
        rm -f "$PIDFILE"
        sleep 1
        killall sing-box 2>/dev/null
        echo "$DESC stopped"
    else
        killall sing-box 2>/dev/null
    fi
}

status() {
    if [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; then
        echo "$DESC is running (PID: $(cat $PIDFILE))"
        return 0
    else
        echo "$DESC is not running"
        return 1
    fi
}

case "$1" in
    start)
        BOOT_START="${2:-1}"
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 1
        BOOT_START="0"
        start
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
EOF
    fi
    
    chmod +x /opt/etc/init.d/S99sing-box
    
    # Create autostart flag by default (VPN starts at boot)
    touch "$VPN_MANAGER_HOME/autostart-enabled"
    
    log_ok "Init-script created"
}

# =============================================================================
# Setup logging: syslog-ng (cloud) + local rotation (fallback)
# =============================================================================

# Generate unique Device ID (8 characters)
generate_device_id() {
    local device_id_file="$VPN_MANAGER_HOME/device-id"
    
    if [ -f "$device_id_file" ]; then
        cat "$device_id_file"
        return
    fi
    
    # Generate 8-character ID from UUID
    local device_id=$(cat /proc/sys/kernel/random/uuid | tr -d '-' | head -c 8)
    echo "$device_id" > "$device_id_file"
    chmod 644 "$device_id_file"
    echo "$device_id"
}

# Setup syslog-ng: logs stay on the router (/opt/var/log/messages via the default config).
# Nothing is sent anywhere; extra log destinations left by older versions are removed.
setup_syslog_ng() {
    log_info "Setting up syslog-ng..."

    local device_id=$(generate_device_id)
    log_ok "Device ID: $device_id"

    # syslog-ng.d is included by default syslog-ng.conf
    mkdir -p /opt/etc/syslog-ng.d
    rm -f /opt/etc/syslog-ng.d/loki.conf /opt/etc/vpn-manager/loki.conf.disabled

    # Enable and start syslog-ng
    if [ -x /opt/etc/init.d/S01syslog-ng ]; then
        /opt/etc/init.d/S01syslog-ng restart >/dev/null 2>&1 || true
        log_ok "syslog-ng started (local logs only)"
    else
        log_warn "syslog-ng init script not found"
    fi
}

setup_logrotate() {
    log_info "Setting up logging..."
    
    # Setup syslog-ng for cloud logging
    setup_syslog_ng
    
    # System log in RAM: writing it line by line to the USB drive wears the drive out
    if [ -f "$SCRIPT_DIR/scripts/S00log-ram" ]; then
        sed 's/\r$//' "$SCRIPT_DIR/scripts/S00log-ram" > /opt/etc/init.d/S00log-ram
        chmod +x /opt/etc/init.d/S00log-ram
        /opt/etc/init.d/S00log-ram start
        [ -x /opt/etc/init.d/S01syslog-ng ] && /opt/etc/init.d/S01syslog-ng restart >/dev/null 2>&1
        log_ok "System log kept in RAM (/tmp/log/messages)"
    fi

    # Install log upkeep script (size cap, verbose mode expiry, daily errors copy)
    if [ -f "$SCRIPT_DIR/scripts/syslog-rotate.sh" ]; then
        sed 's/\r$//' "$SCRIPT_DIR/scripts/syslog-rotate.sh" > /opt/bin/syslog-rotate.sh
        chmod +x /opt/bin/syslog-rotate.sh
        log_ok "Syslog rotation script installed"
    fi
    
    # Setup crontab
    mkdir -p /opt/var/spool/cron/crontabs
    local crontab_file="/opt/var/spool/cron/crontabs/root"
    
    # Remove old entries
    if [ -f "$crontab_file" ]; then
        grep -v "singbox-logrotate\|logs-rotate\|syslog-rotate" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
        mv "${crontab_file}.tmp" "$crontab_file"
    fi
    
    # Log upkeep every 10 minutes (cheap: the log is in RAM)
    echo "*/10 * * * * /opt/bin/syslog-rotate.sh >/dev/null 2>&1" >> "$crontab_file"
    log_ok "Log upkeep configured (every 10 minutes)"
    
    # Add task for auto-update subscriptions (every hour)
    if [ -f "$SCRIPT_DIR/scripts/subscription-update.sh" ]; then
        mkdir -p "$VPN_MANAGER_HOME/scripts"
        sed 's/\r$//' "$SCRIPT_DIR/scripts/subscription-update.sh" > "$VPN_MANAGER_HOME/scripts/subscription-update.sh"
        chmod +x "$VPN_MANAGER_HOME/scripts/subscription-update.sh"
        grep -v "subscription-update" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
        mv "${crontab_file}.tmp" "$crontab_file"
        echo "0 * * * * $VPN_MANAGER_HOME/scripts/subscription-update.sh >/dev/null 2>&1" >> "$crontab_file"
        log_ok "Subscription auto-update configured (hourly)"
    fi
    
    # FEAT-011: Add task for auto-update lists domains/subnets (daily at 4:00)
    if [ -f "$SCRIPT_DIR/scripts/lists-update.sh" ]; then
        mkdir -p "$VPN_MANAGER_HOME/scripts"
        sed 's/\r$//' "$SCRIPT_DIR/scripts/lists-update.sh" > "$VPN_MANAGER_HOME/scripts/lists-update.sh"
        chmod +x "$VPN_MANAGER_HOME/scripts/lists-update.sh"
        grep -v "lists-update" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
        mv "${crontab_file}.tmp" "$crontab_file"
        echo "0 4 * * * $VPN_MANAGER_HOME/scripts/lists-update.sh update >/dev/null 2>&1" >> "$crontab_file"
        log_ok "Lists auto-update configured (daily at 4:00)"
    fi

    # B1: "Russia" list set — its script and default lists (existing lists are kept)
    if [ -f "$SCRIPT_DIR/scripts/direct-lists.sh" ]; then
        mkdir -p "$VPN_MANAGER_HOME/scripts"
        sed 's/\r$//' "$SCRIPT_DIR/scripts/direct-lists.sh" > "$VPN_MANAGER_HOME/scripts/direct-lists.sh"
        chmod +x "$VPN_MANAGER_HOME/scripts/direct-lists.sh"
        for f in direct-domains.txt direct-domains-udp.txt direct-subnets.txt direct-subnets-udp.txt; do
            if [ ! -s "$VPN_MANAGER_HOME/$f" ] && [ -f "$SCRIPT_DIR/config/$f" ]; then
                sed 's/\r$//' "$SCRIPT_DIR/config/$f" > "$VPN_MANAGER_HOME/$f"
            fi
        done
        log_ok "Russia list set installed"
    fi
    
    # Add task for updates cache segments (every 5 minutes)
    grep -v "update-cache" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
    mv "${crontab_file}.tmp" "$crontab_file"
    echo "*/5 * * * * /opt/etc/init.d/S98singbox-rules update-cache >/dev/null 2>&1" >> "$crontab_file"
    log_ok "Segment cache update configured (every 5 minutes)"

    # B9: addresses of all VPN servers, resolved from their names, bypass the tunnel
    grep -v "update-servers" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
    mv "${crontab_file}.tmp" "$crontab_file"
    echo "7 * * * * /opt/etc/init.d/S98singbox-rules update-servers >/dev/null 2>&1" >> "$crontab_file"
    log_ok "VPN server address list update configured (hourly)"
    
    # Add task to apply deferred IPv6 settings (every minute)
    grep -v "apply-ipv6-pending" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
    mv "${crontab_file}.tmp" "$crontab_file"
    echo "* * * * * /opt/etc/init.d/S98singbox-rules apply-ipv6-pending >/dev/null 2>&1" >> "$crontab_file"
    log_ok "IPv6 apply configured (every minute)"

    # Re-check DNS upstream (plain vs DoT) when WAN conditions change
    grep -v "dns-upstream-fallback" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
    mv "${crontab_file}.tmp" "$crontab_file"
    echo "*/15 * * * * $VPN_MANAGER_HOME/scripts/dns-upstream-fallback.sh apply --quiet >/dev/null 2>&1" >> "$crontab_file"
    log_ok "DNS upstream fallback recheck configured (every 15 minutes)"

    # Keep per-domain DoT routing in sync with the domain lists; also watchdogs stubby
    grep -v "dns-dot-domains" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
    mv "${crontab_file}.tmp" "$crontab_file"
    echo "*/10 * * * * $VPN_MANAGER_HOME/scripts/dns-dot-domains.sh >/dev/null 2>&1" >> "$crontab_file"
    log_ok "Per-domain DoT routing configured (every 10 minutes)"

    # B2: nightly self-update check. The line is always installed; the script
    # itself returns immediately while the panel switch is off, so this costs a
    # router that does not want updates one no-op a day.
    grep -v "update-check" "$crontab_file" > "${crontab_file}.tmp" 2>/dev/null || true
    mv "${crontab_file}.tmp" "$crontab_file"
    echo "23 5 * * * $VPN_MANAGER_HOME/scripts/update-check.sh cron >/dev/null 2>&1" >> "$crontab_file"
    log_ok "Self-update check configured (nightly, 05:23)"

    # IMPORTANT: cron requires permissions 600 on crontab, else BAD FILE MODE
    chmod 600 "$crontab_file"
    
    # Startaem cron if not running
    if [ -x /opt/etc/init.d/S10cron ]; then
        /opt/etc/init.d/S10cron restart >/dev/null 2>&1 || true
    fi
    
    log_ok "Log rotation configured (daily at 3:00)"
}

# =============================================================================
# Generate dnsmasq configov from lists domains
# =============================================================================

generate_dnsmasq_config() {
    log_info "Generating dnsmasq configuration..."
    
    mkdir -p /opt/etc/dnsmasq.d
    
    # =========================================================================
    # TCP+UDP domains → ipset vpn_domains
    # Use merged list: local + remote (FEAT-011)
    # =========================================================================
    cat > "$DNSMASQ_VPN_CONF" << 'EOF'
# Automatically generated install-singbox.sh
# TCP+UDP domains → ipset vpn_domains
# All traffic (TCP and UDP) to this domainm goes via VPN
# Sources: vpn-domains.txt (local) + remote-lists/tcp_udp_domains.txt (auto)

EOF
    
    local tcpudp_count=0
    local merged_domains=$(get_merged_domains)
    
    if [ -n "$merged_domains" ]; then
        echo "$merged_domains" | while IFS= read -r domain; do
            [ -z "$domain" ] && continue
            echo "ipset=/$domain/vpn_domains,vpn_domains6" >> "$DNSMASQ_VPN_CONF"
            tcpudp_count=$((tcpudp_count + 1))
        done
        tcpudp_count=$(echo "$merged_domains" | wc -l)
        log_ok "TCP+UDP domains: $tcpudp_count (merged)"
    else
        log_warn "No domains for TCP+UDP"
        cat >> "$DNSMASQ_VPN_CONF" << 'EOF'
# Testovye domains
ipset=/icanhazip.com/vpn_domains,vpn_domains6
ipset=/wtfismyip.com/vpn_domains,vpn_domains6
ipset=/2ip.ru/vpn_domains,vpn_domains6
EOF
    fi
    
    # =========================================================================
    # UDP-only domains → ipset vpn_domains_udp
    # Use merged list: local + remote (FEAT-011)
    # =========================================================================
    cat > "$DNSMASQ_VPN_UDP_CONF" << 'EOF'
# Automatically generated install-singbox.sh
# UDP-only domains → ipset vpn_domains_udp
# Only UDP traffic to this domainm goes via VPN (TCP directly)
# Sources: vpn-domains-udp.txt (local) + remote-lists/udp_domains.txt (auto)

EOF
    
    local udp_count=0
    local merged_domains_udp=$(get_merged_domains_udp)
    
    if [ -n "$merged_domains_udp" ]; then
        echo "$merged_domains_udp" | while IFS= read -r domain; do
            [ -z "$domain" ] && continue
            echo "ipset=/$domain/vpn_domains_udp,vpn_domains6_udp" >> "$DNSMASQ_VPN_UDP_CONF"
        done
        udp_count=$(echo "$merged_domains_udp" | wc -l)
        log_ok "UDP-only domains: $udp_count (merged)"
    else
        log_warn "No domains for UDP-only"
        cat >> "$DNSMASQ_VPN_UDP_CONF" << 'EOF'
# Telegram (UDP for calls/video)
ipset=/telegram.org/vpn_domains_udp,vpn_domains6_udp
ipset=/t.me/vpn_domains_udp,vpn_domains6_udp
ipset=/telegram.me/vpn_domains_udp,vpn_domains6_udp
EOF
    fi
    
    # =========================================================================
    # Check that dnsmasq includes dnsmasq.d
    # =========================================================================
    if [ -f /opt/etc/dnsmasq.conf ]; then
        if ! grep -q "conf-dir=/opt/etc/dnsmasq.d" /opt/etc/dnsmasq.conf; then
            echo "" >> /opt/etc/dnsmasq.conf
            echo "# Include VPN domains" >> /opt/etc/dnsmasq.conf
            echo "conf-dir=/opt/etc/dnsmasq.d" >> /opt/etc/dnsmasq.conf
            log_ok "Added conf-dir to dnsmasq.conf"
        fi
    fi
    
    # B1: "Russia" list set — its dnsmasq config and ipsets (script installed earlier)
    if [ -x "$VPN_MANAGER_HOME/scripts/direct-lists.sh" ]; then
        "$VPN_MANAGER_HOME/scripts/direct-lists.sh" dnsmasq >/dev/null 2>&1 && log_ok "Russia list set: dnsmasq config generated"
    fi

    # =========================================================================
    # Setup upstream DNS (plain :53 or DoT fallback via stubby)
    # =========================================================================
    log_info "Configuring upstream DNS servers..."
    local fallback="$VPN_MANAGER_HOME/scripts/dns-upstream-fallback.sh"
    if [ -x "$fallback" ]; then
        "$fallback" apply --no-restart || log_warn "DNS upstream detection failed (will retry on service start)"
    else
        log_warn "dns-upstream-fallback.sh not found — run install_vpn_manager first"
    fi
}

# =============================================================================
# Script iptables rules (copy from scripts/)
# =============================================================================

create_rules_init() {
    log_info "Installing iptables rules script..."
    
    local source_script="$SCRIPT_DIR/scripts/S98singbox-rules"
    
    if [ -f "$source_script" ]; then
        # Copy and convert CRLF → LF (on sluchay if files with Windows)
        sed 's/\r$//' "$source_script" > "$INIT_RULES"
        chmod +x "$INIT_RULES"
        log_ok "Script rules installed: $INIT_RULES"
        
        # Install netfilter hook for automatic rules restoration
        # when Keenetic recreates iptables (WAN reconnection, settings change)
        local netfilter_hook="$SCRIPT_DIR/scripts/100-singbox.sh"
        local netfilter_dir="/opt/etc/ndm/netfilter.d"
        if [ -f "$netfilter_hook" ]; then
            mkdir -p "$netfilter_dir"
            sed 's/\r$//' "$netfilter_hook" > "$netfilter_dir/100-singbox.sh"
            chmod +x "$netfilter_dir/100-singbox.sh"
            log_ok "hook netfilter installed (auto-restore rules)"
        fi
    else
        log_error "File $source_script not found!"
        log_info "Create basic script..."
        
        cat > "$INIT_RULES" << 'EOFSCRIPT'
#!/bin/sh
# sing-box TUN routing rules (basic fallback version)
# Full version: scripts/S98singbox-rules

TUN_INTERFACE="singbox0"
TUN_TABLE=100
TUN_FWMARK="0x100"
VPN_SERVERS=""

start() {
    echo "Creating ipsets..."
    ipset create vpn_domains hash:ip timeout 86400 2>/dev/null || true
    ipset create vpn_domains_udp hash:ip timeout 86400 2>/dev/null || true
    
    echo "Setting up iptables MARK rules..."
    iptables -t mangle -N SING_BOX_MARK 2>/dev/null || iptables -t mangle -F SING_BOX_MARK
    
    for server in $VPN_SERVERS; do
        iptables -t mangle -A SING_BOX_MARK -d $server -j RETURN
    done
    
    iptables -t mangle -A SING_BOX_MARK -d 192.168.0.0/16 -j RETURN
    iptables -t mangle -A SING_BOX_MARK -d 10.0.0.0/8 -j RETURN
    iptables -t mangle -A SING_BOX_MARK -d 172.16.0.0/12 -j RETURN
    iptables -t mangle -A SING_BOX_MARK -d 127.0.0.0/8 -j RETURN
    
    iptables -t mangle -A SING_BOX_MARK -m set --match-set vpn_domains dst -j MARK --set-mark $TUN_FWMARK
    iptables -t mangle -A SING_BOX_MARK -m set --match-set vpn_domains_udp dst -j MARK --set-mark $TUN_FWMARK
    
    LAN_IF=$(ip route | grep "^192.168" | awk '{print $3}' | head -1)
    [ -z "$LAN_IF" ] && LAN_IF="br0"
    
    iptables -t mangle -C PREROUTING -i $LAN_IF -j SING_BOX_MARK 2>/dev/null || \
        iptables -t mangle -A PREROUTING -i $LAN_IF -j SING_BOX_MARK
    
    echo "Setting up FORWARD rules for TUN..."
    iptables -C FORWARD -i $TUN_INTERFACE -j ACCEPT 2>/dev/null || \
        iptables -I FORWARD -i $TUN_INTERFACE -j ACCEPT
    iptables -C FORWARD -o $TUN_INTERFACE -j ACCEPT 2>/dev/null || \
        iptables -I FORWARD -o $TUN_INTERFACE -j ACCEPT
    
    iptables -t nat -C POSTROUTING -o $TUN_INTERFACE -j RETURN 2>/dev/null || \
        iptables -t nat -I POSTROUTING -o $TUN_INTERFACE -j RETURN
    
    echo "Setting up policy routing..."
    mkdir -p /opt/etc/iproute2
    grep -q "^${TUN_TABLE} vpn$" /opt/etc/iproute2/rt_tables 2>/dev/null || echo "${TUN_TABLE} vpn" >> /opt/etc/iproute2/rt_tables
    ln -sf /opt/etc/iproute2 /tmp/iproute2 2>/dev/null
    
    ip rule add fwmark $TUN_FWMARK lookup $TUN_TABLE priority 100 2>/dev/null
    ip route add default dev $TUN_INTERFACE table $TUN_TABLE 2>/dev/null
    
    echo "Done."
}

stop() {
    echo "Removing rules..."
    iptables -t mangle -D PREROUTING -i br0 -j SING_BOX_MARK 2>/dev/null
    iptables -t mangle -F SING_BOX_MARK 2>/dev/null
    iptables -t mangle -X SING_BOX_MARK 2>/dev/null
    iptables -D FORWARD -i $TUN_INTERFACE -j ACCEPT 2>/dev/null
    iptables -D FORWARD -o $TUN_INTERFACE -j ACCEPT 2>/dev/null
    iptables -t nat -D POSTROUTING -o $TUN_INTERFACE -j RETURN 2>/dev/null
    ip rule del fwmark $TUN_FWMARK lookup $TUN_TABLE 2>/dev/null
    ip route del default dev $TUN_INTERFACE table $TUN_TABLE 2>/dev/null
    echo "Done."
}

case "$1" in
    start) start ;;
    stop) stop ;;
    restart) stop; sleep 1; start ;;
    status) ipset list vpn_domains 2>/dev/null | head -10 ;;
    *) echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac
EOFSCRIPT
        
        chmod +x "$INIT_RULES"
        log_warn "Created basic script. recommended use full version from scripts/"
    fi
}

# =============================================================================
# Install VPN Manager (web UI)
# =============================================================================

install_vpn_manager() {
    log_info "Installation VPN Manager..."
    
    # Install lighttpd
    if ! opkg list-installed | grep -q "^lighttpd "; then
        log_info "Installation lighttpd..."
        opkg install lighttpd lighttpd-mod-cgi lighttpd-mod-setenv >/dev/null 2>&1 || {
            log_warn "Not managed install lighttpd"
            return 1
        }
    fi
    log_ok "lighttpd installed"
    
    # Create directories VPN Manager
    mkdir -p "$VPN_MANAGER_HOME"
    mkdir -p "$VPN_MANAGER_HOME/configs"
    mkdir -p "$VPN_MANAGER_HOME/backups"
    mkdir -p /opt/var/log/vpn-manager

    # Generate persistent router HWID for subscription authentication
    local hwid_file="$VPN_MANAGER_HOME/router-hwid"
    if [ ! -f "$hwid_file" ] || [ ! -s "$hwid_file" ]; then
        local hwid
        hwid=$(cat /dev/urandom 2>/dev/null | tr -dc 'a-f0-9' | head -c 16)
        [ -z "$hwid" ] && hwid=$(date +%s | md5sum 2>/dev/null | head -c 16)
        [ -z "$hwid" ] && hwid="vpnmanager000001"
        echo "$hwid" > "$hwid_file"
        log_ok "Router HWID generated: $hwid"
    else
        log_ok "Router HWID already exists: $(cat "$hwid_file")"
    fi
    
    # Copy web UI in /opt/share/www/vpn-manager (document-root lighttpd)
    if [ -d "$SCRIPT_DIR/web" ]; then
        mkdir -p /opt/share/www/vpn-manager
        cp -r "$SCRIPT_DIR/web/"* /opt/share/www/vpn-manager/
        chmod +x /opt/share/www/vpn-manager/api/*.cgi 2>/dev/null
        # Convert CRLF in LF for CGI and shell fileov (Windows -> Unix)
        for f in /opt/share/www/vpn-manager/api/*.cgi /opt/share/www/vpn-manager/api/*.sh; do
            [ -f "$f" ] && sed -i 's/\r$//' "$f"
        done
        # Cache-bust static assets (app.js, style.css) on each install/update
        local web_ver
        web_ver=$(cat "$SCRIPT_DIR/VERSION" 2>/dev/null | tr -d '\r\n')
        [ -z "$web_ver" ] && web_ver="dev"
        if [ -f /opt/share/www/vpn-manager/index.html ]; then
            sed -i "s/__APP_VERSION__/${web_ver}/g" /opt/share/www/vpn-manager/index.html
        fi
        # Installed version on the router: panel status and future auto-update read it here
        mkdir -p /opt/etc/vpn-manager
        echo "$web_ver" > /opt/etc/vpn-manager/VERSION
        log_ok "Web UI installed in /opt/share/www/vpn-manager/"
    else
        log_warn "directory web/ not found"
    fi
    
    # Copy files domains (only if not exist or empty)
    if [ -f "$DOMAINS_FILE_SRC" ]; then
        if [ ! -f "$DOMAINS_FILE" ] || [ ! -s "$DOMAINS_FILE" ]; then
            cp "$DOMAINS_FILE_SRC" "$DOMAINS_FILE"
            # Convert CRLF → LF (Windows → Unix)
            sed -i 's/\r$//' "$DOMAINS_FILE"
            log_ok "Copied list TCP+UDP domains"
        fi
    fi
    if [ -f "$DOMAINS_UDP_FILE_SRC" ]; then
        if [ ! -f "$DOMAINS_UDP_FILE" ] || [ ! -s "$DOMAINS_UDP_FILE" ]; then
            cp "$DOMAINS_UDP_FILE_SRC" "$DOMAINS_UDP_FILE"
            # Convert CRLF → LF (Windows → Unix)
            sed -i 's/\r$//' "$DOMAINS_UDP_FILE"
            log_ok "Copied list UDP-only domains"
        fi
    fi
    if [ -f "$SCRIPT_DIR/config/device-routing.json" ]; then
        cp "$SCRIPT_DIR/config/device-routing.json" "$VPN_MANAGER_HOME/"
    fi
    
    # Copy script auto-update subscriptions
    mkdir -p "$VPN_MANAGER_HOME/scripts"
    if [ -f "$SCRIPT_DIR/scripts/subscription-update.sh" ]; then
        cp "$SCRIPT_DIR/scripts/subscription-update.sh" "$VPN_MANAGER_HOME/scripts/"
        chmod +x "$VPN_MANAGER_HOME/scripts/subscription-update.sh"
        sed -i 's/\r$//' "$VPN_MANAGER_HOME/scripts/subscription-update.sh"
        log_ok "Script auto-update subscriptions installed"
    fi
    
    # FEAT-011: Copy script auto-update lists
    if [ -f "$SCRIPT_DIR/scripts/lists-update.sh" ]; then
        cp "$SCRIPT_DIR/scripts/lists-update.sh" "$VPN_MANAGER_HOME/scripts/"
        chmod +x "$VPN_MANAGER_HOME/scripts/lists-update.sh"
        sed -i 's/\r$//' "$VPN_MANAGER_HOME/scripts/lists-update.sh"
        log_ok "Script auto-update lists installed"
    fi
    
    # Failover daemon (auto-switch VPN configs when active is unreachable)
    if [ -f "$SCRIPT_DIR/scripts/failover-daemon.sh" ]; then
        cp "$SCRIPT_DIR/scripts/failover-daemon.sh" "$VPN_MANAGER_HOME/scripts/"
        chmod +x "$VPN_MANAGER_HOME/scripts/failover-daemon.sh"
        sed -i 's/\r$//' "$VPN_MANAGER_HOME/scripts/failover-daemon.sh"
        log_ok "Failover daemon installed"
    fi

    # DNS upstream fallback (plain :53 → DoT via stubby when WAN blocks port 53)
    if [ -f "$SCRIPT_DIR/scripts/dns-upstream-fallback.sh" ]; then
        cp "$SCRIPT_DIR/scripts/dns-upstream-fallback.sh" "$VPN_MANAGER_HOME/scripts/"
        chmod +x "$VPN_MANAGER_HOME/scripts/dns-upstream-fallback.sh"
        sed -i 's/\r$//' "$VPN_MANAGER_HOME/scripts/dns-upstream-fallback.sh"
        log_ok "DNS upstream fallback script installed"
    fi

    # Per-domain DoT routing: VPN-list domains resolved via stubby, so a provider
    # that forges answers for specific names (NXDOMAIN with aa flag) cannot lie.
    if [ -f "$SCRIPT_DIR/scripts/dns-dot-domains.sh" ]; then
        cp "$SCRIPT_DIR/scripts/dns-dot-domains.sh" "$VPN_MANAGER_HOME/scripts/"
        chmod +x "$VPN_MANAGER_HOME/scripts/dns-dot-domains.sh"
        sed -i 's/\r$//' "$VPN_MANAGER_HOME/scripts/dns-dot-domains.sh"
        log_ok "Per-domain DoT routing script installed"
    fi

    # B2: self-update. Inert until a source URL is set and the switch is turned
    # on in the panel, so installing it changes nothing by itself.
    if [ -f "$SCRIPT_DIR/scripts/update-check.sh" ]; then
        cp "$SCRIPT_DIR/scripts/update-check.sh" "$VPN_MANAGER_HOME/scripts/"
        chmod +x "$VPN_MANAGER_HOME/scripts/update-check.sh"
        sed -i 's/\r$//' "$VPN_MANAGER_HOME/scripts/update-check.sh"
        log_ok "Self-update script installed"
    fi
    if [ -f "$SCRIPT_DIR/scripts/S55dns-dot-stub" ]; then
        sed 's/\r$//' "$SCRIPT_DIR/scripts/S55dns-dot-stub" > /opt/etc/init.d/S55dns-dot-stub
        chmod +x /opt/etc/init.d/S55dns-dot-stub
        log_ok "DoT stub init installed: /opt/etc/init.d/S55dns-dot-stub"
    fi
    
    # FEAT-011: Create directory for removednykh lists
    mkdir -p "$REMOTE_LISTS_DIR"
    log_ok "directory remote-lists created"
    
    # FEAT-011: Initialize settings.json with auto_update_lists=true
    # FEAT-200: Add lists_source_url (configurable remote lists source)
    # FEAT-202: Add dnsmasq_port (configurable internal DNS port)
    if [ ! -s "$VPN_MANAGER_HOME/settings.json" ] || ! jq empty "$VPN_MANAGER_HOME/settings.json" 2>/dev/null; then
        cat > "$VPN_MANAGER_HOME/settings.json" << 'EOF'
{
  "web_port": 8001,
  "auto_update_lists": true,
  "lists_source_url": "https://raw.githubusercontent.com/6g22zdtvk8-tech/split-kvn-lists/main",
  "dnsmasq_port": 5353,
  "failover_mode": "off",
  "failover_check_interval": 300,
  "auto_update": true,
  "update_source_url": "https://github.com/6g22zdtvk8-tech/split-kvn/releases/latest/download/manifest.json",
  "update_source_migrated": true,
  "usdt_wallet": "TKeLZvc52avetPTngMC4TvJrv9zAu56Tv2"
}
EOF
        log_ok "Settings initialized"
    else
        # Ensure usdt_wallet exists in existing settings
        if ! jq -e '.usdt_wallet' "$VPN_MANAGER_HOME/settings.json" >/dev/null 2>&1; then
            local tmp=$(mktemp)
            jq '. + {"usdt_wallet": "TKeLZvc52avetPTngMC4TvJrv9zAu56Tv2"}' "$VPN_MANAGER_HOME/settings.json" > "$tmp" && mv "$tmp" "$VPN_MANAGER_HOME/settings.json"
            log_ok "Added usdt_wallet to existing settings"
        fi

        # B2: give an existing router the self-update keys. The switch is on by
        # the owner's decision, but the source is empty, so nothing happens until
        # a source is published and set — the nightly run exits quietly.
        if ! jq -e 'has("auto_update")' "$VPN_MANAGER_HOME/settings.json" >/dev/null 2>&1; then
            local tmp_au=$(mktemp)
            jq '. + {"auto_update": true, "update_source_url": (.update_source_url // "")}' \
                "$VPN_MANAGER_HOME/settings.json" > "$tmp_au" && mv "$tmp_au" "$VPN_MANAGER_HOME/settings.json"
            log_ok "Added self-update keys to existing settings (on, no source yet)"
        fi

        # Routers set up before releases were published have an empty source. Point
        # them at the published releases once; after that an empty source is the
        # owner's own choice (it switches updates off) and is left alone.
        if ! jq -e '.update_source_migrated' "$VPN_MANAGER_HOME/settings.json" >/dev/null 2>&1; then
            local tmp_src=$(mktemp)
            jq --arg u "$DEFAULT_UPDATE_SOURCE" \
                '(if (.update_source_url // "") == "" then .update_source_url = $u else . end) | .update_source_migrated = true' \
                "$VPN_MANAGER_HOME/settings.json" > "$tmp_src" && mv "$tmp_src" "$VPN_MANAGER_HOME/settings.json"
            log_ok "Update source: $(jq -r '.update_source_url' "$VPN_MANAGER_HOME/settings.json")"
        fi
    fi
    
    # Copy auth reset script
    if [ -f "$SCRIPT_DIR/scripts/vpn-manager-reset-auth.sh" ]; then
        cp "$SCRIPT_DIR/scripts/vpn-manager-reset-auth.sh" "$VPN_MANAGER_HOME/scripts/"
        chmod +x "$VPN_MANAGER_HOME/scripts/vpn-manager-reset-auth.sh"
        sed -i 's/\r$//' "$VPN_MANAGER_HOME/scripts/vpn-manager-reset-auth.sh"
        log_ok "Auth reset script installed"
    fi
    
    # Copy files IP-subnets (for voice calls and t.p.)
    if [ -f "$SUBNETS_FILE_SRC" ]; then
        cp "$SUBNETS_FILE_SRC" "$SUBNETS_FILE"
        sed -i 's/\r$//' "$SUBNETS_FILE"
        log_ok "Copied list IP-subnets (TCP+UDP)"
    fi
    if [ -f "$SUBNETS_UDP_FILE_SRC" ]; then
        cp "$SUBNETS_UDP_FILE_SRC" "$SUBNETS_UDP_FILE"
        sed -i 's/\r$//' "$SUBNETS_UDP_FILE"
        log_ok "Copied list IP-subnets (UDP-only)"
    fi
    
    # Fix CRLF in existing domain files (in case they were copied from Windows earlier)
    for domain_file in "$DOMAINS_FILE" "$DOMAINS_UDP_FILE"; do
        if [ -f "$domain_file" ] && grep -q $'\r' "$domain_file" 2>/dev/null; then
            sed -i 's/\r$//' "$domain_file"
            log_ok "Ispravleny perevody strok in $(basename "$domain_file")"
        fi
    done
    
    # Copy auth-template.json for auth reset capability
        if [ -f "$SCRIPT_DIR/config/auth-template.json" ]; then
        cp "$SCRIPT_DIR/config/auth-template.json" "$VPN_MANAGER_HOME/auth-template.json"
        log_ok "Copied auth template"
    fi
    
    # Several connections is the default for a new router: the first server the
    # user ticks becomes the main one. A router that already runs a server
    # (an update, a reinstall over a working setup) keeps the mode it had.
    if [ ! -f "$VPN_MANAGER_HOME/multi.json" ] && [ ! -s "$VPN_MANAGER_HOME/active-config" ]; then
        echo '{"mode":"multi","members":[],"subscriptions":[],"primary":""}' > "$VPN_MANAGER_HOME/multi.json"
        log_ok "Default mode: several connections"
    fi

    # Create routing_policies.json with defoltami (if not exists)
    local ROUTING_POLICIES_FILE="$VPN_MANAGER_HOME/routing_policies.json"
    if [ ! -f "$ROUTING_POLICIES_FILE" ]; then
        echo '{"policies":{"br0":"split"},"global":"split"}' > "$ROUTING_POLICIES_FILE"
        chmod 644 "$ROUTING_POLICIES_FILE"
        log_ok "Created file policies routing (by default: split)"
    fi
    
    # Create auth.db (reset on a fresh install, kept on an update)
    # Old file is backed up as auth.db.bak.TIMESTAMP
    if [ "$UPDATE_MODE" = "1" ] && [ -f "$VPN_MANAGER_HOME/auth.db" ]; then
        log_ok "Kept auth.db: password and sessions survive the update"
    else
    if [ -f "$VPN_MANAGER_HOME/auth.db" ]; then
        mv "$VPN_MANAGER_HOME/auth.db" "$VPN_MANAGER_HOME/auth.db.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    fi
    if [ -f "$VPN_MANAGER_HOME/auth-template.json" ]; then
        cp "$VPN_MANAGER_HOME/auth-template.json" "$VPN_MANAGER_HOME/auth.db"
    else
        # Default auth.db with disabled authorization
        cat > "$VPN_MANAGER_HOME/auth.db" << 'EOF'
{
  "users": [
    {
      "username": "admin",
      "password_hash": "",
      "first_login": false,
      "created_at": "",
      "last_login": "",
      "failed_attempts": 0,
      "locked_until": null
    }
  ],
  "settings": {
    "auth_mode": "disabled",
    "recovery_code": "",
    "onboarding_shown": false,
    "min_password_length": 8,
    "max_failed_attempts": 5,
    "lockout_duration_minutes": 15,
    "session_timeout_hours": 24
  }
}
EOF
    fi
    log_ok "Created auth.db (auth disabled, can enable in settings)"
    # B8: the old "no password, risk accepted" mark for VPN access went with the old
    # auth.db — access for VPN-server clients now needs a password again
    if [ -f "$VPN_MANAGER_HOME/settings.json" ] && command -v jq >/dev/null 2>&1; then
        if jq 'del(.vpn_lan_access_no_password)' "$VPN_MANAGER_HOME/settings.json" > "$VPN_MANAGER_HOME/settings.json.b8" 2>/dev/null && \
           [ -s "$VPN_MANAGER_HOME/settings.json.b8" ]; then
            cat "$VPN_MANAGER_HOME/settings.json.b8" > "$VPN_MANAGER_HOME/settings.json"
        fi
        rm -f "$VPN_MANAGER_HOME/settings.json.b8"
    fi
    # ...and the existing sing-box config may still carry the B8 rules: with no password
    # they must go now, not at the first rebuild (the same config as with access off)
    if [ -s "$SINGBOX_CONFIG" ] && command -v jq >/dev/null 2>&1; then
        if jq '.route.rules = [(.route.rules // [])[] | select((((.outbound // "") | startswith("direct-lan-")) or (.inbound == ["ss-server-in"] and .action == "reject")) | not)]
               | .outbounds = [(.outbounds // [])[] | select((.tag // "") | startswith("direct-lan-") | not)]' \
               "$SINGBOX_CONFIG" > "$SINGBOX_CONFIG.b8" 2>/dev/null && [ -s "$SINGBOX_CONFIG.b8" ] && jq empty "$SINGBOX_CONFIG.b8" 2>/dev/null; then
            cmp -s "$SINGBOX_CONFIG.b8" "$SINGBOX_CONFIG" || cat "$SINGBOX_CONFIG.b8" > "$SINGBOX_CONFIG"
        fi
        rm -f "$SINGBOX_CONFIG.b8"
    fi
    fi
    
    # Main config: port for VPN Manager
    # Without server.bind — slushaet on all interfaces (0.0.0.0)
    # Bezopasnost obespechivaetsya pravilom $HTTP["remoteip"] in 99-vpn-manager.conf
    cat > /opt/etc/lighttpd/conf.d/00-vpn-manager-base.conf << 'EOF'
# VPN Manager: port 8001
# Slushaet on all interfaces, access ogranichen only lokalnymi setyami
# (sm. rule $HTTP["remoteip"] in 99-vpn-manager.conf)
server.port = 8001
EOF
    log_ok "configured port 8001 (all interfaces)"
    
    # Modify standard 30-cgi.conf so .cgi uses shebang, not perl
    # This need potomu that our CGI scripty — shell, not perl
    if [ -f /opt/etc/lighttpd/conf.d/30-cgi.conf ]; then
        sed -i 's|".cgi" => "/opt/bin/perl"|".cgi" => ""|' /opt/etc/lighttpd/conf.d/30-cgi.conf
        log_ok "Configured CGI for shell scripts"
    fi
    
    # Delete old file if remains from previous installation
    rm -f /opt/etc/lighttpd/conf.d/35-cgi-shell.conf
    
    # Configuration VPN Manager
    cat > /opt/etc/lighttpd/conf.d/99-vpn-manager.conf << 'EOF'
# VPN Manager configuration
server.modules += ("mod_access", "mod_alias")

# Alias: all requests to / are directed to vpn-manager
alias.url = (
    "/" => "/opt/share/www/vpn-manager/"
)

# Environment for CGI
setenv.add-environment += (
    "VPN_MANAGER_HOME" => "/opt/etc/vpn-manager"
)

# Zashchita: only local network
$HTTP["remoteip"] !~ "^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)" {
    url.access-deny = ("")
}
EOF
    
    log_ok "Configuration lighttpd created (port 8001)"
    
    # Restart/start lighttpd
    if [ -f /opt/etc/init.d/S80lighttpd ] && [ -f /opt/etc/init.d/rc.func ]; then
        /opt/etc/init.d/S80lighttpd restart >/dev/null 2>&1 || true
    else
        if [ ! -f /opt/etc/init.d/rc.func ]; then
            log_warn "rc.func not found, start lighttpd directly"
        fi
        if [ -x /opt/sbin/lighttpd ]; then
            /opt/sbin/lighttpd -f /opt/etc/lighttpd/lighttpd.conf -m /opt/lib/lighttpd >/dev/null 2>&1 || true
        fi
    fi

    if ps w | grep -q "[l]ighttpd"; then
        log_ok "lighttpd running"
    else
        log_warn "lighttpd not running"
    fi
}

# (Old setup_logrotate function removed - using new one above)

# =============================================================================
# Check configuration
# =============================================================================

verify_config() {
    log_info "Check configuration sing-box..."
    
    if sing-box check -c "$SINGBOX_CONFIG" 2>/dev/null; then
        log_ok "Configuration valid"
        return 0
    else
        log_error "Configuration error!"
        sing-box check -c "$SINGBOX_CONFIG"
        return 1
    fi
}

# =============================================================================
# Start services
# =============================================================================

start_services() {
    log_info "Start services..."

    # Detect plain vs DoT upstream, then restart dnsmasq (+ stubby if needed)
    local fallback="$VPN_MANAGER_HOME/scripts/dns-upstream-fallback.sh"
    if [ -x "$fallback" ]; then
        "$fallback" apply --no-restart || log_warn "DNS upstream fallback apply failed"
    fi
    
    # Restart dnsmasq
    if [ -f /opt/etc/init.d/S56dnsmasq ]; then
        /opt/etc/init.d/S56dnsmasq restart >/dev/null 2>&1 || true
        log_ok "dnsmasq restarted"
    fi
    
    # Start iptables rules
    "$INIT_RULES" start
    
    # Start sing-box
    /opt/etc/init.d/S99sing-box restart >/dev/null 2>&1 || {
        log_error "Not managed start sing-box"
        return 1
    }
    
    sleep 2
    
    if pgrep -f "sing-box" >/dev/null 2>&1; then
        log_ok "sing-box running"
    else
        log_error "sing-box not started"
        return 1
    fi
    
    # VPN-server now built-in in sing-box how VLESS inbound
    # Separate ssserver and 110-vpn-client-routing no longer needed
    log_ok "VPN-server built-in in sing-box (port $SS_SERVER_PORT)"
}

# =============================================================================
# Information
# =============================================================================

print_info() {
    # Get IP with LAN interface (br0), but not WAN
    local router_ip=$(ip addr show br0 2>/dev/null | grep "inet " | awk '{print $2}' | cut -d'/' -f1 | head -1)
    [ -z "$router_ip" ] && router_ip="192.168.1.1"
    
    echo ""
    printf "${GREEN}============================================${NC}\n"
    printf "${GREEN}   sing-box VPN successfully installed!${NC}\n"
    printf "${GREEN}============================================${NC}\n"
    echo ""
    printf "Version: ${BLUE}%s${NC}\n" "$VERSION"
    echo ""
    printf "${GREEN}VPN Manager:${NC}\n"
    printf "  URL: ${BLUE}http://%s:8001${NC}\n" "$router_ip"
    printf "  Auth: ${BLUE}disabled${NC} (can enable in settings)\n"
    echo ""
    printf "${YELLOW}VPN Client Setup (outbound VPN):${NC}\n"
    printf "  Add VPN-configuration via VPN Manager\n"
    printf "  or edit: ${BLUE}%s${NC}\n" "$SINGBOX_CONFIG"
    echo ""
    
    # Show credentials VPN-servers if on configured
    if [ -f "$SS_SERVER_CREDS" ]; then
        printf "${GREEN}VPN Server (for external clients):${NC}\n"
        printf "  Port: ${BLUE}%s${NC}\n" "$SS_SERVER_PORT"
        printf "  Protocol: ${BLUE}VLESS + WebSocket${NC}\n"
        printf "  Transport: ${BLUE}WebSocket (ws)${NC}\n"
        echo ""
        printf "${YELLOW}IMPORTANT for VPN-servers:${NC}\n"
        printf "  1. Open port %s (TCP) in Keenetic settings\n" "$SS_SERVER_PORT"
        printf "  2. Use DDNS or external IP for connection\n"
        printf "  3. QR code and link: VPN Manager → VPN Server\n"
        echo ""
    fi
    
    printf "${GREEN}============================================${NC}\n"
}

# =============================================================================
# update domains
# =============================================================================

update_domains() {
    log_info "Updating domain list..."
    generate_dnsmasq_config
    
    if [ -f /opt/etc/init.d/S56dnsmasq ]; then
        /opt/etc/init.d/S56dnsmasq restart >/dev/null 2>&1
        log_ok "dnsmasq restarted"
    fi
    
    log_ok "Domeny updated"
}

# =============================================================================
# Clear old components
# =============================================================================

cleanup_legacy_components() {
    local cleaned=0
    
    # Delete the Shadowsocks-era user API. Nothing calls it any more, but it is
    # still reachable over HTTP and its update_singbox_users() writes users in the
    # Shadowsocks shape ({name, password}) into what is now a VLESS inbound — one
    # request would strip every user's uuid and lock all clients out.
    if [ -f /opt/share/www/vpn-manager/api/ssserver.cgi ]; then
        rm -f /opt/share/www/vpn-manager/api/ssserver.cgi
        log_ok "Legacy ssserver.cgi removed (superseded by vpnserver.cgi)"
        cleaned=1
    fi

    # Delete old standalone ssserver (now built-in in sing-box)
    if [ -f /opt/etc/init.d/S23ssserver ]; then
        /opt/etc/init.d/S23ssserver stop >/dev/null 2>&1 || true
        killall ssserver 2>/dev/null || true
        rm -f /opt/etc/init.d/S23ssserver
        log_ok "Old ssserver removed (now built into sing-box)"
        cleaned=1
    fi
    
    # Ubivaem ssserver if on all still works
    if pgrep -f "ssserver" >/dev/null 2>&1; then
        killall ssserver 2>/dev/null || true
        cleaned=1
    fi
    
    # Delete old vpn-client-routing (no longer needed)
    if [ -f /opt/etc/ndm/netfilter.d/110-vpn-client-routing.sh ]; then
        rm -f /opt/etc/ndm/netfilter.d/110-vpn-client-routing.sh
        log_ok "Removed legacy 110-vpn-client-routing.sh"
        cleaned=1
    fi
    
    [ "$cleaned" -eq 0 ] && log_ok "old components not found"
}

# =============================================================================
# Main function
# =============================================================================


# Update an existing installation: refresh the code, keep the data.
#
# What this DOES replace: the panel (web UI and CGI), the helper scripts in
# $VPN_MANAGER_HOME/scripts, the init scripts, and the recorded version.
# What it NEVER touches: auth.db (password and sessions), settings.json,
# subscriptions, domain and subnet lists, the router HWID, the sing-box config
# and the VPN-server credentials — so clients keep working and nobody is logged out.
#
# It deliberately does not restart sing-box. A restart drops every tunnel in the
# house, and only the init scripts can require one; the caller is told when that
# is the case and decides. B2 (automatic updates) will drive the restart itself,
# with a backup taken first and a rollback if the check fails.
run_update() {
    check_root

    local old_ver="unknown"
    [ -f /opt/etc/vpn-manager/VERSION ] && old_ver="$(cat /opt/etc/vpn-manager/VERSION 2>/dev/null)"

    # The release number lives in VERSION next to this script (what install_vpn_manager
    # copies to the router); $VERSION above is the installer's own, long frozen
    local new_ver="$VERSION"
    if [ -f "$SCRIPT_DIR/VERSION" ]; then
        new_ver="$(head -1 "$SCRIPT_DIR/VERSION" 2>/dev/null | tr -d '\r\n')"
        [ -n "$new_ver" ] || new_ver="$VERSION"
    fi

    echo ""
    printf "${BLUE}============================================${NC}\n"
    printf "${BLUE}   VPN Manager update: %s -> %s${NC}\n" "$old_ver" "$new_ver"
    printf "${BLUE}============================================${NC}\n"
    echo ""

    if [ ! -d "$VPN_MANAGER_HOME" ]; then
        log_error "Nothing to update: $VPN_MANAGER_HOME not found"
        log_info "Run the installer without arguments for a fresh install"
        exit 1
    fi

    UPDATE_MODE=1

    # Fingerprint the init scripts before and after, so we can tell the caller
    # whether the running services are now older than the files on disk.
    local rules_before="" singbox_before="" rules_after="" singbox_after=""
    [ -f /opt/etc/init.d/S98singbox-rules ] && rules_before=$(md5sum /opt/etc/init.d/S98singbox-rules 2>/dev/null | awk '{print $1}')
    [ -f /opt/etc/init.d/S99sing-box ] && singbox_before=$(md5sum /opt/etc/init.d/S99sing-box 2>/dev/null | awk '{print $1}')

    # sing-box itself: an older build (1.12) cannot read the config the new panel
    # writes, so the binary is brought up to SINGBOX_VERSION first (no-op when current)
    log_info "=== sing-box ==="
    install_singbox_binary || log_warn "sing-box not updated — the panel keeps the old one"
    echo ""

    log_info "=== Panel and scripts ==="
    install_vpn_manager
    echo ""

    # The kept config.json is moved to the sing-box 1.14 format by the new panel code
    migrate_existing_singbox_config
    echo ""

    log_info "=== Service scripts ==="
    create_singbox_init
    create_rules_init
    setup_logrotate
    echo ""

    [ -f /opt/etc/init.d/S98singbox-rules ] && rules_after=$(md5sum /opt/etc/init.d/S98singbox-rules 2>/dev/null | awk '{print $1}')
    [ -f /opt/etc/init.d/S99sing-box ] && singbox_after=$(md5sum /opt/etc/init.d/S99sing-box 2>/dev/null | awk '{print $1}')

    # A new sing-box binary was installed with the old one stopped: start it on the
    # migrated config, rules after it (the kill switch holds VPN traffic meanwhile)
    if [ -x /opt/etc/init.d/S99sing-box ] && ! pidof sing-box >/dev/null 2>&1; then
        rm -f /opt/var/run/sing-box.stopped
        /opt/etc/init.d/S99sing-box start >/dev/null 2>&1
        SKIP_WARMUP=1 /opt/etc/init.d/S98singbox-rules start 0 >/dev/null 2>&1
        # the init script returns before sing-box is up (26.09 the check fired too early
        # and reported a failure while sing-box started a second later) — wait up to 15 s
        local i=0
        while [ $i -lt 15 ] && ! pidof sing-box >/dev/null 2>&1; do sleep 1; i=$((i + 1)); done
        if pidof sing-box >/dev/null 2>&1; then
            log_ok "sing-box started: $(/opt/bin/sing-box version 2>/dev/null | head -1)"
        else
            log_error "sing-box did not start — check: /opt/bin/sing-box check -c $SINGBOX_CONFIG"
        fi
    fi

    # The panel is plain files served by lighttpd: new code is live as soon as it
    # is copied, no restart needed. Reload only if lighttpd config changed.
    if [ -x /opt/etc/init.d/S80lighttpd ]; then
        /opt/etc/init.d/S80lighttpd restart >/dev/null 2>&1 || true
        log_ok "Panel reloaded"
    fi

    echo ""
    printf "${GREEN}============================================${NC}\n"
    printf "${GREEN}   Updated: %s -> %s${NC}\n" "$old_ver" "$new_ver"
    printf "${GREEN}============================================${NC}\n"
    log_ok "Password, settings, subscriptions and lists left untouched"

    if [ "$rules_before" != "$rules_after" ] || [ "$singbox_before" != "$singbox_after" ]; then
        echo ""
        log_warn "Service scripts changed — sing-box is still running the old ones"
        log_warn "Apply when a break is acceptable: /opt/etc/init.d/S99sing-box restart"
        [ "$rules_before" != "$rules_after" ] && log_warn "and /opt/etc/init.d/S98singbox-rules restart"
    else
        echo ""
        log_ok "Service scripts unchanged — no restart needed"
    fi
    echo ""
}

main() {
    case "$1" in
        update)
            run_update
            exit 0
            ;;
        update-domains)
            check_root
            update_domains
            exit 0
            ;;
        --help|-h)
            echo "sing-box VPN Installer v$VERSION"
            echo ""
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  (no arguments)    Install sing-box VPN (resets the panel password)"
            echo "  update            Update the code, keep password/settings/data"
            echo "  update-domains    update domain list from vpn-domains.txt"
            echo "  --help            Show this help"
            exit 0
            ;;
    esac
    
    echo ""
    printf "${BLUE}============================================${NC}\n"
    printf "${BLUE}   sing-box VPN Installer v%s${NC}\n" "$VERSION"
    printf "${BLUE}============================================${NC}\n"
    echo ""
    
    check_root
    
    log_info "=== Cleanup old components ==="
    cleanup_legacy_components
    echo ""
    
    log_info "=== Installation packages ==="
    install_packages
    echo ""
    
    log_info "=== Check TUN device ==="
    check_tun_device
    echo ""
    
    log_info "=== Setup VPN-servers (VLESS + WebSocket) ==="
    # IMPORTANT: First create credentials, then sing-box config (for podstanovki)
    setup_ssserver
    echo ""
    
    log_info "=== Configuration sing-box ==="
    create_singbox_config
    ensure_singbox_dns_bootstrap
    create_singbox_init
    setup_logrotate
    echo ""
    
    log_info "=== Installation VPN Manager ==="
    # IMPORTANT: VPN Manager ustanavlivaetsya To generatsii dnsmasq configbut,
    # because install_vpn_manager copies vpn-domains.txt which is needed for dnsmasq
    install_vpn_manager
    echo ""

    # An existing config.json is kept as is (see create_singbox_config) — bring it
    # to the sing-box 1.14 shape with the panel's own migration, now that it is installed
    migrate_existing_singbox_config
    echo ""
    
    log_info "=== Setup dnsmasq ==="
    generate_dnsmasq_config
    echo ""
    
    # DNS Override is no longer needed — dnsmasq on port 5353, iptables redirektit traffic
    # enable_dns_override
    
    log_info "=== Setup iptables ==="
    create_rules_init
    echo ""
    
    # ssserver init and vpn-client-routing more not needed — VPN-server now in sing-box
    # create_ssserver_init
    # create_vpn_client_routing
    
    log_info "=== Check configuration ==="
    if ! verify_config; then
        log_warn "Ispravte configuration and run manually"
        print_info
        exit 1
    fi
    echo ""
    
    log_info "=== Start services ==="
    start_services
    echo ""

    log_info "=== Keenetic network setup (deferred) ==="
    # IMPORTANT: ndmc may be unavailable during time auto-install (netfriend wizard still works)
    # Poetomu add task in cron — ona will run when ndmc stano ready
    schedule_ndmc_postinstall
    echo ""

    log_info "=== Smoke-test ==="
    smoke_test
    echo ""

    finalize_autoinstall
    print_info
}

main "$@"
