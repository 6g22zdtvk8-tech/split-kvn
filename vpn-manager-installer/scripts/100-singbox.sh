#!/bin/sh
# Keenetic netfilter hook for sing-box TUN routing rules
# This script is called every time Keenetic recreates iptables rules
# Placed in /opt/etc/ndm/netfilter.d/
#
# IMPORTANT: This script MUST exit quickly (< 5 sec) to avoid Keenetic timeout!
# All blocking operations are done in background subshell.

PIDFILE="/opt/var/run/sing-box.pid"

# Check that sing-box is installed
[ -x /opt/etc/init.d/S98singbox-rules ] || exit 0

# Check that sing-box is running (via PID file, fast check)
if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE" 2>/dev/null)
    if ! kill -0 "$PID" 2>/dev/null; then
        exit 0
    fi
else
    # No PID file = sing-box not running
    exit 0
fi

# Serialize reapplications. Keenetic can fire many netfilter events within a few
# seconds (a "storm"). Previously each event spawned its own restart-rules in the
# background with no locking, so several ran in parallel, collided on the xtables
# lock ("Another app is currently holding the xtables lock") and left the ruleset
# half-applied for a long time -> traffic hung or leaked to direct until the next
# clean event. Now:
#   - only ONE worker reapplies rules at a time (atomic mkdir lock);
#   - a burst of events collapses into a single reapply (debounce + dirty flag);
#   - a trailing reapply always runs so the final state matches the latest event.
# In RAM, not on the flash: these are touched on every firmware reload (twice an hour
# here) and mean nothing across a reboot.
LOCKDIR="/tmp/singbox-netfilter.lock.d"
DIRTYFILE="/tmp/singbox-netfilter.dirty"
# When the last rebuild finished. An event arriving right after it, with our chains
# still in place, is the firmware noticing our own iptables calls — not a new reload.
LASTFILE="/tmp/singbox-netfilter.last"
ECHO_WINDOW=15

# Run everything in background to avoid Keenetic timeout
# (logger can block if syslog-ng is busy)
(
    # Are our chains in place? A firmware reload is what wipes them, so this tells a real
    # reload apart from the firmware noticing our own iptables calls. It MUST be asked
    # before the restore below, which puts the chains back and would hide the difference.
    chains_in_place() {
        iptables -w -t mangle -S SING_BOX_MARK >/dev/null 2>&1 || return 1
        # 26.09: the firmware also rewrites FORWARD and nat; our accept to the tunnel
        # going missing killed the VPN while the mangle chains stood — check it too
        /opt/etc/init.d/S98singbox-rules passage-ok >/dev/null 2>&1 || return 1
        # the rules script keeps its IPv6 copy here; no copy means no IPv6 chains to check
        if command -v ip6tables >/dev/null 2>&1 && [ -s /tmp/singbox-mangle6.rules ]; then
            ip6tables -w -t mangle -S SING_BOX6_MARK >/dev/null 2>&1 || return 1
        fi
        return 0
    }
    chains_in_place && WAS_INTACT=yes || WAS_INTACT=no

    # B12: this reload may have wiped our chains. Put them back at once from the copy the
    # last successful build saved (a no-op if they are still there); new connections
    # opened in the gap would otherwise stay on the internet port for their whole life.
    # The full rebuild below still follows after the pause.
    /opt/etc/init.d/S98singbox-rules quick-restore >/dev/null 2>&1

    # An echo of our own rebuild: it ended a moment ago and the chains were untouched when
    # we arrived. A real reload wipes them, so it never lands here — and the copy restored
    # above covers only the mangle chains, not the DNS redirects, routing rule and ipsets
    # that the full rebuild recreates.
    if [ "$WAS_INTACT" = yes ]; then
        LAST=$(cat "$LASTFILE" 2>/dev/null)
        case "$LAST" in
            ''|*[!0-9]*) LAST=0 ;;
        esac
        if [ $(( $(date +%s) - LAST )) -lt "$ECHO_WINDOW" ]; then
            exit 0
        fi
    fi

    # Mark that a netfilter change happened and still needs to be applied.
    : > "$DIRTYFILE" 2>/dev/null

    # Drop a stale lock left by a worker that was killed mid-run (> 1 min old).
    if [ -d "$LOCKDIR" ] && [ -n "$(find "$LOCKDIR" -prune -mmin +1 2>/dev/null)" ]; then
        rm -rf "$LOCKDIR" 2>/dev/null
    fi

    # Become the single worker. If the lock already exists, another worker is
    # running — it will see our DIRTYFILE and reapply, so we just exit.
    if ! mkdir "$LOCKDIR" 2>/dev/null; then
        exit 0
    fi
    trap 'rm -rf "$LOCKDIR" 2>/dev/null' EXIT

    logger -t singbox-netfilter "Keenetic netfilter event, reapplying sing-box rules" 2>/dev/null

    # Small delay to let Keenetic finish its changes and to coalesce a burst.
    sleep 2

    # Apply until our chains are really in place (without domain warmup — ipset is preserved).
    #
    # Repeating on "an event happened" alone made the hook feed itself: the rebuild's own
    # iptables calls look like a new netfilter event to the firmware, that event re-arms
    # DIRTYFILE, and the worker went round again — 2-4 rebuilds per single firmware reload.
    # A firmware reload is what wipes our chains, so ask that instead: rebuild while they
    # are missing. Our own rebuild leaves them in place, so it never triggers another round,
    # while a real wipe during a rebuild is still caught. Bounded, so it can never spin.
    ROUNDS=0
    while [ "$ROUNDS" -lt 4 ]; do
        rm -f "$DIRTYFILE" 2>/dev/null
        /opt/etc/init.d/S98singbox-rules restart-rules 2>&1 | logger -t singbox-rules 2>/dev/null
        ROUNDS=$((ROUNDS + 1))
        # Remember when this rebuild ended: events echoing back from its own iptables
        # calls arrive within the next second or two and must not start another one.
        date +%s > "$LASTFILE" 2>/dev/null
        chains_in_place && break
    done

    if ! chains_in_place; then
        logger -t singbox-netfilter "rules still missing after $ROUNDS rebuilds" 2>/dev/null
    fi
) &

exit 0
