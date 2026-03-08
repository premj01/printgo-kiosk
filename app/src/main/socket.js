const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const kioskNativeResources = require('../../../resources.json');
const { RECONNECT_DELAY } = require("../config/constants");
const { safeSend } = require("./window");

let socket = null;
let UniqueKisokIDForIndividual = "";
let printDetails = null;
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
let hasWarnedChunkWithoutMetadata = false;

function resumeSocketIfPaused() {
    if (socket && socket.isPaused) {
        socket.resume();
    }
}

function handleNonJsonMessage(rawMessage) {
    const message = (rawMessage || "").trim();

    if (!message) {
        return;
    }

    // Some backends may emit kiosk id / heartbeat text frames.
    if (
        message === kioskNativeResources.kioksid ||
        message.toLowerCase() === "ping" ||
        message.toLowerCase() === "pong"
    ) {
        return;
    }

    console.log("Unknown plain message:", message);
}

function connectSocket() {

    const SERVER_URL =
        `${kioskNativeResources.socketMethod}://${kioskNativeResources.SERVER_URL}?role=kiosk&kioskid=${kioskNativeResources.kioksid}`;

    safeSend('status', { text: "Initializing connection with server..." });

    socket = new WebSocket(SERVER_URL);

    socket.on("open", () => {
        console.log("Connected to server");
        safeSend('status', { text: "Connected to server" });
    });

    socket.on("message", (msg, isBinary) => {

        // HANDLE FILE CHUNKS
        if (isBinary) {

            if (!printDetails || !printDetails.stream) {
                if (!hasWarnedChunkWithoutMetadata) {
                    console.log("Received chunk without metadata");
                    hasWarnedChunkWithoutMetadata = true;
                }
                return;
            }

            hasWarnedChunkWithoutMetadata = false;

            const transfer = printDetails;

            const ok = transfer.stream.write(msg);

            if (!ok) {
                socket.pause();
            }

            transfer.received++;

            if (transfer.received >= transfer.totalChunks) {
                printDetails = null;

                transfer.stream.end(() => {
                    resumeSocketIfPaused();

                    console.log("File saved:", transfer.fileName);

                    sendEvent("ack-after-file-sent", {
                        kioskId: kioskNativeResources.kioksid,
                        sessionId: transfer.sessionId
                    });
                });
            }

            return;
        }

        // HANDLE JSON MESSAGES
        let parsed;
        const rawMessage = msg.toString();

        try {
            parsed = JSON.parse(rawMessage);
        } catch {
            handleNonJsonMessage(rawMessage);
            return;
        }

        if (typeof parsed === "string") {
            handleNonJsonMessage(parsed);
            return;
        }

        if (!parsed || typeof parsed !== "object") {
            console.log("Invalid message payload");
            return;
        }

        const { type, data } = parsed;

        if (type === kioskNativeResources.kioksid) {
            return;
        }

        switch (type) {

            case "setting-reference-id-for-user-identification":

                UniqueKisokIDForIndividual = data.userSessionUUID;

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
                console.log("User session id setuped .. ready to continue : " + UniqueKisokIDForIndividual);


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

                    if (printDetails?.stream) {
                        printDetails.stream.destroy();
                        printDetails = null;
                    }

                    resumeSocketIfPaused();

                    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
                    const defaultFileName = path.basename(data.fileName);
                    const targetPath = path.join(UPLOAD_DIR, defaultFileName);

                    printDetails = {

                        userName: data.userName,
                        fileName: defaultFileName,
                        sessionId: data.sessionId,
                        totalChunks: data.totalChunks,
                        received: 0,

                        // Use write mode so existing files are replaced automatically.
                        stream: fs.createWriteStream(targetPath, { flags: "w" })
                    };

                    // resume socket when stream drained
                    printDetails.stream.on("drain", () => {
                        resumeSocketIfPaused();
                    });

                    printDetails.stream.on("error", (err) => {
                        console.error("File stream error:", err.message);
                        printDetails = null;
                        resumeSocketIfPaused();
                    });

                    printDetails.stream.on("close", () => {
                        resumeSocketIfPaused();
                    });

                    console.log("Metadata received:", data.fileName);

                } else {

                    console.log("Metadata ignored");

                }

                break;

            case "ack-after-file-sent":

                // Do not bind this ACK to current UI session id. A user can reset
                // immediately after upload, but backend still expects transfer ACK.
                if (data?.kioskId === kioskNativeResources.kioksid && data?.sessionId) {
                    sendEvent("ack-of-file-from-kiosk", {
                        ack: true,
                        sessionId: data.sessionId
                    });
                }

                break;

            case "status-user-connected-to-kiosk":
                safeSend('status', {
                    text: data.msg
                });

                break;

            case "print-file-request-from-user-via-server":



                break;

            case "printer-status-request-from-server":


                break;

            case "printer-get-list-request-from-server":

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

        const payload = data ?? {};

        socket.send(JSON.stringify({
            type,
            data: payload,
            ...payload
        }));

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