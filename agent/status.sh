#!/usr/bin/env bash
# =============================================================================
#  PrintGo Kiosk — Agent & System Status
#  Usage:  ./status.sh
# =============================================================================
APP_NAME="kiosk-agent"

echo ""
echo "━━━  PM2 Process Status  ━━━━━━━━━━━━━━━━━━━━━━━━"
pm2 status

echo ""
echo "━━━  Agent Detail  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pm2 describe "$APP_NAME" 2>/dev/null || echo "  Agent '$APP_NAME' is not registered in PM2."

echo ""
echo "━━━  System Resources  ━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Uptime  : $(uptime -p 2>/dev/null || uptime)"
echo "  Memory  : $(free -h | awk '/^Mem:/ {print $3 " used / " $2 " total"}')"
echo "  Disk    : $(df -h / | awk 'NR==2 {print $3 " used / " $2 " total (" $5 " full)"}')"
CPU_TEMP_FILE="/sys/class/thermal/thermal_zone0/temp"
if [ -f "$CPU_TEMP_FILE" ]; then
  TEMP=$(awk '{printf "%.1f°C", $1/1000}' "$CPU_TEMP_FILE")
  echo "  CPU Temp: $TEMP"
fi
echo ""
