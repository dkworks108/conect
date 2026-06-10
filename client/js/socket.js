/**
 * Connect — WebSocket Client
 * Real connection with auto-reconnect, queue, heartbeat, latency tracking
 */
class SocketManager {
  constructor() {
    this.ws = null;
    this.serverUrl = null;
    this.httpUrl = null;
    this.clientId = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
    this.messageQueue = [];
    this.eventHandlers = {};
    this.profile = null;
    this.heartbeatInterval = null;
    this._reconnectTimer = null;
    this._lastRoomId = null;
    this.latency = 0;
    this._lastPingTime = 0;
    this.connectedAt = 0;
  }

  connect(serverUrl, profile) {
    return new Promise((resolve, reject) => {
      this.profile = profile;
      let url = serverUrl.trim().replace(/\/+$/, '');
      // Save HTTP URL for display
      if (!url.match(/^https?:\/\//) && !url.match(/^wss?:\/\//)) url = 'http://' + url;
      this.httpUrl = url.replace(/^ws/, 'http');
      // Convert to WS
      let wsUrl = url.replace(/^http/, 'ws');
      if (!wsUrl.match(/:\d+/)) wsUrl += ':3000';
      this.serverUrl = wsUrl;

      const timeout = setTimeout(() => {
        reject(new Error('Cannot reach server at ' + serverUrl + ' — Is the server running?'));
        if (this.ws) try { this.ws.close(); } catch(e) {}
      }, 10000);

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (e) {
        clearTimeout(timeout);
        reject(new Error('Invalid server address: ' + serverUrl));
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        this.connectedAt = Date.now();
        this.reconnectAttempts = 0;
        this._startHeartbeat();
        this._flushQueue();
        this.send('register', profile);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'registered') {
            clearTimeout(timeout);
            this.clientId = msg.payload.clientId;
            this._emit('connected', { clientId: this.clientId, serverUrl: this.serverUrl });
            resolve({ clientId: this.clientId });
          } else if (msg.type === 'pong') {
            this.latency = Date.now() - this._lastPingTime;
          } else if (msg.type === 'error' && !this.clientId) {
            clearTimeout(timeout);
            reject(new Error(msg.payload.message || 'Server error'));
            return;
          }
          this._handleMessage(msg);
        } catch (e) {
          console.error('[SOCKET] Parse error:', e);
        }
      };

      this.ws.onclose = (event) => {
        const wasConnected = this.connected;
        this.connected = false;
        this._stopHeartbeat();
        this._emit('disconnected', { code: event.code, wasConnected });
        if (wasConnected && event.code !== 1000) {
          this._attemptReconnect();
        }
      };

      this.ws.onerror = () => {
        if (!this.connected) {
          clearTimeout(timeout);
          reject(new Error('Cannot reach server at ' + serverUrl + ' — Is the server running?'));
        }
        this._emit('connection-error', { message: 'Connection error' });
      };
    });
  }

  disconnect() {
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this.reconnectAttempts = this.maxReconnectAttempts + 1;
    if (this.ws) try { this.ws.close(1000); } catch (e) {}
    this.connected = false;
    this.clientId = null;
    this.connectedAt = 0;
    this._emit('disconnected', { wasConnected: true, manual: true });
  }

  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._emit('reconnect-failed', { attempts: this.reconnectAttempts });
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
    this._emit('reconnecting', { attempt: this.reconnectAttempts, max: this.maxReconnectAttempts, delay });

    this._reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.httpUrl || this.serverUrl, this.profile);
        this._emit('reconnected', {});
        // Re-join last room
        if (this._lastRoomId) {
          this.send('join-room', { roomId: this._lastRoomId });
        }
      } catch (e) {
        this._attemptReconnect();
      }
    }, delay);
  }

  resetReconnect() {
    this.reconnectAttempts = 0;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
  }

  send(type, payload) {
    const msg = JSON.stringify({ type, payload });
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.messageQueue.push(msg);
    }
  }

  request(type, payload, responseType, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const handler = (data) => {
        if (resolved) return;
        resolved = true;
        this.off(responseType, handler);
        this.off('error', errHandler);
        clearTimeout(timer);
        resolve(data);
      };
      const errHandler = (data) => {
        if (resolved) return;
        resolved = true;
        this.off(responseType, handler);
        this.off('error', errHandler);
        clearTimeout(timer);
        reject(new Error(data.message || 'Request failed'));
      };
      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.off(responseType, handler);
        this.off('error', errHandler);
        reject(new Error('Request timed out'));
      }, timeoutMs);
      this.on(responseType, handler);
      this.on('error', errHandler);
      this.send(type, payload);
    });
  }

  on(eventType, callback) {
    if (!this.eventHandlers[eventType]) this.eventHandlers[eventType] = [];
    this.eventHandlers[eventType].push(callback);
    return () => this.off(eventType, callback);
  }

  off(eventType, callback) {
    if (this.eventHandlers[eventType]) {
      this.eventHandlers[eventType] = this.eventHandlers[eventType].filter(cb => cb !== callback);
    }
  }

  _handleMessage(msg) {
    const { type, payload } = msg;
    if (!type) return;
    this._emit(type, payload || {});
  }

  _emit(eventType, data) {
    const handlers = this.eventHandlers[eventType] || [];
    handlers.forEach(cb => { try { cb(data); } catch (e) { console.error('[SOCKET] Handler error:', e); } });
    const wild = this.eventHandlers['*'] || [];
    wild.forEach(cb => { try { cb(eventType, data); } catch (e) {} });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.connected) {
        this._lastPingTime = Date.now();
        this.send('ping', {});
      }
    }, 25000);
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
  }

  _flushQueue() {
    while (this.messageQueue.length > 0 && this.connected) {
      const msg = this.messageQueue.shift();
      try { this.ws.send(msg); } catch (e) { this.messageQueue.unshift(msg); break; }
    }
  }

  getStatus() {
    return {
      connected: this.connected,
      serverUrl: this.httpUrl || this.serverUrl,
      clientId: this.clientId,
      reconnectAttempts: this.reconnectAttempts,
      latency: this.latency,
      connectedFor: this.connectedAt ? Date.now() - this.connectedAt : 0
    };
  }

  setLastRoom(roomId) { this._lastRoomId = roomId; }
  getDisplayUrl() { return (this.httpUrl || this.serverUrl || '').replace(/^(wss?|https?):\/\//, ''); }
}

window.SocketManager = SocketManager;
