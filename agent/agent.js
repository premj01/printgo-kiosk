"use strict";

const WebSocket = require("ws");
const { exec } = require("child_process");
const os = require("os");
const path = require("path");

// ─── Load config ────────────────────────────────────────────────────────────
let nativeResources;
try {
  nativeResources = require("../resources.json");
} catch (e) {
  console.error("❌ Failed to load resources.json:", e.message);
  process.exit(1);
}

// node-pty is optional — graceful fallback when not compiled
let pty = null;
try {
  pty = require("node-pty");
} catch (e) {
  console.warn("⚠️  node-pty not available — real-time terminal sessions disabled.");
  console.warn("   Run `npm install` inside the agent folder to enable them.");
}

// ─── Constants ───────────────────────────────────────────────────────────────
const SERVER_URL =
  `${nativeResources.socketMethod}://${nativeResources.SERVER_URL}` +
  `?role=agent&kioskid=${nativeResources.kioksid}`;

const KIOSK_PM2_NAME = nativeResources.kioskPM2Name || "kiosk-app";
const KIOSK_ROOT = path.resolve(__dirname, "..");
const RECONNECT_MS = 3000;
const HEARTBEAT_MS = 20000;

// Active PTY terminal sessions  { sessionId → { ptyProcess } }
const ptySessions = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Send a typed JSON message only if the socket is open. */
function send(ws, type, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

/**
 * Run a shell command and resolve with { success, stdout, stderr, exitCode, cmd }.
 * @param {string} cmd
 * @param {{ timeout?: number, cwd?: string }} [opts]
 * @returns {Promise<object>}
 */
function run(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: opts.timeout || 30_000, maxBuffer: 2 * 1024 * 1024, cwd: opts.cwd }, (err, stdout, stderr) => {
      resolve({
        success: !err,
        stdout: (stdout || "").trim(),
        stderr: (stderr || "").trim(),
        exitCode: err ? (err.code || 1) : 0,
        cmd,
      });
    });
  });
}

// ─── Kiosk management ────────────────────────────────────────────────────────

async function handleStartKiosk(data, ws) {
  console.log("▶  Starting kiosk…");
  let result = await run(`pm2 start ${KIOSK_PM2_NAME}`);
  if (!result.success) {
    // Fallback: start the electron/node app directly via PM2
    const appEntry = path.join(KIOSK_ROOT, "app", "main.js");
    result = await run(`pm2 start "${appEntry}" --name "${KIOSK_PM2_NAME}"`);
  }
  send(ws, "kiosk-command-result", { command: "start-kiosk", ...result });
}

async function handleStopKiosk(data, ws) {
  console.log("⏹  Stopping kiosk…");
  send(ws, "kiosk-command-result", { command: "stop-kiosk", ...await run(`pm2 stop ${KIOSK_PM2_NAME}`) });
}

async function handleRestartKiosk(data, ws) {
  console.log("🔄  Restarting kiosk…");
  send(ws, "kiosk-command-result", { command: "restart-kiosk", ...await run(`pm2 restart ${KIOSK_PM2_NAME}`) });
}

async function handleKioskStatus(data, ws) {
  console.log("📊  Checking kiosk status…");
  const result = await run("pm2 jlist");
  let processes = [];
  if (result.success && result.stdout) {
    try {
      const all = JSON.parse(result.stdout);
      processes = all.map((p) => ({
        name: p.name,
        pid: p.pid,
        status: p.pm2_env.status,
        cpu: p.monit?.cpu,
        memory: p.monit?.memory,
        uptime: p.pm2_env.pm_uptime,
        restarts: p.pm2_env.restart_time,
      }));
    } catch { processes = result.stdout; }
  }
  send(ws, "kiosk-status-result", { command: "kiosk-status", success: result.success, processes, stderr: result.stderr });
}

async function handlePm2Save(_data, ws) {
  console.log("💾  Saving PM2 process list…");
  send(ws, "kiosk-command-result", { command: "pm2-save", ...await run("pm2 save") });
}

async function handleGetLogs(data, ws) {
  const lines = data?.lines || 100;
  console.log(`📜  Fetching last ${lines} PM2 log lines…`);
  send(ws, "logs-result", {
    command: "get-logs",
    ...await run(`pm2 logs ${KIOSK_PM2_NAME} --lines ${lines} --nostream`, { timeout: 15_000 }),
  });
}

// ─── OS management ───────────────────────────────────────────────────────────

async function handleRestartSystem(_data, ws) {
  console.log("🔁  Rebooting system…");
  send(ws, "kiosk-command-result", { command: "restart-system", success: true, stdout: "System reboot initiated…" });
  setTimeout(() => exec("sudo reboot"), 1000);
}

async function handleUpdateSystem(_data, ws) {
  console.log("⬆  Updating system packages…");
  send(ws, "kiosk-command-result", { command: "update-system-started", success: true, stdout: "apt update + upgrade started — this may take several minutes." });
  send(ws, "kiosk-command-result", {
    command: "update-system-complete",
    ...await run("sudo apt-get update && sudo apt-get upgrade -y", { timeout: 300_000 }),
  });
}

async function handleUpdateKiosk(_data, ws) {
  console.log("⬆  Updating kiosk application…");
  const appDir = path.join(KIOSK_ROOT, "app");
  const agentDir = path.join(KIOSK_ROOT, "agent");
  const cmds = [
    `cd "${KIOSK_ROOT}" && git pull`,
    `cd "${appDir}" && npm install`,
    `cd "${agentDir}" && npm install`,
    `pm2 restart ${KIOSK_PM2_NAME}`,
  ].join(" && ");
  send(ws, "kiosk-command-result", { command: "update-kiosk-started", success: true, stdout: "Kiosk update started…" });
  send(ws, "kiosk-command-result", { command: "update-kiosk-complete", ...await run(cmds, { timeout: 120_000 }) });
}

// ─── System information ───────────────────────────────────────────────────────

async function handleGetSystemInfo(_data, ws) {
  console.log("ℹ️  Collecting system info…");

  // Basic OS info
  const nets = os.networkInterfaces();
  const ips = {};
  for (const [name, addrs] of Object.entries(nets)) {
    const v4 = addrs.find((a) => a.family === "IPv4" && !a.internal);
    if (v4) ips[name] = v4.address;
  }

  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || "unknown",
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptimeSeconds: os.uptime(),
    loadAvg: os.loadavg(),
    ips,
  };

  // Disk (Linux only)
  const disk = await run("df -h --output=source,size,used,avail,pcent,target");
  info.disk = disk.stdout;

  // CPU temperature (Raspberry Pi / common Linux)
  const temp = await run("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo ''");
  if (temp.stdout) {
    info.cpuTempC = (parseInt(temp.stdout, 10) / 1000).toFixed(1);
  }

  send(ws, "system-info-result", { command: "get-system-info", success: true, info });
}

async function handleListProcesses(_data, ws) {
  console.log("📋  Listing all PM2 processes…");
  const result = await run("pm2 jlist");
  let processes = result.stdout;
  if (result.success) {
    try { processes = JSON.parse(result.stdout); } catch { /* keep raw */ }
  }
  send(ws, "process-list-result", { command: "list-processes", success: result.success, processes });
}

async function handleKillProcess(data, ws) {
  const pid = parseInt(data?.pid, 10);
  if (!pid || isNaN(pid)) {
    send(ws, "execute-command-result", { command: "kill-process", success: false, stderr: "Valid pid required" });
    return;
  }
  console.log(`🔪  Killing PID ${pid}…`);
  send(ws, "execute-command-result", { command: "kill-process", pid, ...await run(`kill -9 ${pid}`) });
}

// ─── Arbitrary command execution ──────────────────────────────────────────────

async function handleExecuteCommand(data, ws) {
  if (!data?.cmd) {
    send(ws, "execute-command-result", { success: false, stderr: "No command provided" });
    return;
  }
  console.log(`💻  Executing: ${data.cmd}`);
  const result = await run(data.cmd, { timeout: data.timeout || 30_000, cwd: data.cwd });
  send(ws, "execute-command-result", { requestId: data.requestId, ...result });
}

// ─── Real-time PTY terminal ──────────────────────────────────────────────────

function handleOpenTerminal(data, ws) {
  const sessionId = data?.sessionId;
  if (!sessionId) { send(ws, "terminal-error", { error: "sessionId required" }); return; }
  if (!pty) { send(ws, "terminal-error", { sessionId, error: "node-pty not available on this agent" }); return; }
  if (ptySessions[sessionId]) { send(ws, "terminal-error", { sessionId, error: "Session already exists" }); return; }

  console.log(`🖥  Opening terminal session: ${sessionId}`);
  const shell = process.platform === "win32" ? "cmd.exe" : (process.env.SHELL || "/bin/bash");

  try {
    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: data?.cols || 80,
      rows: data?.rows || 24,
      cwd: KIOSK_ROOT,
      env: { ...process.env },
    });

    ptySessions[sessionId] = { ptyProcess };

    // Stream all PTY output back to the server
    ptyProcess.onData((output) => {
      send(ws, "terminal-output", { sessionId, data: output });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`🖥  Terminal ${sessionId} exited (code=${exitCode})`);
      delete ptySessions[sessionId];
      send(ws, "terminal-closed", { sessionId, exitCode, signal });
    });

    send(ws, "terminal-opened", { sessionId, shell, cols: data?.cols || 80, rows: data?.rows || 24 });
  } catch (err) {
    console.error("❌  PTY spawn failed:", err.message);
    send(ws, "terminal-error", { sessionId, error: err.message });
  }
}

function handleTerminalInput(data, ws) {
  const session = ptySessions[data?.sessionId];
  if (!session) { send(ws, "terminal-error", { sessionId: data?.sessionId, error: "Session not found" }); return; }
  session.ptyProcess.write(data.data ?? "");
}

function handleTerminalResize(data, ws) {
  const session = ptySessions[data?.sessionId];
  if (!session || !data?.cols || !data?.rows) return;
  try { session.ptyProcess.resize(data.cols, data.rows); } catch { /* ignore */ }
}

function handleCloseTerminal(data, ws) {
  const sessionId = data?.sessionId;
  const session = ptySessions[sessionId];
  if (!session) { send(ws, "terminal-error", { sessionId, error: "Session not found" }); return; }
  console.log(`🖥  Closing terminal session: ${sessionId}`);
  session.ptyProcess.kill();
  delete ptySessions[sessionId];
  send(ws, "terminal-closed", { sessionId, reason: "closed-by-admin" });
}

// Kill all open PTY sessions (called on disconnect)
function closeAllTerminals() {
  for (const id of Object.keys(ptySessions)) {
    try { ptySessions[id].ptyProcess.kill(); } catch { /* ignore */ }
    delete ptySessions[id];
  }
}

// ─── Message dispatch table ───────────────────────────────────────────────────
const HANDLERS = {
  // Kiosk
  "start-kiosk-now": handleStartKiosk,
  "stop-kiosk-now": handleStopKiosk,
  "restart-kiosk-now": handleRestartKiosk,
  "kiosk-status-check": handleKioskStatus,
  "pm2-save": handlePm2Save,
  "get-logs": handleGetLogs,
  // OS
  "restart-system-now": handleRestartSystem,
  "update-system-now": handleUpdateSystem,
  "update-kiosk-now": handleUpdateKiosk,
  // Info
  "get-system-info": handleGetSystemInfo,
  "list-processes": handleListProcesses,
  "kill-process": handleKillProcess,
  // Shell
  "execute-command": handleExecuteCommand,
  // Real-time terminal
  "open-terminal": handleOpenTerminal,
  "terminal-input": handleTerminalInput,
  "terminal-resize": handleTerminalResize,
  "close-terminal": handleCloseTerminal,
};

// ─── WebSocket lifetime ───────────────────────────────────────────────────────

function createSocket() {
  console.log(`🔌  Connecting to ${SERVER_URL} …`);
  const ws = new WebSocket(SERVER_URL);
  let heartbeatTimer = null;

  ws.on("open", () => {
    console.log("✅  Connected to server");

    // Announce readiness
    send(ws, "agent-ready", {
      kioskId: nativeResources.kioksid,
      kioskName: nativeResources.kioskName,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      timestamp: new Date().toISOString(),
      capabilities: Object.keys(HANDLERS),
    });

    // Keep-alive heartbeat
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        send(ws, "agent-heartbeat", {
          kioskId: nativeResources.kioksid,
          freeMemory: os.freemem(),
          uptime: os.uptime(),
          loadAvg: os.loadavg(),
          timestamp: new Date().toISOString(),
        });
      }
    }, HEARTBEAT_MS);
  });

  ws.on("message", (raw) => {
    let parsed;
    try { parsed = JSON.parse(raw.toString()); } catch {
      console.warn("📩  Unparseable message:", raw.toString().slice(0, 80));
      return;
    }
    const handler = HANDLERS[parsed.type];
    if (handler) {
      console.log(`📩  ← ${parsed.type}`);
      handler(parsed.data || {}, ws);
    } else {
      console.log(`📩  Unknown type: ${parsed.type}`);
    }
  });

  ws.on("close", (code, reason) => {
    clearInterval(heartbeatTimer);
    closeAllTerminals();
    console.log(`❌  Disconnected (${code}). Reconnecting in ${RECONNECT_MS / 1000}s…`);
    setTimeout(createSocket, RECONNECT_MS);
  });

  ws.on("error", (err) => {
    console.error("⚠️  WebSocket error:", err.message);
    // "close" event fires after error, so reconnect is handled there
  });

  return ws;
}

// ─── Start ────────────────────────────────────────────────────────────────────
createSocket();

