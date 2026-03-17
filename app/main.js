const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { print } = require("pdf-to-printer");
// const { text } = require("stream/consumers");
const kioskNativeResources = require('../resources.json')
const WebSocket = require("ws");
const { log } = require("console");
const fs = require("fs");
const http = require("http");
const https = require("https");

let win;
let UniqueKisokIDForIndividual;
let socket;
let printDetails = {}; //userName, fileName, mail, filePath, sessionId


let videoURLs = {
  success: "https://cdn.dribbble.com/userupload/26582295/file/original-63bbdcbb56d15515935dc9c5b5b144d7.gif",

  loading_cat: path.join(__dirname, "assets/cat_wait_speaker.mp4")

}


// new BrowserWindow({
//   title: "PrintGo : Easy Printing Solution..",
//   width: 800,
//   height: 600,
//   // kiosk: true,       // fullscreen kiosk mode
//   // frame: false,      // no window frame
//   alwaysOnTop: true,
//   // autoHideMenuBar: true,
//   webPreferences: {
//     nodeIntegration: true,
//     contextIsolation: false
//   }
// });


// reconnect settings

const RECONNECT_DELAY = 2000;

function downloadFileFromSignedUrl(downloadUrl, targetPath) {
  return new Promise((resolve, reject) => {
    const client = downloadUrl.startsWith("https://") ? https : http;
    const fileStream = fs.createWriteStream(targetPath, { flags: "w" });

    const request = client.get(downloadUrl, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        fileStream.close();
        fs.unlink(targetPath, () => { });
        reject(new Error(`Failed to download file, status ${response.statusCode}`));
        return;
      }

      response.pipe(fileStream);
      fileStream.on("finish", () => fileStream.close(() => resolve(targetPath)));
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

        case "download-file-from-s3-request": {
          const fileKey = data?.fileKey ?? null;
          const sessionId = data?.sessionId ?? null;
          const fileName = path.basename(data?.fileName ?? `${Date.now()}.pdf`);
          const downloadUrl = data?.downloadUrl ?? null;
          const targetPath = path.join(__dirname, "uploads", fileName);

          if (!fileKey || !sessionId || !downloadUrl) {
            sendEvent("download-file-from-s3-ack", {
              kioskId: kioskNativeResources.kioksid,
              sessionId,
              fileKey,
              fileName,
              success: false,
              error: "Missing fields in download request",
            });
            break;
          }

          fs.mkdirSync(path.dirname(targetPath), { recursive: true });

          downloadFileFromSignedUrl(downloadUrl, targetPath)
            .then(() => {
              sendEvent("download-file-from-s3-ack", {
                kioskId: kioskNativeResources.kioksid,
                sessionId,
                fileKey,
                fileName,
                success: true,
              });
            })
            .catch((err) => {
              sendEvent("download-file-from-s3-ack", {
                kioskId: kioskNativeResources.kioksid,
                sessionId,
                fileKey,
                fileName,
                success: false,
                error: err.message,
              });
            });

          break;
        }

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

function createWindow() {
  win = new BrowserWindow({
    title: "PrintGo : Easy Printing Solution..",
    width: 800,
    height: 600,
    // kiosk: true,       // fullscreen kiosk mode
    // frame: false,      // no window frame
    // alwaysOnTop: true,

    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile("index.html");
  // win.loadFile("app/dist/index.html");
  win.once('ready-to-show', () => win.show());

  // Disable devtools for privacy
  // win.webContents.on("devtools-opened", () => win.webContents.closeDevTools());
}

app.whenReady().then(() => {
  createWindow();
  connectSocket();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});


function safeSend(channel, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }

}

// Send back job status updates
function printPDF(filePath) {
  safeSend('status', { text: "Printing Started.." });

  return print(filePath)
    .then(() => {
      console.log("Printed successfully!");
      safeSend('status', { text: "Printed Successfully 🎉" });
    })
    .catch((err) => {
      console.error("Error printing PDF:", err);
      safeSend('status', { text: `Something Wrong Happened<br>${err}` });
      return err;
    });
}
ipcMain.on("reset-user-session-id-kiosk-local", () => {

  resetUserIdKiosk("kiosk button")

});

// function which handle infinite resets of user session without causing crash
const resetUserIdKiosk = (from = "Unknown") => {
  try {
    console.log("Renderer requested: Reset kiosk session ID ", from);

    // setting id nullinitially ... it will also display no QR or support QR
    safeSend('status', { text: "Resetting session... ", content: "clean-up-animation" });
    safeSend("SetQRCode", { img: videoURLs.success }); // clear qrcode and set appropriate gif
    let oldId = UniqueKisokIDForIndividual;
    UniqueKisokIDForIndividual = "";
    sendEvent("reset-user-session-id-kiosk", {
      msg: ` ${from} please reset id `,
      oldId: oldId
    });
    // UI pn update kela 
  } catch (err) {
    console.log(err);
  }
}

// module.exports = { safeSend }
