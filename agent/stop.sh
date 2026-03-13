#!/usr/bin/env bash
# =============================================================================
#  PrintGo Kiosk — Stop Agent
#  Usage:  ./stop.sh
# =============================================================================
APP_NAME="kiosk-agent"
echo "⏹  Stopping '$APP_NAME'…"
pm2 stop "$APP_NAME" && pm2 save
echo "✅  Agent stopped."
