/**
 * Connect — Chat System
 * Real-time messaging, file sharing, voice messages, typing indicators
 * All messages persisted to IndexedDB
 */
class ChatSystem {
  constructor(socketManager, storageSystem) {
    this.socket = socketManager;
    this.storage = storageSystem;
    this.currentRoomId = null;
    this.currentRoomName = null;
    this.joinCode = null;
    this.members = new Map();
    this.messages = [];
    this.typingUsers = new Map();
    this.typingTimeout = null;
    this.replyingTo = null;
    this.peerLocations = new Map();
    this._listeners = {};
    this._fileChunks = new Map();
    this._setupSocketHandlers();
  }

  _setupSocketHandlers() {
    this.socket.on('chat-message', (payload) => {
      if (payload.senderId === this.socket.clientId) {
        // Our own message echoed back — confirm delivery
        const pending = this.messages.find(m =>
          m.status === 'sending' && m.text === payload.text &&
          Math.abs(m.timestamp - payload.timestamp) < 15000
        );
        if (pending) {
          pending.msgId = payload.msgId;
          pending.status = 'sent';
          pending.timestamp = payload.timestamp;
          // Update in IndexedDB
          this.storage.saveMessage(this.currentRoomId, { ...pending, status: 'sent' });
          this._emit('message-status-update', pending);
          // Mark as delivered if others in room
          if (this.members.size > 1) {
            setTimeout(() => {
              pending.status = 'delivered';
              this._emit('message-status-update', pending);
            }, 1500);
          }
        }
        return;
      }

      // Message from someone else
      // Deduplicate (may have loaded from history)
      if (this.messages.find(m => m.msgId === payload.msgId)) return;

      const msg = { ...payload, status: 'received' };
      this.messages.push(msg);
      this.storage.saveMessage(this.currentRoomId, msg);
      this._emit('new-message', msg);

      // Send read receipt if we're viewing the chat
      if (document.visibilityState === 'visible') {
        this.socket.send('read-receipt', { msgIds: [payload.msgId] });
      }
    });

    this.socket.on('user-typing', (payload) => {
      if (payload.clientId === this.socket.clientId) return;
      if (payload.isTyping) {
        const existing = this.typingUsers.get(payload.clientId);
        if (existing && existing.timeout) clearTimeout(existing.timeout);
        const timeout = setTimeout(() => {
          this.typingUsers.delete(payload.clientId);
          this._emit('typing-changed');
        }, 4000);
        this.typingUsers.set(payload.clientId, { name: payload.displayName, timeout });
      } else {
        const existing = this.typingUsers.get(payload.clientId);
        if (existing && existing.timeout) clearTimeout(existing.timeout);
        this.typingUsers.delete(payload.clientId);
      }
      this._emit('typing-changed');
    });

    this.socket.on('member-joined', (payload) => {
      if (payload.clientId === this.socket.clientId) return;
      const p = payload.profile || {};
      this.members.set(payload.clientId, {
        id: payload.clientId,
        displayName: p.displayName || 'Someone',
        avatar: p.avatar || '😎',
        avatarColor: p.avatarColor || '#7b2fff',
        statusMessage: p.statusMessage || ''
      });
      const sysMsg = {
        msgId: 'sys_' + Date.now() + '_' + payload.clientId.slice(0, 4),
        type: 'system', text: '🟢 ' + (p.displayName || 'Someone') + ' joined the room',
        timestamp: Date.now()
      };
      this.messages.push(sysMsg);
      this._emit('new-message', sysMsg);
      this._emit('members-changed', { count: this.members.size });
    });

    this.socket.on('member-left', (payload) => {
      this.members.delete(payload.clientId);
      this.typingUsers.delete(payload.clientId);
      this.peerLocations.delete(payload.clientId);
      const sysMsg = {
        msgId: 'sys_' + Date.now() + '_left',
        type: 'system', text: '🔴 ' + (payload.displayName || 'Someone') + ' left the room',
        timestamp: Date.now()
      };
      this.messages.push(sysMsg);
      this._emit('new-message', sysMsg);
      this._emit('members-changed', { count: this.members.size });
    });

    this.socket.on('room-joined', async (payload) => {
      this.currentRoomId = payload.roomId;
      this.currentRoomName = payload.roomName;
      this.joinCode = payload.joinCode;
      this.socket.setLastRoom(payload.roomId);

      this.members.clear();
      (payload.members || []).forEach(m => this.members.set(m.id, m));

      // Load local messages first
      const localMsgs = await this.storage.loadMessages(payload.roomId, 100);

      // Server history
      const serverMsgs = (payload.history || []).map(m => ({ ...m, status: 'received' }));

      // Merge: deduplicate by msgId, prefer server version
      const allMap = new Map();
      localMsgs.forEach(m => { if (m.msgId) allMap.set(m.msgId, m); });
      serverMsgs.forEach(m => { if (m.msgId) allMap.set(m.msgId, m); });
      this.messages = Array.from(allMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      // Persist server messages to local DB
      if (serverMsgs.length > 0) {
        this.storage.saveMessages(payload.roomId, serverMsgs);
      }

      this._emit('room-ready', {
        roomId: payload.roomId,
        roomName: payload.roomName,
        joinCode: payload.joinCode,
        memberCount: payload.memberCount || this.members.size
      });
    });

    this.socket.on('message-read', (payload) => {
      if (!payload.msgIds) return;
      payload.msgIds.forEach(id => {
        const msg = this.messages.find(m => m.msgId === id && m.senderId === this.socket.clientId);
        if (msg) { msg.status = 'read'; this._emit('message-status-update', msg); }
      });
    });

    this.socket.on('server-shutdown', () => {
      this._emit('server-shutdown');
      this.currentRoomId = null;
      this.currentRoomName = null;
      this.members.clear();
      this.typingUsers.clear();
    });

    // ─── FILE EVENTS ────────────────────────────
    this.socket.on('file-incoming', (payload) => {
      this._fileChunks.set(payload.fileId, {
        ...payload, chunks: [], receivedCount: 0
      });
      this._emit('file-incoming', payload);
    });

    this.socket.on('file-chunk', (payload) => {
      const buf = this._fileChunks.get(payload.fileId);
      if (!buf) return;
      buf.chunks[payload.chunkIndex] = payload.data;
      buf.receivedCount++;
      this._emit('file-progress', {
        fileId: payload.fileId,
        progress: payload.progress || Math.round((buf.receivedCount / buf.totalChunks) * 100)
      });
    });

    this.socket.on('file-complete', (payload) => {
      const buf = this._fileChunks.get(payload.fileId);
      const fileMsg = { ...payload, status: 'received' };
      this.messages.push(fileMsg);
      this.storage.saveMessage(this.currentRoomId, fileMsg);

      // Reassemble file data if we have chunks
      if (buf && buf.chunks.length > 0) {
        const fullData = buf.chunks.join('');
        this.storage.saveFile(payload.fileId, fullData);
        fileMsg._localData = fullData;
      }
      this._fileChunks.delete(payload.fileId);
      this._emit('new-message', fileMsg);
    });
  }

  // ─── ROOM OPERATIONS ─────────────────────────
  async createRoom(roomName, isPrivate = false, password = null) {
    try {
      const result = await this.socket.request('create-room', { roomName, isPrivate, password }, 'room-created', 10000);
      return { success: true, ...result };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async joinRoom(roomId, password = null) {
    return new Promise((resolve) => {
      let resolved = false;
      const handler = (data) => { if (resolved) return; resolved = true; this.socket.off('room-joined', handler); this.socket.off('error', errH); resolve({ success: true, ...data }); };
      const errH = (data) => { if (resolved) return; resolved = true; this.socket.off('room-joined', handler); this.socket.off('error', errH); resolve({ success: false, error: data.message }); };
      this.socket.on('room-joined', handler);
      this.socket.on('error', errH);
      this.socket.send('join-room', { roomId, password });
      setTimeout(() => { if (!resolved) { resolved = true; this.socket.off('room-joined', handler); this.socket.off('error', errH); resolve({ success: false, error: 'Timed out joining room' }); } }, 10000);
    });
  }

  leaveRoom() {
    if (!this.currentRoomId) return;
    this.socket.send('leave-room', { roomId: this.currentRoomId });
    this.socket.setLastRoom(null);
    this.storage.clearLastRoom();
    this.currentRoomId = null;
    this.currentRoomName = null;
    this.joinCode = null;
    this.members.clear();
    this.messages = [];
    this.typingUsers.clear();
    this.peerLocations.clear();
    this._fileChunks.clear();
    this._emit('room-left');
  }

  // ─── SEND TEXT ────────────────────────────────
  sendText(text, replyToId = null) {
    if (!text.trim() || !this.currentRoomId) return null;
    const profile = this.socket.profile || {};
    const optimistic = {
      msgId: 'pending_' + Date.now(),
      type: 'text',
      senderId: this.socket.clientId,
      senderName: profile.displayName || 'You',
      senderAvatar: profile.avatar || '😎',
      senderColor: profile.avatarColor || '#00d4ff',
      text: text.trim().slice(0, 5000),
      replyTo: replyToId,
      timestamp: Date.now(),
      status: 'sending'
    };
    this.messages.push(optimistic);
    this._emit('new-message', optimistic);
    this.socket.send('chat-message', {
      roomId: this.currentRoomId,
      text: text.trim().slice(0, 5000),
      replyTo: replyToId
    });
    return optimistic;
  }

  // ─── SEND FILE ────────────────────────────────
  async sendFile(file) {
    if (!file || !this.currentRoomId) return;
    if (file.size > 10 * 1024 * 1024) {
      this._emit('error', { message: 'File exceeds 10MB limit' });
      return;
    }
    const fileId = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const CHUNK_SIZE = 32768; // 32KB

    // If image, compress first
    let fileData;
    if (file.type.startsWith('image/') && file.size > 512000) {
      fileData = await this._compressImage(file);
    } else {
      fileData = await this._readFileAsBase64(file);
    }

    const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);

    // Show optimistic preview
    const preview = {
      msgId: 'sending_' + fileId, type: 'file',
      senderId: this.socket.clientId,
      senderName: (this.socket.profile || {}).displayName || 'You',
      senderAvatar: (this.socket.profile || {}).avatar || '😎',
      senderColor: (this.socket.profile || {}).avatarColor || '#00d4ff',
      fileName: file.name, fileSize: file.size, fileType: file.type,
      fileId, status: 'uploading', progress: 0, timestamp: Date.now()
    };
    this.messages.push(preview);
    this._emit('new-message', preview);

    // Send start
    this.socket.send('file-start', {
      fileId, fileName: file.name, fileSize: file.size,
      fileType: file.type, totalChunks, roomId: this.currentRoomId
    });

    // Send chunks with delay
    for (let i = 0; i < totalChunks; i++) {
      const chunk = fileData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      this.socket.send('file-chunk', { fileId, chunkIndex: i, data: chunk });
      preview.progress = Math.round(((i + 1) / totalChunks) * 100);
      this._emit('file-progress', { fileId, progress: preview.progress });
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 50));
    }

    // Send end
    this.socket.send('file-end', { fileId, roomId: this.currentRoomId });
    preview.status = 'sent';
    preview._localData = fileData;
    this.storage.saveFile(fileId, fileData);
    this._emit('message-status-update', preview);
  }

  _readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  _compressImage(file, maxDim = 1920, quality = 0.8) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl.split(',')[1]);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        // Fall back to raw read
        this._readFileAsBase64(file).then(resolve);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // ─── SEND VOICE MESSAGE ──────────────────────
  sendVoiceMessage(audioBlob, duration) {
    if (!this.currentRoomId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      const profile = this.socket.profile || {};
      const optimistic = {
        msgId: 'voice_' + Date.now(),
        type: 'voice',
        senderId: this.socket.clientId,
        senderName: profile.displayName || 'You',
        senderAvatar: profile.avatar || '😎',
        senderColor: profile.avatarColor || '#00d4ff',
        text: '🎤 Voice message',
        audioData: base64,
        audioDuration: duration,
        timestamp: Date.now(),
        status: 'sending'
      };
      this.messages.push(optimistic);
      this._emit('new-message', optimistic);
      this.socket.send('chat-message', {
        roomId: this.currentRoomId,
        messageType: 'voice',
        text: '🎤 Voice message',
        audioData: base64,
        duration
      });
    };
    reader.readAsDataURL(audioBlob);
  }

  // ─── LOCATION ─────────────────────────────────
  shareLocation(lat, lng, accuracy) {
    if (!this.currentRoomId) return;
    this.socket.send('share-location', { roomId: this.currentRoomId, lat, lng, accuracy });
  }

  // ─── TYPING ───────────────────────────────────
  sendTyping() {
    if (!this.currentRoomId) return;
    this.socket.send('typing', { roomId: this.currentRoomId, isTyping: true });
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.socket.send('typing', { roomId: this.currentRoomId, isTyping: false });
    }, 3000);
  }

  // ─── QUERY ────────────────────────────────────
  async getRooms() {
    try {
      const result = await this.socket.request('list-rooms', {}, 'rooms-list', 5000);
      return result.rooms || [];
    } catch (e) { return []; }
  }

  getMembers() { return Array.from(this.members.values()); }

  getTypingString() {
    const names = Array.from(this.typingUsers.values()).map(u => u.name);
    if (names.length === 0) return '';
    if (names.length === 1) return names[0] + ' is typing...';
    if (names.length === 2) return names.join(' and ') + ' are typing...';
    return names.length + ' people are typing...';
  }

  search(query) {
    if (!query.trim()) return this.messages;
    const q = query.toLowerCase();
    return this.messages.filter(m => m.text && m.text.toLowerCase().includes(q));
  }

  // ─── EVENT EMITTER ────────────────────────────
  on(event, cb) { if (!this._listeners[event]) this._listeners[event] = []; this._listeners[event].push(cb); }
  off(event, cb) { if (this._listeners[event]) this._listeners[event] = this._listeners[event].filter(c => c !== cb); }
  _emit(event, data) { (this._listeners[event] || []).forEach(cb => { try { cb(data); } catch (e) {} }); }

  // ─── FORMAT HELPERS ───────────────────────────
  static formatTime(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  static formatDate(t) {
    const d = new Date(t), today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const y = new Date(today - 86400000);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString();
  }
  static formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
}

window.ChatSystem = ChatSystem;
