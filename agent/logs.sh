#!/usr/bin/env bash
# =============================================================================
#  PrintGo Kiosk — Follow Agent Logs
#  Usage:  ./logs.sh [lines]
#  Example: ./logs.sh 200
# =============================================================================
APP_NAME="kiosk-agent"
LINES="${1:-100}"
echo "📜  Showing last $LINES lines and following '$APP_NAME' logs…"
echo "     Press Ctrl+C to stop."
echo ""
pm2 logs "$APP_NAME" --lines "$LINES"
