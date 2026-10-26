#!/bin/sh
# B44: local changes on top of the domain/subnet lists.
#
# Lists keep their format (cloud files from split-kvn-lists, local vpn-*.txt and
# direct-*.txt); everything new lives in list-overrides.json, so an older Split-KVN
# simply ignores it. An entry switched off acts as if it were not in the list:
#   - cloud lists are downloaded into remote-lists/orig/ (and remote-lists/direct/orig/);
#     the usual remote-lists/*.txt everyone reads are those copies minus the "off" entries;
#   - a local entry that is off is kept in its file as "#off: <entry>" — a comment for
#     every reader, the panel turns it back on.
# One set of changes per router (both modes).
#
#   remote            rebuild remote-lists/*.txt (and direct/*.txt) from orig/ minus "off"
#   local             comment out / back in the local entries per "off"
#   set on|off <e>... switch entries, then rebuild (no apply)
#   apply             remote + local, then apply to dnsmasq / ipset / sing-box (slow part)
#   via <id|-> <e>... the entries go through server <id> ("-": back to the group's way)
#   list              the "off" entries, one per line

export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

H="${VPN_MANAGER_HOME:-/opt/etc/vpn-manager}"
OV="$H/list-overrides.json"
R="$H/remote-lists"
FILES="tcp_udp_domains.txt udp_domains.txt tcp_udp_subnets.txt udp_subnets.txt"
LOCAL_FILES="vpn-domains.txt vpn-domains-udp.txt vpn-subnets.txt vpn-subnets-udp.txt direct-domains.txt direct-domains-udp.txt direct-subnets.txt direct-subnets-udp.txt"

log() { logger -t list-overrides "$*" 2>/dev/null; [ -t 1 ] && echo "$*"; return 0; }

# The panel and this script both rewrite the list files: one at a time (a lock older
# than a minute is from a run that died). "files_lock" waits up to ~10 s.
FILES_LOCK=/tmp/list-files.lock
files_lock() {
    local i=0
    while ! mkdir "$FILES_LOCK" 2>/dev/null; do
        [ $i -ge 50 ] && { [ -n "$(find "$FILES_LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rmdir "$FILES_LOCK"; i=0; }
        i=$((i + 1))
        usleep 200000 2>/dev/null || sleep 1
    done
}
files_unlock() { rmdir "$FILES_LOCK" 2>/dev/null; return 0; }

# list-overrides.json itself: one writer at a time (the panel's requests run in parallel)
OV_LOCK=/tmp/list-overrides.lock
ov_lock() {
    local i=0
    while ! mkdir "$OV_LOCK" 2>/dev/null; do
        [ $i -ge 50 ] && { [ -n "$(find "$OV_LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rmdir "$OV_LOCK"; i=0; }
        i=$((i + 1))
        usleep 200000 2>/dev/null || sleep 1
    done
}
ov_unlock() { rmdir "$OV_LOCK" 2>/dev/null; return 0; }

off_list() {
    [ -s "$OV" ] || return 0
    jq -r '(.off // [])[] | strings' "$OV" 2>/dev/null
}

# orig copy → filtered file (entries in "off" dropped; comments and order kept)
filter_file() {
    local src="$1" dst="$2" offf="$3"
    [ -f "$src" ] || return 0
    if [ -s "$offf" ]; then
        awk -v OFF="$offf" 'BEGIN { while ((getline l < OFF) > 0) off[l] = 1 }
             { e = $0; gsub(/[ \t\r]/, "", e); sub(/^\*\./, "", e); sub(/^\*/, "", e)
               if (e != "" && substr(e, 1, 1) != "#" && (e in off)) next; print }' "$src" > "$dst.tmp.$$"
    else
        cat "$src" > "$dst.tmp.$$"
    fi
    mv "$dst.tmp.$$" "$dst"
}

# First run after the update: the files downloaded so far become the orig copies
seed_orig() {
    local dir="$1" f
    mkdir -p "$dir/orig"
    for f in $FILES; do
        [ -f "$dir/orig/$f" ] || { [ -f "$dir/$f" ] && cp "$dir/$f" "$dir/orig/$f"; }
    done
}

cmd_remote() {
    local offf="/tmp/list-overrides.off.$$" dir f
    off_list > "$offf"
    for dir in "$R" "$R/direct"; do
        [ -d "$dir" ] || continue
        seed_orig "$dir"
        for f in $FILES; do
            filter_file "$dir/orig/$f" "$dir/$f" "$offf"
        done
    done
    rm -f "$offf"
}

cmd_local() {
    local offf="/tmp/list-overrides.off.$$" f
    off_list > "$offf"
    files_lock
    for f in $LOCAL_FILES; do
        [ -f "$H/$f" ] || continue
        # "off" holds entries without a "*." prefix (as the table shows them); the line keeps it
        awk -v OFF="$offf" 'function bare(x) { sub(/^\*\./, "", x); sub(/^\*/, "", x); return x }
             BEGIN { while ((getline l < OFF) > 0) off[l] = 1 }
             /^#off: / { e = substr($0, 7); gsub(/[ \t\r]/, "", e); if (bare(e) in off) print; else print e; next }
             { e = $0; gsub(/[ \t\r]/, "", e)
               if (e != "" && substr(e, 1, 1) != "#" && (bare(e) in off)) print "#off: " e; else print }' \
            "$H/$f" > "$H/$f.tmp.$$" && cat "$H/$f.tmp.$$" > "$H/$f"
        rm -f "$H/$f.tmp.$$"
    done
    files_unlock
    rm -f "$offf"
}

cmd_set() {
    local mode="$1" tmp="$OV.tmp.$$" list
    shift
    [ "$mode" = "on" ] || [ "$mode" = "off" ] || { echo "set on|off <entry>..."; return 1; }
    list=$(printf '%s\n' "$@" | tr -d ' \t\r' | grep -v '^$' | jq -R . | jq -cs .)
    ov_lock
    [ -s "$OV" ] && jq -e 'type == "object"' "$OV" >/dev/null 2>&1 || echo '{"off":[]}' > "$OV"
    if [ "$mode" = "off" ]; then
        jq --argjson l "$list" '.off = ((.off // []) + $l | unique)' "$OV" > "$tmp"
    else
        jq --argjson l "$list" '.off = ((.off // []) - $l)' "$OV" > "$tmp"
    fi
    [ -s "$tmp" ] && mv "$tmp" "$OV" || { rm -f "$tmp"; ov_unlock; return 1; }
    ov_unlock
    cmd_remote
    cmd_local
}

# B44 stage 2: "via" — the routing itself is built by common.sh apply_via_rules
cmd_via() {
    local id="$1" tmp="$OV.tmp.$$" list
    shift
    list=$(printf '%s\n' "$@" | tr -d ' \t\r' | grep -v '^$' | jq -R . | jq -cs .)
    ov_lock
    [ -s "$OV" ] && jq -e 'type == "object"' "$OV" >/dev/null 2>&1 || echo '{"off":[]}' > "$OV"
    if [ "$id" = "-" ]; then
        jq --argjson l "$list" '.via = ((.via // {}) | with_entries(select(.key as $k | $l | index($k) | not)))' "$OV" > "$tmp"
    else
        jq --argjson l "$list" --arg id "$id" '.via = ((.via // {}) + ($l | map({key: ., value: $id}) | from_entries))' "$OV" > "$tmp"
    fi
    [ -s "$tmp" ] && mv "$tmp" "$OV" || { rm -f "$tmp"; ov_unlock; return 1; }
    ov_unlock
}

# dnsmasq/ipset/sing-box pick up the rebuilt files (what a lists update does, without
# the download). sing-box restarts only when its own rules really changed.
cmd_apply() {
    cmd_remote
    cmd_local
    local lu="$H/scripts/lists-update.sh"
    [ -x "$lu" ] && "$lu" reapply >/dev/null 2>&1
    log "applied: $(off_list | grep -c .) entries off"
}

case "$1" in
    lock)   files_lock ;;
    unlock) files_unlock ;;
    ovlock)   ov_lock ;;
    ovunlock) ov_unlock ;;
    remote) cmd_remote ;;
    local)  cmd_local ;;
    set)    shift; cmd_set "$@" ;;
    via)    shift; cmd_via "$@" ;;
    apply)  cmd_apply ;;
    list)   off_list ;;
    *) echo "Usage: $0 {remote|local|set on|off <entry>...|apply|list}"; exit 1 ;;
esac
