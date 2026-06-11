# Architecture

## Overview

Connect is a local-network communication PWA with a Node.js server and browser clients.

## Server

- `server/server.js` serves static client assets with Express.
- WebSocket traffic is handled with `ws`.
- Rooms are persisted to `server/data/rooms.json` and mirrored in `server/data/server.state.json`.
- Health, metrics, and admin endpoints are exposed over HTTP.
- Logs are written to `server/data/logs/server.log`.

## Client

- `client/index.html` loads the SPA shell.
- `client/js/app.js` coordinates navigation and subsystem events.
- `client/js/socket.js` manages connection state and reconnection.
- `client/js/chat.js` owns messaging, file transfer, voice messages, and history.
- `client/js/storage.js` wraps IndexedDB and localStorage.
- `client/js/webrtc.js` handles voice call signaling and peer connections.
- `client/js/audio.js` provides sound effects and MediaRecorder voice capture.
- `client/js/gps.js` manages location sharing and canvas rendering.

## Offline Strategy

- The service worker caches the application shell and core scripts.
- IndexedDB keeps message history, rooms, and files available offline.
- The client shows offline status when the service worker posts `OFFLINE_STATE`.

## Data Flow

1. The client connects over WebSocket.
2. The server registers the profile and assigns a client ID.
3. Room membership changes are broadcast to room members.
4. Messages and transfers are persisted locally on the client.
5. The server persists room metadata and message history on disk.
