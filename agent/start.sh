#!/usr/bin/env bash
# =============================================================================
#  PrintGo Kiosk — Start Agent (background via PM2)
#  Usage:  ./start.sh
# =============================================================================
set -e

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="kiosk-agent"

echo "▶  Starting '$APP_NAME'…"

# If already registered in PM2, just start it; otherwise register fresh
if pm2 describe "$APP_NAME" &>/dev/null; then
  pm2 start "$APP_NAME"
else
  pm2 start "$AGENT_DIR/agent.js" \
    --name "$APP_NAME" \
    --restart-delay=3000 \
    --max-restarts=20 \
    --log-date-format="YYYY-MM-DD HH:mm:ss"
fi

pm2 save
echo "✅  Agent started.  Run './logs.sh' to follow output."
