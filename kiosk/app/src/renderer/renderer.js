const { ipcRenderer } = require("electron");
const path = require("path");
// NOTE: In Electron renderer, __dirname points to the HTML file's directory (src/pages/),
// not this JS file's directory — so we resolve relative to the HTML location.
const { setQrCode } = require(path.join(__dirname, "../renderer/qr-code"));

const status = document.getElementById("status");
const resetButton = document.getElementById("resetButton");
const ActionImg = document.getElementById("imagetoshow");
const qrContainer = document.getElementById("qr");

resetButton.addEventListener("click", () => {
    setQrCode(null, qrContainer, ActionImg, status);
    ipcRenderer.send("reset-user-session-id-kiosk-local", { state: true })
})


// function requestPrint() {
//   ipcRenderer.send('print-request', pdfPath);
// }

ipcRenderer.on("status", (event, msg) => {
    status.innerText = msg.text;

})
ipcRenderer.on("SetQRCode", async (event, obj) => {
    if (obj.img !== undefined) {
        await setQrCode(null, qrContainer, ActionImg, status);
        ActionImg.src = obj.img;
    }
    else {

        await setQrCode(`${obj.url}/kisokRedirect?userSessionNumber=${obj.kioskid}`, qrContainer, ActionImg, status);
        document.getElementById("kioskID").innerText = `${obj.url}/kisokRedirect?userSessionNumber=${obj.kioskid}`
    }
})
