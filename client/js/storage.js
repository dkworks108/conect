/**
 * Connect — Storage System (IndexedDB + localStorage)
 * Handles messages, rooms, profile, settings, offline queue
 */
class StorageSystem {
  constructor() {
    this.dbName = 'ConnectDB';
    this.dbVersion = 2;
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
        tx.oncomplete = () => resolve(true);
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

  // ─── EXPORT / CLEAR ───────────────────────────
  async exportAllData() {
    const data = {
      profile: this.loadProfile(),
      settings: this.loadAllSettings(),
      serverUrl: this.loadServerUrl(),
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
}

window.StorageSystem = StorageSystem;
