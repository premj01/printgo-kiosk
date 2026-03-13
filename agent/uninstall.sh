#!/usr/bin/env bash
# =============================================================================
#  PrintGo Kiosk — Uninstall Agent (removes from PM2, leaves files intact)
#  Usage:  ./uninstall.sh
# =============================================================================
APP_NAME="kiosk-agent"

echo "⚠️   This will stop and remove '$APP_NAME' from PM2."
read -r -p "    Continue? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Cancelled."
  exit 0
fi

echo "⏹  Stopping '$APP_NAME'…"
pm2 stop   "$APP_NAME" 2>/dev/null || true
pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 save

echo "✅  Agent removed from PM2. Files are still in place."
echo "    To remove node_modules run:  rm -rf node_modules"
