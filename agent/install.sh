#!/usr/bin/env bash
# =============================================================================
#  PrintGo Kiosk — Agent Installer
#  Installs all dependencies and registers the agent to auto-start via PM2.
#
#  Usage:
#    chmod +x install.sh
#    sudo ./install.sh
# =============================================================================
set -e

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="kiosk-agent"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   PrintGo Kiosk Agent — Installer        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. System packages needed to compile node-pty ──────────────────────────
echo "▶  Installing system build dependencies…"
apt-get update -qq
apt-get install -y build-essential python3 python3-pip git curl > /dev/null

# ── 2. Node.js — install via NodeSource if not already present ──────────────
if ! command -v node &>/dev/null; then
  echo "▶  Node.js not found — installing Node.js 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs > /dev/null
else
  echo "✅  Node.js $(node -v) already installed"
fi

# ── 3. PM2 — process manager ─────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "▶  Installing PM2 globally…"
  npm install -g pm2 > /dev/null
else
  echo "✅  PM2 $(pm2 -v) already installed"
fi

# ── 4. Agent npm dependencies (ws + node-pty with native build) ──────────────
echo "▶  Installing agent npm dependencies…"
cd "$AGENT_DIR"
npm install

echo "✅  npm dependencies installed"

# ── 5. Register agent with PM2 ───────────────────────────────────────────────
echo "▶  Registering '$APP_NAME' with PM2…"
pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 start "$AGENT_DIR/agent.js" \
  --name "$APP_NAME" \
  --restart-delay=3000 \
  --max-restarts=20 \
  --log-date-format="YYYY-MM-DD HH:mm:ss"

# ── 6. Save PM2 process list and configure auto-startup ─────────────────────
echo "▶  Saving PM2 process list…"
pm2 save

echo "▶  Configuring PM2 to start on system boot…"
# Capture the generated sudo command from pm2 startup and run it automatically
STARTUP_CMD=$(pm2 startup 2>&1 | grep -o 'sudo .*' | head -1)
if [ -n "$STARTUP_CMD" ]; then
  echo "   Running: $STARTUP_CMD"
  eval "$STARTUP_CMD" || echo "⚠️   Auto startup setup failed — run the above command manually if needed."
else
  echo "⚠️   Could not parse pm2 startup command — run 'pm2 startup' manually."
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅  Installation complete!             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Agent is running:  pm2 status"
echo "  View logs:         pm2 logs $APP_NAME"
echo "  Stop agent:        pm2 stop $APP_NAME"
echo ""
