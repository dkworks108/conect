/**
 * Connect — Profile Manager
 * Handles creation, editing, sharing, and device detection
 */
class ProfileManager {
  constructor(storage) {
    this.storage = storage;
    this.profile = null;
    this.avatarEmojis = ['😎','🚀','🦊','🐱','🦁','🐼','🦄','🐉','🎮','🎯','⚡','🔥','🌈','🍀','🌙','🌻','🛰️','🧠','🛡️','🎧','📡','💎','🪐','✨'];
    this.avatarColors = [
      '#00d4ff','#7b2fff','#ff6b35','#00ff88','#ff4488','#ffcc00',
      '#ff4444','#44aaff','#88ff44','#ff88ff','#44ffcc','#ffaa44',
      '#1e90ff','#0fb9b1','#f368e0','#576574'
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

  validate(data) {
    const displayName = String(data.displayName || '').trim();
    const statusMessage = String(data.statusMessage || '').trim();
    const avatar = data.avatar || '😎';
    const avatarColor = data.avatarColor || '#00d4ff';
    const errors = [];

    if (displayName.length < 2 || displayName.length > 20) {
      errors.push('Display name must be 2-20 characters.');
    }
    if (statusMessage.length > 100) {
      errors.push('Status message must be 100 characters or less.');
    }
    if (!this.avatarEmojis.includes(avatar)) {
      errors.push('Please choose a valid avatar.');
    }
    if (!this.avatarColors.includes(avatarColor)) {
      errors.push('Please choose a valid color.');
    }

    return {
      valid: errors.length === 0,
      errors,
      value: {
        displayName: displayName.slice(0, 20),
        avatar,
        avatarColor,
        statusMessage: statusMessage.slice(0, 100)
      }
    };
  }

  create(data) {
    const validated = this.validate(data);
    this.profile = {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
      displayName: validated.value.displayName || 'User',
      avatar: validated.value.avatar,
      avatarColor: validated.value.avatarColor,
      statusMessage: validated.value.statusMessage,
      status: 'online',
      createdAt: Date.now()
    };
    this.storage.saveProfile(this.profile);
    return this.profile;
  }

  update(fields) {
    if (!this.profile) this.load();
    if (!this.profile) return null;
    const next = { ...this.profile, ...fields };
    const validated = this.validate(next);
    this.profile.displayName = validated.value.displayName || this.profile.displayName;
    this.profile.avatar = validated.value.avatar;
    this.profile.avatarColor = validated.value.avatarColor;
    this.profile.statusMessage = validated.value.statusMessage;
    this.profile.updatedAt = Date.now();
    this.storage.saveProfile(this.profile);
    return this.profile;
  }

  createRandom() {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    return this.create({
      displayName: `User${suffix}`,
      avatar: this.avatarEmojis[Math.floor(Math.random() * this.avatarEmojis.length)],
      avatarColor: this.avatarColors[Math.floor(Math.random() * this.avatarColors.length)],
      statusMessage: ''
    });
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
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
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
