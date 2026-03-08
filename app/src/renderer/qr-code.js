const QRCode = require("qrcode");

const setQrCode = async (qrData, qrContainer, actionImg, statusEl) => {
    //remove QR if data is null

    if (qrData === null) {
        qrContainer.style.display = "none";
        actionImg.style.display = "block";
        statusEl.innerText = "creating new session...";
    } else {
        // show QR if data is their
        qrContainer.style.display = "block";
        actionImg.style.display = "none";
        QRCode.toCanvas(qrContainer, qrData, { width: 300 }, function (error) {
            if (error) console.error(error);
            else console.log("QR code generated:", qrData);
        });
    }

}

module.exports = { setQrCode };
