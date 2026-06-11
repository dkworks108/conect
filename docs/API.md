# API

## HTTP Endpoints

- `GET /api/health` - server health snapshot
- `GET /api/metrics` - runtime metrics
- `GET /api/info` - version, room list, and host info
- `GET /api/rooms` - current room list
- `GET /api/admin/state` - current room and metrics snapshot

## WebSocket Message Types

### Client to Server

- `register`
- `create-room`
- `join-room`
- `leave-room`
- `chat-message`
- `typing`
- `share-location`
- `file-start`
- `file-chunk`
- `file-end`
- `webrtc-offer`
- `webrtc-answer`
- `webrtc-ice`
- `webrtc-reject`
- `read-receipt`
- `ping`

### Server to Client

- `registered`
- `room-created`
- `room-joined`
- `room-left`
- `chat-message`
- `user-typing`
- `message-read`
- `file-incoming`
- `file-chunk`
- `file-complete`
- `rooms-list`
- `rooms-updated`
- `server-shutdown`
- `webrtc-rejected`
- `error`
- `pong`

## Notes

- Payloads are JSON encoded.
- Message history is capped on the server and locally.
- Files are transferred in chunks and reassembled client-side.
