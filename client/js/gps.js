/**
 * Connect — GPS + Canvas Map
 * Geolocation tracking, canvas map rendering with peer positions
 */
class GPSNavigation {
  constructor() {
    this.watchId = null;
    this.currentPosition = null;
    this.isTracking = false;
    this.peerLocations = new Map();
    this.scale = 5; // pixels per meter
    this.canvas = null;
    this.ctx = null;
    this.animFrame = null;
    this._listeners = {};
  }

  startTracking() {
    if (this.isTracking || !('geolocation' in navigator)) return false;
    this.isTracking = true;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        this.currentPosition = {
          lat: p.coords.latitude, lng: p.coords.longitude,
          accuracy: p.coords.accuracy, heading: p.coords.heading,
          timestamp: p.timestamp
        };
        this._emit('position', this.currentPosition);
      },
      (e) => this._emit('error', { message: e.message }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
    return true;
  }

  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
  }

  getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (this.currentPosition) { resolve(this.currentPosition); return; }
      if (!('geolocation' in navigator)) { reject(new Error('GPS not available on this device')); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => {
          this.currentPosition = {
            lat: p.coords.latitude, lng: p.coords.longitude,
            accuracy: p.coords.accuracy, timestamp: p.timestamp
          };
          resolve(this.currentPosition);
        },
        (e) => reject(new Error('Location access denied — enable in browser settings')),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  updatePeerLocation(clientId, data) {
    this.peerLocations.set(clientId, {
      ...data, updatedAt: Date.now()
    });
    // Remove stale positions (>5 min)
    this.peerLocations.forEach((v, k) => {
      if (Date.now() - v.updatedAt > 300000) this.peerLocations.delete(k);
    });
  }

  // ─── CANVAS MAP ───────────────────────────────
  initMap(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this._renderLoop();
  }

  destroyMap() {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
  }

  zoomIn() { this.scale = Math.min(this.scale * 1.5, 50); }
  zoomOut() { this.scale = Math.max(this.scale / 1.5, 0.5); }
  resetZoom() { this.scale = 5; }

  _renderLoop() {
    this._drawMap();
    this.animFrame = requestAnimationFrame(() => this._renderLoop());
  }

  _drawMap() {
    const c = this.canvas, ctx = this.ctx;
    if (!c || !ctx) return;
    const w = c.width = c.offsetWidth * (window.devicePixelRatio || 1);
    const h = c.height = c.offsetHeight * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    const dw = c.offsetWidth, dh = c.offsetHeight;
    const cx = dw / 2, cy = dh / 2;

    // Background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, dw, dh);

    // Grid
    const gridSize = 40;
    ctx.strokeStyle = 'rgba(0,212,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < dw; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, dh); ctx.stroke(); }
    for (let y = 0; y < dh; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(dw, y); ctx.stroke(); }

    if (!this.currentPosition) {
      ctx.fillStyle = '#6a6a9a';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for GPS signal...', cx, cy);
      ctx.fillText('Enable location access', cx, cy + 24);
      return;
    }

    const myLat = this.currentPosition.lat;
    const myLng = this.currentPosition.lng;

    // Accuracy circle
    const accPx = Math.min(this.currentPosition.accuracy * this.scale, dw / 2);
    ctx.beginPath();
    ctx.arc(cx, cy, accPx, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,212,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,212,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // My position (blue dot with pulse)
    const pulse = (Math.sin(Date.now() / 500) + 1) * 4 + 8;
    ctx.beginPath();
    ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,212,255,0.15)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#00d4ff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#00d4ff';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('You', cx, cy + 20);

    // Peer locations
    this.peerLocations.forEach((peer) => {
      const dx = (peer.lng - myLng) * 111000 * Math.cos(myLat * Math.PI / 180);
      const dy = -(peer.lat - myLat) * 111000; // negative because y increases downward
      const px = cx + dx * this.scale;
      const py = cy + dy * this.scale;

      if (px < -20 || px > dw + 20 || py < -20 || py > dh + 20) return;

      // Connection line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.strokeStyle = 'rgba(123,47,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Distance label
      const dist = this._calcDistance(myLat, myLng, peer.lat, peer.lng);
      const mdx = (cx + px) / 2, mdy = (cy + py) / 2;
      ctx.fillStyle = 'rgba(123,47,255,0.8)';
      ctx.font = '9px sans-serif';
      ctx.fillText(this.formatDistance(dist), mdx, mdy - 4);

      // Peer dot
      const color = peer.avatarColor || '#7b2fff';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Name label
      ctx.fillStyle = '#f0f0ff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(peer.displayName || '?', px, py + 16);
    });

    // Scale bar
    const scaleMeters = Math.round(100 / this.scale);
    const scaleWidth = scaleMeters * this.scale;
    ctx.strokeStyle = '#6a6a9a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, dh - 30);
    ctx.lineTo(20 + scaleWidth, dh - 30);
    ctx.stroke();
    ctx.fillStyle = '#6a6a9a';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this.formatDistance(scaleMeters), 20, dh - 16);

    // Compass
    ctx.fillStyle = '#6a6a9a';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', dw - 24, 24);
    ctx.beginPath();
    ctx.moveTo(dw - 24, 28);
    ctx.lineTo(dw - 28, 38);
    ctx.lineTo(dw - 20, 38);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,68,68,0.6)';
    ctx.fill();
  }

  _calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  formatDistance(m) {
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(1) + ' km';
  }

  static isSupported() { return 'geolocation' in navigator; }

  on(e, cb) { if (!this._listeners[e]) this._listeners[e] = []; this._listeners[e].push(cb); }
  _emit(e, d) { (this._listeners[e] || []).forEach(cb => { try { cb(d); } catch (er) {} }); }
}

window.GPSNavigation = GPSNavigation;
