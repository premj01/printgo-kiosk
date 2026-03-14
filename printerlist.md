# Printer List Event Contract

This document defines how printer list data is currently exchanged between the kiosk app and server, including how to derive separate B&W and color lists.

## Current status

Separate arrays for B&W and color printers are **not** sent by default.

Current implementation sends a **single `printers` array** where each printer has capability metadata:
- `supportsColor: true | false | null`
- `printMode: "color" | "monochrome" | "unknown"`

## Socket events

### 1. Request from server
Event: `printer-get-list-request-from-server`

```json
{
  "type": "printer-get-list-request-from-server",
  "data": {}
}
```

### 2. Response from kiosk
Event: `printer-get-list-response-to-server`

```json
{
  "type": "printer-get-list-response-to-server",
  "data": {
    "kioskId": "KIOSK001",
    "printers": [
      {
        "name": "HP_LaserJet",
        "isDefault": true,
        "accepting": true,
        "status": "idle",
        "supportsColor": false,
        "printMode": "monochrome"
      },
      {
        "name": "Epson_Color",
        "isDefault": false,
        "accepting": true,
        "status": "idle",
        "supportsColor": true,
        "printMode": "color"
      }
    ],
    "error": null
  }
}
```

## Field definitions

- `kioskId` (`string`): kiosk identifier from `resources.json`.
- `printers` (`array`): list of discovered printers.
- `printers[].name` (`string`): printer queue name.
- `printers[].isDefault` (`boolean`): whether this is system default printer.
- `printers[].accepting` (`boolean`): whether queue accepts jobs.
- `printers[].status` (`string`): `idle | printing | disabled | unknown`.
- `printers[].supportsColor` (`boolean | null`): capability detection result.
- `printers[].printMode` (`string`): normalized mode (`color`, `monochrome`, `unknown`).
- `error` (`string | null`): non-null only if listing failed.

## Server-side split logic (recommended now)

Use the existing single list and derive grouped lists on server:

```js
const printers = payload.data.printers || [];

const colorPrinters = printers.filter((p) => p.supportsColor === true);
const bwPrinters = printers.filter((p) => p.supportsColor === false);
const unknownPrinters = printers.filter((p) => p.supportsColor == null);
```

## Source references

- `app/src/main/printer.js` (`getPrinterList`): builds printer entries and color capability fields.
- `app/src/main/socket.js` (`printer-get-list-request-from-server`): sends `printer-get-list-response-to-server` with `{ kioskId, ...result }`.

## Optional enhancement (not implemented yet)

If needed, kiosk can be updated to include grouped arrays directly in response data:
- `colorPrinters: []`
- `bwPrinters: []`
- `unknownPrinters: []`

This can be added while keeping `printers` for backward compatibility.
