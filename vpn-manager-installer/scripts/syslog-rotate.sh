#!/bin/sh
# Log upkeep. Run by cron every 10 minutes and by the panel's "rotate" button.
#  - caps the system log, which lives in RAM (see S00log-ram)
#  - caps the lighttpd error log on the drive
#  - returns sing-box to the quiet "warn" level when verbose mode has ended
#  - every 6 hours copies warnings and errors to the drive, so a reboot does not erase them

export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

# Paths can be overridden from the environment (used by tests)
SYSLOG="${SYSLOG:-/tmp/log/messages}"
FLASH_SYSLOG="${FLASH_SYSLOG:-/opt/var/log/messages}"
SYSLOG_MAX_BYTES=5242880     # 5 MB of RAM at most
SYSLOG_KEEP_BYTES=2097152    # what is left after trimming

LIGHTTPD_LOG="${LIGHTTPD_LOG:-/opt/var/log/lighttpd/error.log}"
LIGHTTPD_MAX=5000
LIGHTTPD_KEEP=1000

ERRORS_LOG="${ERRORS_LOG:-/opt/var/log/last-errors.log}"   # on the drive: survives a reboot
ERRORS_MAX_BYTES=204800
ERRORS_EVERY_MIN=360   # sing-box errors change the copy every time: each write is the whole file

COMMON_SH="${COMMON_SH:-/opt/share/www/vpn-manager/api/common.sh}"

# The log belongs in RAM; put the layout back if something replaced the symlink
if [ -x /opt/etc/init.d/S00log-ram ] && [ ! -L "$FLASH_SYSLOG" ]; then
    /opt/etc/init.d/S00log-ram start
    /opt/etc/init.d/S01syslog-ng restart >/dev/null 2>&1
fi
[ -f "$SYSLOG" ] || SYSLOG="$FLASH_SYSLOG"

# Cap the system log. Rewritten in place: syslog-ng keeps appending to the same
# file, no restart needed. The first (cut) line after tail -c is dropped.
if [ -f "$SYSLOG" ]; then
    size=$(wc -c < "$SYSLOG" 2>/dev/null || echo 0)
    if [ "$size" -gt "$SYSLOG_MAX_BYTES" ]; then
        tail -c "$SYSLOG_KEEP_BYTES" "$SYSLOG" | sed '1d' > "${SYSLOG}.tmp" && cat "${SYSLOG}.tmp" > "$SYSLOG"
        rm -f "${SYSLOG}.tmp"
        logger -t syslog-rotate "Trimmed system log: $size -> $(wc -c < "$SYSLOG") bytes"
    fi
fi

# Cap the lighttpd error log (in place as well, lighttpd keeps its file open)
if [ -f "$LIGHTTPD_LOG" ]; then
    lines=$(wc -l < "$LIGHTTPD_LOG" 2>/dev/null || echo 0)
    if [ "$lines" -gt "$LIGHTTPD_MAX" ]; then
        tail -n "$LIGHTTPD_KEEP" "$LIGHTTPD_LOG" > "${LIGHTTPD_LOG}.tmp" && cat "${LIGHTTPD_LOG}.tmp" > "$LIGHTTPD_LOG"
        rm -f "${LIGHTTPD_LOG}.tmp"
        logger -t syslog-rotate "Rotated lighttpd: $lines -> $LIGHTTPD_KEEP lines"
    fi
fi

# Verbose sing-box logging lasts an hour; also covers a reboot in the middle of it
# (the flag is in RAM and gone, but the config would still say "info")
if [ -f "$COMMON_SH" ]; then
    . "$COMMON_SH"
    if [ "$(verbose_log_until)" -eq 0 ]; then
        rm -f "$SINGBOX_VERBOSE_FLAG"
        if [ -f "$SINGBOX_CONFIG" ] && [ "$(jq -r '.log.level // empty' "$SINGBOX_CONFIG" 2>/dev/null)" != "warn" ]; then
            singbox_set_log_level warn && logger -t syslog-rotate "sing-box log level back to warn"
        fi
    fi
fi

# Copy of warnings and errors to the drive every 6 hours: one small file, rewritten only
# when it changed. S00log-ram keeps the previous boot's copy as last-errors.prev.log.
errors_age_min=999999
if [ -f "$ERRORS_LOG" ]; then
    errors_age_min=$(( ( $(date +%s) - $(date -r "$ERRORS_LOG" +%s 2>/dev/null || echo 0) ) / 60 ))
fi
if [ -f "$SYSLOG" ] && [ "$errors_age_min" -ge "$ERRORS_EVERY_MIN" ]; then
    grep -iE 'warn|error|fail|fatal|crit' "$SYSLOG" | tr -d '\000-\010\013-\037\177' | sed 's/\[[0-9;]*[mKHJ]//g' \
        | tail -c "$ERRORS_MAX_BYTES" > "${ERRORS_LOG}.new"
    if [ -s "${ERRORS_LOG}.new" ] && ! cmp -s "${ERRORS_LOG}.new" "$ERRORS_LOG" 2>/dev/null; then
        mv "${ERRORS_LOG}.new" "$ERRORS_LOG"
    else
        rm -f "${ERRORS_LOG}.new"
        # unchanged: refresh the time only, so the next check is in an hour
        [ -f "$ERRORS_LOG" ] && touch "$ERRORS_LOG"
    fi
fi
