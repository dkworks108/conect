# Deployment

## Local Production Run

```bash
cd server
npm install
NODE_ENV=production npm start
```

## Recommended Production Checks

- Verify the host device is on a stable LAN or hotspot.
- Confirm the port in the range `3000-3010` is reachable.
- Open the server URL from a second device before distributing the QR code.
- Confirm `server/data/rooms.json` and `server/data/logs/server.log` are writable.

## Operational Notes

- The server retries the port range until it finds an available port.
- The HTTP server serves the browser client and the WebSocket endpoint from the same origin.
- Room state is saved periodically and again on shutdown.

## Troubleshooting

- If the server does not start, check that `node_modules` exists under `server/`.
- If clients cannot connect, verify the host and client devices are on the same network.
- If offline caching does not activate, reload the app once while online so the service worker can install.
