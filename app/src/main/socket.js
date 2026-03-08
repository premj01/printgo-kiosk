const WebSocket = require("ws");
const fs = require("fs");
const kioskNativeResources = require('../../../resources.json');
const { RECONNECT_DELAY } = require("../config/constants");
const { safeSend } = require("./window");

let socket = null;
let UniqueKisokIDForIndividual = "";
let printDetails = null;

function connectSocket() {

    const SERVER_URL =
        `${kioskNativeResources.socketMethod}://${kioskNativeResources.SERVER_URL}?role=kiosk&kioskid=${kioskNativeResources.kioksid}`;

    safeSend('status', { text: "Initializing connection with server..." });

    socket = new WebSocket(SERVER_URL);

    socket.on("open", () => {
        console.log("Connected to server");
        safeSend('status', { text: "Connected to server" });
    });

    socket.on("message", (msg) => {

        // HANDLE BINARY FILE DATA 
        if (Buffer.isBuffer(msg)) {

            if (!printDetails?.stream) {
                console.log("Received chunk without metadata");
                return;
            }

            const transfer = printDetails;

            const ok = transfer.stream.write(msg);

            if (!ok) socket.pause();

            transfer.received++;

            if (transfer.received >= transfer.totalChunks) {

                transfer.stream.end();

                console.log("File saved:", transfer.fileName);

                socket.send(JSON.stringify({
                    type: "ack-after-file-sent",
                    data: {
                        kioskId: kioskNativeResources.kioksid,
                        sessionId: transfer.sessionId
                    }
                }));

                printDetails = null;
            }

            return;
        }

        //  HANDLE JSON CONTROL MESSAGES 
        let parsed;

        try {
            parsed = JSON.parse(msg.toString());
        } catch {
            console.log("Invalid message");
            return;
        }

        const { type, data } = parsed;

        switch (type) {

            case "setting-reference-id-for-user-identification":

                UniqueKisokIDForIndividual = data.referenceId;

                safeSend('status', {
                    serverStatus: data.serverStatus,
                    text: "Please scan the QR code to print your documents"
                });

                safeSend('SetQRCode', {
                    kioskid: UniqueKisokIDForIndividual,
                    url: `${kioskNativeResources.httpMethod}://${kioskNativeResources.AppURL}`,
                });

                sendEvent("unique-user-id-setuped", {
                    kioskid: kioskNativeResources.kioksid,
                    userUniqueReferenceId: UniqueKisokIDForIndividual,
                    kioskStatus: true
                });

                break;

            case "connected-to-user-successfully":

                safeSend('status', {
                    text: `Thank you ${data?.userName ?? "Customer"} for choosing us 😊`
                });

                safeSend('SetQRCode', { img: true });

                break;

            case "metadata-before-file-sending":

                if (
                    data.fileName &&
                    data.sessionId &&
                    data.totalChunks &&
                    UniqueKisokIDForIndividual === data.sessionId
                ) {

                    printDetails = {
                        userName: data.userName,
                        fileName: data.fileName,
                        sessionId: data.sessionId,
                        totalChunks: data.totalChunks,
                        received: 0,
                        stream: fs.createWriteStream(`./received_${data.fileName}`)
                    };

                    console.log("Metadata received:", data.fileName);

                } else {

                    console.log("Metadata ignored");
                }

                break;

            case "ack-after-file-sent":

                if (
                    data.sessionId === UniqueKisokIDForIndividual &&
                    data.kioskId === kioskNativeResources.kioksid
                ) {

                    socket.send(JSON.stringify({
                        type: "ack-of-file-from-kiosk",
                        data: {
                            ack: true,
                            sessionId: data.sessionId
                        }
                    }));
                }

                break;

            default:
                console.log("Unknown message:", type);
        }

    });

    socket.on("close", () => {
        console.log("Disconnected from server");
        UniqueKisokIDForIndividual = "";
        socket = null;
        setTimeout(connectSocket, RECONNECT_DELAY);
    });

    socket.on("error", (err) => {
        console.error("Connection error:", err.message);
    });
}

function sendEvent(type, data) {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, ...data }));
    }
}

function getUniqueKioskID() {
    return UniqueKisokIDForIndividual;
}

function setUniqueKioskID(id) {
    UniqueKisokIDForIndividual = id;
}

module.exports = {
    connectSocket,
    sendEvent,
    getUniqueKioskID,
    setUniqueKioskID
};
