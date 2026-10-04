#!/bin/sh
# Several connections: keep traffic off a dead main server (B29).
#
# The "vpn" fallback group only moves on when opening a connection fails. A TCP-based
# server that is down refuses at once, but WireGuard/AmneziaWG have no such refusal:
# a dead endpoint takes the connection and nothing comes back. So once a minute (cron)
# the main server is tested through sing-box itself (Clash API delay test); after two
# failures in a row the live main switch (vpn-main) goes to the fastest server that
# answers, and back to the main server once it answers twice in a row. Only the running
# sing-box is switched — multi.json keeps the owner's choice of the main server.
# State lives in RAM; the drive is not written.

export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

VPN_MANAGER_HOME="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}"
MULTI_FILE="$VPN_MANAGER_HOME/multi.json"
CLASH_API="http://127.0.0.1:9090"
STATE="/tmp/vpn-manager/multi-health"
LOCK="/tmp/multi-health.lock"
URL="https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204"
FAILS_TO_SWITCH=2
OKS_TO_RETURN=2

log() { logger -t multi-health "$*" 2>/dev/null; return 0; }

jq -e '.mode == "multi"' "$MULTI_FILE" >/dev/null 2>&1 || exit 0
mkdir -p /tmp/vpn-manager
[ -f "$LOCK" ] && [ $(( $(date +%s) - $(date -r "$LOCK" +%s 2>/dev/null || echo 0) )) -lt 120 ] && exit 0
touch "$LOCK"
trap 'rm -f "$LOCK"' EXIT

main="m-$(jq -r '.primary // ""' "$MULTI_FILE")"
[ "$main" != "m-" ] || exit 0
now=$(curl -s -m 3 "$CLASH_API/proxies/vpn-main" | jq -r '.now // empty' 2>/dev/null)
[ -n "$now" ] || exit 0   # sing-box not running or no group

alive() { curl -s -m 8 "$CLASH_API/proxies/$1/delay?url=$URL&timeout=6000" | jq -e '(.delay // 0) > 0' >/dev/null 2>&1; }

# fastest server that answers now, other than $1. sing-box answers {} while its own
# minute check of the group is running, so ask twice; then take the group's own pick
best_other() {
    local r="" i
    for i in 1 2; do
        r=$(curl -s -m 20 "$CLASH_API/group/vpn-auto/delay?url=$URL&timeout=6000" 2>/dev/null \
            | jq -r --arg x "$1" 'to_entries | map(select(.key != $x and (.value | type) == "number" and .value > 0)) | sort_by(.value) | .[0].key // empty' 2>/dev/null)
        [ -n "$r" ] && break
        sleep 3
    done
    [ -n "$r" ] || r=$(curl -s -m 3 "$CLASH_API/proxies/vpn-auto" | jq -r --arg x "$1" '.now // empty | select(. != $x)' 2>/dev/null)
    echo "$r"
}

fails=0; oks=0
[ -f "$STATE" ] && read -r fails oks < "$STATE"
case "$fails$oks" in *[!0-9]*|'') fails=0; oks=0 ;; esac

switch_to() {
    curl -s -m 5 -X PUT -H 'Content-Type: application/json' -d "{\"name\":\"$1\"}" "$CLASH_API/proxies/vpn-main" >/dev/null 2>&1
}

if alive "$main"; then
    fails=0
    if [ "$now" != "$main" ]; then
        oks=$((oks + 1))
        if [ "$oks" -ge "$OKS_TO_RETURN" ]; then
            switch_to "$main"
            log "Main server $main answers again, traffic back to it (was on $now)"
            oks=0
        fi
    fi
else
    oks=0
    fails=$((fails + 1))
    if [ "$fails" -ge "$FAILS_TO_SWITCH" ]; then
        # Already on a stand-in that still answers: nothing to do
        if [ "$now" != "$main" ] && alive "$now"; then
            :
        else
            to=$(best_other "$main")
            if [ -n "$to" ] && [ "$to" != "$now" ]; then
                switch_to "$to"
                log "Main server $main does not answer, traffic moved to $to"
            elif [ -z "$to" ]; then
                log "Main server $main does not answer and no other server answers"
            fi
        fi
    fi
fi
echo "$fails $oks" > "$STATE"
