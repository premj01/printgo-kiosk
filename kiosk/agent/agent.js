const WebSocket = require("ws");
const nativeResources = require("../resources.json");

const SERVER_URL = `${nativeResources.socketMethod}://${nativeResources.SERVER_URL}?role=agent&kioskid=${nativeResources.kioksid}`;

// Function to create a WebSocket client
function createSocket() {
  const ws = new WebSocket(SERVER_URL);

  ws.on("open", () => {
    console.log("Connected to server");

    ws.send(JSON.stringify({
      type: "should-start-kiosk",
      data: { from: nativeResources.kioksid, msg: `Hello server ! I am ready at ${new Date()}` }
    }));
  });

  // Listen for messages from server
  ws.on("message", (msg) => {
    try {


      const parsed = JSON.parse(msg.toString());
      if (parsed.type === "start-kiosk-now") {
        console.log("📩 Received: start-kiosk-now command to initiate kiosk");
        console.log(parsed.data.msg);
      } else if (parsed.type === "restart-kiosk-now") {
        console.log("📩 Received : restart-kiosk-now command to restart kiosk");
      } else if (parsed.type === "stop-kiosk-now") {
        console.log("📩 Received : stop-kiosk-now command to stop kiosk");
      } else if (parsed.type === "kiosk-status-check") {
        console.log("📩 Received : kiosk-status-check command to check kiosk status");
      }
      else if (parsed.type === "restart-system-now") {
        console.log("📩 Received : restart-system-now command to restart system");
      } else if (parsed.type === "update-system-now") {
        console.log("📩 Received : update-system-now command to update system");
      } else if (parsed.type === "update-kiosk-now") {
        console.log("📩 Received : update-kiosk-now command to update kiosk");
      } else {
        console.log("📩 Unknown message type:", parsed.type);
      }
    } catch (e) {
      console.log("📩 Raw message:", msg.toString());
    }
  });

  // Handle close
  ws.on("close", (code, reason) => {
    console.log(`❌ Disconnected: ${code} ${reason}`);
    // Optional: Reconnect after 2 seconds
    setTimeout(createSocket, 2000);
  });

  // Handle errors
  ws.on("error", (err) => {
    console.error("⚠️ Connection error:", err.message);
    // setTimeout(createSocket, 2000);
  });

  return ws;
}


createSocket();

