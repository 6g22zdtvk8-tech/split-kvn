#!/bin/sh
# =============================================================================
# Full backup / restore of VPN Manager state
#
#   GET  /api/backup.cgi/export            → vpn-manager-backup-*.tar.gz
#   POST /api/backup.cgi/restore[?hwid=1]  ← raw .tar.gz body
#
# The archive holds everything the user built up in the panel: configurations,
# subscriptions, the active server, VPN server users, own domain/subnet lists,
# segment policies, panel settings and the router HWID used by HWID-protected
# subscriptions. It deliberately leaves out the panel password (auth.db), caches
# and state this router detects for itself (e.g. the DNS upstream mode). The
# archive contains secrets (subscription links, server keys, user UUIDs) and has
# to be kept like a password.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

BACKUP_TYPE="vpn-manager-backup"
BACKUP_FORMAT=1
MAX_BACKUP_BYTES=10485760      # compressed upload
MAX_UNPACKED_BYTES=31457280    # after gunzip (tar bomb guard)
MAX_ENTRIES=2000
SNAPSHOT_DIR="$VPN_MANAGER_HOME/backups"
SNAPSHOT_KEEP=5
# On the USB drive, not in RAM-backed /tmp
BACKUP_TMP="${BACKUP_TMP:-/opt/tmp}"
SUBSCRIPTIONS_FILE_PATH="$VPN_MANAGER_HOME/subscriptions.json"
CREDS_FILE="$VPN_MANAGER_HOME/vpnserver-credentials.json"

# Top-level files taken as they are (besides configs/*.json)
BACKUP_FILES="subscriptions.json active-config settings.json routing_policies.json
device-routing.json vpn-domains.txt vpn-domains-udp.txt vpn-subnets.txt
vpn-subnets-udp.txt direct-domains.txt direct-domains-udp.txt direct-subnets.txt
direct-subnets-udp.txt vpnserver-credentials.json autostart-enabled router-hwid
multi.json"
# Restore is a full replacement: these are removed when the backup has none
# (the source router simply did not have them). settings, server users and the
# HWID are kept instead — losing them would cut off the panel or the clients.
# The Russia lists are not here: a backup from before B1 has none, and wiping
# the router's lists on such a restore would be a loss, not a restore.
REPLACED_WHEN_ABSENT="subscriptions.json active-config routing_policies.json
device-routing.json vpn-domains.txt vpn-domains-udp.txt vpn-subnets.txt
vpn-subnets-udp.txt autostart-enabled"

# Every archive entry must match this; anything else rejects the whole file
ALLOWED_ENTRY_RE='^(\./)?$|^(\./)?configs/?$|^(\./)?configs/[A-Za-z0-9_.@+-]+\.json$|^(\./)?(manifest\.json|subscriptions\.json|active-config|settings\.json|routing_policies\.json|device-routing\.json|vpn-domains\.txt|vpn-domains-udp\.txt|vpn-subnets\.txt|vpn-subnets-udp\.txt|direct-domains\.txt|direct-domains-udp\.txt|direct-subnets\.txt|direct-subnets-udp\.txt|vpnserver-credentials\.json|autostart-enabled|router-hwid|multi\.json)$'
CONFIG_ID_RE='^[A-Za-z0-9_.@+-]+$'

app_version() {
    head -1 "$VPN_MANAGER_HOME/VERSION" 2>/dev/null | tr -d '\r\n'
}

# Write the gzipped backup archive to file $1; fails unless the result is a
# complete, readable archive
write_backup_archive() {
    local out="$1" stage="$BACKUP_TMP/vpn-backup.$$" f rc
    rm -rf "$stage"
    (umask 077 && mkdir -p "$stage/configs") || return 1

    for f in $BACKUP_FILES; do
        [ -f "$VPN_MANAGER_HOME/$f" ] && cp "$VPN_MANAGER_HOME/$f" "$stage/$f"
    done
    for f in "$VPN_CONFIGS_DIR"/*.json; do
        [ -f "$f" ] && cp "$f" "$stage/configs/"
    done

    jq -n \
        --arg type "$BACKUP_TYPE" \
        --argjson format "$BACKUP_FORMAT" \
        --arg version "$(app_version)" \
        --arg created "$(date '+%Y-%m-%dT%H:%M:%S')" \
        --argjson configs "$(ls "$stage/configs" | grep -c '\.json$')" \
        '{type: $type, format: $format, app_version: $version, created_at: $created, configs: $configs}' \
        > "$stage/manifest.json"

    (umask 077 && cd "$stage" && tar -cf - . | gzip -c > "$out")
    rc=$?
    rm -rf "$stage"
    [ $rc -eq 0 ] && gzip -t "$out" 2>/dev/null && gzip -dc "$out" | tar -tf - >/dev/null 2>&1
}

do_export() {
    local out="$BACKUP_TMP/vpn-export.$$.tar.gz"
    # Expanded now: $out is local and gone by the time the trap fires
    trap "rm -rf '$out' '$BACKUP_TMP/vpn-backup.$$'" EXIT INT TERM
    mkdir -p "$BACKUP_TMP"
    # Build first: a failure must be a JSON error, not a broken download
    if ! write_backup_archive "$out"; then
        json_error "backup.internal" 500
        return
    fi
    echo "Content-Type: application/gzip"
    echo "Content-Disposition: attachment; filename=\"vpn-manager-backup-$(date +%Y%m%d-%H%M%S).tar.gz\""
    echo "Cache-Control: no-store"
    echo ""
    cat "$out"
    rm -f "$out"
    log_action "BACKUP_EXPORTED" "Full backup downloaded"
}

# Run another API script of the panel in-process (same session cookie)
# Usage: call_api <script> <method> <path> [query] [json body]
call_api() {
    local body="$5"
    printf '%s' "$body" | \
        REQUEST_METHOD="$2" PATH_INFO="$3" QUERY_STRING="$4" CONTENT_LENGTH="${#body}" \
        sh "$SCRIPT_DIR/$1" >/dev/null 2>&1
}

restore_fail() {
    rm -rf "$WORK" "$ARCHIVE"
    json_error "$1" "${2:-400}"
    exit 0
}

# Keep this router's values of the given keys when a restored JSON file has them
# Usage: keep_current_keys <restored file> <current file> <key>...
keep_current_keys() {
    local restored="$1" current="$2" keys
    shift 2
    [ -f "$restored" ] && [ -f "$current" ] || return 0
    keys=$(printf '"%s",' "$@"); keys="[${keys%,}]"
    # (no --slurpfile: it hangs on some aarch64 jq builds)
    jq --argjson cur "$(cat "$current")" --argjson keys "$keys" \
        '. + ($cur | with_entries(select(.key as $k | $keys | index($k)) | select(.value != null)))' \
        "$restored" > "$restored.merged" 2>/dev/null \
        && [ -s "$restored.merged" ] && mv "$restored.merged" "$restored"
    rm -f "$restored.merged"
}

do_restore() {
    local apply_hwid="$1" f snapshot count_configs count_subs count_users active active_missing=false

    WORK="$BACKUP_TMP/vpn-restore.$$"
    ARCHIVE="$BACKUP_TMP/vpn-restore.$$.tar.gz"
    trap 'rm -rf "$WORK" "$ARCHIVE"' EXIT INT TERM

    [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null || restore_fail "backup.empty"
    [ "$CONTENT_LENGTH" -le "$MAX_BACKUP_BYTES" ] || restore_fail "backup.tooLarge" 413
    mkdir -p "$BACKUP_TMP" || restore_fail "backup.internal" 500
    head -c "$CONTENT_LENGTH" > "$ARCHIVE"
    [ "$(wc -c < "$ARCHIVE")" -eq "$CONTENT_LENGTH" ] || restore_fail "backup.notArchive"

    # --- Validate before touching anything ------------------------------------
    gzip -t "$ARCHIVE" 2>/dev/null || restore_fail "backup.notArchive"
    # Bounded by streaming: a small .gz can unpack into gigabytes
    [ "$(gzip -dc "$ARCHIVE" | head -c $((MAX_UNPACKED_BYTES + 1)) | wc -c)" -le "$MAX_UNPACKED_BYTES" ] \
        || restore_fail "backup.tooLarge" 413
    [ "$(gzip -dc "$ARCHIVE" | tar -tf - 2>/dev/null | head -n $((MAX_ENTRIES + 1)) | wc -l)" -le "$MAX_ENTRIES" ] \
        || restore_fail "backup.tooLarge" 413
    gzip -dc "$ARCHIVE" | tar -tf - >/dev/null 2>&1 || restore_fail "backup.notArchive"
    # Only plain files and directories: no symlinks, hard links, devices or fifos
    # (BusyBox lists a hard link as a regular file followed by "-> target")
    gzip -dc "$ARCHIVE" | tar -tvf - 2>/dev/null | grep -v '^$' | \
        grep -qE '^[^-d]| -> | link to ' && restore_fail "backup.badEntry"
    gzip -dc "$ARCHIVE" | tar -tf - 2>/dev/null | grep -v '^$' | grep -vE "$ALLOWED_ENTRY_RE" | grep -q . \
        && restore_fail "backup.badEntry"

    (umask 077 && mkdir -p "$WORK") || restore_fail "backup.internal" 500
    (cd "$WORK" && gzip -dc "$ARCHIVE" | tar -xf -) || restore_fail "backup.notArchive"
    [ -z "$(find "$WORK" \( ! -type f ! -type d \) -o \( -type f -links +1 \) 2>/dev/null)" ] \
        || restore_fail "backup.badEntry"

    jq -e --arg t "$BACKUP_TYPE" '.type == $t' "$WORK/manifest.json" >/dev/null 2>&1 \
        || restore_fail "backup.notManagerBackup"
    for f in "$WORK"/*.json "$WORK"/configs/*.json; do
        [ -f "$f" ] || continue
        jq -e . "$f" >/dev/null 2>&1 || restore_fail "backup.badJson"
    done
    if [ -f "$WORK/subscriptions.json" ]; then
        jq -e '.subscriptions | type == "array"' "$WORK/subscriptions.json" >/dev/null 2>&1 \
            || restore_fail "backup.badJson"
    fi
    if [ -f "$WORK/vpnserver-credentials.json" ]; then
        jq -e '.users | type == "array"' "$WORK/vpnserver-credentials.json" >/dev/null 2>&1 \
            || restore_fail "backup.badJson"
    fi
    # Several connections: ticked servers, subscriptions, main server, mode
    if [ -f "$WORK/multi.json" ]; then
        jq -e 'type == "object" and ((.members // []) | type == "array")' "$WORK/multi.json" >/dev/null 2>&1 \
            || restore_fail "backup.badJson"
    fi
    if [ -f "$WORK/active-config" ]; then
        active=$(head -1 "$WORK/active-config" | tr -d '\r\n')
        echo "$active" | grep -qE "$CONFIG_ID_RE" || restore_fail "backup.badEntry"
        if [ ! -f "$WORK/configs/$active.json" ]; then
            rm -f "$WORK/active-config"
            active_missing=true
        fi
    fi

    # --- Snapshot the current state, so a wrong file can be undone ------------
    mkdir -p "$SNAPSHOT_DIR"
    snapshot="pre-restore-$(date +%Y%m%d-%H%M%S).tar.gz"
    if ! write_backup_archive "$SNAPSHOT_DIR/$snapshot"; then
        rm -f "$SNAPSHOT_DIR/$snapshot"
        restore_fail "backup.snapshotFailed" 500
    fi
    ls -t "$SNAPSHOT_DIR"/pre-restore-*.tar.gz 2>/dev/null | tail -n +$((SNAPSHOT_KEEP + 1)) | \
        while read -r f; do rm -f "$f"; done

    # --- Replace ----------------------------------------------------------------
    # Ports belong to this router: the panel, dnsmasq and the forwarded VPN server port
    keep_current_keys "$WORK/settings.json" "$SETTINGS_FILE" web_port dnsmasq_port
    # B8: "no password, risk accepted" belongs to this router's password, which a backup
    # does not carry — never restore it (access then needs the password here)
    if [ -f "$WORK/settings.json" ]; then
        if jq 'del(.vpn_lan_access_no_password)' "$WORK/settings.json" > "$WORK/settings.json.b8" 2>/dev/null && [ -s "$WORK/settings.json.b8" ]; then
            mv "$WORK/settings.json.b8" "$WORK/settings.json"
        fi
        rm -f "$WORK/settings.json.b8"
    fi
    keep_current_keys "$WORK/vpnserver-credentials.json" "$CREDS_FILE" server_port
    [ "$apply_hwid" = "1" ] || rm -f "$WORK/router-hwid"

    mkdir -p "$VPN_CONFIGS_DIR"
    rm -f "$VPN_CONFIGS_DIR"/*.json
    for f in "$WORK"/configs/*.json; do
        [ -f "$f" ] || continue
        cp "$f" "$VPN_CONFIGS_DIR/"
        chmod 644 "$VPN_CONFIGS_DIR/$(basename "$f")"
    done
    for f in $REPLACED_WHEN_ABSENT; do
        [ -f "$WORK/$f" ] || rm -f "$VPN_MANAGER_HOME/$f"
    done
    for f in $BACKUP_FILES; do
        [ -f "$WORK/$f" ] || continue
        cp "$WORK/$f" "$VPN_MANAGER_HOME/$f"
        chmod 644 "$VPN_MANAGER_HOME/$f"
    done

    # --- Apply --------------------------------------------------------------------
    # Several connections come back as the group; if none of its servers survived
    # (an older backup, a different router) the one active server is applied instead
    active=$(get_active_config)
    if multi_is_on && apply_multi_config >/dev/null 2>&1; then
        :
    elif [ -n "$active" ] && [ -f "$VPN_CONFIGS_DIR/$active.json" ]; then
        apply_singbox_outbound "$VPN_CONFIGS_DIR/$active.json" "vpn" >/dev/null 2>&1
    fi
    # Segment policies and subnet lists
    "$SINGBOX_RULES_INIT" restart-rules >/dev/null 2>&1
    # Domain lists → dnsmasq (the Russia set first, so the one dnsmasq restart takes both)
    direct_lists all
    call_api domains.cgi POST /reload
    # sing-box picks up the outbound and server users from files on start
    check_singbox_running && singbox_restart
    # Cron jobs derived from settings
    call_api lists.cgi GET /toggle \
        "enabled=$(jq -r 'if .auto_update_lists == false then "false" else "true" end' "$SETTINGS_FILE" 2>/dev/null)"
    call_api failover.cgi POST /settings "" \
        "$(jq -c '{mode: (.failover_mode // "off"), check_interval: (.failover_check_interval // 300)}' "$SETTINGS_FILE" 2>/dev/null)"

    count_configs=$(ls "$VPN_CONFIGS_DIR" 2>/dev/null | grep -c '\.json$')
    count_subs=$(jq '.subscriptions | length' "$SUBSCRIPTIONS_FILE_PATH" 2>/dev/null || echo 0)
    count_users=$(jq '.users | length' "$CREDS_FILE" 2>/dev/null || echo 0)

    log_action "BACKUP_RESTORED" "Configs: $count_configs, subscriptions: $count_subs, users: $count_users, hwid: $apply_hwid, snapshot: $snapshot"
    json_success "{\"configs\":$count_configs,\"subscriptions\":${count_subs:-0},\"users\":${count_users:-0},\"hwid_applied\":$([ "$apply_hwid" = "1" ] && echo true || echo false),\"active_missing\":$active_missing,\"snapshot\":\"$snapshot\"}"
}

ACTION=$(echo "${PATH_INFO:-}" | cut -d'/' -f2)

case "$REQUEST_METHOD" in
    GET)
        case "$ACTION" in
            export) do_export ;;
            *) json_error "Unknown action: $ACTION" 404 ;;
        esac
        ;;
    POST)
        case "$ACTION" in
            restore)
                HWID=$(echo "$QUERY_STRING" | sed -n 's/.*hwid=\([01]\).*/\1/p')
                do_restore "${HWID:-0}"
                ;;
            *) json_error "Unknown action: $ACTION" 404 ;;
        esac
        ;;
    *)
        json_error "Method not allowed" 405
        ;;
esac
