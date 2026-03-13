# PrintGo Kiosk Agent

A WebSocket agent that connects to the PrintGo server and gives it **full OS-level control** over the kiosk machine — start/stop/restart the kiosk app, reboot the OS, run arbitrary shell commands, and open a real-time interactive terminal session directly from the admin dashboard.

---

## Quick start (on the kiosk Linux machine)

```bash
cd agent

# 1. Install everything and register with PM2 (run once, needs sudo)
sudo bash install.sh

# 2. Done — agent is now running in the background and will auto-start on boot
```

---

## Scripts

All scripts live in the `agent/` folder. Make them executable once with:

```bash
chmod +x install.sh start.sh stop.sh restart.sh logs.sh status.sh uninstall.sh
```

| Script | npm shortcut | Description |
|--------|-------------|-------------|
| `sudo bash install.sh` | `npm run install:agent` | Install system deps, compile node-pty, register with PM2, configure auto-boot |
| `bash start.sh` | `npm run bg:start` | Start the agent in the background via PM2 |
| `bash stop.sh` | `npm run bg:stop` | Stop the agent |
| `bash restart.sh` | `npm run bg:restart` | Restart the agent |
| `bash logs.sh [lines]` | `npm run bg:logs` | Follow live logs (default last 100 lines) |
| `bash status.sh` | `npm run bg:status` | Show PM2 status + system memory/disk/temp |
| `bash uninstall.sh` | `npm run bg:uninstall` | Remove from PM2 (files stay intact) |

> Run `node agent.js` directly (without PM2) for quick local testing.

---

## Manual PM2 commands

```bash
pm2 start agent.js --name "kiosk-agent"
pm2 stop    kiosk-agent
pm2 restart kiosk-agent
pm2 delete  kiosk-agent
pm2 list
pm2 logs    kiosk-agent
pm2 monit
```

---

## Socket messages (server → agent)

All messages are JSON: `{ "type": "<command>", "data": { ... } }`

### Kiosk management

| type | data | description |
|------|------|-------------|
| `start-kiosk-now` | — | `pm2 start kiosk-app` |
| `stop-kiosk-now` | — | `pm2 stop kiosk-app` |
| `restart-kiosk-now` | — | `pm2 restart kiosk-app` |
| `kiosk-status-check` | — | Returns PM2 process list as JSON |
| `pm2-save` | — | `pm2 save` (persist process list) |
| `get-logs` | `{ lines?: number }` | Last N lines of PM2 logs |

### OS management

| type | data | description |
|------|------|-------------|
| `restart-system-now` | — | `sudo reboot` |
| `update-system-now` | — | `apt-get update && apt-get upgrade -y` |
| `update-kiosk-now` | — | `git pull` + `npm install` + `pm2 restart` |

### System information

| type | data | description |
|------|------|-------------|
| `get-system-info` | — | Hostname, CPU, memory, disk, temperature, IPs |
| `list-processes` | — | Full PM2 process JSON |
| `kill-process` | `{ pid: number }` | `kill -9 <pid>` |

### Shell execution

| type | data | description |
|------|------|-------------|
| `execute-command` | `{ cmd, timeout?, cwd?, requestId? }` | Run any shell command; result returned via `execute-command-result` |

### Real-time terminal (PTY)

| type | data | description |
|------|------|-------------|
| `open-terminal` | `{ sessionId, cols?, rows? }` | Spawn a PTY shell; output streams as `terminal-output` |
| `terminal-input` | `{ sessionId, data }` | Write keystrokes/text to the PTY |
| `terminal-resize` | `{ sessionId, cols, rows }` | Resize the PTY window |
| `close-terminal` | `{ sessionId }` | Kill the PTY session |

---

## Socket messages (agent → server)

| type | description |
|------|-------------|
| `agent-ready` | Sent on connect — includes kioskId, hostname, capabilities list |
| `agent-heartbeat` | Sent every 20 s — free memory, uptime, load avg |
| `kiosk-command-result` | Result of any kiosk/OS command |
| `kiosk-status-result` | Response to `kiosk-status-check` |
| `system-info-result` | Response to `get-system-info` |
| `process-list-result` | Response to `list-processes` |
| `logs-result` | Response to `get-logs` |
| `execute-command-result` | Result of `execute-command` |
| `terminal-opened` | PTY session created |
| `terminal-output` | PTY stdout/stderr chunk |
| `terminal-closed` | PTY session ended |
| `terminal-error` | PTY error |

---

## Configuration (`resources.json`)

| key | description |
|-----|-------------|
| `socketMethod` | `ws` or `wss` |
| `SERVER_URL` | Host:port of the server |
| `kioksid` | Unique kiosk identifier |
| `kioskName` | Human-readable kiosk name |
| `kioskPM2Name` | PM2 process name for the kiosk app (default: `kiosk-app`) |
