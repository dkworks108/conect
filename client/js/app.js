/**
 * Connect — Main Application Controller
 * Handles UI logic, connects subsystems, and manages state
 */
class ConnectApp {
  constructor() {
    this.storage = new StorageSystem();
    this.profile = new ProfileManager(this.storage);
    this.socket = new SocketManager();
    this.chat = new ChatSystem(this.socket, this.storage);
    this.webrtc = new WebRTCManager(this.socket);
    this.audio = new AudioSystem();
    this.gps = new GPSNavigation();
    this.settings = {};
    this.emojiCategories = {
      Smileys: ['😀','😂','🥰','😎','😭','😡','🤔','😴','🤮','🤯','😏','🤣','😇','🥳','😱'],
      Gestures: ['👍','👎','👋','🙏','💪','🤝','✅','❌','👏','🙌'],
      Objects: ['🔥','🎉','🚀','🌟','⚡','💥','🎯','🏆','💎','🔑','🎮','📱','💻','🎧'],
      Animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐒'],
      Food: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥'],
      Travel: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🛴','🚲']
    };
    
    // UI Elements map
    this.pages = {};
    this.navItems = {};

    window.addEventListener('DOMContentLoaded', () => this._init());
    window.addEventListener('beforeunload', () => this._destroy());
  }

  async _init() {
    // 1. Load and apply settings
    this.settings = this.storage.loadAllSettings();
    this._applySettings();

    // Cache common DOM elements
    document.querySelectorAll('.page').forEach(p => this.pages[p.id] = p);
    document.querySelectorAll('.nav-item').forEach(n => this.navItems[n.dataset.target] = n);

    // 2. Setup event listeners
    this._setupDOMEvents();
    this._setupSystemEvents();

    // 3. Check for deep links (room sharing)
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('join');
    if (joinCode) this.storage.saveLastRoom(joinCode);

    // 4. Initial Routing
    if (this.profile.exists()) {
      const serverUrl = this.storage.loadServerUrl() || window.location.host;
      this._navigateTo('home');
      await this._connect(serverUrl);
      const targetRoom = joinCode || this.storage.loadLastRoom();
      if (targetRoom) {
        this.chat.joinRoom(targetRoom);
      }
    } else {
      this._navigateTo('setup');
    }

    // 5. Offline caching check
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'OFFLINE_STATE') {
          this._showToast('📴 Offline — Showing cached messages', 'warning');
        }
      });
    }

    this._roomsRefreshTimer = setInterval(() => {
      if (this.pages.home && this.pages.home.classList.contains('active')) {
        this._refreshRooms();
      }
    }, 5000);
  }

  _applySettings() {
    document.documentElement.dataset.theme = this.settings.theme;
    document.documentElement.style.setProperty('--primary', this.settings.accent === 'cyan' ? '#00d4ff' : (this.settings.accent === 'purple' ? '#7b2fff' : '#ff6b35'));
    document.body.style.fontSize = this.settings.fontSize === 'small' ? '14px' : (this.settings.fontSize === 'large' ? '18px' : '16px');
    this.audio.soundEnabled = this.settings.sounds;
    this.audio.vibrationEnabled = this.settings.vibration;
  }

  _setupDOMEvents() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        if (target === 'chat' && !this.chat.currentRoomId) {
          this._showToast('Join a room first', 'info');
          return;
        }
        this._navigateTo(target);
      });
    });

    // Setup / Edit Profile
    const setupForm = document.getElementById('setup-form');
    if (setupForm) {
      setupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const mode = document.getElementById('setup-mode')?.value || 'create';
        const data = {
          displayName: document.getElementById('setup-name').value,
          statusMessage: document.getElementById('setup-status').value,
          avatar: document.querySelector('.avatar-option.selected')?.textContent || '😎',
          avatarColor: document.querySelector('.color-option.selected')?.dataset.color || '#00d4ff'
        };
        const validation = this.profile.validate(data);
        if (!validation.valid) {
          this._showToast(validation.errors[0] || 'Invalid profile', 'error');
          return;
        }
        
        if (mode === 'create') {
          this.profile.create(validation.value);
          const serverUrl = document.getElementById('setup-server')?.value || window.location.host;
          this.storage.saveServerUrl(serverUrl);
          this._connect(serverUrl);
          this._navigateTo('home');
        } else {
          this.profile.update(validation.value);
          this._renderProfile();
          this._navigateTo('profile');
          this._showToast('Profile updated', 'success');
        }
      });
    }

    // Connect Screen (if used manually)
    const connectForm = document.getElementById('connect-form');
    if (connectForm) {
      connectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const serverUrl = document.getElementById('connect-url').value;
        this.storage.saveServerUrl(serverUrl);
        this._connect(serverUrl);
      });
    }

    // Room Creation
    const createRoomBtn = document.getElementById('create-room-btn');
    if (createRoomBtn) {
      createRoomBtn.addEventListener('click', async () => {
        const name = prompt('Enter room name:');
        if (name) {
          createRoomBtn.disabled = true;
          const res = await this.chat.createRoom(name);
          createRoomBtn.disabled = false;
          if (!res.success) this._showToast(res.error, 'error');
        }
      });
    }

    // Chat Input
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    if (chatInput && sendBtn) {
      chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        sendBtn.disabled = !chatInput.value.trim();
        this.chat.sendTyping();
      });
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._sendMessage();
        }
      });
      sendBtn.addEventListener('click', () => this._sendMessage());
    }

    // Voice Recording
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) {
      let isRecording = false;
      let startX = 0;
      
      const startRecord = async (e) => {
        e.preventDefault();
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        const started = await this.audio.startRecording();
        if (started) {
          isRecording = true;
          document.getElementById('recording-ui').classList.remove('hidden');
          chatInput.classList.add('hidden');
        }
      };
      
      const moveRecord = (e) => {
        if (!isRecording) return;
        const currentX = e.touches ? e.touches[0].clientX : e.clientX;
        if (startX - currentX > 50) {
          this.audio.cancelRecording();
          isRecording = false;
          document.getElementById('recording-ui').classList.add('hidden');
          chatInput.classList.remove('hidden');
          this._showToast('Recording cancelled', 'info');
        }
      };
      
      const stopRecord = (e) => {
        e.preventDefault();
        if (!isRecording) return;
        isRecording = false;
        document.getElementById('recording-ui').classList.add('hidden');
        chatInput.classList.remove('hidden');
        this.audio.stopRecording();
      };

      micBtn.addEventListener('mousedown', startRecord);
      micBtn.addEventListener('touchstart', startRecord);
      document.addEventListener('mousemove', moveRecord);
      document.addEventListener('touchmove', moveRecord);
      document.addEventListener('mouseup', stopRecord);
      document.addEventListener('touchend', stopRecord);

      this.audio.on('recording-complete', ({ blob, duration, mimeType }) => {
        this.chat.sendVoiceMessage(blob, duration, mimeType);
      });
      this.audio.on('recording-too-short', () => {
        this._showToast('Hold longer to record', 'warning');
      });
    }

    // File Sharing
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
          this.chat.sendFile(file);
          fileInput.value = ''; // reset
        }
      });
    }

    // GPS & Map
    const locationBtn = document.getElementById('location-btn');
    if (locationBtn) {
      locationBtn.addEventListener('click', async () => {
        try {
          const pos = await this.gps.getCurrentPosition();
          this.chat.shareLocation(pos.lat, pos.lng, pos.accuracy);
          this._showToast('Location shared', 'success');
        } catch (e) {
          this._showToast(e.message, 'error');
        }
      });
    }

    // Search Messages
    const searchBtn = document.getElementById('search-btn');
    const searchBar = document.getElementById('chat-search-bar');
    const searchInput = document.getElementById('chat-search-input');
    if (searchBtn && searchBar && searchInput) {
      searchBtn.addEventListener('click', () => {
        const isHidden = searchBar.style.display === 'none';
        searchBar.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          searchInput.focus();
        } else {
          searchInput.value = '';
          this._renderMessages(true);
        }
      });
      searchInput.addEventListener('input', async (e) => {
        const q = e.target.value;
        if (!q.trim()) {
          this._renderMessages(true);
          return;
        }
        const results = await this.storage.searchMessages(q);
        const area = document.getElementById('chat-messages');
        if (!area) return;
        area.innerHTML = '';
        if (results.length === 0) {
           area.innerHTML = '<div class="empty-state">No messages found.</div>';
           return;
        }
        results.reverse().forEach(m => this._appendMessage(m));
      });
    }

    // Settings listeners
    document.querySelectorAll('.setting-toggle, .setting-select').forEach(el => {
      el.addEventListener('change', (e) => {
        const key = e.target.dataset.setting;
        const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        this.settings[key] = val;
        this.storage.saveSetting(key, val);
        this._applySettings();
      });
    });
    
    // Edit Profile Button
    const editProfileBtn = document.getElementById('edit-profile-btn');
    if (editProfileBtn) {
      editProfileBtn.addEventListener('click', () => {
        this._populateEditProfile();
        this._navigateTo('setup');
      });
    }

    // Emoji Picker
    const emojiBtn = document.getElementById('emoji-btn');
    if (emojiBtn) {
      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleEmojiPicker();
      });
    }

    // WebRTC Calls
    const endCallBtn = document.getElementById('end-call-btn');
    if (endCallBtn) endCallBtn.addEventListener('click', () => this.webrtc.endCall());
    
    const acceptCallBtn = document.getElementById('accept-call');
    const declineCallBtn = document.getElementById('decline-call');
    if (acceptCallBtn) acceptCallBtn.addEventListener('click', () => {
      this.webrtc.acceptCall();
      document.getElementById('incoming-call-modal').classList.add('hidden');
    });
    if (declineCallBtn) declineCallBtn.addEventListener('click', () => {
      this.webrtc.rejectCall();
      document.getElementById('incoming-call-modal').classList.add('hidden');
    });
    
    // Header click for connection info
    const appHeader = document.querySelector('.app-header');
    if (appHeader) {
      appHeader.addEventListener('click', () => this._showConnectionInfo());
    }

    // Chat List scroll (Virtual / Paginated)
    const chatList = document.getElementById('chat-messages');
    if (chatList) {
      chatList.addEventListener('scroll', async () => {
        if (chatList.scrollTop === 0) {
          const area = chatList;
          const prevHeight = area.scrollHeight;
          const added = await this.chat.loadOlderMessages(50);
          if (added && added.length) {
            this._prependMessages(added);
            // Preserve view position
            area.scrollTop = area.scrollHeight - prevHeight;
          }
        }
      });
    }
  }

  _setupSystemEvents() {
    // --- Socket Events ---
    this.socket.on('connected', () => {
      this._updateHeaderStatus('connected', 'Connected');
      this.audio.playConnected();
      this._refreshRooms();
    });
    this.socket.on('disconnected', ({ wasConnected }) => {
      this._updateHeaderStatus('disconnected', 'Disconnected');
      if (wasConnected) this._showToast('Connection lost', 'error');
    });
    this.socket.on('reconnecting', ({ attempt }) => {
      this._updateHeaderStatus('reconnecting', `Reconnecting... (${attempt}/5)`);
    });
    this.socket.on('reconnected', () => {
      this._updateHeaderStatus('connected', 'Connected');
      this._showToast('Reconnected successfully', 'success');
    });
    this.socket.on('rooms-updated', () => {
      if (this.pages.home && this.pages.home.classList.contains('active')) {
        this._refreshRooms();
      }
    });

    // --- Chat Events ---
    this.chat.on('room-ready', (data) => {
      this._navigateTo('chat');
      document.getElementById('chat-room-name').textContent = data.roomName;
      document.getElementById('chat-member-count').textContent = data.memberCount;
      this.storage.saveLastRoom(data.roomId);
      this._renderMessages(true);
      
      // Request notification permission if enabled in settings
      if (this.settings.notifications && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    });

    this.chat.on('room-left', () => {
      this.storage.clearLastRoom();
      document.getElementById('chat-messages').innerHTML = '';
      this._navigateTo('home');
      this._refreshRooms();
    });

    this.chat.on('new-message', (msg) => {
      this._appendMessage(msg);
      if (msg.type === 'system') return;
      if (msg.senderId !== this.socket.clientId) {
        this.audio.playMessageReceived();
        this._showNotification(`Message from ${msg.senderName}`, msg.text);
      } else {
        this.audio.playMessageSent();
      }
    });

    this.chat.on('message-status-update', (msg) => {
      this._updateMessageStatusUI(msg);
    });

    this.chat.on('message-updated', () => {
      if (this.pages.chat && this.pages.chat.classList.contains('active')) {
        this._renderMessages(true);
      }
    });

    this.chat.on('message-removed', () => {
      if (this.pages.chat && this.pages.chat.classList.contains('active')) {
        this._renderMessages(true);
      }
    });

    this.chat.on('typing-changed', () => {
      const typingEl = document.getElementById('typing-indicator');
      if (!typingEl) return;
      const str = this.chat.getTypingString();
      if (str) {
        typingEl.textContent = str;
        typingEl.classList.remove('hidden');
      } else {
        typingEl.classList.add('hidden');
      }
    });

    this.chat.on('members-changed', ({ count }) => {
      const el = document.getElementById('chat-member-count');
      if (el) el.textContent = count;
    });

    this.chat.on('member-left', (payload) => {
      if (this.webrtc.currentCallId === payload.clientId) {
        this.webrtc.endCall();
        this._showToast(`${payload.displayName || 'User'} left the room`, 'info');
      }
    });

    this.chat.on('file-progress', ({ fileId, progress }) => {
      const bar = document.getElementById(`progress-${fileId}`);
      if (bar) bar.style.width = `${progress}%`;
    });

    this.chat.on('server-shutdown', () => {
      this._showToast('Server is shutting down', 'warning');
      this._navigateTo('home');
      this._showNotification('Server Shutdown', 'The Connect server is shutting down');
    });

    // --- WebRTC Events ---
    this.webrtc.on('incoming-call', ({ fromName }) => {
      document.getElementById('incoming-call-modal').classList.remove('hidden');
      document.querySelector('#incoming-call-modal .call-name').textContent = fromName;
      this.audio.playRinging();
    });

    this.webrtc.on('call-started', ({ targetId }) => {
      document.getElementById('active-call-bar').classList.remove('hidden');
      this._startCallTimer();
    });

    this.webrtc.on('call-accepted', () => {
      document.getElementById('active-call-bar').classList.remove('hidden');
      this._startCallTimer();
    });

    this.webrtc.on('call-ended', ({ duration }) => {
      document.getElementById('active-call-bar').classList.add('hidden');
      this._stopCallTimer();
      this._showToast(`Call ended (${WebRTCManager.formatDuration(duration)})`, 'info');
    });

    this.webrtc.on('error', (err) => {
      this._showToast(err.message, 'error');
      this.audio.playError();
    });
  }

  async _connect(url) {
    if (this.socket.connected) return;
    this._updateHeaderStatus('reconnecting', 'Connecting...');
    try {
      await this.socket.connect(url, this.profile.get());
    } catch (e) {
      this._updateHeaderStatus('disconnected', 'Failed to connect');
      this._showToast(e.message, 'error');
    }
  }

  _navigateTo(pageId) {
    Object.values(this.pages).forEach(p => p.classList.remove('active'));
    Object.values(this.navItems).forEach(n => n.classList.remove('active'));
    
    if (this.pages[pageId]) this.pages[pageId].classList.add('active');
    if (this.navItems[pageId]) this.navItems[pageId].classList.add('active');

    // Hide/show bottom nav based on page
    const bottomNav = document.querySelector('.bottom-nav');
    if (pageId === 'setup' || pageId === 'connect') {
      if (bottomNav) bottomNav.style.display = 'none';
    } else {
      if (bottomNav) bottomNav.style.display = 'flex';
    }

    if (pageId === 'home') this._refreshRooms();
    if (pageId === 'profile') this._renderProfile();
    if (pageId === 'settings') this._renderSettings();
  }

  _sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value;
    if (text.trim()) {
      this.chat.sendText(text);
      input.value = '';
      input.style.height = 'auto';
      document.getElementById('send-btn').disabled = true;
    }
  }

  _appendMessage(msg) {
    const area = document.getElementById('chat-messages');
    if (!area) return;

    const isMine = msg.senderId === this.socket.clientId;
    const isSystem = msg.type === 'system';
    
    const div = document.createElement('div');
    div.className = `chat-message ${isSystem ? 'system' : (isMine ? 'mine' : 'theirs')} fade-in`;
    div.dataset.msgId = msg.msgId;

    if (isSystem) {
      div.innerHTML = `<div class="system-text">${ConnectUtils.escapeHTML(msg.text || '')}</div>`;
    } else {
      let contentHtml = '';
      if (msg.type === 'location') {
        contentHtml = `
          <div class="loc-bubble">
            <div class="loc-icon">📍</div>
            <div class="loc-details">
              <strong>${ConnectUtils.escapeHTML(msg.senderName || 'Someone')}'s Location</strong><br>
              <small>${Number(msg.lat).toFixed(5)}, ${Number(msg.lng).toFixed(5)}</small>
            </div>
          </div>
          <div class="loc-actions">
            <a href="https://maps.google.com/?q=${msg.lat},${msg.lng}" target="_blank" class="btn btn-secondary text-sm">🗺️ Maps</a>
          </div>
        `;
      } else if (msg.type === 'file') {
        const isImage = msg.fileType && msg.fileType.startsWith('image/');
        if (isImage && msg._localData) {
          contentHtml = `<img src="data:${msg.fileType};base64,${msg._localData}" class="chat-img" alt="Image">`;
        } else {
          const prog = msg.status === 'uploading' ? `<div class="progress-bar"><div id="progress-${msg.fileId}" class="progress-fill" style="width:${msg.progress}%"></div></div>` : '';
          contentHtml = `
            <div class="file-bubble">
              📎 ${ConnectUtils.escapeHTML(msg.fileName || 'file')} (${ChatSystem.formatSize(msg.fileSize)})
              ${prog}
              ${msg.status === 'received' ? `<button class="btn btn-secondary text-sm mt-sm" onclick="app._downloadFile('${msg.fileId}', '${ConnectUtils.escapeHTML(msg.fileName || 'file')}')">Download</button>` : ''}
            </div>
          `;
        }
      } else if (msg.type === 'voice') {
        contentHtml = `
          <div class="voice-bubble">
            <button class="play-btn" onclick="app.audio.playVoiceMessage('${msg.audioData}', '${msg.audioMimeType || msg.mimeType || 'audio/webm'}')">▶</button>
            <div class="voice-waveform"></div>
            <span class="voice-dur">${WebRTCManager.formatDuration(msg.audioDuration)}</span>
          </div>
        `;
      } else {
        contentHtml = ConnectUtils.escapeHTML(msg.text || '').replace(/\n/g, '<br>');
      }

      let statusIcon = '';
      if (isMine) {
        if (msg.status === 'sending') statusIcon = ' ⏳';
        else if (msg.status === 'sent') statusIcon = ' ✓';
        else if (msg.status === 'delivered') statusIcon = ' ✓✓';
        else if (msg.status === 'read') statusIcon = ' <span style="color:#00d4ff">✓✓</span>';
      }

      div.innerHTML = `
        ${!isMine ? `<div class="chat-avatar" style="background:${msg.senderColor}">${ConnectUtils.escapeHTML(msg.senderAvatar || '')}</div>` : ''}
        <div class="chat-bubble ${isMine ? 'mine' : ''}">
          ${!isMine ? `<div class="chat-name">${ConnectUtils.escapeHTML(msg.senderName || '')}</div>` : ''}
          <div class="chat-content">${contentHtml}</div>
          <div class="chat-meta">${ChatSystem.formatTime(msg.timestamp)}${statusIcon}</div>
        </div>
      `;
    }
    
    area.appendChild(div);
    this._scrollToBottom();
  }

  _prependMessages(msgs) {
    const area = document.getElementById('chat-messages');
    if (!area || !msgs || msgs.length === 0) return;
    msgs.forEach(msg => {
      const isMine = msg.senderId === this.socket.clientId;
      const isSystem = msg.type === 'system';
      const div = document.createElement('div');
      div.className = `chat-message ${isSystem ? 'system' : (isMine ? 'mine' : 'theirs')} fade-in`;
      div.dataset.msgId = msg.msgId;

      if (isSystem) {
        div.innerHTML = `<div class="system-text">${ConnectUtils.escapeHTML(msg.text || '')}</div>`;
      } else {
        let contentHtml = '';
        if (msg.type === 'location') {
          contentHtml = `
            <div class="loc-bubble">
              <div class="loc-icon">📍</div>
              <div class="loc-details">
                <strong>${ConnectUtils.escapeHTML(msg.senderName || 'Someone')}'s Location</strong><br>
                <small>${Number(msg.lat).toFixed(5)}, ${Number(msg.lng).toFixed(5)}</small>
              </div>
            </div>
            <div class="loc-actions">
              <a href="https://maps.google.com/?q=${msg.lat},${msg.lng}" target="_blank" class="btn btn-secondary text-sm">🗺️ Maps</a>
            </div>
          `;
        } else if (msg.type === 'file') {
          const isImage = msg.fileType && msg.fileType.startsWith('image/');
          if (isImage && msg._localData) {
            contentHtml = `<img src="data:${msg.fileType};base64,${msg._localData}" class="chat-img" alt="Image">`;
          } else {
            const prog = msg.status === 'uploading' ? `<div class="progress-bar"><div id="progress-${msg.fileId}" class="progress-fill" style="width:${msg.progress}%"></div></div>` : '';
            contentHtml = `
              <div class="file-bubble">
                  📎 ${ConnectUtils.escapeHTML(msg.fileName || 'file')} (${ChatSystem.formatSize(msg.fileSize)})
                ${prog}
                  ${msg.status === 'received' ? `<button class="btn btn-secondary text-sm mt-sm" onclick="app._downloadFile('${msg.fileId}', '${ConnectUtils.escapeHTML(msg.fileName || 'file')}')">Download</button>` : ''}
              </div>
            `;
          }
        } else if (msg.type === 'voice') {
          contentHtml = `
            <div class="voice-bubble">
              <button class="play-btn" onclick="app.audio.playVoiceMessage('${msg.audioData}')">▶</button>
              <div class="voice-waveform"></div>
              <span class="voice-dur">${WebRTCManager.formatDuration(msg.audioDuration)}</span>
            </div>
          `;
        } else {
            contentHtml = ConnectUtils.escapeHTML(msg.text || '').replace(/\n/g, '<br>');
        }

        let statusIcon = '';
        if (isMine) {
          if (msg.status === 'sending') statusIcon = ' ⏳';
          else if (msg.status === 'sent') statusIcon = ' ✓';
          else if (msg.status === 'delivered') statusIcon = ' ✓✓';
          else if (msg.status === 'read') statusIcon = ' <span style="color:#00d4ff">✓✓</span>';
        }

        div.innerHTML = `
          ${!isMine ? `<div class="chat-avatar" style="background:${msg.senderColor}">${ConnectUtils.escapeHTML(msg.senderAvatar || '')}</div>` : ''}
          <div class="chat-bubble ${isMine ? 'mine' : ''}">
            ${!isMine ? `<div class="chat-name">${ConnectUtils.escapeHTML(msg.senderName || '')}</div>` : ''}
            <div class="chat-content">${contentHtml}</div>
            <div class="chat-meta">${ChatSystem.formatTime(msg.timestamp)}${statusIcon}</div>
          </div>
        `;
      }

      area.insertBefore(div, area.firstChild);
    });
  }

  _updateMessageStatusUI(msg) {
    const el = document.querySelector(`.chat-message[data-msg-id="${msg.msgId}"] .chat-meta`);
    if (el) {
      let statusIcon = ' ✓';
      if (msg.status === 'delivered') statusIcon = ' ✓✓';
      if (msg.status === 'read') statusIcon = ' <span style="color:#00d4ff">✓✓</span>';
      el.innerHTML = `${ChatSystem.formatTime(msg.timestamp)}${statusIcon}`;
    }
  }

  _renderMessages(clear = false) {
    const area = document.getElementById('chat-messages');
    if (!area) return;
    if (clear) area.innerHTML = '';
    
    if (this.chat.messages.length === 0) {
      area.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <h3>Say hello!</h3>
          <p>This is the start of your encrypted local chat.</p>
        </div>
      `;
      return;
    }

    this.chat.messages.forEach(m => this._appendMessage(m));
  }

  _scrollToBottom() {
    const area = document.getElementById('chat-messages');
    if (area) area.scrollTop = area.scrollHeight;
  }

  _destroy() {
    if (this._roomsRefreshTimer) {
      clearInterval(this._roomsRefreshTimer);
      this._roomsRefreshTimer = null;
    }
    this.socket.disconnect();
    this.gps.stopTracking();
    this.webrtc.endCall();
  }

  async _refreshRooms() {
    const list = document.getElementById('rooms-list');
    if (!list) return;
    
    list.innerHTML = '<div class="spinner" style="margin:20px auto"></div>';
    const rooms = await this.chat.getRooms();
    
    if (rooms.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <h3>No Rooms Yet</h3>
          <p>Create a room to start chatting</p>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    rooms.forEach(r => {
      const div = document.createElement('div');
      div.className = 'network-card';
      const createdLabel = r.createdAt ? ChatSystem.formatDate(r.createdAt) : 'Recently';
      div.innerHTML = `
        <div class="network-icon" style="background:${r.hostColor || '#00d4ff'}">${r.hostAvatar || '😎'}</div>
        <div class="network-info">
          <div class="network-name">${ConnectUtils.escapeHTML(r.name || '')}</div>
            <div class="network-meta">${r.memberCount} members · ${ConnectUtils.escapeHTML(r.hostName || 'Unknown')} · ${createdLabel} ${r.isPrivate ? '🔒' : ''}</div>
            <div class="network-meta">Code: ${ConnectUtils.escapeHTML(r.joinCode || '')}</div>
        </div>
        <button class="join-btn">Join</button>
      `;
      div.addEventListener('click', () => {
        if (r.isPrivate) {
          const pw = prompt('Enter room password:');
          if (pw !== null) this.chat.joinRoom(r.id, pw).then(res => { if(!res.success) this._showToast(res.error, 'error'); });
        } else {
          this.chat.joinRoom(r.id).then(res => { if(!res.success) this._showToast(res.error, 'error'); });
        }
      });
      list.appendChild(div);
    });
  }

  _renderProfile() {
    const p = this.profile.get();
    if (!p) return;
    
    const info = this.profile.getDeviceInfo();
    const html = `
      <div style="text-align:center; padding: 20px">
        <div class="avatar xl" style="background:${p.avatarColor}; margin:0 auto 16px">${ConnectUtils.escapeHTML(p.avatar || '')}</div>
        <h2 style="margin-bottom:8px">${ConnectUtils.escapeHTML(p.displayName || '')}</h2>
        <p class="text-muted" style="margin-bottom:16px">${ConnectUtils.escapeHTML(p.statusMessage || 'Available')}</p>
        <button id="edit-profile-btn" class="btn btn-secondary">Edit Profile</button>
      </div>
      <div class="glass-card mt-sm">
        <h4 style="margin-bottom:12px; border-bottom:1px solid var(--border); padding-bottom:8px">Device Info</h4>
        <div class="flex-between text-sm" style="margin-bottom:8px"><span>Device</span> <span>${info.device}</span></div>
        <div class="flex-between text-sm" style="margin-bottom:8px"><span>OS</span> <span>${info.os}</span></div>
        <div class="flex-between text-sm"><span>Browser</span> <span>${info.browser}</span></div>
      </div>
    `;
    const container = document.getElementById('profile-content');
    if (container) container.innerHTML = html;
    
    // Re-bind edit button
    const btn = document.getElementById('edit-profile-btn');
    if (btn) btn.addEventListener('click', () => {
      this._populateEditProfile();
      this._navigateTo('setup');
    });
  }

  _populateEditProfile() {
    const p = this.profile.get();
    if (!p) return;
    
    const modeInput = document.getElementById('setup-mode');
    if (modeInput) modeInput.value = 'edit';
    
    const title = document.querySelector('#setup h2');
    if (title) title.textContent = 'Edit Profile';
    
    const submitBtn = document.querySelector('#setup-form button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Save Changes →';
    
    document.getElementById('setup-name').value = p.displayName;
    document.getElementById('setup-status').value = p.statusMessage || '';
    
    // Avatar selection logic would go here (matching UI state)
    // Server URL input should be hidden or disabled in edit mode
    const serverGroup = document.getElementById('setup-server')?.parentElement;
    if (serverGroup) serverGroup.style.display = 'none';
  }

  _renderSettings() {
    const s = this.settings;
    const toggles = document.querySelectorAll('.setting-toggle');
    toggles.forEach(t => {
      const key = t.dataset.setting;
      if (s[key] !== undefined) t.checked = s[key];
    });
    
    const selects = document.querySelectorAll('.setting-select');
    selects.forEach(sel => {
      const key = sel.dataset.setting;
      if (s[key] !== undefined) sel.value = s[key];
    });
  }

  _updateHeaderStatus(status, text) {
    const dot = document.getElementById('header-status-dot');
    const label = document.getElementById('header-status-text');
    if (dot) {
      dot.className = 'status-dot';
      if (status === 'connected') dot.classList.add('online');
      if (status === 'reconnecting') dot.classList.add('away');
      if (status === 'disconnected') dot.classList.add('offline');
    }
    if (label) {
      label.textContent = text;
    }
  }

  _showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${ConnectUtils.escapeHTML(message)}</span>
      <button class="toast-close">✕</button>
    `;
    container.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);
    
    const close = () => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 350);
    };
    
    toast.querySelector('.toast-close').addEventListener('click', close);
    setTimeout(close, 4000);
  }

  _showNotification(title, body) {
    if (this.settings.notifications && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(title, { body, icon: '/assets/icons/icon-192.png' });
    }
  }

  async _downloadFile(fileId, fileName) {
    const data = await this.storage.loadFile(fileId);
    if (!data) {
      this._showToast('File data not found locally', 'error');
      return;
    }
    const a = document.createElement('a');
    a.href = `data:application/octet-stream;base64,${data}`;
    a.download = fileName;
    a.click();
  }

  _toggleEmojiPicker() {
    let picker = document.getElementById('emoji-picker');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'emoji-picker';
      picker.className = 'glass-card slide-up';
      picker.style.position = 'absolute';
      picker.style.bottom = '80px';
      picker.style.left = '16px';
      picker.style.right = '16px';
      picker.style.zIndex = '1000';
      picker.style.maxHeight = '250px';
      picker.style.overflowY = 'auto';
      
      let html = '<div style="display:flex; flex-wrap:wrap; gap:8px;">';
      Object.entries(this.emojiCategories).forEach(([cat, emojis]) => {
        html += `<div style="width:100%; font-size:12px; color:var(--text-muted); margin-top:8px">${cat}</div>`;
        emojis.forEach(e => {
          html += `<button class="emoji-btn" style="background:none; border:none; font-size:24px; cursor:pointer">${e}</button>`;
        });
      });
      html += '</div>';
      picker.innerHTML = html;
      
      picker.addEventListener('click', (e) => {
        if (e.target.classList.contains('emoji-btn')) {
          const input = document.getElementById('chat-input');
          input.value += e.target.textContent;
          input.focus();
        }
      });
      
      document.querySelector('.app-main').appendChild(picker);
      
      // Close on outside click
      const closeHandler = (e) => {
        if (!picker.contains(e.target) && e.target.id !== 'emoji-btn') {
          picker.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 10);
    } else {
      picker.remove();
    }
  }

  _showConnectionInfo() {
    const st = this.socket.getStatus();
    alert(`Connection Info:\nServer: ${st.serverUrl}\nStatus: ${st.connected ? 'Connected' : 'Disconnected'}\nLatency: ${st.latency}ms\nClient ID: ${st.clientId}`);
  }

  _startCallTimer() {
    let secs = 0;
    const el = document.getElementById('call-timer');
    if (!el) return;
    this._callTimerInterval = setInterval(() => {
      secs++;
      el.textContent = WebRTCManager.formatDuration(secs);
    }, 1000);
  }

  _stopCallTimer() {
    if (this._callTimerInterval) clearInterval(this._callTimerInterval);
    const el = document.getElementById('call-timer');
    if (el) el.textContent = '00:00';
  }
}

// Initialize app globally
window.app = new ConnectApp();
