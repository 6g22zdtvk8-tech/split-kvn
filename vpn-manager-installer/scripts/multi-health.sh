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

# sing-box memory: a line in the log when it nears the soft limit (S99: a third of RAM),
# at most once an hour — the first sign before the kernel would kill it
_sb=$(pidof sing-box 2>/dev/null | awk '{print $1}')
if [ -n "$_sb" ]; then
    _rss=$(awk '/^VmRSS:/ {print $2}' /proc/$_sb/status 2>/dev/null)
    _lim=$(awk '/^MemTotal:/ {printf "%d", $2 / 3}' /proc/meminfo 2>/dev/null)
    _mark=/tmp/vpn-manager-mem-warned
    if [ -n "$_rss" ] && [ -n "$_lim" ] && [ "$_rss" -gt $((_lim * 9 / 10)) ] && \
       { [ ! -f "$_mark" ] || [ $(( $(date +%s) - $(date -r "$_mark" +%s 2>/dev/null || echo 0) )) -gt 3600 ]; }; then
        logger -t vpn-manager "sing-box uses $((_rss / 1024)) MB of RAM (soft limit $((_lim / 1024)) MB)"
        touch "$_mark"
    fi
fi

# B44: entries sent through a chosen server or dedicated group (selectors via-* = [own way, vpn]): the
# server does not answer → the selector goes to the group's way; it answers again → back
_api="http://127.0.0.1:9090"
for _sel in $(curl -s -m 5 "$_api/proxies" 2>/dev/null | jq -r '.proxies | keys[] | select(startswith("via-"))' 2>/dev/null); do
    # its own way first (x-<id> or a dedicated group vg-gN), the shared group last
    _info=$(curl -s -m 5 "$_api/proxies/$_sel")
    _x=$(printf '%s' "$_info" | jq -r '.all[0] // empty')
    _now=$(printf '%s' "$_info" | jq -r '.now // empty')
    _all=$(printf '%s' "$_info" | jq -r '.all[-1] // empty')
    [ -n "$_x" ] || continue
    # a dedicated group is fine while any of its servers answers (the group check also
    # tells urltest which one); a single server must answer itself
    case "$_x" in
        vg-*) _ok=$(curl -s -m 15 "$_api/group/$_x/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=8000" | jq -e '[.[]? | select(. > 0)] | length > 0' >/dev/null 2>&1 && echo 1) ;;
        *)    _ok=$(curl -s -m 12 "$_api/proxies/$_x/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=8000" | jq -e '(.delay // 0) > 0' >/dev/null 2>&1 && echo 1) ;;
    esac
    if [ "$_ok" = 1 ]; then
        _want="$_x"
    else
        _want="$_all"
    fi
    if [ -n "$_want" ] && [ "$_want" != "$_now" ]; then
        curl -s -m 5 -X PUT -H 'Content-Type: application/json' -d "{\"name\":\"$_want\"}" "$_api/proxies/$_sel" >/dev/null 2>&1 &&
            logger -t vpn-manager "B44: $_sel → $_want"
    fi
done

jq -e '.mode == "multi"' "$MULTI_FILE" >/dev/null 2>&1 || exit 0
# "fastest" (B42): no main server to watch, sing-box picks the server itself
jq -e '.strategy == "fastest"' "$MULTI_FILE" >/dev/null 2>&1 && exit 0
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
