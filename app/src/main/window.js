const { BrowserWindow } = require("electron");
const path = require("path");

let win = null;

function createWindow() {
    win = new BrowserWindow({
        title: "PrintGo : Easy Printing Solution..",
        width: 800,
        height: 600,
        kiosk: true,       // fullscreen kiosk mode
        frame: false,      // no window frame
        alwaysOnTop: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile(path.join(__dirname, "../pages/index.html"));
    // win.loadFile("app/dist/index.html");
    win.once('ready-to-show', () => win.show());

    // Disable devtools for privacy
    // win.webContents.on("devtools-opened", () => win.webContents.closeDevTools());

    return win;
}

function getWindow() {
    return win;
}

function safeSend(channel, data) {
    if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
    }
}

module.exports = { createWindow, getWindow, safeSend };
