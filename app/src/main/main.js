const { app } = require("electron");
const { createWindow } = require("./window");
const { connectSocket } = require("./socket");
const { registerIpcHandlers } = require("./ipc-handlers");

app.whenReady().then(() => {
    createWindow();
    connectSocket();   // user-level: QR, file transfer, printing
    registerIpcHandlers();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
