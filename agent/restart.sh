#!/usr/bin/env bash
# =============================================================================
#  PrintGo Kiosk — Restart Agent
#  Usage:  ./restart.sh
# =============================================================================
APP_NAME="kiosk-agent"
echo "🔄  Restarting '$APP_NAME'…"
pm2 restart "$APP_NAME"
echo "✅  Agent restarted."
