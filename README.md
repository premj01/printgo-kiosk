# PrintGo Kiosk

Electron-based kiosk client with a lightweight WebSocket agent for remote kiosk control.

## Project Structure

- `app/`: Electron kiosk application (UI + socket connection + printing flow)
- `agent/`: Node.js WebSocket agent process for kiosk control messages
- `resources.json`: Runtime configuration used by both `app` and `agent`
- `example.resources.json`: Example configuration template
- `logs/`: Runtime logs
- `scripts/`: Helper scripts
- `systemd/`: Service definitions (Linux-oriented)

## Prerequisites

- Node.js 18+ (recommended)
- npm 9+
- Windows print environment configured for `pdf-to-printer`

## Configuration

Edit `resources.json` before starting:

```json
{
  "socketMethod": "ws",
  "httpMethod": "http",
  "SERVER_URL": "localhost:3000",
  "AppURL": "localhost:5173",
  "kioskName": "Kiosk-01",
  "kioksid": "KIOSK001"
}
```

Notes:

- Keep the key name `kioksid` as-is because current code expects that exact property.
- `SERVER_URL` should be host:port only (for example `localhost:3000`), not a full URL.
- `AppURL` is used to generate the QR target URL shown in the kiosk app.
- We definately need CUPS installed on the kiosk machine.

## Install

Install dependencies for both modules:

```bash
cd agent
npm install

cd ../app
npm install
```

## Run

Start the kiosk app:

```bash
cd app
npm start
```

Run the agent (separate terminal):

```bash
cd agent
node agent.js
```

## PM2 (optional for agent)

From `agent/`:

```bash
pm2 start agent.js --name "kiosk-agent"
pm2 stop kiosk-agent
pm2 delete kiosk-agent
pm2 list
pm2 logs kiosk-agent
pm2 monitor
```

## How It Works (High Level)

1. `app` opens an Electron window and connects to the WebSocket backend.
2. Backend provides a user/session reference for QR display.
3. User scans QR, uploads file, kiosk receives metadata/chunks.
4. App saves incoming file and can trigger local PDF print flow.
5. `agent` remains connected for remote kiosk lifecycle commands.

## Troubleshooting

- Connection issues:
  - Verify `resources.json` host/port values.
  - Confirm backend server is reachable.
- QR not updating:
  - Check app logs for `setting-reference-id-for-user-identification` events.
- Printing fails:
  - Ensure printer is installed and accessible from the host.
  - Verify `pdf-to-printer` can access the target PDF path.
- Frequent reconnects:
  - Check network stability and WebSocket server health.

## Development Notes

- Main Electron entry: `app/src/main/main.js`
- Kiosk socket handling: `app/src/main/socket.js`
- Print helper: `app/src/main/printer.js`
- Agent entry: `agent/agent.js`

## License

ISC (per package manifests).
