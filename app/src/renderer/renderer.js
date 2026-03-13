const { ipcRenderer } = require("electron");
const path = require("path");
const { setQrCode } = require(path.join(__dirname, "../renderer/qr-code"));

const THEME = {
    // body
    bodyBg: "linear-gradient(135deg, #e9f0ff, #fef6ff)",

    // glass cards
    cardBg: "rgba(255, 255, 255, 0.9)",
    cardBorder: "rgba(255, 255, 255, 0.6)",

    // status dot
    dotActive: "#3fb86b",
    dotActiveGlow: "rgba(63, 184, 107, 0.2)",
    dotOffline: "#da5203",
    dotPillBg: "rgba(255, 255, 255, 0.88)",
    dotPillBorder: "rgba(52, 83, 114, 0.18)",
    dotText: "#264057",

    // timeout warning
    timeoutBg: "rgba(255, 50, 50, 0.723)",
    timeoutText: "rgb(255, 255, 255)",
};

const status = document.getElementById("status");
const resetButton = document.getElementById("resetButton");
const ActionImg = document.getElementById("imagetoshow");
const qrContainer = document.getElementById("qr");

const upperText = document.getElementById("upper-text");


// -----------------------------------------------------------------------
const flagDot = document.getElementById("flag-dot");
const stateMessage = document.getElementById("state");

const setState = (color = THEME.dotOffline, msg = "Not Connected") => {
    flagDot.style.backgroundColor = color;
    flagDot.style.boxShadow = `0 0 0 4px ${color}33`;
    stateMessage.innerText = msg;
}

// -----------------------------------------------------------------------

//################################################################

const timeoutWarning = document.getElementById("timeout-warning");
const timeoutMessage = document.getElementById("timeout-message");

const setTimeoutMessageWarningScreen = (isActive = false, msg = "Timeout Warning", backgroundcolor = THEME.timeoutBg, color = THEME.timeoutText) => {

    timeoutWarning.style.display = isActive ? "none" : "block";
    timeoutWarning.style.background = backgroundcolor;
    timeoutWarning.style.color = color;
    timeoutMessage.innerText = msg;
}
//################################################################



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

ipcRenderer.on("set-timeout-warning", (event, obj) => {
    setTimeoutMessageWarningScreen(obj.isActive, obj.msg);
})
ipcRenderer.on("set-state", (event, obj) => {
    setState(obj.color, obj.msg);
})