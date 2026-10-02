#!/bin/sh
# Network diagnostics for a limited time. Run by cron every minute.
#
# While /opt/etc/vpn-manager/net-diag.until holds a moment in the future:
#  - dnsmasq writes every DNS query to the system log (which device asked for which
#    name and what it got back);
#  - every 10 seconds the connections of home devices to DNS servers are written to
#    the log: plain DNS (port 53), encrypted DNS (DoT, port 853) and DNS over HTTPS
#    to the well-known public resolvers (port 443). Each one once, with "no reply"
#    when nothing came back, so a resolver that the provider blocks is visible.
# After that moment it switches itself off and removes its files.
# The log lives in RAM; apart from switching dnsmasq logging on and off, the drive is not written.

export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

VPN_MANAGER_HOME="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}"
UNTIL_FILE="$VPN_MANAGER_HOME/net-diag.until"
DNSMASQ_CONF="/opt/etc/dnsmasq.d/zz-net-diag.conf"
DNSMASQ_INIT="/opt/etc/init.d/S56dnsmasq"
SEEN="/tmp/vpn-manager/net-diag.seen"
LOCK="/tmp/net-diag.lock"
CONNTRACK="/proc/net/nf_conntrack"
# Public resolvers that also answer DNS over HTTPS / HTTP3 on port 443
DOH_IPS="8.8.8.8 8.8.4.4 1.1.1.1 1.0.0.1 9.9.9.9 149.112.112.112 208.67.222.222 208.67.220.220 94.140.14.14 94.140.15.15 77.88.8.8 77.88.8.1"

log() { logger -t net-diag "$*" 2>/dev/null; return 0; }

[ "$1" = "stop" ] && echo 0 > "$UNTIL_FILE"

now=$(date +%s)
until=$(cat "$UNTIL_FILE" 2>/dev/null)
case "$until" in ''|*[!0-9]*) until=0 ;; esac

if [ "$now" -ge "$until" ]; then
    if [ -f "$DNSMASQ_CONF" ]; then
        rm -f "$DNSMASQ_CONF"
        "$DNSMASQ_INIT" restart >/dev/null 2>&1
        log "Network diagnostics finished, DNS query logging is off"
    fi
    rm -f "$UNTIL_FILE" "$SEEN"
    exit 0
fi

mkdir -p /tmp/vpn-manager
[ -f "$LOCK" ] && [ $(( now - $(date -r "$LOCK" +%s 2>/dev/null || echo 0) )) -lt 120 ] && exit 0
touch "$LOCK"
trap 'rm -f "$LOCK"' EXIT

if [ ! -f "$DNSMASQ_CONF" ]; then
    echo "log-queries" > "$DNSMASQ_CONF"
    "$DNSMASQ_INIT" restart >/dev/null 2>&1
    log "Network diagnostics on for $(( (until - now + 59) / 60 )) min: DNS queries and connections to DNS servers are written here"
fi

[ -r "$CONNTRACK" ] || exit 0
touch "$SEEN"

# the router's own addresses: its own lookups are not what we are after
self_ips=" $(ip -4 addr show 2>/dev/null | awk '$1 == "inet" { sub(/\/.*/, "", $2); printf "%s ", $2 }')"

# 6 looks a minute, 10 seconds apart; cron starts the next minute
i=0
while [ $i -lt 6 ]; do
    awk -v doh=" $DOH_IPS " -v self="$self_ips" '
        function priv(a) { return a ~ /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/ }
        {
            proto = ""; src = ""; dst = ""; dport = ""; noreply = 0
            for (f = 1; f <= NF; f++) {
                if ($f == "tcp" || $f == "udp") { if (proto == "") proto = $f }
                else if ($f ~ /^src=/ && src == "") src = substr($f, 5)
                else if ($f ~ /^dst=/ && dst == "") dst = substr($f, 5)
                else if ($f ~ /^dport=/ && dport == "") dport = substr($f, 7)
                else if ($f == "[UNREPLIED]") noreply = 1
            }
            if (proto == "" || !priv(src) || priv(dst) || index(self, " " src " ")) next
            if (dport == "53" || dport == "853" || (dport == "443" && index(doh, " " dst " ")))
                print src, dst, dport, proto, (noreply ? "no-reply" : "answered")
        }' "$CONNTRACK" 2>/dev/null | sort -u | while read -r src dst dport proto state; do
        key="$src $dst $dport $proto $state"
        grep -qxF "$key" "$SEEN" && continue
        echo "$key" >> "$SEEN"
        case "$dport" in
            53)  kind="plain DNS" ;;
            853) kind="encrypted DNS (DoT)" ;;
            *)   kind="DNS over HTTPS" ;;
        esac
        if [ "$state" = "no-reply" ]; then
            log "$src -> $dst:$dport/$proto $kind: NO REPLY"
        else
            log "$src -> $dst:$dport/$proto $kind: answered"
        fi
    done
    i=$((i + 1))
    [ $i -lt 6 ] && sleep 10
done
exit 0
