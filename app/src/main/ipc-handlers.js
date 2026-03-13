const { ipcMain } = require("electron");
const { safeSend } = require("./window");
const { sendEvent, getUniqueKioskID, setUniqueKioskID } = require("./socket");
const { videoURLs } = require("../config/constants");

function registerIpcHandlers() {
    ipcMain.on("reset-user-session-id-kiosk-local", () => {
        resetUserIdKiosk("from kiosk button");
    });
}

// function which handle infinite resets of user session without causing crash
const resetUserIdKiosk = (from = "Unknown") => {
    try {
        console.log("Renderer requested: Reset kiosk session ID ", from);

        // setting id nullinitially ... it will also display no QR or support QR
        safeSend('status', { text: "Resetting session... ", content: "clean-up-animation" });
        safeSend("SetQRCode", { img: videoURLs.success }); // clear qrcode and set appropriate gif
        let oldId = getUniqueKioskID();
        setUniqueKioskID("");

        setTimeout(() => {

            sendEvent("reset-user-session-id-kiosk", {
                msg: `${from} please reset id `,
                oldId: oldId
            });

        }, 3000)

        // // testing code .. no matters 
        // sendEvent("testing-file-request-from-kiosk", {
        //     msg: `file send request on button click`
        // });


        // UI pn update kela 
    } catch (err) {
        console.log(err);
    }
}

module.exports = { registerIpcHandlers, resetUserIdKiosk };
