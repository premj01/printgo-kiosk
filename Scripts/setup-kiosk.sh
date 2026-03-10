#!/bin/bash

set -e

echo "Starting PrintGo Always-On Kiosk Setup..."

# 1. Update package lists
echo "Updating package lists..."
sudo apt-get update

# 2. Install Git and Curl
echo "Installing Git and Curl..."
sudo apt-get install -y git curl

# 3. Install minimal X server, window manager, and unclutter
echo "Installing minimal X11, Openbox, and Unclutter..."
sudo apt-get install -y --no-install-recommends xserver-xorg x11-xserver-utils xinit openbox unclutter

# 4. Install Electron/Chromium shared libraries
echo "Installing dependencies for Electron..."
sudo apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libgtk-3-0 libgbm1 libasound2

# 5. Install NVM and Node.js
echo "Downloading and installing NVM..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

# Load nvm in the current shell script so we can use it immediately
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "Installing Node.js v24..."
nvm install 24

echo "Verifying Node and NPM installations:"
node -v
npm -v

# 6. Clone the repository and install npm packages
echo "Setting up printgo-kiosk directory..."
REPO_URL="https://github.com/premj01/printgo-kiosk.git"
APP_DIR="$HOME/printgo-kiosk"

if [ ! -d "$APP_DIR" ]; then
    git clone "$REPO_URL" "$APP_DIR"
else
    echo "printgo-kiosk directory already exists. Pulling latest changes..."
    cd "$APP_DIR" && git pull
fi

if [ -f "$APP_DIR/package.json" ]; then
    echo "Installing npm dependencies..."
    cd "$APP_DIR"
    npm install
fi

# 6.1 Create resources.json if missing
echo "Ensuring resources.json exists..."
if [ ! -f "$APP_DIR/resources.json" ]; then
    if [ -f "$APP_DIR/example.resources.json" ]; then
        cp "$APP_DIR/example.resources.json" "$APP_DIR/resources.json"
        echo "Created resources.json from example.resources.json"
    else
        cat << 'EOF' > "$APP_DIR/resources.json"
{
  "socketMethod": "ws",
  "httpMethod": "http",
  "SERVER_URL": "localhost:3000",
  "AppURL": "localhost:5173",
  "kioskName": "Kiosk-01",
  "kioksid": "KIOSK001"
}
EOF
        echo "Created resources.json from default template"
    fi
else
    echo "resources.json already exists. Keeping existing file."
fi

# Keep a compatibility copy if a singular file name is expected
if [ ! -f "$APP_DIR/resource.json" ]; then
    cp "$APP_DIR/resources.json" "$APP_DIR/resource.json"
    echo "Created resource.json as a copy of resources.json"
else
    echo "resource.json already exists. Keeping existing file."
fi

# 7. Configure .xinitrc for always-on kiosk mode
echo "Creating ~/.xinitrc configuration..."
cat << EOF > ~/.xinitrc
#!/bin/bash

# Load NVM so the X11 session knows where 'npm' and 'node' are
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"

# Disable screen blanking, screensaver, and DPMS (power saving)
xset s off
xset s noblank
xset -dpms

# Hide the mouse cursor
unclutter -idle 0.1 -root &

# Start the window manager in the background
openbox-session &

# Navigate to the app directory
cd ~/printgo-kiosk

# Infinite loop: keeps the app always on. Restarts after 5s if it crashes.
while true; do
    npm start
    sleep 5
done
EOF

chmod +x ~/.xinitrc

# 8. Enable automatic console login on boot
echo "Enabling automatic console login..."
sudo raspi-config nonint do_boot_behaviour B2

# 9. Configure auto-start X server on boot
echo "Setting up auto-start in ~/.bash_profile..."
if ! grep -q "startx" ~/.bash_profile 2>/dev/null; then
    cat << 'EOF' >> ~/.bash_profile

# Start X server automatically on primary display
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    startx
fi
EOF
fi

echo "==================================================="
echo "Setup complete! The system is configured."
echo "Rebooting in 10 seconds to apply changes..."
echo "==================================================="
sleep 10
sudo reboot
