#!/bin/sh
# Authorization API
# 
# Authorization modes (auth_mode):
#   - first_login: first login, setup required (admin/admin)
#   - disabled: authorization disabled, access without password
#   - password: password authorization
#
# VPN Manager is available ONLY from router's local network.
# Access from external network (internet) is not possible.

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR="$(dirname "$0")"
. "$SCRIPT_DIR/common.sh"

# Determine action from URL
ACTION=$(echo "$PATH_INFO" | sed 's/^\///' | cut -d'/' -f1)

# Generate recovery code (format: XXXX-XXXX-XXXX)
generate_recovery_code() {
    # 12 random characters (letters and digits), split into groups of 4
    local chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    local code=""
    local i=0
    # Use hexdump instead of od (BusyBox od doesn't support -An)
    local random_bytes=$(head -c 12 /dev/urandom 2>/dev/null | hexdump -e '12/1 "%02x"')
    
    while [ $i -lt 12 ]; do
        local byte=$(echo "$random_bytes" | cut -c$((i*2+1))-$((i*2+2)))
        local index=$((0x$byte % 32))
        code="${code}$(echo "$chars" | cut -c$((index+1))-$((index+1)))"
        i=$((i + 1))
        
        # Add hyphen after every 4 characters (except the last)
        if [ $((i % 4)) -eq 0 ] && [ $i -lt 12 ]; then
            code="${code}-"
        fi
    done
    
    echo "$code"
}

# Save recovery code to auth.db
save_recovery_code() {
    local code="$1"
    local hashed_code=$(echo -n "$code" | sha256sum | cut -d' ' -f1)
    
    # Check if recovery_code field already exists
    if grep -q '"recovery_code"' "$AUTH_DB"; then
        sed -i "s/\"recovery_code\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"recovery_code\": \"$hashed_code\"/" "$AUTH_DB"
    else
        # Add field to settings
        sed -i 's/"auth_mode"[[:space:]]*:[[:space:]]*"[^"]*"/"auth_mode": "password", "recovery_code": "'"$hashed_code"'"/' "$AUTH_DB"
    fi
}

# Verify recovery code
verify_recovery_code() {
    local code="$1"
    local hashed_input=$(echo -n "$code" | sha256sum | cut -d' ' -f1)
    local stored_hash=$(grep -o '"recovery_code"[[:space:]]*:[[:space:]]*"[^"]*"' "$AUTH_DB" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')
    
    [ -n "$stored_hash" ] && [ "$hashed_input" = "$stored_hash" ]
}

# Get current authorization mode
get_auth_mode() {
    if [ -f "$AUTH_DB" ]; then
        grep -o '"auth_mode"[[:space:]]*:[[:space:]]*"[^"]*"' "$AUTH_DB" | sed 's/.*"\([^"]*\)"$/\1/'
    else
        echo "first_login"
    fi
}

case "$ACTION" in
    login)
        if [ "$REQUEST_METHOD" != "POST" ]; then
            json_error "Method not supported" 405
            exit 0
        fi
        
        AUTH_MODE=$(get_auth_mode)
        
        # If authorization is disabled — create session immediately
        if [ "$AUTH_MODE" = "disabled" ]; then
            SESSION_ID=$(create_session "admin")
            log_action "LOGIN_AUTO" "Authorization disabled, automatic login"
            
            echo "Content-Type: application/json"
            session_cookie_header "$SESSION_ID"
            echo ""
            echo "{\"success\":true,\"auth_mode\":\"disabled\"}"
            exit 0
        fi
        
        # Read POST data
        POST_DATA=$(read_post_data)
        USERNAME=$(json_get_value "$POST_DATA" "username")
        PASSWORD=$(json_get_value "$POST_DATA" "password")
        
        if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
            json_error "Login and password are required" 400
            exit 0
        fi
        
        # Verify credentials
        if [ ! -f "$AUTH_DB" ]; then
            json_error "Authorization database not found" 500
            exit 0
        fi
        
        AUTH_DATA=$(cat "$AUTH_DB")
        
        # Find user (simplified parsing)
        STORED_HASH=$(echo "$AUTH_DATA" | grep -o "\"password_hash\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
        STORED_USER=$(echo "$AUTH_DATA" | grep -o "\"username\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
        FIRST_LOGIN=$(echo "$AUTH_DATA" | grep -o "\"first_login\"[[:space:]]*:[[:space:]]*\(true\|false\)" | head -1 | sed 's/.*: *//')
        FAILED_ATTEMPTS=$(echo "$AUTH_DATA" | grep -o "\"failed_attempts\"[[:space:]]*:[[:space:]]*[0-9]*" | head -1 | sed 's/.*: *//')
        LOCKED_UNTIL=$(echo "$AUTH_DATA" | grep -o "\"locked_until\"[[:space:]]*:[[:space:]]*[0-9]*" | head -1 | sed 's/.*: *//')
        
        # Check lockout
        NOW=$(date +%s)
        if [ -n "$LOCKED_UNTIL" ] && [ "$LOCKED_UNTIL" != "null" ] && [ "$LOCKED_UNTIL" -gt "$NOW" ] 2>/dev/null; then
            REMAINING=$(( (LOCKED_UNTIL - NOW) / 60 + 1 ))
            json_error "Account locked. Try again in $REMAINING min." 403
            exit 0
        fi
        
        if [ "$USERNAME" != "$STORED_USER" ]; then
            log_action "LOGIN_FAILED" "Invalid username: $USERNAME"
            json_error "Invalid login or password" 401
            exit 0
        fi
        
        # For first login check default password
        if [ "$AUTH_MODE" = "first_login" ] && [ "$PASSWORD" = "admin" ]; then
            SESSION_ID=$(create_session "$USERNAME")
            log_action "LOGIN_SUCCESS" "First login: $USERNAME"
            
            echo "Content-Type: application/json"
            session_cookie_header "$SESSION_ID"
            echo ""
            echo "{\"success\":true,\"auth_mode\":\"first_login\",\"message\":\"Choose authorization mode\"}"
            exit 0
        fi
        
        # Verify password
        if verify_password "$PASSWORD" "$STORED_HASH"; then
            # Reset failed attempts counter
            sed -i 's/"failed_attempts"[[:space:]]*:[[:space:]]*[0-9]*/"failed_attempts": 0/' "$AUTH_DB"
            sed -i 's/"locked_until"[[:space:]]*:[[:space:]]*[^,}]*/"locked_until": null/' "$AUTH_DB"
            
            # Update last login time
            LAST_LOGIN=$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')
            sed -i "s/\"last_login\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"last_login\": \"$LAST_LOGIN\"/" "$AUTH_DB"
            
            SESSION_ID=$(create_session "$USERNAME")
            log_action "LOGIN_SUCCESS" "User: $USERNAME"
            
            echo "Content-Type: application/json"
            session_cookie_header "$SESSION_ID"
            echo ""
            echo "{\"success\":true,\"first_login\":false}"
        else
            # Increment failed attempts counter
            FAILED_ATTEMPTS=$((FAILED_ATTEMPTS + 1))
            sed -i "s/\"failed_attempts\"[[:space:]]*:[[:space:]]*[0-9]*/\"failed_attempts\": $FAILED_ATTEMPTS/" "$AUTH_DB"
            
            if [ "$FAILED_ATTEMPTS" -ge 5 ]; then
                # Lock for 15 minutes
                LOCK_TIME=$((NOW + 900))
                sed -i "s/\"locked_until\"[[:space:]]*:[[:space:]]*[^,}]*/\"locked_until\": $LOCK_TIME/" "$AUTH_DB"
                log_action "LOGIN_LOCKED" "Too many attempts: $USERNAME"
                json_error "Account locked for 15 minutes" 403
            else
                REMAINING=$((5 - FAILED_ATTEMPTS))
                log_action "LOGIN_FAILED" "Invalid password: $USERNAME (attempts remaining: $REMAINING)"
                json_error "Invalid password. Attempts remaining: $REMAINING" 401
            fi
        fi
        ;;
        
    logout)
        # Only the panel logs out (a link on another site must not end the session)
        if [ "$HTTP_X_REQUESTED_WITH" != "vpn-manager" ]; then
            json_error "Forbidden" 403
            exit 0
        fi
        destroy_session
        log_action "LOGOUT" "Session ended"
        
        echo "Content-Type: application/json"
        echo "Set-Cookie: vpn_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
        echo ""
        echo "{\"success\":true,\"message\":\"Logout successful\"}"
        ;;
        
    check)
        AUTH_MODE=$(get_auth_mode)
        ONBOARDING=$(grep -o '"onboarding_shown"[[:space:]]*:[[:space:]]*[^,}]*' "$AUTH_DB" 2>/dev/null | sed 's/.*:[[:space:]]*//' | tr -d ' ')
        [ -z "$ONBOARDING" ] && ONBOARDING="false"
        
        if validate_session; then
            SESSION_ID=$(get_session_id)
            SESSION_FILE="$SESSION_DIR/$SESSION_ID"
            USERNAME=$(sed -n '2p' "$SESSION_FILE" 2>/dev/null)

            # Every page load checks the session: renew the cookie so the browser keeps
            # it for another SESSION_TTL, in step with the session on the router
            # (no cookie without a session: the no-password mode passes without one)
            [ -n "$SESSION_ID" ] && session_cookie_header "$SESSION_ID"
            json_success "{\"authenticated\":true,\"username\":\"$USERNAME\",\"auth_mode\":\"$AUTH_MODE\",\"onboarding_shown\":$ONBOARDING}"
        else
            # If authorization is disabled — consider user authorized
            if [ "$AUTH_MODE" = "disabled" ]; then
                json_success "{\"authenticated\":true,\"username\":\"admin\",\"auth_mode\":\"disabled\",\"onboarding_shown\":$ONBOARDING}"
            else
                json_success "{\"authenticated\":false,\"auth_mode\":\"$AUTH_MODE\",\"onboarding_shown\":$ONBOARDING}"
            fi
        fi
        ;;
    
    dismiss-onboarding)
        # Mark that tooltip was shown
        if grep -q '"onboarding_shown"' "$AUTH_DB"; then
            sed -i 's/"onboarding_shown"[[:space:]]*:[[:space:]]*false/"onboarding_shown": true/' "$AUTH_DB"
        else
            # Add field if it doesn't exist
            sed -i 's/"auth_mode"[[:space:]]*:[[:space:]]*"[^"]*"/&, "onboarding_shown": true/' "$AUTH_DB"
        fi
        json_success "{\"message\":\"OK\"}"
        ;;
        
    change-password)
        if ! validate_session; then
            json_error "Authorization required" 401
            exit 0
        fi
        
        if [ "$REQUEST_METHOD" != "POST" ]; then
            json_error "Method not supported" 405
            exit 0
        fi
        
        POST_DATA=$(read_post_data)
        CURRENT_PASSWORD=$(json_get_value "$POST_DATA" "current_password")
        NEW_PASSWORD=$(json_get_value "$POST_DATA" "new_password")
        
        AUTH_DATA=$(cat "$AUTH_DB")
        FIRST_LOGIN=$(echo "$AUTH_DATA" | grep -o "\"first_login\"[[:space:]]*:[[:space:]]*\(true\|false\)" | head -1 | sed 's/.*: *//')
        
        # On first login current_password can be "admin"
        if [ "$FIRST_LOGIN" != "true" ]; then
            STORED_HASH=$(echo "$AUTH_DATA" | grep -o "\"password_hash\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
            
            if ! verify_password "$CURRENT_PASSWORD" "$STORED_HASH"; then
                json_error "Invalid current password" 401
                exit 0
            fi
        fi
        
        # Check new password length
        if [ ${#NEW_PASSWORD} -lt 8 ]; then
            json_error "Password must be at least 8 characters" 400
            exit 0
        fi
        
        # Hash and save new password
        NEW_HASH=$(hash_password "$NEW_PASSWORD")
        
        sed -i "s|\"password_hash\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"password_hash\": \"$NEW_HASH\"|" "$AUTH_DB"
        sed -i 's/"first_login"[[:space:]]*:[[:space:]]*true/"first_login": false/' "$AUTH_DB"
        
        log_action "PASSWORD_CHANGED" "Password changed"
        json_success "{\"message\":\"Password changed successfully\"}"
        ;;
        
    setup)
        # Initial authorization mode setup (first login — no password)
        if [ "$REQUEST_METHOD" != "POST" ]; then
            json_error "Method not supported" 405
            exit 0
        fi
        
        AUTH_MODE=$(get_auth_mode)
        if [ "$AUTH_MODE" != "first_login" ]; then
            json_error "Setup already completed. Use change-mode." 400
            exit 0
        fi
        
        POST_DATA=$(read_post_data)
        NEW_MODE=$(json_get_value "$POST_DATA" "mode")
        NEW_PASSWORD=$(json_get_value "$POST_DATA" "password")
        
        if [ "$NEW_MODE" != "disabled" ] && [ "$NEW_MODE" != "password" ]; then
            json_error "Invalid mode. Allowed: disabled, password" 400
            exit 0
        fi
        
        RECOVERY_CODE=""
        if [ "$NEW_MODE" = "password" ]; then
            if [ -z "$NEW_PASSWORD" ] || [ ${#NEW_PASSWORD} -lt 8 ]; then
                json_error "Password must be at least 8 characters" 400
                exit 0
            fi
            
            NEW_HASH=$(hash_password "$NEW_PASSWORD")
            sed -i "s|\"password_hash\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"password_hash\": \"$NEW_HASH\"|" "$AUTH_DB"
            
            # Generate and save recovery code
            RECOVERY_CODE=$(generate_recovery_code)
            save_recovery_code "$RECOVERY_CODE"
        fi
        
        # Update authorization mode
        sed -i "s/\"auth_mode\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"auth_mode\": \"$NEW_MODE\"/" "$AUTH_DB"
        sed -i 's/"first_login"[[:space:]]*:[[:space:]]*true/"first_login": false/' "$AUTH_DB"
        
        log_action "AUTH_SETUP" "Authorization mode: $NEW_MODE"
        
        if [ -n "$RECOVERY_CODE" ]; then
            json_success "{\"message\":\"Setup completed\",\"auth_mode\":\"$NEW_MODE\",\"recovery_code\":\"$RECOVERY_CODE\"}"
        else
            json_success "{\"message\":\"Setup completed\",\"auth_mode\":\"$NEW_MODE\"}"
        fi
        ;;
        
    change-mode)
        # Change authorization mode (from settings)
        if ! validate_session; then
            json_error "Authorization required" 401
            exit 0
        fi
        
        if [ "$REQUEST_METHOD" != "POST" ]; then
            json_error "Method not supported" 405
            exit 0
        fi
        
        POST_DATA=$(read_post_data)
        NEW_MODE=$(json_get_value "$POST_DATA" "mode")
        NEW_PASSWORD=$(json_get_value "$POST_DATA" "password")
        CURRENT_PASSWORD=$(json_get_value "$POST_DATA" "current_password")
        
        AUTH_MODE=$(get_auth_mode)
        
        # If current mode is password — require current password for change
        if [ "$AUTH_MODE" = "password" ]; then
            AUTH_DATA=$(cat "$AUTH_DB")
            STORED_HASH=$(echo "$AUTH_DATA" | grep -o "\"password_hash\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
            
            if ! verify_password "$CURRENT_PASSWORD" "$STORED_HASH"; then
                json_error "Invalid current password" 401
                exit 0
            fi
        fi
        
        if [ "$NEW_MODE" != "disabled" ] && [ "$NEW_MODE" != "password" ]; then
            json_error "Invalid mode. Allowed: disabled, password" 400
            exit 0
        fi

        # B8: with VPN-server access to the panel on, no password opens the panel to
        # every VPN-server user. Allowed only after the panel's explicit warning.
        if [ "$NEW_MODE" = "disabled" ] && [ "$(vpn_lan_access)" != off ] && \
           [ "$(json_get_value "$POST_DATA" "confirm_vpn_risk")" != "true" ]; then
            json_error "errors.vpnLanAccessPasswordRisk" 409
            exit 0
        fi

        RECOVERY_CODE=""
        if [ "$NEW_MODE" = "password" ]; then
            if [ -z "$NEW_PASSWORD" ] || [ ${#NEW_PASSWORD} -lt 8 ]; then
                json_error "Password must be at least 8 characters" 400
                exit 0
            fi

            NEW_HASH=$(hash_password "$NEW_PASSWORD")
            sed -i "s|\"password_hash\"[[:space:]]*:[[:space:]]*\"[^\"]*\"|\"password_hash\": \"$NEW_HASH\"|" "$AUTH_DB"

            # Generate new recovery code when enabling password
            RECOVERY_CODE=$(generate_recovery_code)
            save_recovery_code "$RECOVERY_CODE"
        fi
        
        # B8: access VPN clients have right now (with the old login mode)
        B8_WAS_ACTIVE=$(vpn_lan_access)
        sed -i "s/\"auth_mode\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"auth_mode\": \"$NEW_MODE\"/" "$AUTH_DB"

        # B8: dropping the password after the warning keeps VPN access on (the mark) —
        # only when access was on, i.e. given with a password, and the warning was
        # confirmed. From first_login or a passwordless mode no mark: access stays off.
        # A new password clears the mark. The rules follow the new login mode.
        if [ "$NEW_MODE" = "disabled" ] && [ "$B8_WAS_ACTIVE" != off ] && \
           [ "$(json_get_value "$POST_DATA" "confirm_vpn_risk")" = "true" ]; then
            vpn_lan_no_password_mark set
        elif [ "$NEW_MODE" = "password" ]; then
            vpn_lan_no_password_mark clear
        fi
        vpn_lan_rebuild

        log_action "AUTH_MODE_CHANGED" "Mode changed: $AUTH_MODE -> $NEW_MODE"
        
        if [ -n "$RECOVERY_CODE" ]; then
            json_success "{\"message\":\"Authorization mode changed\",\"auth_mode\":\"$NEW_MODE\",\"recovery_code\":\"$RECOVERY_CODE\"}"
        else
            json_success "{\"message\":\"Authorization mode changed\",\"auth_mode\":\"$NEW_MODE\"}"
        fi
        ;;
        
    get-mode)
        # Get current mode (for UI)
        AUTH_MODE=$(get_auth_mode)
        json_success "{\"auth_mode\":\"$AUTH_MODE\"}"
        ;;
        
    recover)
        # Recover access via recovery code
        if [ "$REQUEST_METHOD" != "POST" ]; then
            json_error "Method not supported" 405
            exit 0
        fi
        
        POST_DATA=$(read_post_data)
        RECOVERY_CODE=$(json_get_value "$POST_DATA" "recovery_code")
        
        if [ -z "$RECOVERY_CODE" ]; then
            json_error "Recovery code is required" 400
            exit 0
        fi
        
        # Normalize code (remove spaces and convert to uppercase)
        RECOVERY_CODE=$(echo "$RECOVERY_CODE" | tr -d ' ' | tr 'a-z' 'A-Z')
        
        if ! verify_recovery_code "$RECOVERY_CODE"; then
            log_action "RECOVERY_FAILED" "Invalid recovery code"
            json_error "Invalid recovery code" 401
            exit 0
        fi
        
        # Reset authorization — return to first_login mode
        sed -i 's/"auth_mode"[[:space:]]*:[[:space:]]*"[^"]*"/"auth_mode": "first_login"/' "$AUTH_DB"
        sed -i 's/"first_login"[[:space:]]*:[[:space:]]*false/"first_login": true/' "$AUTH_DB"
        sed -i 's/"failed_attempts"[[:space:]]*:[[:space:]]*[0-9]*/"failed_attempts": 0/' "$AUTH_DB"
        sed -i 's/"locked_until"[[:space:]]*:[[:space:]]*[^,}]*/"locked_until": null/' "$AUTH_DB"
        # Clear recovery code (one-time use)
        sed -i 's/"recovery_code"[[:space:]]*:[[:space:]]*"[^"]*"/"recovery_code": ""/' "$AUTH_DB"
        
        # Delete all sessions
        rm -f "$SESSION_DIR"/* 2>/dev/null

        # B8: back to first_login (default password) — VPN clients lose the panel at once
        vpn_lan_no_password_mark clear
        vpn_lan_rebuild

        log_action "RECOVERY_SUCCESS" "Access restored, authorization reset"
        json_success "{\"message\":\"Access restored. Login with admin/admin to configure.\"}"
        ;;
        
    *)
        json_error "Unknown action: $ACTION" 404
        ;;
esac
