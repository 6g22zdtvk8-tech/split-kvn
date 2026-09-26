#!/bin/sh
# VPN Manager — Authorization Reset
# Usage: vpn-manager-reset-auth.sh
# 
# Resets VPN Manager authorization (disables password).
# After reset access will be open without password.

AUTH_DB="/opt/etc/vpn-manager/auth.db"
AUTH_TEMPLATE="/opt/etc/vpn-manager/auth-template.json"
SESSION_DIR="/opt/etc/vpn-manager/sessions"

echo "═══════════════════════════════════════════"
echo "  VPN Manager — Authorization Reset"
echo "═══════════════════════════════════════════"
echo ""

# Delete all sessions (the old RAM location too, for routers not yet updated)
rm -f "$SESSION_DIR"/* /tmp/vpn-manager-sessions/* 2>/dev/null

# If template exists — use it
if [ -f "$AUTH_TEMPLATE" ]; then
    cp "$AUTH_TEMPLATE" "$AUTH_DB"
    echo "✓ Authorization reset from template"
elif [ -f "$AUTH_DB" ]; then
    # Reset auth_mode to disabled
    sed -i 's/"auth_mode"[[:space:]]*:[[:space:]]*"[^"]*"/"auth_mode": "disabled"/' "$AUTH_DB"
    
    # Reset password
    sed -i 's/"password_hash"[[:space:]]*:[[:space:]]*"[^"]*"/"password_hash": ""/' "$AUTH_DB"
    
    # Reset failed attempts counter
    sed -i 's/"failed_attempts"[[:space:]]*:[[:space:]]*[0-9]*/"failed_attempts": 0/' "$AUTH_DB"
    
    # Reset lockout
    sed -i 's/"locked_until"[[:space:]]*:[[:space:]]*[^,}]*/"locked_until": null/' "$AUTH_DB"
    
    # Clear recovery code
    sed -i 's/"recovery_code"[[:space:]]*:[[:space:]]*"[^"]*"/"recovery_code": ""/' "$AUTH_DB"
    
    echo "✓ Authorization reset"
else
    echo "✗ Authorization file not found: $AUTH_DB"
    echo "  VPN Manager is probably not installed."
    exit 1
fi

echo ""
echo "Access to VPN Manager is now open without password."
echo "Enable password in Settings if needed."
echo "═══════════════════════════════════════════"
