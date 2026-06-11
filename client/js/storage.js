/**
 * Connect — Storage System (IndexedDB + localStorage)
 * Handles messages, rooms, profile, settings, offline queue
 */
class StorageSystem {
  constructor() {
    this.dbName = 'ConnectDB';
    this.dbVersion = 3;
    this.db = null;
    this._ready = this._initDB();
  }

  _initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('messages')) {
          const ms = db.createObjectStore('messages', { keyPath: 'msgId' });
          ms.createIndex('roomId', 'roomId', { unique: false });
          ms.createIndex('timestamp', 'timestamp', { unique: false });
          ms.createIndex('roomTimestamp', ['roomId', 'timestamp'], { unique: false });
        }
        if (!db.objectStoreNames.contains('rooms')) {
          db.createObjectStore('rooms', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'queueId', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'fileId' });
        }
        if (!db.objectStoreNames.contains('logs')) {
          const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          ls.createIndex('timestamp', 'timestamp', { unique: false });
          ls.createIndex('level', 'level', { unique: false });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = (e) => { console.error('[STORAGE] DB init error:', e.target.error); reject(e.target.error); };
    });
  }

  async _getDB() {
    if (this.db) return this.db;
    return this._ready;
  }

  // ─── PROFILE (localStorage) ───────────────────
  saveProfile(profile) {
    localStorage.setItem('connect_profile', JSON.stringify({ ...profile, updatedAt: Date.now() }));
  }

  loadProfile() {
    try { return JSON.parse(localStorage.getItem('connect_profile')); }
    catch (e) { return null; }
  }

  isFirstRun() {
    return !localStorage.getItem('connect_profile');
  }

  // ─── SETTINGS (localStorage) ──────────────────
  saveSetting(key, value) {
    localStorage.setItem('connect_' + key, JSON.stringify(value));
  }

  loadSetting(key, defaultVal = null) {
    try {
      const v = localStorage.getItem('connect_' + key);
      return v !== null ? JSON.parse(v) : defaultVal;
    } catch (e) { return defaultVal; }
  }

  saveAllSettings(settings) {
    Object.entries(settings).forEach(([k, v]) => this.saveSetting(k, v));
  }

  loadAllSettings() {
    return {
      theme: this.loadSetting('theme', 'dark'),
      accent: this.loadSetting('accent', 'cyan'),
      fontSize: this.loadSetting('fontSize', 'medium'),
      sounds: this.loadSetting('sounds', true),
      vibration: this.loadSetting('vibration', true),
      notifications: this.loadSetting('notifications', false)
    };
  }

  // ─── SERVER URL ───────────────────────────────
  saveServerUrl(url) { localStorage.setItem('connect_server', url); }
  loadServerUrl() { return localStorage.getItem('connect_server'); }
  clearServerUrl() { localStorage.removeItem('connect_server'); }

  // ─── LAST ROOM ────────────────────────────────
  saveLastRoom(roomId) { localStorage.setItem('connect_lastRoom', roomId); }
  loadLastRoom() { return localStorage.getItem('connect_lastRoom'); }
  clearLastRoom() { localStorage.removeItem('connect_lastRoom'); }

  // ─── RECENT EMOJIS ───────────────────────────
  getRecentEmojis() {
    try { return JSON.parse(localStorage.getItem('connect_recentEmojis') || '[]'); }
    catch (e) { return []; }
  }
  addRecentEmoji(emoji) {
    let recent = this.getRecentEmojis().filter(e => e !== emoji);
    recent.unshift(emoji);
    recent = recent.slice(0, 16);
    localStorage.setItem('connect_recentEmojis', JSON.stringify(recent));
  }

  // ─── MESSAGES (IndexedDB) ────────────────────
  async saveMessage(roomId, msg) {
    try {
      const db = await this._getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        tx.objectStore('messages').put({ ...msg, roomId, storedAt: Date.now() });
        tx.oncomplete = () => {
          resolve(true);
          this.trimMessages(roomId, 500).catch(e => console.error('[STORAGE] Prune error:', e));
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.error('[STORAGE] saveMessage error:', e);
      return false;
    }
  }

  async saveMessages(roomId, msgs) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        msgs.forEach(m => store.put({ ...m, roomId, storedAt: Date.now() }));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  async loadMessages(roomId, limit = 100) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const idx = store.index('roomId');
        const msgs = [];
        const req = idx.openCursor(IDBKeyRange.only(roomId), 'prev');
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && msgs.length < limit) {
            msgs.push(cursor.value);
            cursor.continue();
          } else {
            resolve(msgs.reverse());
          }
        };
        req.onerror = () => resolve([]);
      });
    } catch (e) { return []; }
  }

  async loadAllMessages() {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('messages', 'readonly');
        const req = tx.objectStore('messages').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch (e) { return []; }
  }

  async getMessageById(msgId) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('messages', 'readonly');
        const req = tx.objectStore('messages').get(msgId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  async searchMessages(query) {
    if (!query) return [];
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('messages', 'readonly');
        const req = tx.objectStore('messages').getAll();
        req.onsuccess = () => {
          const msgs = req.result || [];
          const q = query.toLowerCase();
          const results = msgs.filter(m => {
            return (m.text && m.text.toLowerCase().includes(q)) ||
                   (m.senderName && m.senderName.toLowerCase().includes(q)) ||
                   (m.fileName && m.fileName.toLowerCase().includes(q));
          });
          resolve(results.sort((a, b) => b.timestamp - a.timestamp));
        };
        req.onerror = () => resolve([]);
      });
    } catch (e) { return []; }
  }

  async clearMessages(roomId) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('messages', 'readwrite');
        const idx = tx.objectStore('messages').index('roomId');
        const req = idx.openCursor(IDBKeyRange.only(roomId));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
          else resolve(true);
        };
        req.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  async trimMessages(roomId, maxCount = 500) {
    try {
      const msgs = await this.loadMessages(roomId, maxCount + 200);
      if (msgs.length <= maxCount) return;
      const toDelete = msgs.slice(0, msgs.length - maxCount);
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        toDelete.forEach(m => store.delete(m.msgId));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  // ─── OFFLINE QUEUE ────────────────────────────
  async queueOfflineMessage(msg) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offlineQueue', 'readwrite');
        tx.objectStore('offlineQueue').add({ ...msg, queuedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  async getOfflineQueue() {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offlineQueue', 'readonly');
        const req = tx.objectStore('offlineQueue').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch (e) { return []; }
  }

  async clearOfflineQueue() {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('offlineQueue', 'readwrite');
        tx.objectStore('offlineQueue').clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  // ─── FILE STORAGE ─────────────────────────────
  async saveFile(fileId, data) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put({ fileId, data, savedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  async loadFile(fileId) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('files', 'readonly');
        const req = tx.objectStore('files').get(fileId);
        req.onsuccess = () => resolve(req.result?.data || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  // ─── ROOMS (IndexedDB) ────────────────────────
  async saveRoom(room) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('rooms', 'readwrite');
        tx.objectStore('rooms').put({ ...room, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  async loadRoom(roomId) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('rooms', 'readonly');
        const req = tx.objectStore('rooms').get(roomId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  async loadRooms() {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('rooms', 'readonly');
        const req = tx.objectStore('rooms').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch (e) { return []; }
  }

  async deleteRoom(roomId) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('rooms', 'readwrite');
        tx.objectStore('rooms').delete(roomId);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  // ─── LOGS ──────────────────────────────────────
  async saveLog(entry) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('logs', 'readwrite');
        tx.objectStore('logs').add({ ...entry, timestamp: entry.timestamp || Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { return false; }
  }

  async loadLogs(limit = 100) {
    try {
      const db = await this._getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('logs', 'readonly');
        const store = tx.objectStore('logs');
        const idx = store.index('timestamp');
        const logs = [];
        const req = idx.openCursor(null, 'prev');
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && logs.length < limit) {
            logs.push(cursor.value);
            cursor.continue();
          } else {
            resolve(logs);
          }
        };
        req.onerror = () => resolve([]);
      });
    } catch (e) { return []; }
  }

  // ─── EXPORT / CLEAR ───────────────────────────
  async exportAllData() {
    const data = {
      profile: this.loadProfile(),
      settings: this.loadAllSettings(),
      serverUrl: this.loadServerUrl(),
      recentEmojis: this.getRecentEmojis(),
      rooms: await this.loadRooms(),
      messages: await this.loadAllMessages(),
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `connect-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async clearAllData() {
    // Clear localStorage
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('connect_')) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    // Clear IndexedDB
    try {
      const db = await this._getDB();
      const storeNames = Array.from(db.objectStoreNames);
      const tx = db.transaction(storeNames, 'readwrite');
      storeNames.forEach(name => tx.objectStore(name).clear());
    } catch (e) { /* ignore */ }
  }

  async estimateUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        return {
          usage: estimate.usage || 0,
          quota: estimate.quota || 0,
          percentUsed: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0
        };
      } catch (e) {
        return { usage: 0, quota: 0, percentUsed: 0 };
      }
    }
    return { usage: 0, quota: 0, percentUsed: 0 };
  }
}

window.StorageSystem = StorageSystem;
