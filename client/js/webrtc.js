/**
 * Connect — WebRTC Voice Calls
 * P2P audio with call UI hooks, incoming/outgoing state management
 */
class WebRTCManager {
  constructor(socketManager) {
    this.socket = socketManager;
    this.peerConnections = new Map();
    this.localStream = null;
    this.remoteStreams = new Map();
    this.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    this._listeners = {};
    this.currentCallId = null;
    this.callStartTime = null;
    this.incomingOffer = null;
    this._setupSignaling();
  }

  _setupSignaling() {
    this.socket.on('webrtc-offer', ({ fromId, fromName, offer }) => {
      this.incomingOffer = { fromId, fromName, offer };
      this._emit('incoming-call', { fromId, fromName, offer });
    });
    this.socket.on('webrtc-answer', async ({ fromId, answer }) => {
      const pc = this.peerConnections.get(fromId);
      if (pc) {
        try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); }
        catch (e) { console.error('[RTC] setRemoteDescription error:', e); }
      }
    });
    this.socket.on('webrtc-ice', async ({ fromId, candidate }) => {
      const pc = this.peerConnections.get(fromId);
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (e) { console.error('[RTC] addIceCandidate error:', e); }
      }
    });
    this.socket.on('webrtc-rejected', ({ fromId, fromName }) => {
      this.endCall(fromId);
      this._emit('call-rejected', { fromId, fromName });
    });
  }

  async callUser(targetId) {
    if (this.currentCallId) { this._emit('error', { message: 'Already in a call' }); return; }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      this._emit('error', { message: 'Microphone access denied. Enable in browser settings.' });
      return;
    }
    this.currentCallId = targetId;
    const pc = this._createPC(targetId);
    this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.send('webrtc-offer', { targetId, offer: pc.localDescription });
    this._emit('call-started', { targetId, direction: 'outgoing' });
  }

  async acceptCall(fromId, offer) {
    if (!fromId && this.incomingOffer) {
      fromId = this.incomingOffer.fromId;
      offer = this.incomingOffer.offer;
    }
    if (!fromId || !offer) return;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      this._emit('error', { message: 'Microphone access denied.' });
      this.rejectCall(fromId);
      return;
    }
    this.currentCallId = fromId;
    this.callStartTime = Date.now();
    const pc = this._createPC(fromId);
    this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.send('webrtc-answer', { targetId: fromId, answer: pc.localDescription });
    this.incomingOffer = null;
    this._emit('call-accepted', { targetId: fromId });
  }

  rejectCall(fromId) {
    if (!fromId && this.incomingOffer) fromId = this.incomingOffer.fromId;
    if (fromId) this.socket.send('webrtc-reject', { targetId: fromId });
    this.incomingOffer = null;
    this._emit('call-rejected-by-us', { targetId: fromId });
  }

  endCall(targetId) {
    if (!targetId) targetId = this.currentCallId;
    const pc = this.peerConnections.get(targetId);
    if (pc) { pc.close(); this.peerConnections.delete(targetId); }
    const s = this.remoteStreams.get(targetId);
    if (s) { s.getTracks().forEach(t => t.stop()); this.remoteStreams.delete(targetId); }
    if (this.localStream && this.peerConnections.size === 0) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    const duration = this.callStartTime ? Math.floor((Date.now() - this.callStartTime) / 1000) : 0;
    this.currentCallId = null;
    this.callStartTime = null;
    this.incomingOffer = null;
    this._emit('call-ended', { targetId, duration });
  }

  endAllCalls() {
    this.peerConnections.forEach((_, id) => this.endCall(id));
  }

  isInCall() { return this.currentCallId !== null; }

  _createPC(targetId) {
    const pc = new RTCPeerConnection(this.config);
    this.peerConnections.set(targetId, pc);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.socket.send('webrtc-ice', { targetId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      this.remoteStreams.set(targetId, e.streams[0]);
      this._playStream(e.streams[0]);
      if (!this.callStartTime) this.callStartTime = Date.now();
      this._emit('remote-stream', { targetId, stream: e.streams[0] });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.endCall(targetId);
      }
    };
    return pc;
  }

  _playStream(stream) {
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.id = 'remote-audio';
    document.body.appendChild(audio);
    audio.play().catch(() => {});
  }

  on(e, cb) { if (!this._listeners[e]) this._listeners[e] = []; this._listeners[e].push(cb); }
  off(e, cb) { if (this._listeners[e]) this._listeners[e] = this._listeners[e].filter(c => c !== cb); }
  _emit(e, d) { (this._listeners[e] || []).forEach(cb => { try { cb(d); } catch (er) {} }); }

  static formatDuration(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return m + ':' + s;
  }
}

window.WebRTCManager = WebRTCManager;
