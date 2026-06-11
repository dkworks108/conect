# Setup

## Requirements

- Node.js 18 or newer
- npm 9 or newer
- A browser with WebSocket, Service Worker, IndexedDB, and WebRTC support

## Install

```bash
cd server
npm install
```

## Run

```bash
cd server
npm start
```

The server prints the local and network URL and generates a QR code in the terminal.

## First Run Flow

1. Open the server URL in a browser on the host device.
2. Create a profile in the setup screen.
3. Create or join a room.
4. Share the network URL or QR code with other devices on the same LAN.

## Offline Behavior

- The app caches core assets with the service worker after the first load.
- Messages, rooms, and files are stored locally in IndexedDB.
- If the connection drops, the client attempts to reconnect automatically.
