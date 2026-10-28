#!/bin/sh
# =============================================================================
# B44: the lists as one table (Domains and subnets tab)
#   GET  /api/listtable.cgi?set=world|russia   every entry of the set's lists:
#        {v, kind: domain|subnet, proto: tcpudp|udp, src: cloud|mine, group, on}
#   POST /api/listtable.cgi/set     {"set":"world","values":[..],"on":false}  switch on/off
#   POST /api/listtable.cgi/add     {"set":"world","values":["x","10.0.0.0/8"],"proto":"tcpudp"}
#   POST /api/listtable.cgi/delete  {"set":"world","values":[..]}  own entries only
# Switching never edits the cloud lists: list-overrides.sh keeps the change aside, so the
# list files keep their format and an older Split-KVN still reads them (see that script).
# Applying (dnsmasq, ipsets, sing-box) runs in the background, the answer comes at once.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

LO="$VPN_MANAGER_HOME/scripts/list-overrides.sh"
ACTION=$(echo "${PATH_INFO:-}" | cut -d'/' -f2)
APPLY_LOCK="/tmp/listtable-apply.lock"

# set → "<cloud dir> <local prefix>"
set_dirs() {
    case "$1" in
        russia) echo "$REMOTE_LISTS_DIR/direct direct" ;;
        *)      echo "$REMOTE_LISTS_DIR vpn" ;;
    esac
}

# one file → lines "v<TAB>kind<TAB>proto<TAB>src<TAB>group<TAB>on" (on: 1/0)
emit() {
    local file="$1" kind="$2" proto="$3" src="$4" offf="$5"
    [ -f "$file" ] || return 0
    awk -v kind="$kind" -v proto="$proto" -v src="$src" -v OFF="$offf" -F'\t' '
        BEGIN { while ((getline l < OFF) > 0) off[l] = 1 }
        { line = $0; gsub(/\r/, "", line) }
        # groups: "# === Name ===", or a banner line ("# ----…" / "# ====…") then "# Name"
        line ~ /^#[ ]*[-=][-=][-=][-=][-=][-=][-=][-=][-=][-=]+[ ]*$/ { expect = 1; next }
        line ~ /^#[ ]*===/ { g = line; sub(/^#[ ]*=+[ ]*/, "", g); sub(/[ ]*=+[ ]*$/, "", g); if (src != "mine") grp = g; expect = 0; next }
        expect && line ~ /^#/ && line !~ /^#off: / { g = line; sub(/^#[ ]*/, "", g); if (src != "mine") grp = g; expect = 0; next }
        line ~ /^#off: / { e = substr(line, 7); gsub(/[ \t]/, "", e); sub(/^\*\./, "", e); sub(/^\*/, "", e); if (e != "") print e "\t" kind "\t" proto "\t" src "\t" grp "\t0"; next }
        line ~ /^#/ || line ~ /^[ \t]*$/ { next }
        { e = line; gsub(/[ \t]/, "", e); sub(/^\*\./, "", e); sub(/^\*/, "", e)
          print e "\t" kind "\t" proto "\t" src "\t" grp "\t" ((e in off) ? 0 : 1) }' "$file"
}

list_json() {
    local set="$1" d cloud pre orig offf
    d=$(set_dirs "$set"); cloud="${d% *}"; pre="${d#* }"
    orig="$cloud/orig"; [ -d "$orig" ] || orig="$cloud"
    offf="/tmp/listtable.off.$$"
    "$LO" list > "$offf" 2>/dev/null || : > "$offf"
    {
        emit "$orig/tcp_udp_domains.txt" domain tcpudp cloud "$offf"
        emit "$orig/udp_domains.txt" domain udp cloud "$offf"
        emit "$orig/tcp_udp_subnets.txt" subnet tcpudp cloud "$offf"
        emit "$orig/udp_subnets.txt" subnet udp cloud "$offf"
        emit "$VPN_MANAGER_HOME/$pre-domains.txt" domain tcpudp mine "$offf"
        emit "$VPN_MANAGER_HOME/$pre-domains-udp.txt" domain udp mine "$offf"
        emit "$VPN_MANAGER_HOME/$pre-subnets.txt" subnet tcpudp mine "$offf"
        emit "$VPN_MANAGER_HOME/$pre-subnets-udp.txt" subnet udp mine "$offf"
    } | awk -F'\t' '
        function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return s }
        # the same entry in the cloud list and in the own list: one row, src "both"
        { k = $1 FS $3
          if (!(k in src)) { order[++n] = k; v[k] = $1; kind[k] = $2; proto[k] = $3; src[k] = $4; grp[k] = $5; on[k] = $6 }
          else if (src[k] != $4) { src[k] = "both"; if (grp[k] == "") grp[k] = $5; if ($6 == "0") on[k] = "0" } }
        END { printf "["
              for (i = 1; i <= n; i++) { k = order[i]
                  printf "%s{\"v\":\"%s\",\"kind\":\"%s\",\"proto\":\"%s\",\"src\":\"%s\",\"group\":\"%s\",\"on\":%s}",
                      (i > 1 ? "," : ""), esc(v[k]), kind[k], proto[k], src[k], esc(grp[k]), (on[k] == "1" ? "true" : "false") }
              printf "]" }'
    rm -f "$offf"
}

# apply in the background, one at a time; a request during an apply is picked up after it
apply_bg() {
    touch /tmp/listtable-apply.again
    (
        mkdir "$APPLY_LOCK" 2>/dev/null || exit 0
        while [ -f /tmp/listtable-apply.again ]; do
            rm -f /tmp/listtable-apply.again
            "$LO" apply >/dev/null 2>&1
        done
        rmdir "$APPLY_LOCK"
    ) </dev/null >/dev/null 2>&1 &
}

applying() { [ -d "$APPLY_LOCK" ] && echo true || echo false; }

# sing-box after a change of "via" or of the dedicated groups, in the background: the
# entry rules and server connections; when the set of dedicated servers changed, the
# shared group too (they leave or rejoin it). Restart (2–3 s) only when the config changed;
# a config sing-box does not accept is rolled back
rebuild_via() {
    local before="$1"
    (
        # one rebuild at a time: two at once (the servers of a choice, then its threshold —
        # one click in the window) read each other's half-written config and both rolled back
        i=0
        while ! mkdir /tmp/listtable-via.lock 2>/dev/null; do
            i=$((i + 1)); [ $i -gt 120 ] && rmdir /tmp/listtable-via.lock 2>/dev/null
            usleep 250000 2>/dev/null || sleep 1
        done
        trap 'rmdir /tmp/listtable-via.lock 2>/dev/null' EXIT
        prev="/tmp/listtable-via.prev.$$"
        cp "$SINGBOX_CONFIG" "$prev" 2>/dev/null
        if [ "$before" != "$(dedicated_ids)" ] && multi_is_on; then
            apply_multi_config    # ends with apply_via_rules
        else
            apply_via_rules
        fi
        if [ $? -eq 0 ] && singbox_config_ok; then
            cmp -s "$prev" "$SINGBOX_CONFIG" || { check_singbox_running && singbox_restart; }
        else
            cat "$prev" > "$SINGBOX_CONFIG"
            log_action "LIST_TABLE" "via: sing-box did not accept the config, rolled back"
        fi
        rm -f "$prev"
    ) </dev/null >/dev/null 2>&1 &
}

valid_entry() {
    case "$2" in
        domain) echo "$1" | grep -qE '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' ;;
        subnet) echo "$1" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$|^[0-9A-Fa-f:]+(/[0-9]{1,3})?$' ;;
        *) return 1 ;;
    esac
}

local_file() {
    local pre="${2#* }" name
    case "$3:$4" in
        domain:udp) name="$pre-domains-udp.txt" ;;
        domain:*)   name="$pre-domains.txt" ;;
        subnet:udp) name="$pre-subnets-udp.txt" ;;
        *)          name="$pre-subnets.txt" ;;
    esac
    echo "$VPN_MANAGER_HOME/$name"
}

case "$REQUEST_METHOD" in
    GET)
        if echo "&$QUERY_STRING" | grep -q '&what=reserved'; then
            # the servers tab: which servers serve only chosen domains
            r='[]'
            [ -s "$VPN_MANAGER_HOME/list-overrides.json" ] && r=$(jq -c '[(.reserved // [])[] | strings]' "$VPN_MANAGER_HOME/list-overrides.json" 2>/dev/null)
            json_success "{\"reserved\":${r:-[]}}"
            exit 0
        fi
        SET=$(echo "&$QUERY_STRING" | sed -n "s/.*&set=\([a-z]*\).*/\1/p"); [ "$SET" = "russia" ] || SET=world
        auto=$(jq 'if .auto_update_lists == null then true else .auto_update_lists end' "$SETTINGS_FILE" 2>/dev/null)
        via='{}'
        groups='{}'
        [ -s "$VPN_MANAGER_HOME/list-overrides.json" ] && via=$(jq -c '.via // {}' "$VPN_MANAGER_HOME/list-overrides.json" 2>/dev/null)
        [ -s "$VPN_MANAGER_HOME/list-overrides.json" ] && groups=$(jq -c '.groups // {}' "$VPN_MANAGER_HOME/list-overrides.json" 2>/dev/null)
        [ -n "$via" ] || via='{}'
        [ -n "$groups" ] || groups='{}'
        modes='{}'; tols='{}'
        [ -s "$VPN_MANAGER_HOME/list-overrides.json" ] && modes=$(jq -c '.mode // {}' "$VPN_MANAGER_HOME/list-overrides.json" 2>/dev/null) && tols=$(jq -c '.tolerance // {}' "$VPN_MANAGER_HOME/list-overrides.json" 2>/dev/null)
        [ -n "$modes" ] || modes='{}'; [ -n "$tols" ] || tols='{}'
        # the servers to choose from: the group's own first (in its order), then the rest
        eff=$(multi_effective | jq -c '.ids' 2>/dev/null); [ -n "$eff" ] || eff='[]'
        ded=$(dedicated_ids)
        resv='[]'
        [ -s "$VPN_MANAGER_HOME/list-overrides.json" ] && resv=$(jq -c '[(.reserved // [])[] | strings]' "$VPN_MANAGER_HOME/list-overrides.json" 2>/dev/null)
        # the subscription a server came from, by name (shown next to the server)
        subs=$(jq -c '[(.subscriptions // [])[] | {key: .id, value: (.name // "")}] | from_entries' "$VPN_MANAGER_HOME/subscriptions.json" 2>/dev/null)
        [ -n "$subs" ] || subs='{}'
        servers=$(multi_catalog | jq -c --argjson eff "$eff" --argjson ded "${ded:-[]}" --argjson subs "$subs" --argjson resv "${resv:-[]}" '[.[] | {id, name, protocol, in_group: (.id as $i | $eff | index($i) != null),
                                                                  dedicated: (.id as $i | $ded | index($i) != null),
                                                                  reserved: (.id as $i | $resv | index($i) != null),
                                                                  sub: (if .subscription_id != "" then ($subs[.subscription_id] // "") else "" end)}]
            | (map(select(.in_group)) | sort_by(.id as $i | $eff | index($i))) + (map(select(.in_group | not)) | sort_by(.name))')
        [ -n "$servers" ] || servers='[]'
        mode=$(multi_state | jq -r '.mode + ":" + .strategy')
        json_success "{\"set\":\"$SET\",\"cloud_active\":${auto:-true},\"applying\":$(applying),\"group_mode\":\"$mode\",\"via\":$via,\"groups\":$groups,\"mode\":$modes,\"tolerance\":$tols,\"default_tolerance\":$MULTI_TOLERANCE,\"servers\":$servers,\"entries\":$(list_json "$SET")}"
        ;;
    POST)
        BODY=$(read_post_data)
        printf '%s' "$BODY" | jq -e 'type == "object"' >/dev/null 2>&1 || { json_error "Invalid JSON" 400; exit 0; }
        SET=$(printf '%s' "$BODY" | jq -r '.set // "world"'); [ "$SET" = "russia" ] || SET=world
        case "$ACTION" in
            set)
                ON=$(printf '%s' "$BODY" | jq -r 'if .on == true then "on" else "off" end')
                VALUES=$(printf '%s' "$BODY" | jq -r '.values[]? | strings' | tr -d ' \t\r' | grep -v '^$')
                [ -n "$VALUES" ] || { json_error "listtable.errors.empty" 400; exit 0; }
                DED=$(dedicated_ids)
                # shellcheck disable=SC2086
                "$LO" set "$ON" $VALUES >/dev/null 2>&1 || { json_error "Cannot save" 500; exit 0; }
                log_action "LIST_TABLE" "$ON: $(printf '%s\n' "$VALUES" | grep -c .) entr(y/ies)"
                apply_bg
                # the only entries of a dedicated group switched off (or back on): its
                # servers rejoin (or leave) the shared group
                [ "$DED" = "$(dedicated_ids)" ] || rebuild_via "$DED"
                json_success "{\"applying\":true}"
                ;;
            add)
                # {"values":[..]} (or one "value"); each is a domain or a subnet, told apart here.
                # Answer: which were added, which were already there, which are neither
                PROTO=$(printf '%s' "$BODY" | jq -r 'if .proto == "udp" then "udp" else "tcpudp" end')
                RAWS=$(printf '%s' "$BODY" | jq -r '((.values // []) + [.value // empty]) | .[] | strings' | tr ',; \t\r' '\n\n\n\n\n' | grep -v '^$')
                [ -n "$RAWS" ] || { json_error "listtable.errors.empty" 400; exit 0; }
                ADDED=""; EXISTS=""; BAD=""
                "$LO" lock
                for R in $RAWS; do
                    # a subnet keeps its "/mask"; a pasted URL loses the scheme and the path
                    if valid_entry "$R" subnet; then
                        V="$R"; KIND=subnet
                    else
                        V=$(printf '%s' "$R" | sed 's/^\*\.//; s/^https\?:\/\///; s/\/.*$//; s/:[0-9]*$//' | tr 'A-Z' 'a-z'); KIND=domain
                        valid_entry "$V" domain || { BAD="$BAD $R"; continue; }
                    fi
                    F=$(local_file x "$(set_dirs "$SET")" "$KIND" "$PROTO")
                    if grep -qxF "$V" "$F" 2>/dev/null || grep -qxF "#off: $V" "$F" 2>/dev/null; then
                        EXISTS="$EXISTS $V"; continue
                    fi
                    [ -s "$F" ] && [ -n "$(tail -c1 "$F")" ] && echo >> "$F"
                    echo "$V" >> "$F"
                    ADDED="$ADDED $V"
                done
                "$LO" unlock
                js() { printf '%s\n' $1 | grep -v '^$' | jq -R . | jq -cs .; }
                if [ -n "$ADDED" ]; then
                    # shellcheck disable=SC2086
                    "$LO" set on $ADDED >/dev/null 2>&1
                    log_action "LIST_TABLE" "Added $(printf '%s\n' $ADDED | grep -c .) entr(y/ies) ($PROTO, $SET)"
                    apply_bg
                fi
                # one value that could not be added keeps the old error answer
                if [ -z "$ADDED" ] && [ "$(printf '%s\n' $RAWS | grep -c .)" -eq 1 ]; then
                    [ -n "$BAD" ] && { json_error "listtable.errors.invalid" 400; exit 0; }
                    json_error "listtable.errors.exists" 409; exit 0
                fi
                json_success "{\"applying\":$([ -n "$ADDED" ] && echo true || echo false),\"added\":$(js "$ADDED"),\"exists\":$(js "$EXISTS"),\"invalid\":$(js "$BAD")}"
                ;;
            delete)
                VALUES=$(printf '%s' "$BODY" | jq -r '.values[]? | strings' | tr -d ' \t\r' | grep -v '^$')
                [ -n "$VALUES" ] || { json_error "listtable.errors.empty" 400; exit 0; }
                DED=$(dedicated_ids)
                pre=$(set_dirs "$SET"); pre="${pre#* }"
                vf="/tmp/listtable.del.$$"; printf '%s\n' "$VALUES" > "$vf"
                "$LO" lock
                for f in "$pre-domains.txt" "$pre-domains-udp.txt" "$pre-subnets.txt" "$pre-subnets-udp.txt"; do
                    [ -f "$VPN_MANAGER_HOME/$f" ] || continue
                    awk -v DEL="$vf" 'BEGIN { while ((getline l < DEL) > 0) d[l] = 1 }
                         { e = $0; sub(/^#off: /, "", e); gsub(/[ \t\r]/, "", e); sub(/^\*\./, "", e); sub(/^\*/, "", e); if (e in d) next; print }' \
                        "$VPN_MANAGER_HOME/$f" > "$VPN_MANAGER_HOME/$f.tmp.$$" && cat "$VPN_MANAGER_HOME/$f.tmp.$$" > "$VPN_MANAGER_HOME/$f"
                    rm -f "$VPN_MANAGER_HOME/$f.tmp.$$"
                done
                "$LO" unlock
                rm -f "$vf"
                # a deleted entry keeps no switch and no connection of its own
                # shellcheck disable=SC2086
                "$LO" set on $VALUES >/dev/null 2>&1
                # shellcheck disable=SC2086
                "$LO" via - $VALUES >/dev/null 2>&1
                log_action "LIST_TABLE" "Deleted $(printf '%s\n' "$VALUES" | grep -c .) own entr(y/ies) ($SET)"
                apply_bg
                # the last entry of a dedicated group gone: its servers rejoin the shared group
                [ "$DED" = "$(dedicated_ids)" ] || rebuild_via "$DED"
                json_success "{\"applying\":true}"
                ;;
            via)
                # {"values":[..], "server":"<config id>" | ""} — "" back to the group's way
                SERVER=$(printf '%s' "$BODY" | jq -r '.server // ""')
                VALUES=$(printf '%s' "$BODY" | jq -r '.values[]? | strings' | tr -d ' \t\r' | grep -v '^$')
                [ -n "$VALUES" ] || { json_error "listtable.errors.empty" 400; exit 0; }
                case "$SERVER" in
                    "") ;;
                    g:*)
                        # a dedicated group (stage 3)
                        jq -e --arg n "${SERVER#g:}" '(.groups // {}) | has($n)' "$VPN_MANAGER_HOME/list-overrides.json" >/dev/null 2>&1 \
                            || { json_error "listtable.errors.server" 400; exit 0; } ;;
                    *[!A-Za-z0-9_.@+,-]*) json_error "listtable.errors.server" 400; exit 0 ;;
                    *)
                        # one server, or "id1,id2,…" — the fastest of these
                        for id in $(printf '%s' "$SERVER" | tr ',' ' '); do
                            [ -f "$VPN_CONFIGS_DIR/$id.json" ] || { json_error "listtable.errors.server" 400; exit 0; }
                        done
                        SERVER=$(printf '%s' "$SERVER" | tr ',' '\n' | grep -v '^$' | sort -u | tr '\n' ',' | sed 's/,$//') ;;
                esac
                DED=$(dedicated_ids)
                # shellcheck disable=SC2086
                "$LO" via "${SERVER:--}" $VALUES >/dev/null 2>&1 || { json_error "Cannot save" 500; exit 0; }
                log_action "LIST_TABLE" "via ${SERVER:-group}: $(printf '%s\n' "$VALUES" | grep -c .) entr(y/ies)"
                rebuild_via "$DED"
                json_success "{\"applying\":true}"
                ;;
            mode)
                # {"values":[..], "mode":"fallback"|"strict"|"equal"} — the main server for entries
                # with their own connection: a fallback (default), never (B45) or in the race (B46)
                M=$(printf '%s' "$BODY" | jq -r '.mode // "fallback"')
                case "$M" in fallback|strict|equal) ;; *) json_error "Invalid mode" 400; exit 0 ;; esac
                VALS=$(printf '%s' "$BODY" | jq -c '[.values[]? | strings | ltrimstr("*.") | ltrimstr("*") | select(length > 0)]')
                [ "$VALS" != "[]" ] || { json_error "listtable.errors.empty" 400; exit 0; }
                OV="$VPN_MANAGER_HOME/list-overrides.json"
                "$LO" ovlock
                [ -s "$OV" ] && jq -e 'type == "object"' "$OV" >/dev/null 2>&1 || echo '{"off":[]}' > "$OV"
                tmp="$OV.tmp.$$"
                jq --argjson v "$VALS" --arg m "$M" '.mode = ((.mode // {}) | with_entries(select(.key as $k | $v | index($k) | not))
                                                        + (if $m == "fallback" then {} else ($v | map({key: ., value: $m}) | from_entries) end))' "$OV" > "$tmp" \
                    && [ -s "$tmp" ] && mv "$tmp" "$OV" || { rm -f "$tmp"; "$LO" ovunlock; json_error "Cannot save" 500; exit 0; }
                "$LO" ovunlock
                log_action "LIST_TABLE" "Main server for $(printf '%s' "$VALS" | jq length) entr(y/ies): $M"
                rebuild_via "$(dedicated_ids)"
                json_success "{\"applying\":true}"
                ;;
            tolerance)
                # {"server":"<the entries' choice: id, id1,id2 or g:name>", "ms": N | null} — the switch
                # threshold of that set of servers (B47); null — the common one
                SRV=$(printf '%s' "$BODY" | jq -r '.server // ""')
                MS=$(printf '%s' "$BODY" | jq -r '.ms // "" | tostring')
                [ -n "$SRV" ] || { json_error "listtable.errors.server" 400; exit 0; }
                case "$MS" in ""|null) MS=null ;; *[!0-9]*) json_error "Invalid value" 400; exit 0 ;; *) [ "$MS" -ge 50 ] && [ "$MS" -le 1000 ] || { json_error "Invalid value" 400; exit 0; } ;; esac
                OV="$VPN_MANAGER_HOME/list-overrides.json"
                "$LO" ovlock
                [ -s "$OV" ] && jq -e 'type == "object"' "$OV" >/dev/null 2>&1 || echo '{"off":[]}' > "$OV"
                tmp="$OV.tmp.$$"
                jq --arg s "$SRV" --argjson ms "$MS" '.tolerance = ((.tolerance // {}) | del(.[$s]) + (if $ms == null then {} else {($s): $ms} end))' "$OV" > "$tmp" \
                    && [ -s "$tmp" ] && mv "$tmp" "$OV" || { rm -f "$tmp"; "$LO" ovunlock; json_error "Cannot save" 500; exit 0; }
                "$LO" ovunlock
                log_action "LIST_TABLE" "Switch threshold for a set of servers: $MS"
                rebuild_via "$(dedicated_ids)"
                json_success "{\"applying\":true}"
                ;;
            reserved)
                # {"id":"<config id>","reserved":true|false} — the server's role: only for
                # chosen domains (out of the shared group, never switched to) or automatic
                ID=$(printf '%s' "$BODY" | jq -r '.id // ""')
                R=$(printf '%s' "$BODY" | jq -r 'if .reserved == true then "true" else "false" end')
                case "$ID" in ""|*[!A-Za-z0-9_.@+-]*) json_error "listtable.errors.server" 400; exit 0 ;; esac
                [ -f "$VPN_CONFIGS_DIR/$ID.json" ] || { json_error "listtable.errors.server" 400; exit 0; }
                DED=$(dedicated_ids)
                OV="$VPN_MANAGER_HOME/list-overrides.json"
                "$LO" ovlock
                [ -s "$OV" ] && jq -e 'type == "object"' "$OV" >/dev/null 2>&1 || echo '{"off":[]}' > "$OV"
                tmp="$OV.tmp.$$"
                jq --arg id "$ID" --argjson r "$R" '.reserved = (((.reserved // []) - [$id]) + (if $r then [$id] else [] end))' "$OV" > "$tmp" \
                    && [ -s "$tmp" ] && mv "$tmp" "$OV" || { rm -f "$tmp"; "$LO" ovunlock; json_error "Cannot save" 500; exit 0; }
                "$LO" ovunlock
                log_action "LIST_TABLE" "Server $ID: $([ "$R" = true ] && echo "only for chosen domains" || echo automatic)"
                rebuild_via "$DED"
                json_success "{\"reserved\":$(jq -c '.reserved // []' "$OV")}"
                ;;
            groups)
                # {"groups":{"<name>":[<config id>…]}} — the whole set; entries of a removed
                # group go back to the shared group's way
                # (router jq: no regex — names are checked below in shell instead)
                G=$(printf '%s' "$BODY" | jq -c '(.groups // {}) | with_entries(select((.value | type) == "array") | .value |= ([.[] | strings] | unique))' 2>/dev/null)
                [ -n "$G" ] || { json_error "Invalid JSON" 400; exit 0; }
                for n in $(printf '%s' "$G" | jq -r 'keys[] | @base64'); do
                    name=$(printf '%s' "$n" | base64 -d 2>/dev/null)
                    len=$(printf '%s' "$name" | wc -m)
                    [ "$len" -ge 1 ] && [ "$len" -le 32 ] || { json_error "listtable.errors.groupName" 400; exit 0; }
                    case "$name" in *'"'*|*'\\'*) json_error "listtable.errors.groupName" 400; exit 0 ;; esac
                done
                for id in $(printf '%s' "$G" | jq -r '[.[][]] | unique | .[]'); do
                    case "$id" in *[!A-Za-z0-9_.@+-]*) json_error "listtable.errors.server" 400; exit 0 ;; esac
                    [ -f "$VPN_CONFIGS_DIR/$id.json" ] || { json_error "listtable.errors.server" 400; exit 0; }
                done
                DED=$(dedicated_ids)
                OV="$VPN_MANAGER_HOME/list-overrides.json"
                "$LO" ovlock
                [ -s "$OV" ] && jq -e 'type == "object"' "$OV" >/dev/null 2>&1 || echo '{"off":[]}' > "$OV"
                tmp="$OV.tmp.$$"
                jq --argjson g "$G" '.groups = $g
                    | .via = ((.via // {}) | with_entries(select((.value | startswith("g:") | not) or ((.value | ltrimstr("g:")) as $n | $g | has($n)))))' "$OV" > "$tmp" \
                    && [ -s "$tmp" ] && mv "$tmp" "$OV" || { rm -f "$tmp"; "$LO" ovunlock; json_error "Cannot save" 500; exit 0; }
                "$LO" ovunlock
                log_action "LIST_TABLE" "Dedicated groups: $(printf '%s' "$G" | jq -r 'keys | join(", ")')"
                rebuild_via "$DED"
                json_success "{\"groups\":$(jq -c '.groups // {}' "$OV")}"
                ;;
            *) json_error "Unknown action" 400 ;;
        esac
        ;;
    *) json_error "Method not supported" 405 ;;
esac
