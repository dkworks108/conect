/**
 * Connect — Profile Manager
 * Handles creation, editing, sharing, and device detection
 */
class ProfileManager {
  constructor(storage) {
    this.storage = storage;
    this.profile = null;
    this.avatarEmojis = ['😎','🚀','🦊','🐱','🦁','🐼','🦄','🐉','🎮','🎯','⚡','🔥'];
    this.avatarColors = [
      '#00d4ff','#7b2fff','#ff6b35','#00ff88','#ff4488','#ffcc00',
      '#ff4444','#44aaff','#88ff44','#ff88ff','#44ffcc','#ffaa44'
    ];
  }

  load() {
    this.profile = this.storage.loadProfile();
    return this.profile;
  }

  exists() {
    return this.storage.loadProfile() !== null;
  }

  get() {
    if (!this.profile) this.load();
    return this.profile;
  }

  create(data) {
    this.profile = {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
      displayName: String(data.displayName || 'User').trim().slice(0, 20),
      avatar: data.avatar || '😎',
      avatarColor: data.avatarColor || '#00d4ff',
      statusMessage: String(data.statusMessage || '').trim().slice(0, 100),
      status: 'online',
      createdAt: Date.now()
    };
    this.storage.saveProfile(this.profile);
    return this.profile;
  }

  update(fields) {
    if (!this.profile) this.load();
    if (!this.profile) return null;
    if (fields.displayName !== undefined) this.profile.displayName = String(fields.displayName).trim().slice(0, 20);
    if (fields.avatar !== undefined) this.profile.avatar = fields.avatar;
    if (fields.avatarColor !== undefined) this.profile.avatarColor = fields.avatarColor;
    if (fields.statusMessage !== undefined) this.profile.statusMessage = String(fields.statusMessage).trim().slice(0, 100);
    this.profile.updatedAt = Date.now();
    this.storage.saveProfile(this.profile);
    return this.profile;
  }

  getShareable() {
    const p = this.get();
    if (!p) return {};
    return {
      displayName: p.displayName,
      avatar: p.avatar,
      avatarColor: p.avatarColor,
      statusMessage: p.statusMessage
    };
  }

  getDeviceInfo() {
    const ua = navigator.userAgent;
    let device = 'Unknown', os = 'Unknown', browser = 'Unknown';
    // OS
    if (/iPhone/.test(ua)) { device = 'iPhone'; os = 'iOS'; }
    else if (/iPad/.test(ua)) { device = 'iPad'; os = 'iOS'; }
    else if (/Android/.test(ua)) { device = 'Android'; os = 'Android'; }
    else if (/Mac OS/.test(ua)) { device = 'Mac'; os = 'macOS'; }
    else if (/Windows/.test(ua)) { device = 'PC'; os = 'Windows'; }
    else if (/Linux/.test(ua)) { device = 'Linux'; os = 'Linux'; }
    else if (/CrOS/.test(ua)) { device = 'Chromebook'; os = 'ChromeOS'; }
    // Browser
    if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/OPR\//.test(ua)) browser = 'Opera';
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    return { device, os, browser };
  }
}

window.ProfileManager = ProfileManager;
