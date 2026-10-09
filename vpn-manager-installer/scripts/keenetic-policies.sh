#!/bin/sh
# B36: device policies in the router firmware.
#
# sing-box has one local SOCKS inbound per routing policy (127.0.0.1, ports in
# settings.json device_policy_ports, see common.sh). This script makes the firmware
# use them: for each policy a "Proxy" connection pointing at its inbound and an access
# policy that allows only that connection. A device is then put on a policy by MAC in
# the firmware's own web interface (Internet access policies) — over cable and Wi-Fi
# alike, whatever its segment. Without sing-box such a device has no internet: the
# firmware sends a policy without a working connection nowhere.
#
# Needs the firmware component "Proxy client" (proxy). The script never installs
# components; without it "apply" only reports that it is missing.
#
#   status         JSON for the panel: component, policies, connections, ports
#   apply [policy] create or update the connections and policies (idempotent)
#   remove policy  delete the connection and the access policy of one policy
#   marks          "<policy> <firewall mark>" per policy, for S98singbox-rules
#
# Firmware objects are found by their description ("SplitKVN ..."), so numbering and
# objects the owner created by hand are left alone.

export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

VPN_MANAGER_HOME="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}"
SETTINGS_FILE="$VPN_MANAGER_HOME/settings.json"
RCI="http://127.0.0.1:79/rci"
POLICIES="fullvpn vpnprimary split direct"
TMP="/tmp/keenetic-policies.$$"

log() { logger -t keenetic-policies "$*" 2>/dev/null; [ "$QUIET" = 1 ] || echo "$*"; return 0; }
ndm() { ndmc -c "$1" 2>&1 | tr -d '\033' | sed 's/\[K//g'; }
cleanup() { rm -f "$TMP" "$TMP.rc"; }
trap cleanup EXIT

desc_of() {
    case "$1" in
        fullvpn)    echo "SplitKVN VPN only" ;;
        vpnprimary) echo "SplitKVN VPN primary" ;;
        split)      echo "SplitKVN Direct primary" ;;
        direct)     echo "SplitKVN Direct" ;;
    esac
}

port_of() {
    jq -r --arg p "$1" '({fullvpn: 21081, vpnprimary: 21082, split: 21083, direct: 21084} + (.device_policy_ports // {}))[$p]' \
        "$SETTINGS_FILE" 2>/dev/null
}

# The firmware component "Proxy client". Proxy interfaces exist only with it, so a
# configured one answers at once; otherwise ask the component list (slow, and it came
# back empty now and then when two panel pages asked at the same moment — try twice)
component_installed() {
    ndm "show running-config" | grep -q '^interface Proxy[0-9]' && return 0
    local try
    for try in 1 2; do
        ndm "components list" | awk '
            /^ *name: / { cur = $2 }
            cur == "proxy" && /^ *installed: / { found = 1 }
            END { exit !found }' && return 0
        sleep 1
    done
    return 1
}

running_config() { ndm "show running-config" > "$TMP.rc"; }

# name of the interface/policy whose block carries this description, from running-config
# $1 = "interface Proxy" or "ip policy Policy", $2 = description
find_by_desc() {
    awk -v head="$1" -v d="$2" '
        index($0, head) == 1 { name = $NF; next }
        /^!/ { name = "" }
        name != "" && $1 == "description" {
            v = $0; sub(/^ *description /, "", v); gsub(/"/, "", v)
            if (v == d) { print name; exit }
        }' "$TMP.rc"
}

# first free number for Proxy<N> / Policy<N>
free_name() {
    local prefix="$1" head="$2" n=0
    while [ $n -lt 32 ]; do
        grep -q "^$head$prefix$n\$" "$TMP.rc" || { echo "$prefix$n"; return 0; }
        n=$((n + 1))
    done
    return 1
}

# create or update one policy: its Proxy connection to our port and its access policy
apply_one() {
    local p="$1" desc port proxy policy
    desc=$(desc_of "$p"); port=$(port_of "$p")
    case "$port" in ''|*[!0-9]*) log "No port for $p, skipped"; return 0 ;; esac

    proxy=$(find_by_desc "interface Proxy" "$desc")
    if [ -z "$proxy" ]; then
        proxy=$(free_name Proxy "interface ") || { log "No free Proxy interface"; return 1; }
        ndm "interface $proxy" >/dev/null
        ndm "interface $proxy description \"$desc\"" >/dev/null
        echo "interface $proxy" >> "$TMP.rc"
        log "Created connection $proxy ($desc)"
        changed=1
    fi
    ndm "interface $proxy proxy protocol socks5" >/dev/null
    ndm "interface $proxy proxy upstream 127.0.0.1 $port" >/dev/null
    ndm "interface $proxy proxy socks5-udp" >/dev/null
    # lowest priority: never the router's own way out, only for its policy
    ndm "interface $proxy ip global 10" >/dev/null
    ndm "interface $proxy up" >/dev/null

    policy=$(find_by_desc "ip policy Policy" "$desc")
    if [ -z "$policy" ]; then
        policy=$(free_name Policy "ip policy ") || { log "No free policy"; return 1; }
        ndm "ip policy $policy" >/dev/null
        ndm "ip policy $policy description \"$desc\"" >/dev/null
        echo "ip policy $policy" >> "$TMP.rc"
        log "Created policy $policy ($desc)"
        changed=1
    fi
    ndm "ip policy $policy permit global $proxy" >/dev/null
}

cmd_apply() {
    if ! component_installed; then
        log "Firmware component \"Proxy client\" is not installed — device policies skipped"
        return 2
    fi
    running_config
    local before=$(md5sum < "$TMP.rc")
    changed=0
    local p
    for p in ${ONLY:-$POLICIES}; do
        apply_one "$p" || return 1
    done
    # save to the drive only when something really changed
    [ "$(ndm "show running-config" | md5sum)" = "$before" ] || ndm "system configuration save" >/dev/null
    [ $changed = 1 ] && log "Device policies ready" || log "Device policies up to date"
    return 0
}

cmd_remove() {
    local p="$1" desc proxy policy
    desc=$(desc_of "$p"); [ -n "$desc" ] || { log "Unknown policy $p"; return 1; }
    running_config
    policy=$(find_by_desc "ip policy Policy" "$desc")
    proxy=$(find_by_desc "interface Proxy" "$desc")
    # devices bound to the policy fall back to the router's default routing
    [ -n "$policy" ] && ndm "no ip policy $policy" >/dev/null && log "Removed policy $policy ($desc)"
    [ -n "$proxy" ] && ndm "no interface $proxy" >/dev/null && log "Removed connection $proxy ($desc)"
    [ -n "$policy$proxy" ] && ndm "system configuration save" >/dev/null
    return 0
}

# "<policy> <mark>" — marks are the firmware's, read live (they belong to the policy)
cmd_marks() {
    curl -s -m 5 "$RCI/show/ip/policy" 2>/dev/null | jq -r '
        to_entries[] | select((.value.description // "") | startswith("SplitKVN ")) |
        [(.value.description | ltrimstr("SplitKVN ")), .value.mark] | @tsv' 2>/dev/null |
    while IFS="$(printf '\t')" read -r d m; do
        case "$d" in
            "VPN only") echo "fullvpn $m" ;;
            "VPN primary") echo "vpnprimary $m" ;;
            "Direct primary") echo "split $m" ;;
            "Direct") echo "direct $m" ;;
        esac
    done
}

cmd_status() {
    local comp=false p desc proxy policy rport webport
    component_installed && comp=true
    running_config
    {
        for p in $POLICIES; do
            desc=$(desc_of "$p")
            proxy=$(find_by_desc "interface Proxy" "$desc")
            policy=$(find_by_desc "ip policy Policy" "$desc")
            rport=""
            [ -n "$proxy" ] && rport=$(awk -v n="$proxy" '$1 == "interface" && $2 == n { f = 1; next }
                /^!/ { f = 0 } f && $1 == "proxy" && $2 == "upstream" { print $4; exit }' "$TMP.rc")
            jq -n --arg k "$p" --arg d "$desc" --arg x "$proxy" --arg y "$policy" --arg port "$(port_of "$p")" --arg rp "$rport" \
                '{key: $k, name: $d, connection: $x, policy: $y, port: ($port | tonumber? // null),
                  router_port: ($rp | tonumber? // null)}'
        done
    } | jq -s --argjson comp "$comp" --arg wp "$(awk '$1 == "ip" && $2 == "http" && $3 == "port" { print $4; exit }' "$TMP.rc")" \
        '{component: $comp, webui_port: ($wp | tonumber? // 80), policies: .}'
}

QUIET=0
[ "$2" = "--quiet" ] && QUIET=1
case "$1" in
    apply)  [ -n "$2" ] && [ "$2" != "--quiet" ] && ONLY="$2"; [ "$3" = "--quiet" ] && QUIET=1; cmd_apply ;;
    remove) cmd_remove "$2" ;;
    marks)  cmd_marks ;;
    status) cmd_status ;;
    *) echo "Usage: $0 {status|apply [policy] [--quiet]|remove policy|marks}"; exit 1 ;;
esac
