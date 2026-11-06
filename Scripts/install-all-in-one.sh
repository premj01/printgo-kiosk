#!/usr/bin/env bash
# PrintGo: one-file installer for a Debian/Ubuntu desktop VM (64-bit x86/ARM).
#
# RUN AS YOUR CURRENT NORMAL LOGIN USER (mint, prem, etc.), WITHOUT sudo:
#   bash install-all-in-one.sh
# Or, if you already have the repository:
#   bash Scripts/install-all-in-one.sh
# Do not use "sudo bash ...", "sudo npm ...", or "sudo node ...".
# This script asks for your sudo password ONLY for system packages, CUPS,
# ownership repair of this installation, and Electron's sandbox helper.
# Your username and home directory are detected automatically; no edits needed.
# A root shell is rejected; use `exit` to return to your normal user first.
#
# Installs to ~/printgo-kiosk; Node/npm/PM2 and caches go under
# ~/.local/share/printgo. Requires internet, sudo access, and an existing
# graphical Linux desktop. It does not install a desktop or configure autologin.
# Existing checkout/config are kept; reruns reinstall dependencies, not git pull.
# Nothing starts automatically. After installation open a NEW terminal:
#   cd ~/printgo-kiosk/app && npm start
# In a second terminal:
#   cd ~/printgo-kiosk/agent && node agent.js
# For the terminal already open, first run:
#   source ~/.local/share/printgo/env.sh
# If needed, edit ~/printgo-kiosk/resources.json for your backend/kiosk ID.
# Configure your actual printer in the desktop's printer settings separately.

set -Eeuo pipefail
export LC_ALL=C
umask 022
trap 'printf "\nInstallation stopped at line %s. Fix the error above, then rerun as your normal user.\n" "$LINENO" >&2' ERR

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

[[ "$EUID" -ne 0 ]] || die 'Run WITHOUT sudo, from your current normal desktop user: bash install-all-in-one.sh'
[[ "$(uname -s)" == Linux ]] || die 'This installer is for Linux.'
command -v apt-get >/dev/null || die 'This installer requires Debian/Ubuntu with apt-get.'
command -v sudo >/dev/null || die 'Your administrator must install sudo and grant your normal user sudo access first.'

LOGIN_USER="$(id -un)"
LOGIN_GROUP="$(id -gn)"
LOGIN_HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"
[[ -n "$LOGIN_HOME" && "$LOGIN_HOME" == /* && "$LOGIN_HOME" != / && "$LOGIN_HOME" != /root ]] || die 'Cannot determine a safe normal-user home directory.'
[[ "$HOME" == "$LOGIN_HOME" ]] || die "HOME does not match $LOGIN_USER. Log in normally as $LOGIN_USER and rerun."
[[ -d "$HOME" && -O "$HOME" && -w "$HOME" ]] || die 'Your home directory must belong to you and be writable.'
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) die 'Use a 64-bit x86 or ARM Linux VM for this installer.' ;;
esac

REPO_URL='https://github.com/premj01/printgo-kiosk.git'
REPO_DIR="$HOME/printgo-kiosk"
STATE_DIR="$HOME/.local/share/printgo"
NODE_DIR="$STATE_DIR/node"
ENV_FILE="$STATE_DIR/env.sh"
[[ ! -L "$REPO_DIR" && ! -L "$STATE_DIR" ]] || die 'The installation directories must not be symbolic links.'

step "Installing for $LOGIN_USER in $REPO_DIR (npm and Node will never run as root)"
sudo -v
sudo apt-get update

# Newer Ubuntu/Debian releases renamed some libraries with a t64 suffix.
# Resolve real installable packages instead of requesting virtual libasound2.
apt_choice() {
  local candidate version
  for candidate in "$@"; do
    version="$(apt-cache policy "$candidate" | awk '/Candidate:/ {print $2; exit}')"
    if [[ -n "$version" && "$version" != '(none)' ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  die "No installable package found for: $*"
}
GTK_PACKAGE="$(apt_choice libgtk-3-0t64 libgtk-3-0)"
ATK_PACKAGE="$(apt_choice libatk-bridge2.0-0t64 libatk-bridge2.0-0)"
ALSA_PACKAGE="$(apt_choice libasound2t64 libasound2)"
CUPS_LIBRARY="$(apt_choice libcups2t64 libcups2)"
sudo apt-get install -y \
  ca-certificates curl git xz-utils build-essential python3 pkg-config \
  cups cups-client cups-bsd cups-ipp-utils printer-driver-all \
  libnss3 libnspr4 libdrm2 libgbm1 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 \
  libxshmfence1 libxss1 libxtst6 libdbus-1-3 libglib2.0-bin \
  "$GTK_PACKAGE" "$ATK_PACKAGE" "$ALSA_PACKAGE" "$CUPS_LIBRARY"

if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
  sudo systemctl enable --now cups
else
  sudo service cups start
fi

# Repair only root-owned entries inside our two dedicated locations. Never
# chown the entire home, follow symlinks, or take files from another normal user.
repair_ownership() {
  local target="$1"
  [[ ! -L "$target" ]] || die "Refusing symlink: $target"
  if [[ -d "$target" ]]; then
    sudo find -P "$target" -xdev -uid 0 -exec chown -h "$LOGIN_USER:$LOGIN_GROUP" {} +
    [[ -O "$target" && -w "$target" ]] || die "Directory is not owned/writable by $LOGIN_USER: $target"
  fi
}

step 'Preparing your own Node installation and npm cache'
repair_ownership "$STATE_DIR"
mkdir -p "$STATE_DIR" "$STATE_DIR/npm" "$STATE_DIR/npm-cache" "$STATE_DIR/cache"
TEMP_DIR="$(mktemp -d "$STATE_DIR/download.XXXXXXXX")"
trap 'rm -rf -- "$TEMP_DIR"' EXIT
download() { curl --fail --show-error --location --retry 3 --proto '=https' --tlsv1.2 "$1" -o "$2"; }

# Resolve the current Node 24 release, then download from that exact version
# directory so a new release during installation cannot change the archive.
download 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' "$TEMP_DIR/SHASUMS256.txt"
NODE_ARCHIVE="$(awk -v arch="$NODE_ARCH" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2; exit}' "$TEMP_DIR/SHASUMS256.txt")"
[[ -n "$NODE_ARCHIVE" ]] || die 'Could not find a matching official Node 24 archive.'
NODE_VERSION="${NODE_ARCHIVE#node-}"
NODE_VERSION="${NODE_VERSION%-linux-*}"
download "https://nodejs.org/dist/$NODE_VERSION/$NODE_ARCHIVE" "$TEMP_DIR/$NODE_ARCHIVE"
awk -v file="$NODE_ARCHIVE" '$2 == file' "$TEMP_DIR/SHASUMS256.txt" > "$TEMP_DIR/checksum.txt"
(cd "$TEMP_DIR" && sha256sum --check checksum.txt)
tar -xJf "$TEMP_DIR/$NODE_ARCHIVE" -C "$TEMP_DIR" --no-same-owner
mkdir -p "$NODE_DIR"
cp -a "$TEMP_DIR/${NODE_ARCHIVE%.tar.xz}/." "$NODE_DIR/"

# A dedicated npm config/cache avoids stale /root paths in an old ~/.npmrc.
# Persist the same environment in future terminals, including after reboot.
cat > "$ENV_FILE" <<'ENV'
# PrintGo user-owned Node/npm environment.
export PATH="$HOME/.local/share/printgo/node/bin:$HOME/.local/share/printgo/npm/bin:$PATH"
export NPM_CONFIG_PREFIX="$HOME/.local/share/printgo/npm"
export NPM_CONFIG_CACHE="$HOME/.local/share/printgo/npm-cache"
export NPM_CONFIG_USERCONFIG="$HOME/.local/share/printgo/npmrc"
export ELECTRON_CACHE="$HOME/.local/share/printgo/cache/electron"
export npm_config_devdir="$HOME/.local/share/printgo/cache/node-gyp"
ENV
touch "$STATE_DIR/npmrc"
# shellcheck source=/dev/null
source "$ENV_FILE"
hash -r
node --version
npm --version

add_shell_environment() {
  local profile="$1"
  local line='[ ! -r "$HOME/.local/share/printgo/env.sh" ] || . "$HOME/.local/share/printgo/env.sh" # PrintGo environment'
  if [[ -e "$profile" && ( ! -O "$profile" || ! -w "$profile" ) ]]; then
    die "Your shell startup file is not owned/writable by you: $profile"
  fi
  if ! grep -Fqx "$line" "$profile" 2>/dev/null; then
    printf '\n%s\n' "$line" >> "$profile"
  fi
}
add_shell_environment "$HOME/.bashrc"
add_shell_environment "$HOME/.profile"
# Bash reads only the first existing login profile; do not create one that
# would hide the desktop's existing .profile setup.
for profile in "$HOME/.bash_profile" "$HOME/.bash_login"; do
  [[ ! -f "$profile" ]] || add_shell_environment "$profile"
done
add_shell_environment "${ZDOTDIR:-$HOME}/.zshrc"
add_shell_environment "${ZDOTDIR:-$HOME}/.zprofile"

step 'Cloning the kiosk repository as your normal user'
repair_ownership "$REPO_DIR"
if [[ -e "$REPO_DIR" ]]; then
  [[ -d "$REPO_DIR/.git" ]] || die "$REPO_DIR already exists but is not a Git checkout. Rename it and rerun."
  ORIGIN="$(git -C "$REPO_DIR" remote get-url origin)"
  case "$ORIGIN" in
    https://github.com/premj01/printgo-kiosk|https://github.com/premj01/printgo-kiosk.git|git@github.com:premj01/printgo-kiosk.git) ;;
    *) die "$REPO_DIR belongs to a different repository; rename it and rerun." ;;
  esac
  printf 'Keeping existing checkout and local changes: %s\n' "$REPO_DIR"
else
  git clone "$REPO_URL" "$REPO_DIR"
fi
[[ -f "$REPO_DIR/app/package.json" && -f "$REPO_DIR/agent/package.json" ]] || die 'Repository is missing app/package.json or agent/package.json.'

step 'Installing app, agent, native terminal support, and user-owned PM2'
# npm install deliberately reconciles the agent's currently stale lockfile.
# Explicitly include dev dependencies: Electron is a devDependency.
unset ELECTRON_SKIP_BINARY_DOWNLOAD ELECTRON_RUN_AS_NODE
export npm_config_python=/usr/bin/python3
(cd "$REPO_DIR/app" && npm install --include=dev --ignore-scripts=false)
(cd "$REPO_DIR/agent" && npm install --include=dev --ignore-scripts=false)
npm install --global pm2 --ignore-scripts=false

if [[ ! -e "$REPO_DIR/resources.json" ]]; then
  [[ -f "$REPO_DIR/example.resources.json" ]] || die 'Missing example.resources.json configuration template.'
  cp "$REPO_DIR/example.resources.json" "$REPO_DIR/resources.json"
  printf 'Created resources.json from the repository example. Check its backend address and kiosk ID.\n'
fi

step 'Configuring the Electron sandbox helper (the app itself stays unprivileged)'
# Chromium's bundled sandbox helper is the ONLY root-owned file in the app.
# It needs root:root and 4755 on Linux; never run Electron itself with sudo.
# Rerun this installer after replacing Electron via npm to restore this mode.
# Reference: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/linux/suid_sandbox_development.md
SANDBOX="$REPO_DIR/app/node_modules/electron/dist/chrome-sandbox"
[[ -f "$SANDBOX" && ! -L "$SANDBOX" ]] || die 'Electron sandbox helper is missing; check the npm installation output.'
sudo chown root:root "$SANDBOX"
sudo chmod 4755 "$SANDBOX"

step 'Checking installed dependencies'
(cd "$REPO_DIR/app" && node -e 'require("ws"); require("qrcode"); const fs = require("fs"); fs.accessSync(require("electron"), fs.constants.X_OK);')
(cd "$REPO_DIR/agent" && node -e 'require("ws"); const pty = require("node-pty"); const p = pty.spawn("/bin/echo", ["PrintGo PTY OK"], {env: process.env}); const timer = setTimeout(() => {p.kill(); process.exit(1);}, 5000); p.onExit(e => {clearTimeout(timer); process.exit(e.exitCode);});')
node -e 'const c = require(process.argv[1]); for (const k of ["SERVER_URL", "AppURL", "kioksid", "socketMethod", "httpMethod"]) {if (!c[k]) throw new Error("Missing configuration key: " + k);}' "$REPO_DIR/resources.json"
ELECTRON_BIN="$REPO_DIR/app/node_modules/electron/dist/electron"
LIBRARIES="$(ldd "$ELECTRON_BIN")"
if grep -q 'not found' <<< "$LIBRARIES"; then
  printf '%s\n' "$LIBRARIES" >&2
  die 'Electron still has missing system libraries.'
fi
if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  "$ELECTRON_BIN" --version
else
  printf 'No graphical session detected. Start the app later from a terminal inside your Linux desktop.\n'
fi

printf '\nInstallation finished for %s. Open two NEW terminals (no sudo):\n\n' "$LOGIN_USER"
printf '  cd %q && npm start\n\n' "$REPO_DIR/app"
printf '  cd %q && node agent.js\n\n' "$REPO_DIR/agent"
printf 'For this already-open terminal, first run: source %q\n' "$ENV_FILE"
printf 'Configuration: %s/resources.json\n' "$REPO_DIR"
printf 'CUPS is installed; add your actual printer in Linux printer settings.\n'
printf 'The app and agent are installed but have not been started or registered for automatic startup.\n'
