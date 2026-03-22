const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const kioskNativeResources = require('../../../resources.json');
const { RECONNECT_DELAY } = require("../config/constants");
const { safeSend } = require("./window");
const {
    printFile,
    getPrinterStatus: fetchPrinterStatus,
    getPrinterList: fetchPrinterList,
    cancelPrinting,
    resetPrinterSettings,
    cleanUploads,
    getJobQueue,
    setDefaultPrinter,
    testPrint,
    getInkLevels,
    pausePrinter,
    resumePrinter,
    getPrintHistory,
} = require("./printer");
const sleepUtil = require("../util/sleep.util");
const { THEME } = require("../themes/theme");

let socket = null;
let UniqueKisokIDForIndividual = "";
let printDetails = null;
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
let hasWarnedChunkWithoutMetadata = false;
let printerInformation = {

}

function setPrinterInformation(info) {
    printerInformation = info;
}
function setPrinterStatus(printerStatus) {
    printerInformation.status = printerStatus;
}
function getPrinterStatus() {
    return printerInformation.status;
}
function setPrinterList(printerList) {
    printerInformation.printerList = printerList;
}
function getPrinterList() {
    return printerInformation.printerList;
}


function getPrinterInformation() {
    return printerInformation;
}

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

function downloadFileFromSignedUrl(downloadUrl, targetPath, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) {
            reject(new Error("Too many redirects while downloading file"));
            return;
        }

        const client = downloadUrl.startsWith("https://") ? https : http;

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        const fileStream = fs.createWriteStream(targetPath, { flags: "w" });

        const request = client.get(downloadUrl, (response) => {
            const statusCode = response.statusCode || 0;

            if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers?.location) {
                fileStream.close();
                fs.unlink(targetPath, () => { });
                resolve(downloadFileFromSignedUrl(response.headers.location, targetPath, redirects + 1));
                return;
            }

            if (statusCode >= 400) {
                fileStream.close();
                fs.unlink(targetPath, () => { });
                reject(new Error(`Failed to download file, status ${statusCode}`));
                return;
            }

            response.pipe(fileStream);

            fileStream.on("finish", () => {
                fileStream.close(() => resolve(targetPath));
            });
        });

        request.setTimeout(30000, () => {
            request.destroy(new Error("Download request timed out"));
        });

        request.on("error", (err) => {
            fileStream.close();
            fs.unlink(targetPath, () => { });
            reject(err);
        });

        fileStream.on("error", (err) => {
            request.destroy();
            fileStream.close();
            fs.unlink(targetPath, () => { });
            reject(err);
        });
    });
}

function buildSessionScopedFileName(sessionId, originalFileName) {
    const safeSessionId = String(sessionId || "unknown-session").replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeOriginal = path.basename(originalFileName || `${Date.now()}.pdf`);
    return `${safeSessionId}__${safeOriginal}`;
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

    socket.on("message", async (msg, isBinary) => {

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

        // parced message
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
                safeSend("set-state", { color: THEME.dotActive, msg: "CONNECTED" })
                safeSend("set-timeout-warning", { isActive: false, msg: "NA" })

                break;

            //session disconnected by user
            case "user-disconnection-warning":
                let msg = data.msg;
                let isActive = data.isActive
                let conwndown = Number(data.timeout_period)

                safeSend("set-timeout-warning", { isActive, msg })
                for (let i = conwndown; isActive && i > 0; i--) {
                    console.log(i);
                    safeSend("set-timeout-warning", { isActive, msg })
                    await sleepUtil(1000);
                }
                break;
            case "user-disconnected":
                safeSend("set-state", { color: THEME.dotOffline, msg: "NOT CONNECTED" })
                // Lazy require avoids circular dependency with ipc-handlers.
                require("./ipc-handlers").resetUserIdKiosk("Reset req : User disconnected");
                break;

            case "print-file-request-from-user-via-server": {
                // Initiate printing with options from server (copies, printer, orientation, etc.)
                const printOpts = {
                    copies: data?.copies ?? 1,
                    printer: data?.printer ?? null,
                    orientation: data?.orientation ?? "portrait",
                    paperSize: data?.paperSize ?? "A4",
                    sides: data?.sides ?? "one-sided",
                    pageRanges: data?.pageRanges ?? null,
                    fitToPage: data?.fitToPage ?? true,
                    colorMode: data?.colorMode ?? "monochrome",
                };

                const fileName = data?.fileName ?? null;

                // Store current print request in printerInformation
                setPrinterInformation({
                    ...printerInformation,
                    currentJob: { fileName, options: printOpts, startedAt: Date.now() },
                });
                setPrinterStatus("printing");

                printFile(fileName, printOpts).then((result) => {
                    setPrinterStatus(result.success ? "idle" : "error");

                    if (result.success && result.jobId) {
                        printerInformation.currentJob = {
                            ...printerInformation.currentJob,
                            jobId: result.jobId,
                        };
                    }

                    sendEvent("print-file-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        sessionId: data?.sessionId,
                        ...result,
                    });

                    // Cleanup uploaded file after printing
                    cleanUploads();
                });
                break;
            }

            case "download-file-from-s3-request": {
                const fileKey = data?.fileKey ?? null;
                const fileNameFromServer = data?.fileName ?? null;
                const downloadUrl = data?.downloadUrl ?? null;
                const sessionId = data?.sessionId ?? null;

                if (!fileKey || !downloadUrl || !sessionId) {
                    sendEvent("download-file-from-s3-ack", {
                        kioskId: kioskNativeResources.kioksid,
                        sessionId,
                        fileKey,
                        fileName: fileNameFromServer,
                        success: false,
                        error: "Missing required fields",
                    });
                    break;
                }

                if (UniqueKisokIDForIndividual && UniqueKisokIDForIndividual !== sessionId) {
                    console.log(
                        `Download request session mismatch (active=${UniqueKisokIDForIndividual}, incoming=${sessionId}). Proceeding with server-issued request.`
                    );
                }

                const safeFileName = buildSessionScopedFileName(sessionId, fileNameFromServer);
                const targetPath = path.join(UPLOAD_DIR, safeFileName);

                // ── Show downloading animation on kiosk UI ──
                safeSend("show-downloading", {
                    title: "Downloading Your File",
                    subtitle: "Your document is being prepared…<br>This will only take a moment",
                    statusText: "Downloading file from secure storage...",
                });

                safeSend("status", { text: "Downloading file from secure storage..." });

                downloadFileFromSignedUrl(downloadUrl, targetPath)
                    .then(() => {
                        // ── Hide downloading animation (success) ──
                        safeSend("hide-downloading", {
                            success: true,
                            statusText: "File downloaded successfully! Ready to print.",
                        });

                        safeSend("status", { text: "File downloaded successfully" });
                        sendEvent("download-file-from-s3-ack", {
                            kioskId: kioskNativeResources.kioksid,
                            sessionId,
                            fileKey,
                            fileName: safeFileName,
                            success: true,
                        });
                    })
                    .catch((err) => {
                        // ── Hide downloading animation (failure) ──
                        safeSend("hide-downloading", {
                            success: false,
                            statusText: `Download failed: ${err.message}`,
                        });

                        safeSend("status", { text: `Download failed: ${err.message}` });
                        sendEvent("download-file-from-s3-ack", {
                            kioskId: kioskNativeResources.kioksid,
                            sessionId,
                            fileKey,
                            fileName: safeFileName,
                            success: false,
                            error: err.message,
                        });
                    });

                break;
            }

            case "printer-status-request-from-server": {
                fetchPrinterStatus().then((result) => {
                    setPrinterStatus(result.status);
                    sendEvent("printer-status-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

            case "printer-get-list-request-from-server": {
                fetchPrinterList().then((result) => {
                    setPrinterList(result.printers);
                    sendEvent("printer-get-list-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

            case "cancle-printing-request-from-server": {
                const jobId = printerInformation?.currentJob?.jobId ?? null;
                const targetPrinter = data?.printer ?? null;

                cancelPrinting(jobId, targetPrinter).then((result) => {
                    if (result.success) {
                        printerInformation.currentJob = null;
                        setPrinterStatus("idle");
                    }
                    sendEvent("cancle-printing-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                    cleanUploads();
                });
                break;
            }

            case "reset-printer-settings-from-server": {
                const targetPrinter = data?.printer ?? null;
                resetPrinterSettings(targetPrinter).then((result) => {
                    sendEvent("reset-printer-settings-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

            case "get-job-queue-request-from-server": {
                getJobQueue().then((result) => {
                    sendEvent("get-job-queue-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

            case "set-default-printer-request-from-server": {
                if (data?.printerName) {
                    setDefaultPrinter(data.printerName).then((result) => {
                        sendEvent("set-default-printer-response-to-server", {
                            kioskId: kioskNativeResources.kioksid,
                            ...result,
                        });
                    });
                }
                break;
            }

            case "test-print-request-from-server": {
                testPrint(data?.printer ?? null).then((result) => {
                    sendEvent("test-print-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

            case "ink-levels-request-from-server": {
                getInkLevels(data?.printer ?? null).then((result) => {
                    sendEvent("ink-levels-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

            case "pause-printer-request-from-server": {
                const targetPrinter = data?.printer ?? null;
                const reason = data?.reason ?? "Paused by PrintGo Kiosk";
                pausePrinter(targetPrinter, reason).then((result) => {
                    if (result.success) setPrinterStatus("paused");
                    sendEvent("pause-printer-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

            case "resume-printer-request-from-server": {
                resumePrinter(data?.printer ?? null).then((result) => {
                    if (result.success) setPrinterStatus("idle");
                    sendEvent("resume-printer-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

            case "print-history-request-from-server": {
                const limit = data?.limit ?? 50;
                getPrintHistory(limit).then((result) => {
                    sendEvent("print-history-response-to-server", {
                        kioskId: kioskNativeResources.kioksid,
                        ...result,
                    });
                });
                break;
            }

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