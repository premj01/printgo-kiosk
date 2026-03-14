#!/usr/bin/env bash
# =============================================================================
# PrintGo Kiosk - Linux dependency installer
# Installs all required system and Node dependencies for:
# - App runtime (Electron)
# - Printer integration (CUPS / lpstat / lp / cancel)
# - Agent management (PM2 + node-pty build toolchain)
# - Remote terminal feature (node-pty prerequisites)
#
# Usage:
#   chmod +x Scripts/linux-installation.sh
#   sudo Scripts/linux-installation.sh
# =============================================================================

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo Scripts/linux-installation.sh"
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer currently supports Debian/Ubuntu/Raspberry Pi OS (apt-get)."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${REPO_ROOT}/app"
AGENT_DIR="${REPO_ROOT}/agent"

echo "=================================================="
echo "PrintGo Linux installation started"
echo "Repo: ${REPO_ROOT}"
echo "=================================================="

echo "[1/8] Updating apt package lists..."
apt-get update

echo "[2/8] Installing base system packages..."
apt-get install -y \
  curl \
  git \
  ca-certificates \
  gnupg \
  build-essential \
  python3 \
  make

echo "[3/8] Installing CUPS printer stack..."
apt-get install -y \
  cups \
  cups-client \
  cups-bsd \
  printer-driver-all

systemctl enable cups || true
systemctl start cups || true

echo "[4/8] Installing Electron runtime libs..."
apt-get install -y \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libgtk-3-0 \
  libgbm1 \
  libasound2

echo "[5/8] Ensuring Node.js is installed..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Node already installed: $(node -v)"
fi

echo "[6/8] Ensuring PM2 is installed globally..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
else
  echo "PM2 already installed: $(pm2 -v)"
fi

echo "[7/8] Installing app and agent npm dependencies..."
if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "Missing app package.json at ${APP_DIR}"
  exit 1
fi
if [[ ! -f "${AGENT_DIR}/package.json" ]]; then
  echo "Missing agent package.json at ${AGENT_DIR}"
  exit 1
fi

cd "${APP_DIR}"
npm install

cd "${AGENT_DIR}"
npm install

# Keep helper scripts executable
chmod +x install.sh start.sh stop.sh restart.sh logs.sh status.sh uninstall.sh || true

echo "[8/8] Ensuring resources.json exists..."
if [[ ! -f "${REPO_ROOT}/resources.json" ]]; then
  if [[ -f "${REPO_ROOT}/example.resources.json" ]]; then
    cp "${REPO_ROOT}/example.resources.json" "${REPO_ROOT}/resources.json"
    echo "Created resources.json from example.resources.json"
  else
    cat > "${REPO_ROOT}/resources.json" << 'JSON'
{
  "socketMethod": "ws",
  "httpMethod": "http",
  "SERVER_URL": "localhost:3000",
  "AppURL": "localhost:5173",
  "kioskName": "Kiosk-01",
  "kioksid": "KIOSK001",
  "kioskPM2Name": "kiosk-app"
}
JSON
    echo "Created resources.json using default template"
  fi
else
  echo "resources.json already exists"
fi

echo
echo "=================================================="
echo "Installation finished"
echo "=================================================="
echo "Quick checks:"
echo "  node -v"
echo "  npm -v"
echo "  pm2 -v"
echo "  lpstat -a"
echo
echo "Optional next steps:"
echo "  cd ${AGENT_DIR} && npm run install:agent"
echo "  cd ${APP_DIR} && npm start"
echo
echo "If agent needs reboot/update permissions via sudo, add sudoers rules for your user."
