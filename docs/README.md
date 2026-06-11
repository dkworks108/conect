# Connect Documentation

This folder contains the operational documentation for Connect.

## Contents

- [SETUP.md](SETUP.md) - Local installation and first run
- [ARCHITECTURE.md](ARCHITECTURE.md) - System design and data flow
- [API.md](API.md) - WebSocket and HTTP endpoints
- [DEPLOYMENT.md](DEPLOYMENT.md) - Production deployment guidance
- [TERMUX.md](TERMUX.md) - Android/Termux server setup

## Current Implementation Notes

- Server runs from `server/server.js` and auto-scans ports `3000-3010`.
- Persistent room data is stored in `server/data/rooms.json`.
- Logs are written to `server/data/logs/server.log`.
- The client is a PWA served from `client/` and cached by the service worker.
