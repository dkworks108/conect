/**
 * Connect Server v2.0 — Production WebSocket + HTTP Server
 */
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode-terminal');

const CONFIG = {
  PORT_RANGE: [3000, 3010],
  MAX_CONNECTIONS: 200,
  MAX_ROOMS: 100,
  MAX_ROOM_MEMBERS: 100,
  MAX_MESSAGE_LENGTH: 5000,
  MAX_FILE_SIZE: 50 * 1024 * 1024,
  PING_INTERVAL: 25000,
  PONG_TIMEOUT: 10000,
  RATE_LIMIT_WINDOW: 60000,
  RATE_LIMIT_MAX: 60,
  MESSAGE_HISTORY_LIMIT: 100,
  ROOM_CLEANUP_INTERVAL: 300000,
  ROOM_EMPTY_TIMEOUT: 3600000,
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',
  DATA_DIR: path.join(__dirname, 'data'),
  ROOMS_FILE: path.join(__dirname, 'data', 'rooms.json'),
  STATE_FILE: path.join(__dirname, 'data', 'server.state.json'),
  LOG_DIR: path.join(__dirname, 'data', 'logs'),
  LOG_FILE: path.join(__dirname, 'data', 'logs', 'server.log')
};

const CLIENT_DIR = path.join(__dirname, '..', 'client');
const startTime = Date.now();
const PORT = Number.parseInt(process.argv[2], 10) || CONFIG.PORT_RANGE[0];

// ─── STATE ──────────────────────────────────────
const clients = new Map();
const rooms = new Map();
const rateLimiter = new Map();
const metrics = {
  connections: 0,
  roomsCreated: 0,
  messages: 0,
  files: 0,
  errors: 0,
  reconnects: 0,
  heartbeats: 0,
  bytesIn: 0,
  bytesOut: 0
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(CLIENT_DIR, { maxAge: '1h', etag: true }));

// ─── HELPERS ────────────────────────────────────
function uid(prefix = '') {
  return `${prefix}${crypto.randomBytes(8).toString('hex')}`;
}

function shortCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}

function ts() {
  return new Date().toISOString();
}

function ensureDataDirs() {
  [CONFIG.DATA_DIR, CONFIG.LOG_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function log(level, component, message, data = {}) {
  const entry = {
    timestamp: ts(),
    level,
    component,
    message,
    data,
    uptime: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    activeConnections: clients.size
  };
  const line = JSON.stringify(entry);
  console.log(line);
  try {
    fs.appendFileSync(CONFIG.LOG_FILE, line + '\n');
  } catch {
    // Best-effort logging only.
  }
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

function sanitizeText(input, maxLen = CONFIG.MAX_MESSAGE_LENGTH) {
  return String(input || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeName(input, maxLen = 50) {
  return sanitizeText(input, maxLen).replace(/[<>]/g, '');
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

function cleanupState() {
  const now = Date.now();
  rooms.forEach((room, roomId) => {
    const memberCount = room.clients ? room.clients.size : 0;
    if (memberCount === 0) {
      if (!room.emptySince) room.emptySince = now;
      if (now - room.emptySince >= CONFIG.ROOM_EMPTY_TIMEOUT) {
        rooms.delete(roomId);
        log('INFO', 'ROOMS', 'Deleted empty room', { roomId, name: room.name });
      }
    } else {
      room.emptySince = null;
    }

    if (Array.isArray(room.messages) && room.messages.length > CONFIG.MESSAGE_HISTORY_LIMIT) {
      room.messages = room.messages.slice(-CONFIG.MESSAGE_HISTORY_LIMIT);
    }

    if (room.fileBuffers instanceof Map) {
      for (const [fileId, buffer] of room.fileBuffers.entries()) {
        if (now - (buffer.startedAt || now) > 5 * 60 * 1000) {
          room.fileBuffers.delete(fileId);
        }
      }
    }
  });
  if (rateLimiter.size > 1000) {
    rateLimiter.clear();
  }
}

function getHostUrl(port) {
  const ip = getLocalIP();
  return `http://${ip}:${port}`;
}

function jsonResponse(res, status, payload) {
  res.status(status).json(payload);
}

// ─── PERSISTENCE ────────────────────────────────
function loadRooms() {
  try {
    const legacyFile = path.join(__dirname, 'rooms.json');
    const sourceFile = fs.existsSync(CONFIG.ROOMS_FILE) ? CONFIG.ROOMS_FILE : legacyFile;
    if (fs.existsSync(sourceFile)) {
      const raw = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw.rooms || [];
      list.forEach(r => {
        rooms.set(r.id, {
          ...r,
          clients: new Set(),
          fileBuffers: new Map(),
          members: new Map(),
          messages: Array.isArray(r.messages) ? r.messages.slice(-CONFIG.MESSAGE_HISTORY_LIMIT) : [],
          hostProfile: r.hostProfile || { displayName: 'Unknown', avatar: '😎', avatarColor: '#00d4ff' },
          lastActivityAt: r.lastActivityAt || r.createdAt || Date.now(),
          emptySince: r.emptySince || null
        });
      });
      metrics.roomsCreated = rooms.size;
      log('INFO', 'STORAGE', 'Loaded rooms from disk', { count: rooms.size, sourceFile });
      if (sourceFile === legacyFile && !fs.existsSync(CONFIG.ROOMS_FILE)) {
        saveRooms();
      }
    }
  } catch (e) {
    log('ERROR', 'STORAGE', 'Could not load rooms', { error: e.message });
  }
}

function saveRooms() {
  try {
    const arr = [];
    rooms.forEach(r => {
      arr.push({
        id: r.id,
        name: r.name,
        joinCode: r.joinCode,
        hostId: r.hostId,
        hostProfile: r.hostProfile || null,
        passwordHash: r.passwordHash || null,
        isPrivate: !!r.isPrivate,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt || Date.now(),
        lastActivityAt: r.lastActivityAt || Date.now(),
        emptySince: r.emptySince || null,
        mutedMembers: Array.from(r.mutedMembers || []),
        bannedMembers: Array.from(r.bannedMembers || []),
        pinnedMessages: Array.from(r.pinnedMessages || []),
        messages: (r.messages || []).slice(-CONFIG.MESSAGE_HISTORY_LIMIT)
      });
    });
    ensureDataDirs();
    fs.writeFileSync(CONFIG.ROOMS_FILE, JSON.stringify({ rooms: arr }, null, 2));
    fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify({
      savedAt: Date.now(),
      rooms: arr,
      roomCount: arr.length,
      activeConnections: clients.size,
      metrics
    }, null, 2));
  } catch (e) {
    log('ERROR', 'STORAGE', 'Could not save rooms', { error: e.message });
  }
}

// Auto-save every 30 seconds
setInterval(saveRooms, 30000);

setInterval(() => {
  cleanupState();
  saveRooms();
}, CONFIG.ROOM_CLEANUP_INTERVAL).unref();

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

function httpRequestLogger(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

app.use(httpRequestLogger);

app.get('/api/health', (req, res) => {
  jsonResponse(res, 200, {
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    connections: clients.size,
    rooms: rooms.size,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    timestamp: Date.now()
  });
});

app.get('/api/metrics', (req, res) => {
  jsonResponse(res, 200, {
    ...metrics,
    uptime: Math.floor(process.uptime()),
    connections: clients.size,
    rooms: rooms.size,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  });
});

app.get('/api/info', (req, res) => {
  jsonResponse(res, 200, {
    version: '2.0.0',
    rooms: getRoomsList(),
    totalConnections: clients.size,
    maxConnections: CONFIG.MAX_CONNECTIONS,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    serverTime: Date.now(),
    host: getHostUrl(currentPort || PORT)
  });
});

app.get('/api/rooms', (req, res) => {
  jsonResponse(res, 200, { rooms: getRoomsList() });
});

app.get('/api/admin/state', (req, res) => {
  jsonResponse(res, 200, {
    rooms: getRoomsList(),
    activeClients: clients.size,
    metrics
  });
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const safePath = path.resolve(path.join(CLIENT_DIR, req.path === '/' ? '/index.html' : req.path));
  if (!safePath.startsWith(path.resolve(CLIENT_DIR))) {
    return res.status(403).send('Forbidden');
  }
  if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    const ext = path.extname(safePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', cache);
    fs.createReadStream(safePath).pipe(res);
    return;
  }
  const indexPath = path.join(CLIENT_DIR, 'index.html');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(indexPath).pipe(res);
});

const httpServer = http.createServer(app);

// ─── WEBSOCKET SERVER ───────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Connection limit
  if (clients.size >= CONFIG.MAX_CONNECTIONS) {
    sendTo(ws, 'error', { code: 'SERVER_FULL', message: `Server is at capacity (${CONFIG.MAX_CONNECTIONS} devices). Try again later.` });
    ws.close();
    return;
  }

  const clientId = uid();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  log('INFO', 'WS', 'Client connected', { clientId, ip });

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
      if (rateLimit.count > CONFIG.RATE_LIMIT_MAX) {
        sendTo(ws, 'error', { code: 'RATE_LIMITED', message: 'Too many messages. Slow down.' });
        return;
      }

      const rawStr = raw.toString();
      if (rawStr.length > CONFIG.MAX_FILE_SIZE + 1024) {
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
    log('INFO', 'WS', 'Client disconnected', { clientId });
    handleDisconnect(clientId);
  });

  ws.on('error', (err) => {
    log('ERROR', 'WS', 'Client error', { clientId, error: err.message });
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
      log('INFO', 'AUTH', 'Client registered', { clientId, displayName: profile.displayName });
      break;
    }

    case 'create-room': {
      if (rooms.size >= CONFIG.MAX_ROOMS) {
        sendTo(ws, 'error', { code: 'SERVER_FULL', message: 'Server has reached the maximum number of rooms.' });
        break;
      }
      const client = clients.get(clientId);
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
        hostProfile: client?.profile || null,
        passwordHash,
        isPrivate: !!payload.isPrivate,
        clients: new Set(),
        messages: [],
        fileBuffers: new Map(),
        createdAt: Date.now()
      };
      rooms.set(roomId, room);
      log('INFO', 'ROOMS', 'Room created', { roomId, roomName: room.name, joinCode, hostId: clientId });
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
      if (room.clients.size >= CONFIG.MAX_ROOM_MEMBERS) {
        sendTo(ws, 'error', { code: 'ROOM_FULL', message: `This room is full (max ${CONFIG.MAX_ROOM_MEMBERS} members).` });
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

      const text = sanitizeText(payload.text);
      if (!text) return;

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
        audioMimeType: payload.mimeType || null,
        replyTo: payload.replyTo || null,
        timestamp: Date.now()
      };

      room.messages.push(chatMsg);
      if (room.messages.length > CONFIG.MESSAGE_HISTORY_LIMIT) room.messages.shift();
      broadcastToRoom(room.id, 'chat-message', chatMsg);
      metrics.messages++;
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
        if (room.messages.length > CONFIG.MESSAGE_HISTORY_LIMIT) room.messages.shift();
      }
      broadcastToRoom(client.roomId, 'chat-message', locMsg);
      metrics.messages++;
      break;
    }

    case 'file-start': {
      const client = clients.get(clientId);
      if (!client || !client.roomId) return;
      const room = rooms.get(client.roomId);
      if (!room) return;
      if (payload.fileSize > CONFIG.MAX_FILE_SIZE) {
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
      if (room.messages.length > CONFIG.MESSAGE_HISTORY_LIMIT) room.messages.shift();
      broadcastToRoom(client.roomId, 'file-complete', {
        fileId: payload.fileId, ...fileMsg
      });
      metrics.files++;
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
      log('WARN', 'WS', 'Unknown message type', { type, clientId });
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
  log('INFO', 'ROOMS', 'Client joined room', { clientId, roomId, roomName: room.name, memberCount: room.clients.size });
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
    log('INFO', 'ROOMS', 'Client left room', { clientId, roomId: room.id, roomName: room.name, memberCount: room.clients.size });
    if (room.clients.size === 0) {
      // Keep room alive for 5 min after last person leaves
      room._deleteTimer = setTimeout(() => {
        if (room.clients.size === 0) {
          rooms.delete(room.id);
          log('INFO', 'ROOMS', 'Room deleted after inactivity', { roomId: room.id, roomName: room.name });
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
      hostId: r.hostId,
      hostName: r.hostProfile?.displayName || 'Unknown',
      hostAvatar: r.hostProfile?.avatar || '😎',
      hostColor: r.hostProfile?.avatarColor || '#00d4ff',
      createdAt: r.createdAt
    });
  });
  return list;
}

// ─── STARTUP ────────────────────────────────────
loadRooms();

function printBanner(url) {
  const localUrl = `http://localhost:${currentPort}`;
  const pad = ' '.repeat(Math.max(0, 37 - url.length));
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║                                       ║');
  console.log('  ║   🔗 Connect Server Running!          ║');
  console.log(`  ║   Local:   ${localUrl}${' '.repeat(Math.max(0, 37 - localUrl.length))}║`);
  console.log(`  ║   Network: ${url}${pad}║`);
  console.log(`  ║   Port:    ${currentPort}${' '.repeat(Math.max(0, 37 - String(currentPort).length))}║`);
  console.log(`  ║   Clients: ${clients.size}${' '.repeat(Math.max(0, 37 - String(clients.size).length))}║`);
  console.log(`  ║   Rooms:   ${rooms.size}${' '.repeat(Math.max(0, 37 - String(rooms.size).length))}║`);
  console.log('  ║                                       ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  try {
    qrcode.generate(url, { small: true });
  } catch (e) {
    log('WARN', 'STARTUP', 'qrcode-terminal unavailable', { error: e.message });
  }
}

function startListening(port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      httpServer.off('error', onError);
      reject(err);
    };
    httpServer.once('error', onError);
    httpServer.listen(port, '0.0.0.0', () => {
      httpServer.off('error', onError);
      resolve(port);
    });
  });
}

(async () => {
  ensureDataDirs();
  for (let port = CONFIG.PORT_RANGE[0]; port <= CONFIG.PORT_RANGE[1]; port++) {
    try {
      currentPort = port;
      await startListening(port);
      const url = getHostUrl(currentPort);
      printBanner(url);
      log('INFO', 'STARTUP', 'Serving files', { directory: CLIENT_DIR });
      log('INFO', 'STARTUP', 'Max connections', { value: CONFIG.MAX_CONNECTIONS });
      log('INFO', 'STARTUP', 'Rate limit', { value: CONFIG.RATE_LIMIT_MAX, windowMs: CONFIG.RATE_LIMIT_WINDOW });
      log('INFO', 'STARTUP', 'Waiting for connections');
      return;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') {
        log('ERROR', 'STARTUP', 'Failed to start server', { port, error: err.message });
      }
    }
  }
  throw new Error(`No available port in range ${CONFIG.PORT_RANGE[0]}-${CONFIG.PORT_RANGE[1]}`);
})().catch((err) => {
  log('ERROR', 'STARTUP', 'Server start failed', { error: err.message });
  process.exit(1);
});

// ─── GRACEFUL SHUTDOWN ──────────────────────────
function shutdown() {
  log('INFO', 'SHUTDOWN', 'Shutting down');
  saveRooms();
  wss.clients.forEach(ws => {
    sendTo(ws, 'server-shutdown', { message: 'Server is shutting down' });
    ws.close(1001, 'Server shutdown');
  });
  clearInterval(heartbeat);
  httpServer.close(() => { log('INFO', 'SHUTDOWN', 'Server closed cleanly'); process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  log('ERROR', 'PROCESS', 'Uncaught exception', { error: err.message, stack: err.stack });
  console.error(err.stack);
});
process.on('unhandledRejection', (err) => {
  log('ERROR', 'PROCESS', 'Unhandled rejection', { error: String(err) });
});
