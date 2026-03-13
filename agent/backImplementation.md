# PrintGo Kiosk — Backend Socket Implementation Guide

This document is the **complete reference** for the server-side engineer (or AI agent) who needs to implement the WebSocket backend that communicates with the kiosk agent.

All messages are JSON frames in the shape:
```json
{ "type": "<event-name>", "data": { ... } }
```

---

## 1. Connection handshake

When the kiosk agent connects it attaches query parameters the server must parse to identify the client:

```
ws://<server>?role=agent&kioskid=KIOSK001
```

| Query param | Value | Description |
|-------------|-------|-------------|
| `role` | `agent` | Identifies this connection as a kiosk agent (not a browser/admin) |
| `kioskid` | e.g. `KIOSK001` | Unique kiosk identifier (from `resources.json`) |

**Server responsibility:**  
- Parse `role` and `kioskid` from the URL query string on every new WebSocket connection.  
- Store the socket in a map keyed by `kioskid` so commands can be routed to the right kiosk.  
- When the socket disconnects, mark that kiosk as `offline` in the map/database.

---

## 2. Agent → Server events  
*(The server must LISTEN for these)*

### 2.1 `agent-ready`
Sent immediately after the agent connects. Use this to mark the kiosk as **online**.

```json
{
  "type": "agent-ready",
  "data": {
    "kioskId": "KIOSK001",
    "kioskName": "Kiosk-01",
    "hostname": "raspberrypi",
    "platform": "linux",
    "arch": "arm64",
    "timestamp": "2026-03-13T10:00:00.000Z",
    "capabilities": [
      "start-kiosk-now", "stop-kiosk-now", "restart-kiosk-now",
      "kiosk-status-check", "pm2-save", "get-logs",
      "restart-system-now",
      "update-system-now", "update-kiosk-now",
      "get-system-info", "list-processes", "kill-process",
      "execute-command",
      "open-terminal", "terminal-input", "terminal-resize", "close-terminal"
    ]
  }
}
```

**Server action:** Update kiosk status to `online`. Store `capabilities`, `hostname`, `platform`.

---

### 2.2 `agent-heartbeat`
Sent every **20 seconds** while the agent is connected.

```json
{
  "type": "agent-heartbeat",
  "data": {
    "kioskId": "KIOSK001",
    "freeMemory": 412876800,
    "uptime": 86400,
    "loadAvg": [0.12, 0.08, 0.05],
    "timestamp": "2026-03-13T10:00:20.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `freeMemory` | `number` | Free RAM in bytes |
| `uptime` | `number` | OS uptime in seconds |
| `loadAvg` | `[1m, 5m, 15m]` | Linux load averages |

**Server action:** Update the kiosk's last-seen timestamp and live metrics in the database/cache. If heartbeats stop arriving for > 60 s, mark the kiosk as `offline`.

---

### 2.3 `kiosk-command-result`
Generic result returned after most kiosk/OS commands finish.

```json
{
  "type": "kiosk-command-result",
  "data": {
    "command": "restart-kiosk",
    "success": true,
    "stdout": "...",
    "stderr": "",
    "exitCode": 0,
    "cmd": "pm2 restart kiosk-app"
  }
}
```

`command` values that use this event:

| `command` value | Triggered by |
|----------------|--------------|
| `start-kiosk` | `start-kiosk-now` |
| `stop-kiosk` | `stop-kiosk-now` |
| `restart-kiosk` | `restart-kiosk-now` |
| `pm2-save` | `pm2-save` |
| `restart-system` | `restart-system-now` |
| `update-system-started` | `update-system-now` (fire-and-forget ack) |
| `update-system-complete` | `update-system-now` (final result) |
| `update-kiosk-started` | `update-kiosk-now` (fire-and-forget ack) |
| `update-kiosk-complete` | `update-kiosk-now` (final result) |

---

### 2.4 `kiosk-status-result`
Response to `kiosk-status-check`.

```json
{
  "type": "kiosk-status-result",
  "data": {
    "command": "kiosk-status",
    "success": true,
    "processes": [
      {
        "name": "kiosk-app",
        "pid": 1234,
        "status": "online",
        "cpu": 2.5,
        "memory": 104857600,
        "uptime": 1711968000000,
        "restarts": 0
      }
    ],
    "stderr": ""
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `processes[].status` | `string` | PM2 status: `online`, `stopped`, `errored`, `launching` |
| `processes[].memory` | `number` | Bytes used |
| `processes[].uptime` | `number` | Unix ms timestamp of process start |

---

### 2.5 `system-info-result`
Response to `get-system-info`.

```json
{
  "type": "system-info-result",
  "data": {
    "command": "get-system-info",
    "success": true,
    "info": {
      "hostname": "raspberrypi",
      "platform": "linux",
      "arch": "arm64",
      "release": "6.1.0-rpi7",
      "cpus": 4,
      "cpuModel": "Cortex-A72",
      "totalMemory": 4294967296,
      "freeMemory": 412876800,
      "uptimeSeconds": 86400,
      "loadAvg": [0.12, 0.08, 0.05],
      "ips": { "eth0": "192.168.1.50", "wlan0": "192.168.1.51" },
      "disk": "Filesystem      Size  Used Avail Use% Mounted on\n/dev/mmcblk0p2   29G   8.2G   21G  29% /",
      "cpuTempC": "48.2"
    }
  }
}
```

---

### 2.6 `process-list-result`
Response to `list-processes`.

```json
{
  "type": "process-list-result",
  "data": {
    "command": "list-processes",
    "success": true,
    "processes": [ /* raw PM2 JSON array */ ]
  }
}
```

---

### 2.7 `logs-result`
Response to `get-logs`.

```json
{
  "type": "logs-result",
  "data": {
    "command": "get-logs",
    "success": true,
    "stdout": "[2026-03-13 10:00:00] kiosk-app | ...",
    "stderr": "",
    "exitCode": 0,
    "cmd": "pm2 logs kiosk-app --lines 100 --nostream"
  }
}
```

---

### 2.8 `execute-command-result`
Response to `execute-command` and `kill-process`.

```json
{
  "type": "execute-command-result",
  "data": {
    "requestId": "req-abc-123",
    "success": true,
    "stdout": "...",
    "stderr": "",
    "exitCode": 0,
    "cmd": "ls -la /home/pi"
  }
}
```

`requestId` echoes back whatever the server sent — useful for correlating async responses.

---

### 2.9 `terminal-opened`
Sent when a PTY session is successfully spawned.

```json
{
  "type": "terminal-opened",
  "data": {
    "sessionId": "session-uuid-1",
    "shell": "/bin/bash",
    "cols": 220,
    "rows": 50
  }
}
```

---

### 2.10 `terminal-output`
Streams PTY stdout/stderr in real time. High-frequency — can fire many times per second.

```json
{
  "type": "terminal-output",
  "data": {
    "sessionId": "session-uuid-1",
    "data": "\u001b[32mpi@raspberrypi\u001b[0m:~$ "
  }
}
```

`data` is a raw terminal string (may contain ANSI escape codes). Forward as-is to the admin browser which should render it with xterm.js.

---

### 2.11 `terminal-closed`
Sent when the PTY process exits or is killed.

```json
{
  "type": "terminal-closed",
  "data": {
    "sessionId": "session-uuid-1",
    "exitCode": 0,
    "signal": null
  }
}
```

Or when closed by the admin:
```json
{
  "type": "terminal-closed",
  "data": {
    "sessionId": "session-uuid-1",
    "reason": "closed-by-admin"
  }
}
```

---

### 2.12 `terminal-error`
Sent on PTY errors (failed spawn, invalid session, node-pty missing).

```json
{
  "type": "terminal-error",
  "data": {
    "sessionId": "session-uuid-1",
    "error": "node-pty not available on this agent"
  }
}
```

---

## 3. Server → Agent events  
*(The server must SEND these to the correct kiosk socket)*

All commands are routed to the target agent by looking up `kioskid` in the connected-sockets map.

### 3.1 Kiosk management

#### `start-kiosk-now`
```json
{ "type": "start-kiosk-now", "data": {} }
```
Starts the kiosk app via PM2. Returns `kiosk-command-result` with `command: "start-kiosk"`.

---

#### `stop-kiosk-now`
```json
{ "type": "stop-kiosk-now", "data": {} }
```
Stops the kiosk app via PM2. Returns `kiosk-command-result` with `command: "stop-kiosk"`.

---

#### `restart-kiosk-now`
```json
{ "type": "restart-kiosk-now", "data": {} }
```
Restarts the kiosk app via PM2. Returns `kiosk-command-result` with `command: "restart-kiosk"`.

---

#### `kiosk-status-check`
```json
{ "type": "kiosk-status-check", "data": {} }
```
Returns `kiosk-status-result` with the full PM2 process list.

---

#### `pm2-save`
```json
{ "type": "pm2-save", "data": {} }
```
Persists the current PM2 process list to disk (survives reboots). Returns `kiosk-command-result`.

---

#### `get-logs`
```json
{
  "type": "get-logs",
  "data": { "lines": 200 }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `lines` | `number` | No | `100` | How many tail lines to fetch |

Returns `logs-result`.

---

### 3.2 OS management

#### `restart-system-now`
```json
{ "type": "restart-system-now", "data": {} }
```
Runs `sudo reboot` after sending back the ack. The socket will disconnect — server should mark the kiosk as offline and expect a reconnect in ~30 s.

---

#### `update-system-now`
```json
{ "type": "update-system-now", "data": {} }
```
Runs `sudo apt-get update && sudo apt-get upgrade -y`. Returns two `kiosk-command-result` messages:
1. `command: "update-system-started"` — immediate ack
2. `command: "update-system-complete"` — final result (can take several minutes)

---

#### `update-kiosk-now`
```json
{ "type": "update-kiosk-now", "data": {} }
```
Runs `git pull` → `npm install` (app + agent) → `pm2 restart`. Returns two `kiosk-command-result` messages:
1. `command: "update-kiosk-started"` — immediate ack
2. `command: "update-kiosk-complete"` — final result

---

### 3.3 System information

#### `get-system-info`
```json
{ "type": "get-system-info", "data": {} }
```
Returns `system-info-result` with hostname, CPU, memory, disk, temperature, IPs.

---

#### `list-processes`
```json
{ "type": "list-processes", "data": {} }
```
Returns `process-list-result` with the raw PM2 JSON array of all registered processes.

---

#### `kill-process`
```json
{
  "type": "kill-process",
  "data": { "pid": 5678 }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pid` | `number` | Yes | OS process ID to kill with SIGKILL |

Returns `execute-command-result` with `command: "kill-process"`.

---

### 3.4 Shell execution

#### `execute-command`
Run any arbitrary shell command on the kiosk machine.

```json
{
  "type": "execute-command",
  "data": {
    "cmd": "ls -la /home/pi",
    "cwd": "/home/pi",
    "timeout": 15000,
    "requestId": "req-abc-123"
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `cmd` | `string` | Yes | — | Shell command to run |
| `cwd` | `string` | No | kiosk root | Working directory |
| `timeout` | `number` | No | `30000` | ms before the command is killed |
| `requestId` | `string` | No | — | Echoed back in the result for correlation |

Returns `execute-command-result`.

---

### 3.5 Real-time terminal (PTY)

Used to give an admin a live interactive shell on the kiosk machine. The server acts as a **relay** between the admin browser (xterm.js) and the agent PTY.

#### `open-terminal`
Opens a new PTY shell session.

```json
{
  "type": "open-terminal",
  "data": {
    "sessionId": "session-uuid-1",
    "cols": 220,
    "rows": 50
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `sessionId` | `string` | Yes | — | Unique ID for this terminal session (generate a UUID on the server) |
| `cols` | `number` | No | `80` | Terminal width in columns |
| `rows` | `number` | No | `24` | Terminal height in rows |

Returns `terminal-opened` on success, `terminal-error` on failure.

---

#### `terminal-input`
Forward a keystroke or paste from the admin browser to the PTY.

```json
{
  "type": "terminal-input",
  "data": {
    "sessionId": "session-uuid-1",
    "data": "ls -la\r"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | Yes | Target terminal session |
| `data` | `string` | Yes | Raw input string (use `\r` for Enter, `\u0003` for Ctrl+C, etc.) |

---

#### `terminal-resize`
Resize the terminal window (call this when the browser xterm.js resizes).

```json
{
  "type": "terminal-resize",
  "data": {
    "sessionId": "session-uuid-1",
    "cols": 240,
    "rows": 55
  }
}
```

---

#### `close-terminal`
Kill the PTY session and clean it up.

```json
{
  "type": "close-terminal",
  "data": { "sessionId": "session-uuid-1" }
}
```

Returns `terminal-closed` with `reason: "closed-by-admin"`.

---

## 4. Server-side data model

Minimal data the server should maintain per connected kiosk:

```js
{
  kioskId:      "KIOSK001",          // from query string
  kioskName:    "Kiosk-01",          // from agent-ready
  socket:       <WebSocket>,         // live socket reference
  status:       "online"|"offline",
  hostname:     "raspberrypi",
  platform:     "linux",
  arch:         "arm64",
  capabilities: [...],               // from agent-ready
  lastSeen:     Date,                // updated on every heartbeat
  metrics: {
    freeMemory: 412876800,
    uptime:     86400,
    loadAvg:    [0.12, 0.08, 0.05],
  },
  terminalSessions: {                // active PTY sessions
    "session-uuid-1": { adminSocketId: "..." }
  }
}
```

---

## 5. PTY relay flow (server ↔ agent ↔ admin browser)

```
Admin browser (xterm.js)
        │  open-terminal (ws)
        ▼
     SERVER  ────────────────►  Agent (kiosk)
        │    open-terminal          │
        │                     spawn PTY (/bin/bash)
        │                           │
        │◄── terminal-opened ───────┘
        │
        │◄── terminal-output ───────  (streamed, high-frequency)
        │
        │──► terminal-input ────────►  (keystrokes from browser)
        │
        │──► terminal-resize ───────►  (on browser resize)
        │
        │──► close-terminal ────────►
        │◄── terminal-closed ───────
```

The server must:
1. Keep a map of `sessionId → { agentSocket, adminSocket }`.
2. When `terminal-output` arrives from the agent, forward it to the correct admin socket.
3. When `terminal-input` / `terminal-resize` / `close-terminal` arrives from the admin, forward it to the correct agent socket.
4. When the admin browser disconnects, send `close-terminal` to the agent.
5. When the agent disconnects with open sessions, notify all affected admin browsers.

---

## 6. Error handling checklist

| Scenario | Expected behaviour |
|----------|--------------------|
| Agent sends unknown `type` | Log and ignore |
| Command sent to offline kiosk | Return error to caller: `{ error: "Kiosk KIOSK001 is offline" }` |
| Agent disconnects mid-command | No result will arrive; implement a timeout on the server side (30 s default) |
| `execute-command` with dangerous cmd | Server should whitelist or require admin auth before forwarding |
| `kill-process` with invalid pid | Agent returns `execute-command-result` with `success: false` |
| `open-terminal` when node-pty missing | Agent returns `terminal-error` |
| Duplicate `sessionId` | Agent returns `terminal-error: "Session already exists"` |

---

## 7. Authentication recommendation

The current agent connects with only a `kioskid` query param — no token. **Before production**, add a shared secret:

1. Add `"agentSecret": "your-secret"` to `resources.json`.
2. Agent sends it as `?token=<secret>` in the connection URL.
3. Server validates the token on upgrade and rejects unknown connections with HTTP 401.

---

## 8. Quick reference — all event types

| Direction | Event type | Purpose |
|-----------|-----------|---------|
| Agent → Server | `agent-ready` | Connection announced |
| Agent → Server | `agent-heartbeat` | 20 s keep-alive + metrics |
| Agent → Server | `kiosk-command-result` | Result of kiosk/OS commands |
| Agent → Server | `kiosk-status-result` | PM2 process list |
| Agent → Server | `system-info-result` | Full system info |
| Agent → Server | `process-list-result` | Raw PM2 JSON |
| Agent → Server | `logs-result` | PM2 log output |
| Agent → Server | `execute-command-result` | Shell command result |
| Agent → Server | `terminal-opened` | PTY session started |
| Agent → Server | `terminal-output` | PTY data stream |
| Agent → Server | `terminal-closed` | PTY session ended |
| Agent → Server | `terminal-error` | PTY error |
| Server → Agent | `start-kiosk-now` | Start kiosk via PM2 |
| Server → Agent | `stop-kiosk-now` | Stop kiosk via PM2 |
| Server → Agent | `restart-kiosk-now` | Restart kiosk via PM2 |
| Server → Agent | `kiosk-status-check` | Get PM2 process list |
| Server → Agent | `pm2-save` | Persist PM2 process list |
| Server → Agent | `get-logs` | Fetch PM2 logs |
| Server → Agent | `restart-system-now` | `sudo reboot` |
| Server → Agent | `update-system-now` | `apt-get upgrade` |
| Server → Agent | `update-kiosk-now` | git pull + npm install + pm2 restart |
| Server → Agent | `get-system-info` | Hostname, CPU, disk, temp, IPs |
| Server → Agent | `list-processes` | List all PM2 processes |
| Server → Agent | `kill-process` | `kill -9 <pid>` |
| Server → Agent | `execute-command` | Run arbitrary shell command |
| Server → Agent | `open-terminal` | Spawn PTY session |
| Server → Agent | `terminal-input` | Write to PTY |
| Server → Agent | `terminal-resize` | Resize PTY |
| Server → Agent | `close-terminal` | Kill PTY session |
