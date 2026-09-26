#!/bin/sh
# B2: VPN Manager self-update
#
# Checks a published manifest for a newer release and installs it, keeping the
# router's data. The installer's "update" subcommand does the actual replacing;
# this script decides whether to run it, takes the backup, and puts everything
# back if the result does not work.
#
# Commands:
#   check            fetch the manifest and record what is available
#   apply            install the available release (only if it is cleared for
#                    automatic rollout)
#   apply --force    install it even if it is on hold — this is the panel's
#                    "Update now" button, i.e. a human decided
#   cron             what the nightly schedule runs: check, then apply, but
#                    only while the panel switch is on
#   status           print the recorded state as JSON (the panel reads this)
#
# Rollout levels in the manifest:
#   auto  — ordinary release, routers take it by themselves
#   hold  — carries new behaviour; routers wait until the owner clears it.
#           The owner clears a release by flipping this field to "auto" in the
#           published manifest, so the decision stays with him and not with the
#           router or with an agent.
#
# All logging goes through syslog, like the other scheduled scripts.

# Set PATH for cron compatibility
export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

VPN_MANAGER_DIR="/opt/etc/vpn-manager"
SETTINGS_FILE="$VPN_MANAGER_DIR/settings.json"
STATE_FILE="$VPN_MANAGER_DIR/update-state.json"
VERSION_FILE="$VPN_MANAGER_DIR/VERSION"
BACKUP_DIR="$VPN_MANAGER_DIR/backups"
WEB_ROOT="/opt/share/www/vpn-manager"
SINGBOX_CONFIG="/opt/etc/sing-box/config.json"
WORK_DIR="/opt/tmp/vpn-manager-update"

# Local socks inbound of sing-box: the fallback path when the manifest host is
# not reachable directly. Same trick subscription-update.sh uses.
VPN_SOCKS="127.0.0.1:2080"

FETCH_TIMEOUT=30
DOWNLOAD_TIMEOUT=180
MAX_ARCHIVE_BYTES=52428800   # 50 MB: the installer folder is ~50 MB unpacked

log() {
    logger -t vpn-manager-update "$1"
    [ -t 1 ] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

need_tools() {
    for t in jq curl tar gzip; do
        command -v "$t" >/dev/null 2>&1 || { log "ERROR: $t not found"; return 1; }
    done
    return 0
}

setting() {
    # setting <jq-path> <default>
    local v=""
    [ -f "$SETTINGS_FILE" ] && v=$(jq -r "$1 // empty" "$SETTINGS_FILE" 2>/dev/null)
    [ -z "$v" ] && v="$2"
    echo "$v"
}

# Booleans need their own reader. jq's "//" operator treats false exactly like
# null, so setting '.auto_update' 'true' hands back "true" for a switch the owner
# explicitly turned off — the switch would silently not work.
setting_bool() {
    local v=""
    [ -f "$SETTINGS_FILE" ] && v=$(jq -r "if $1 == null then \"\" else ($1 | tostring) end" "$SETTINGS_FILE" 2>/dev/null)
    [ -z "$v" ] && v="$2"
    echo "$v"
}

current_version() {
    [ -f "$VERSION_FILE" ] && cat "$VERSION_FILE" 2>/dev/null || echo "0.0.0"
}

# Compare dotted numeric versions without sort -V (busybox may lack it).
# Prints: 1 if $1 > $2, 0 otherwise. Non-numeric parts are treated as 0, so a
# malformed version never looks newer than a real one by accident.
version_gt() {
    local a="$1" b="$2" i=1 pa pb
    while [ $i -le 4 ]; do
        pa=$(echo "$a" | cut -d. -f$i); pb=$(echo "$b" | cut -d. -f$i)
        pa=$(echo "$pa" | tr -cd '0-9'); pb=$(echo "$pb" | tr -cd '0-9')
        [ -z "$pa" ] && pa=0
        [ -z "$pb" ] && pb=0
        [ "$pa" -gt "$pb" ] 2>/dev/null && { echo 1; return; }
        [ "$pa" -lt "$pb" ] 2>/dev/null && { echo 0; return; }
        i=$((i + 1))
    done
    echo 0
}

# Fetch a URL directly, then through the tunnel. Subscription servers taught us
# the direct path can be closed while the tunnel works; the manifest host is no
# different, and a router that cannot reach it must not be stuck on an old build.
fetch() {
    local url="$1" out="$2" timeout="$3"
    if curl -s --max-time "$timeout" -o "$out" "$url" 2>/dev/null && [ -s "$out" ]; then
        return 0
    fi
    if curl -s --max-time "$timeout" --socks5-hostname "$VPN_SOCKS" -o "$out" "$url" 2>/dev/null && [ -s "$out" ]; then
        log "Fetched via VPN fallback: $url"
        return 0
    fi
    return 1
}

write_state() {
    # write_state <available> <rollout> <notes> <result>
    local cur; cur=$(current_version)
    mkdir -p "$VPN_MANAGER_DIR"
    jq -n --arg cur "$cur" --arg av "$1" --arg ro "$2" --arg notes "$3" \
          --arg result "$4" --arg at "$(date '+%Y-%m-%d %H:%M:%S')" \
        '{current:$cur, available:$av, rollout:$ro, notes:$notes, last_result:$result, checked_at:$at}' \
        > "$STATE_FILE".tmp 2>/dev/null && mv "$STATE_FILE".tmp "$STATE_FILE"
    chmod 644 "$STATE_FILE" 2>/dev/null
}

do_check() {
    need_tools || return 1

    local src; src=$(setting '.update_source_url' '')
    if [ -z "$src" ]; then
        # Not an error: this is simply a router nobody has pointed at a source.
        # Recorded so the panel can say so instead of showing a blank.
        write_state "" "" "" "no-source"
        return 1
    fi

    mkdir -p "$WORK_DIR"
    local manifest="$WORK_DIR/manifest.json"
    rm -f "$manifest"

    # A failed check must leave a trace. Silence here used to mean the panel kept
    # showing the last good answer as if it were fresh.
    if ! fetch "$src" "$manifest" "$FETCH_TIMEOUT"; then
        log "ERROR: manifest not reachable: $src"
        write_state "" "" "" "check-unreachable"
        return 1
    fi
    if ! jq empty "$manifest" 2>/dev/null; then
        log "ERROR: manifest is not valid JSON"
        write_state "" "" "" "check-bad-manifest"
        return 1
    fi

    local av ro notes cur
    av=$(jq -r '.version // empty' "$manifest")
    ro=$(jq -r '.rollout // "hold"' "$manifest")
    notes=$(jq -r '.notes_ru // .notes_en // ""' "$manifest")
    cur=$(current_version)

    if [ -z "$av" ]; then
        log "ERROR: manifest has no version"
        write_state "" "$ro" "" "check-bad-manifest"
        return 1
    fi

    write_state "$av" "$ro" "$notes" "checked"

    if [ "$(version_gt "$av" "$cur")" = "1" ]; then
        log "Update available: $cur -> $av (rollout: $ro)"
        return 0
    fi

    log "Up to date: $cur"
    return 2
}

# Everything the update can damage, in one archive we can put back.
make_backup() {
    local tag="$1"
    mkdir -p "$BACKUP_DIR"
    local out="$BACKUP_DIR/pre-update-$tag-$(date +%Y%m%d%H%M%S).tar.gz"
    if (umask 077 && tar -cf - \
            -C / \
            opt/etc/vpn-manager \
            opt/share/www/vpn-manager \
            opt/etc/sing-box/config.json \
            opt/etc/init.d/S98singbox-rules \
            opt/etc/init.d/S99sing-box 2>/dev/null | gzip -c > "$out") \
       && gzip -t "$out" 2>/dev/null; then
        echo "$out"
        return 0
    fi
    rm -f "$out"
    return 1
}

restore_backup() {
    local archive="$1"
    [ -s "$archive" ] || return 1
    gzip -dc "$archive" | tar -xf - -C / 2>/dev/null || return 1
    return 0
}

# Is the router still working after the update? Panel answering, sing-box alive,
# its config still valid. Anything else is the caller's business.
self_check() {
    local port; port=$(setting '.web_port' '8001')

    pidof sing-box >/dev/null 2>&1 || { log "Self-check: sing-box is not running"; return 1; }

    if command -v sing-box >/dev/null 2>&1 && [ -s "$SINGBOX_CONFIG" ]; then
        sing-box check -c "$SINGBOX_CONFIG" >/dev/null 2>&1 || { log "Self-check: sing-box config rejected"; return 1; }
    fi

    local code
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:$port/" 2>/dev/null)
    case "$code" in
        200|301|302|401) : ;;
        *) log "Self-check: panel answered '$code'"; return 1 ;;
    esac

    return 0
}

do_apply() {
    local force="$1"
    need_tools || return 1

    local src; src=$(setting '.update_source_url' '')
    [ -z "$src" ] && { log "Update source is not set"; return 1; }

    mkdir -p "$WORK_DIR"
    local manifest="$WORK_DIR/manifest.json"
    rm -f "$manifest"
    fetch "$src" "$manifest" "$FETCH_TIMEOUT" || { log "ERROR: manifest not reachable"; return 1; }
    jq empty "$manifest" 2>/dev/null || { log "ERROR: manifest is not valid JSON"; return 1; }

    local av ro url sum cur notes
    av=$(jq -r '.version // empty' "$manifest")
    ro=$(jq -r '.rollout // "hold"' "$manifest")
    url=$(jq -r '.url // empty' "$manifest")
    sum=$(jq -r '.sha256 // empty' "$manifest")
    notes=$(jq -r '.notes_ru // .notes_en // ""' "$manifest")
    cur=$(current_version)

    [ -z "$av" ] || [ -z "$url" ] || [ -z "$sum" ] && { log "ERROR: manifest is incomplete"; return 1; }

    if [ "$(version_gt "$av" "$cur")" != "1" ]; then
        log "Nothing to do: installed $cur, published $av"
        write_state "$av" "$ro" "$notes" "up-to-date"
        return 2
    fi

    if [ "$ro" != "auto" ] && [ "$force" != "force" ]; then
        log "Release $av is on hold — waiting for the owner to clear it"
        write_state "$av" "$ro" "$notes" "held"
        return 3
    fi

    # Download and verify before touching anything on the router.
    local archive="$WORK_DIR/release.tar.gz"
    rm -f "$archive"
    if ! fetch "$url" "$archive" "$DOWNLOAD_TIMEOUT"; then
        log "ERROR: release archive not reachable"
        write_state "$av" "$ro" "$notes" "download-failed"
        return 1
    fi

    local size; size=$(wc -c < "$archive" 2>/dev/null || echo 0)
    if [ "$size" -gt "$MAX_ARCHIVE_BYTES" ] 2>/dev/null; then
        log "ERROR: archive is larger than expected ($size bytes)"
        rm -f "$archive"
        write_state "$av" "$ro" "$notes" "archive-too-big"
        return 1
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        local got; got=$(sha256sum "$archive" 2>/dev/null | awk '{print $1}')
        if [ "$got" != "$sum" ]; then
            log "ERROR: checksum mismatch, refusing to install"
            rm -f "$archive"
            write_state "$av" "$ro" "$notes" "checksum-mismatch"
            return 1
        fi
    else
        log "ERROR: sha256sum not available, refusing to install unverified code"
        rm -f "$archive"
        write_state "$av" "$ro" "$notes" "no-sha256sum"
        return 1
    fi

    local unpack="$WORK_DIR/unpack"
    rm -rf "$unpack"; mkdir -p "$unpack"
    if ! gzip -dc "$archive" | tar -xf - -C "$unpack" 2>/dev/null; then
        log "ERROR: archive does not unpack"
        write_state "$av" "$ro" "$notes" "bad-archive"
        return 1
    fi

    # The archive must look like the installer folder, or we are not running it.
    local root="$unpack"
    [ -f "$root/install-singbox.sh" ] || root=$(find "$unpack" -maxdepth 2 -name install-singbox.sh -exec dirname {} \; 2>/dev/null | head -1)
    if [ -z "$root" ] || [ ! -f "$root/install-singbox.sh" ] || [ ! -d "$root/web" ]; then
        log "ERROR: archive does not contain the installer"
        write_state "$av" "$ro" "$notes" "bad-archive"
        return 1
    fi

    local backup; backup=$(make_backup "$cur")
    if [ -z "$backup" ]; then
        log "ERROR: backup failed, not updating"
        write_state "$av" "$ro" "$notes" "backup-failed"
        return 1
    fi
    log "Backup taken: $backup"

    log "Installing $cur -> $av"
    if ! sh "$root/install-singbox.sh" update >/dev/null 2>&1; then
        log "ERROR: installer returned a failure — rolling back"
        restore_backup "$backup" && log "Rolled back to $cur" || log "ERROR: rollback failed, backup kept at $backup"
        write_state "$av" "$ro" "$notes" "install-failed"
        return 1
    fi

    if ! self_check; then
        log "ERROR: self-check failed after update — rolling back"
        if restore_backup "$backup"; then
            /opt/etc/init.d/S99sing-box restart >/dev/null 2>&1 || true
            log "Rolled back to $cur"
        else
            log "ERROR: rollback failed, backup kept at $backup"
        fi
        write_state "$av" "$ro" "$notes" "self-check-failed"
        return 1
    fi

    rm -rf "$unpack" "$archive"
    write_state "$av" "$ro" "$notes" "updated"
    log "Updated to $av"
    return 0
}

# What the nightly schedule calls. Everything is gated here rather than in the
# crontab line, so turning the feature off in the panel is enough — no need to
# rewrite anyone's cron. A router with the switch off, or with no source
# configured, does nothing at all and says so only in the log.
do_cron() {
    # Default is on, by the owner's decision (20.09). Only an explicit "false"
    # in settings stops the nightly run.
    local enabled; enabled=$(setting_bool '.auto_update' 'true')
    if [ "$enabled" = "false" ]; then
        return 0
    fi

    # No source means nobody has published anything for this router yet. That is
    # a normal state, not a fault, so it must not write an error to the log every
    # single night.
    local src; src=$(setting '.update_source_url' '')
    if [ -z "$src" ]; then
        return 0
    fi

    do_check
    case $? in
        0) : ;;            # something newer is published, go on
        2) return 0 ;;     # already current
        *) return 1 ;;     # could not check; the log already says why
    esac

    do_apply
}

do_status() {
    if [ -s "$STATE_FILE" ]; then
        cat "$STATE_FILE"
    else
        jq -n --arg cur "$(current_version)" \
            '{current:$cur, available:"", rollout:"", notes:"", last_result:"never-checked", checked_at:""}'
    fi
}

case "$1" in
    check)  do_check ;;
    cron)   do_cron ;;
    apply)
        # Not "cond && a || b": if the forced run fails, "||" would run the
        # unforced one on top of it. An if/else runs do_apply exactly once.
        if [ "$2" = "--force" ]; then
            do_apply force
        else
            do_apply
        fi
        ;;
    status) do_status ;;
    *)
        echo "Usage: $0 {check|apply [--force]|cron|status}"
        exit 1
        ;;
esac
