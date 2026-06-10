/**
 * Connect Server v2.0 — Production WebSocket + HTTP Server
 * Features: rooms, chat, files, location, WebRTC signaling,
 * rate limiting, persistence, graceful shutdown
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2]) || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const ROOMS_FILE = path.join(__dirname, 'rooms.json');
const MAX_CONNECTIONS = 50;
const MAX_HISTORY = 100;
const MAX_MSG_PER_MIN = 30;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const startTime = Date.now();

// ─── STATE ──────────────────────────────────────
const clients = new Map();
let rooms = new Map();

// ─── HELPERS ────────────────────────────────────
function uid() {
  return crypto.randomBytes(6).toString('hex');
}
function shortCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}
function ts() {
  return new Date().toISOString().slice(11, 19);
}
function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// ─── PERSISTENCE ────────────────────────────────
function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
      data.forEach(r => {
        r.clients = new Set();
        r.rateLimits = new Map();
        rooms.set(r.id, r);
      });
      log(`Loaded ${rooms.size} rooms from disk`);
    }
  } catch (e) {
    log('Could not load rooms: ' + e.message);
  }
}

function saveRooms() {
  try {
    const arr = [];
    rooms.forEach(r => {
      arr.push({
        id: r.id, name: r.name, joinCode: r.joinCode,
        hostId: r.hostId, passwordHash: r.passwordHash || null,
        isPrivate: r.isPrivate, createdAt: r.createdAt,
        messages: (r.messages || []).slice(-MAX_HISTORY)
      });
    });
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    log('Could not save rooms: ' + e.message);
  }
}

// Auto-save every 30 seconds
setInterval(saveRooms, 30000);

// ─── MIME TYPES ─────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

// ─── HTTP SERVER ────────────────────────────────
const httpServer = http.createServer((req, res) => {
  // CORS headers for local network
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  // API endpoints
  if (req.url === '/api/info') {
    const roomsList = [];
    rooms.forEach(r => {
      roomsList.push({ id: r.id, name: r.name, joinCode: r.joinCode, memberCount: r.clients.size });
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version: '2.0.0',
      rooms: roomsList,
      totalConnections: clients.size,
      maxConnections: MAX_CONNECTIONS,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      serverTime: Date.now()
    }));
    return;
  }

  // Static file serving
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';

  const filePath = path.join(CLIENT_DIR, url);
  const safePath = path.resolve(filePath);
  if (!safePath.startsWith(path.resolve(CLIENT_DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      // SPA fallback
      if (url !== '/index.html') {
        fs.readFile(path.join(CLIENT_DIR, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); res.end('Not Found'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          res.end(d2);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(safePath);
    const mime = MIME[ext] || 'application/octet-stream';
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cache });
    res.end(data);
  });
});

// ─── WEBSOCKET SERVER ───────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Connection limit
  if (clients.size >= MAX_CONNECTIONS) {
    sendTo(ws, 'error', { code: 'SERVER_FULL', message: `Server is at capacity (${MAX_CONNECTIONS} devices). Try again later.` });
    ws.close();
    return;
  }

  const clientId = uid();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  log(`Client connected: ${clientId} from ${ip}`);

  ws.isAlive = true;
  ws.clientId = clientId;
  ws.on('pong', () => { ws.isAlive = true; });

  // Rate limit tracker
  const rateLimit = { count: 0, resetAt: Date.now() + 60000 };

  ws.on('message', (raw) => {
    try {
      // Rate limiting
      const now = Date.now();
      if (now > rateLimit.resetAt) {
        rateLimit.count = 0;
        rateLimit.resetAt = now + 60000;
      }
      rateLimit.count++;
      if (rateLimit.count > MAX_MSG_PER_MIN) {
        sendTo(ws, 'error', { code: 'RATE_LIMITED', message: 'Too many messages. Slow down.' });
        return;
      }

      const rawStr = raw.toString();
      if (rawStr.length > MAX_FILE_SIZE + 1024) {
        sendTo(ws, 'error', { code: 'MESSAGE_TOO_LARGE', message: 'Message exceeds maximum size.' });
        return;
      }

      const msg = JSON.parse(rawStr);
      handleMessage(clientId, ws, msg);
    } catch (e) {
      sendTo(ws, 'error', { code: 'INVALID_MESSAGE', message: 'Invalid JSON format.' });
    }
  });

  ws.on('close', () => {
    log(`Client disconnected: ${clientId}`);
    handleDisconnect(clientId);
  });

  ws.on('error', (err) => {
    log(`Client error ${clientId}: ${err.message}`);
  });
});

// ─── HEARTBEAT ──────────────────────────────────
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ─── MESSAGE HANDLER ────────────────────────────
function handleMessage(clientId, ws, msg) {
  const { type, payload = {} } = msg;
  if (!type) return;

  switch (type) {

    case 'register': {
      const profile = {
        displayName: String(payload.displayName || 'Anonymous').slice(0, 30),
        avatar: String(payload.avatar || '😎').slice(0, 4),
        avatarColor: String(payload.avatarColor || '#00d4ff').slice(0, 9),
        statusMessage: String(payload.statusMessage || '').slice(0, 100)
      };
      clients.set(clientId, {
        id: clientId, ws, profile,
        roomId: null, joinedAt: Date.now(), lastSeen: Date.now()
      });
      sendTo(ws, 'registered', { clientId, serverVersion: '2.0.0' });
      log(`Registered: ${profile.displayName} (${clientId})`);
      break;
    }

    case 'create-room': {
      const roomId = uid();
      const joinCode = shortCode();
      let passwordHash = null;
      if (payload.isPrivate && payload.password) {
        passwordHash = hashPassword(payload.password);
      }
      const room = {
        id: roomId,
        name: String(payload.roomName || 'Unnamed Room').slice(0, 40),
        joinCode,
        hostId: clientId,
        passwordHash,
        isPrivate: !!payload.isPrivate,
        clients: new Set(),
        messages: [],
        fileBuffers: new Map(),
        createdAt: Date.now()
      };
      rooms.set(roomId, room);
      log(`Room created: "${room.name}" [${joinCode}] by ${clientId}`);
      sendTo(ws, 'room-created', { roomId, roomName: room.name, joinCode });
      joinRoom(clientId, ws, roomId);
      broadcastRoomsList();
      saveRooms();
      break;
    }

    case 'join-room': {
      let room = null;
      const target = payload.roomId || payload.joinCode || '';
      // Find by ID
      room = rooms.get(target);
      // Find by joinCode
      if (!room) {
        for (const [, r] of rooms) {
          if (r.joinCode === target.toUpperCase()) { room = r; break; }
        }
      }
      if (!room) {
        sendTo(ws, 'error', { code: 'ROOM_NOT_FOUND', message: `Room "${target}" not found. Check the code and try again.` });
        return;
      }
      if (room.passwordHash && payload.password) {
        if (hashPassword(payload.password) !== room.passwordHash) {
          sendTo(ws, 'error', { code: 'WRONG_PASSWORD', message: 'Wrong password. Try again.' });
          return;
        }
      } else if (room.passwordHash && !payload.password) {
        sendTo(ws, 'error', { code: 'WRONG_PASSWORD', message: 'This room requires a password.' });
        return;
      }
      joinRoom(clientId, ws, room.id);
      break;
    }

    case 'leave-room': {
      leaveRoom(clientId);
      break;
    }

    case 'chat-message': {
      const client = clients.get(clientId);
      if (!client || !client.roomId) {
        sendTo(ws, 'error', { code: 'NOT_IN_ROOM', message: 'You must join a room first.' });
        return;
      }
      const room = rooms.get(client.roomId);
      if (!room) return;

      const text = String(payload.text || '').slice(0, 5000);
      if (!text.trim()) return;

      const chatMsg = {
        msgId: uid(),
        type: payload.messageType || 'text',
        senderId: clientId,
        senderName: client.profile.displayName,
        senderAvatar: client.profile.avatar,
        senderColor: client.profile.avatarColor,
        text: text,
        audioData: payload.audioData || null,
        audioDuration: payload.duration || null,
        replyTo: payload.replyTo || null,
        timestamp: Date.now()
      };

      room.messages.push(chatMsg);
      if (room.messages.length > MAX_HISTORY) room.messages.shift();
      broadcastToRoom(room.id, 'chat-message', chatMsg);
      break;
    }

    case 'typing': {
      const client = clients.get(clientId);
      if (!client || !client.roomId) return;
      broadcastToRoom(client.roomId, 'user-typing', {
        clientId,
        displayName: client.profile.displayName,
        isTyping: !!payload.isTyping
      }, clientId); // exclude sender
      break;
    }

    case 'share-location': {
      const client = clients.get(clientId);
      if (!client || !client.roomId) return;
      const lat = parseFloat(payload.lat);
      const lng = parseFloat(payload.lng);
      if (isNaN(lat) || isNaN(lng)) {
        sendTo(ws, 'error', { code: 'INVALID_MESSAGE', message: 'Invalid coordinates.' });
        return;
      }
      const locMsg = {
        msgId: uid(),
        type: 'location',
        senderId: clientId,
        senderName: client.profile.displayName,
        senderAvatar: client.profile.avatar,
        senderColor: client.profile.avatarColor,
        lat, lng,
        accuracy: parseFloat(payload.accuracy) || 0,
        timestamp: Date.now()
      };
      const room = rooms.get(client.roomId);
      if (room) {
        room.messages.push(locMsg);
        if (room.messages.length > MAX_HISTORY) room.messages.shift();
      }
      broadcastToRoom(client.roomId, 'chat-message', locMsg);
      break;
    }

    case 'file-start': {
      const client = clients.get(clientId);
      if (!client || !client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room) return;
      if (payload.fileSize > MAX_FILE_SIZE) {
        sendTo(ws, 'error', { code: 'FILE_TOO_LARGE', message: 'File exceeds 10MB limit.' });
        return;
      }
      const fileId = payload.fileId || uid();
      room.fileBuffers = room.fileBuffers || new Map();
      room.fileBuffers.set(fileId, {
        senderId: clientId,
        senderName: client.profile.displayName,
        senderAvatar: client.profile.avatar,
        senderColor: client.profile.avatarColor,
        fileName: String(payload.fileName || 'file').slice(0, 200),
        fileSize: payload.fileSize,
        fileType: payload.fileType || 'application/octet-stream',
        totalChunks: payload.totalChunks,
        chunks: [],
        receivedChunks: 0,
        startedAt: Date.now()
      });
      broadcastToRoom(client.roomId, 'file-incoming', {
        fileId, fileName: payload.fileName, fileSize: payload.fileSize,
        fileType: payload.fileType, totalChunks: payload.totalChunks,
        senderId: clientId, senderName: client.profile.displayName,
        senderAvatar: client.profile.avatar, senderColor: client.profile.avatarColor
      });
      break;
    }

    case 'file-chunk': {
      const client = clients.get(clientId);
      if (!client || !client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || !room.fileBuffers) return;
      const buf = room.fileBuffers.get(payload.fileId);
      if (!buf) return;
      buf.chunks[payload.chunkIndex] = payload.data;
      buf.receivedChunks++;
      broadcastToRoom(client.roomId, 'file-chunk', {
        fileId: payload.fileId,
        chunkIndex: payload.chunkIndex,
        data: payload.data,
        progress: Math.round((buf.receivedChunks / buf.totalChunks) * 100)
      }, clientId); // exclude sender, they already have it
      break;
    }

    case 'file-end': {
      const client = clients.get(clientId);
      if (!client || !client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room || !room.fileBuffers) return;
      const buf = room.fileBuffers.get(payload.fileId);
      if (!buf) return;
      const fileMsg = {
        msgId: uid(), type: 'file',
        senderId: clientId, senderName: buf.senderName,
        senderAvatar: buf.senderAvatar, senderColor: buf.senderColor,
        fileName: buf.fileName, fileSize: buf.fileSize, fileType: buf.fileType,
        fileId: payload.fileId, timestamp: Date.now()
      };
      room.messages.push(fileMsg);
      if (room.messages.length > MAX_HISTORY) room.messages.shift();
      broadcastToRoom(client.roomId, 'file-complete', {
        fileId: payload.fileId, ...fileMsg
      });
      // Clean up buffer after 5 minutes
      setTimeout(() => { if (room.fileBuffers) room.fileBuffers.delete(payload.fileId); }, 300000);
      break;
    }

    case 'list-rooms': {
      sendTo(ws, 'rooms-list', { rooms: getRoomsList() });
      break;
    }

    case 'ping': {
      const client = clients.get(clientId);
      if (client) client.lastSeen = Date.now();
      sendTo(ws, 'pong', { serverTime: Date.now() });
      break;
    }

    case 'webrtc-offer':
    case 'webrtc-answer':
    case 'webrtc-ice': {
      const target = clients.get(payload.targetId);
      if (!target || target.ws.readyState !== 1) {
        sendTo(ws, 'error', { code: 'PEER_NOT_FOUND', message: 'User is not available.' });
        return;
      }
      const client = clients.get(clientId);
      const fwd = { ...payload, fromId: clientId, fromName: client?.profile?.displayName || 'Unknown' };
      delete fwd.targetId;
      sendTo(target.ws, type, fwd);
      break;
    }

    case 'webrtc-reject': {
      const target = clients.get(payload.targetId);
      if (target && target.ws.readyState === 1) {
        const client = clients.get(clientId);
        sendTo(target.ws, 'webrtc-rejected', {
          fromId: clientId,
          fromName: client?.profile?.displayName || 'Unknown'
        });
      }
      break;
    }

    case 'read-receipt': {
      const client = clients.get(clientId);
      if (!client || !client.roomId) return;
      broadcastToRoom(client.roomId, 'message-read', {
        readerId: clientId, readerName: client.profile.displayName,
        msgIds: payload.msgIds || []
      }, clientId);
      break;
    }

    default:
      log(`Unknown message type: ${type} from ${clientId}`);
  }
}

// ─── ROOM OPERATIONS ────────────────────────────
function joinRoom(clientId, ws, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Leave any current room first
  leaveRoom(clientId);

  room.clients.add(clientId);
  const client = clients.get(clientId);
  if (client) client.roomId = roomId;

  // Build member list
  const members = [];
  room.clients.forEach(cid => {
    const c = clients.get(cid);
    if (c) members.push({
      id: cid,
      displayName: c.profile.displayName,
      avatar: c.profile.avatar,
      avatarColor: c.profile.avatarColor,
      statusMessage: c.profile.statusMessage
    });
  });

  // Send room info + last 50 messages
  sendTo(ws, 'room-joined', {
    roomId, roomName: room.name, joinCode: room.joinCode,
    members, history: room.messages.slice(-50),
    hostId: room.hostId, memberCount: room.clients.size
  });

  // Notify other members
  broadcastToRoom(roomId, 'member-joined', {
    clientId,
    profile: client?.profile || {},
    memberCount: room.clients.size
  }, clientId);

  broadcastRoomsList();
  log(`${client?.profile?.displayName || clientId} joined "${room.name}" (${room.clients.size} members)`);
}

function leaveRoom(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;
  const room = rooms.get(client.roomId);
  if (room) {
    room.clients.delete(clientId);
    broadcastToRoom(room.id, 'member-left', {
      clientId,
      displayName: client.profile.displayName,
      memberCount: room.clients.size
    });
    log(`${client.profile.displayName} left "${room.name}" (${room.clients.size} members)`);
    if (room.clients.size === 0) {
      // Keep room alive for 5 min after last person leaves
      room._deleteTimer = setTimeout(() => {
        if (room.clients.size === 0) {
          rooms.delete(room.id);
          log(`Room "${room.name}" deleted (empty for 5 min)`);
          broadcastRoomsList();
          saveRooms();
        }
      }, 300000);
    }
    broadcastRoomsList();
  }
  client.roomId = null;
}

function handleDisconnect(clientId) {
  leaveRoom(clientId);
  clients.delete(clientId);
}

// ─── BROADCAST HELPERS ──────────────────────────
function sendTo(ws, type, payload) {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify({ type, payload, timestamp: Date.now(), msgId: uid() }));
    } catch (e) { /* connection gone */ }
  }
}

function broadcastToRoom(roomId, type, payload, excludeId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.clients.forEach(cid => {
    if (cid === excludeId) return;
    const c = clients.get(cid);
    if (c && c.ws.readyState === 1) sendTo(c.ws, type, payload);
  });
}

function broadcastRoomsList() {
  const list = getRoomsList();
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) sendTo(ws, 'rooms-updated', { rooms: list });
  });
}

function getRoomsList() {
  const list = [];
  rooms.forEach(r => {
    list.push({
      id: r.id, name: r.name, joinCode: r.joinCode,
      memberCount: r.clients.size, isPrivate: r.isPrivate,
      hostId: r.hostId, createdAt: r.createdAt
    });
  });
  return list;
}

// ─── STARTUP ────────────────────────────────────
loadRooms();

httpServer.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  const url = `http://${ip}:${PORT}`;
  const pad = ' '.repeat(Math.max(0, 37 - url.length));
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║                                       ║');
  console.log('  ║   🔗 Connect Server Running!          ║');
  console.log(`  ║   Local:   http://localhost:${PORT}      ║`);
  console.log(`  ║   Network: ${url}${pad}║`);
  console.log(`  ║   Port:    ${PORT}                        ║`);
  console.log('  ║                                       ║');
  console.log('  ║   Share the Network address with      ║');
  console.log('  ║   others on the same WiFi!            ║');
  console.log('  ║                                       ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');

  try {
    const qr = require('qrcode-terminal');
    qr.generate(url, { small: true }, (code) => {
      console.log('  Scan this QR code to connect:\n');
      console.log(code);
    });
  } catch (e) {
    log('Install qrcode-terminal for QR: npm install qrcode-terminal');
  }

  log(`Serving files from: ${CLIENT_DIR}`);
  log(`Max connections: ${MAX_CONNECTIONS}`);
  log(`Rate limit: ${MAX_MSG_PER_MIN} msg/min per client`);
  log('Waiting for connections...');
});

// ─── GRACEFUL SHUTDOWN ──────────────────────────
function shutdown() {
  log('Shutting down...');
  saveRooms();
  wss.clients.forEach(ws => {
    sendTo(ws, 'server-shutdown', { message: 'Server is shutting down' });
    ws.close(1001, 'Server shutdown');
  });
  clearInterval(heartbeat);
  httpServer.close(() => { log('Server closed cleanly'); process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  log('UNCAUGHT ERROR: ' + err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (err) => {
  log('UNHANDLED REJECTION: ' + err);
});
