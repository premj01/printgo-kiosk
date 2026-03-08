const WebSocket = require("ws");
const fs = require("fs");
const kioskNativeResources = require('../../../resources.json');
const { RECONNECT_DELAY } = require("../config/constants");
const { safeSend } = require("./window");

let socket = null;
let UniqueKisokIDForIndividual = "";
let printDetails = {}; //userName, fileName, mail, filePath, sessionId

function connectSocket() {
    const SERVER_URL = `${kioskNativeResources.socketMethod}://${kioskNativeResources.SERVER_URL}?role=kiosk&kioskid=${kioskNativeResources.kioksid}`;
    safeSend('status', { text: "Initializing connection with server..." });
    socket = new WebSocket(SERVER_URL);

    socket.on("open", () => {
        console.log(" Connected to server");
        safeSend('status', { text: "Connected to server" });
    });

    socket.on("message", (msg) => {
        try {
            const parsed = JSON.parse(msg.toString());
            const { type, data } = parsed;
            switch (type) {

                case "new-job":
                    // console.log("New job received:", parsed.data);
                    // win.webContents.send('status', { text: "Initiating Your print" });
                    // let printJobpath = "./files/data.pdf";
                    // const status = printPDF(printJobpath);

                    // sendEvent("after-printing-status", {
                    //   status: true,
                    //   msg: status || "printing successful"
                    // });
                    break;

                case "setting-reference-id-for-user-identification":
                    UniqueKisokIDForIndividual = data.referenceId;
                    setTimeout(() => {


                        console.log("UniqueKisokIDForIndividual started");

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
                        console.log("UniqueKisokIDForIndividual done");

                    }, 1000);
                    break;
                case "connected-to-user-successfully":
                    console.log("Connected to user successfully:", data);
                    safeSend('status', { text: `Thank you ${data.userName} for choosing us 😊` });
                    safeSend('SetQRCode', { img: true });
                    break;

                case "metadata-before-file-sending":
                    if (data.userName !== undefined || data.fileName !== undefined || data.mail !== undefined || data.filePath !== undefined || data.sessionId !== undefined || data.totalChunks !== undefined) {
                        if (UniqueKisokIDForIndividual == sessionId) {
                            // updating metadata for individual 
                            const { userName, fileName, mail, filePath, sessionId, totalChunks } = data;
                            printDetails = { userName, fileName, mail, filePath, sessionId, totalChunks, chunks: [], received: 0 }

                            console.log("Metadata received for:", data.fileName);
                        } else {
                            console.log("Not : Metadata not received for:", data.fileName);
                        }
                    } else {
                        console.log("Not : Metadata not received for : Invalid Params");
                    }
                    break;

                case "ack-after-file-sent":
                    if (data.fileName !== undefined || data.sessionId !== undefined || data.kioskId !== undefined) {
                        if (sessionId === UniqueKisokIDForIndividual && kioskId === kioskNativeResources.kioksid) {

                            const { fileName, sessionId, kioskId } = data;
                            socket.send(JSON.stringify({ type: "ack-of-file-from-kiosk", data: { ack: true, sessionId: sessionId } }))
                            // printDetails = { fileName, sessionId, kioskId }
                        }
                    }
                    break;

                // file tranfer handled manually for efficiency and less load data tranfer
                case "file-data":
                    const transfer = printDetails;
                    if (!transfer) return console.log("Unknown fileId, ignoring chunk");

                    transfer.chunks[data.chunkIndex] = msg.binaryData;   // store chunk
                    transfer.received++;

                    if (transfer.received === transfer.totalChunks) {
                        const finalBuffer = Buffer.concat(transfer.chunks);

                        fs.writeFileSync("./received_" + transfer.fileName, finalBuffer);
                        console.log("File saved:", transfer.fileName);

                        // send ACK
                        socket.send(JSON.stringify({
                            type: "ack-after-file-sent",
                            data: {
                                fileId: data.fileId,
                                kioskId: kioskNativeResources.kioksid,
                                sessionId: transfer.sessionId
                            }
                        }));
                    }
                    break;

                default:
                    console.log("Unknown message:", type, "  :", data);
            }
        } catch (e) {
            console.error("Failed to parse message:", msg.toString());
        }
    });

    socket.on("close", () => {
        console.log("❌ Disconnected from server");
        UniqueKisokIDForIndividual = "";
        socket = null;
        setTimeout(connectSocket, RECONNECT_DELAY);
    }
    );

    socket.on("error", (err) => {
        console.error("⚠️ Connection error:", err.message);
    });
}

function sendEvent(type, data) {
    try {

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type, ...data }));
        }
    } catch (err) {
        console.log(err);
    }
}

function getUniqueKioskID() {
    return UniqueKisokIDForIndividual;
}

function setUniqueKioskID(id) {
    UniqueKisokIDForIndividual = id;
}

module.exports = { connectSocket, sendEvent, getUniqueKioskID, setUniqueKioskID };
