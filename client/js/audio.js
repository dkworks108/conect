/**
 * Connect — Audio System + Voice Recorder
 * Sound effects, vibration, and MediaRecorder voice recording
 */
class AudioSystem {
  constructor() {
    this.audioCtx = null;
    this.soundEnabled = true;
    this.vibrationEnabled = true;
    this.recorder = null;
    this.recordingChunks = [];
    this.recordingStartTime = 0;
    this.isRecording = false;
    this._listeners = {};
    this.maxRecordingDurationMs = 5 * 60 * 1000;
    this._recordingTimeout = null;
    this._currentStream = null;
  }

  _getCtx() {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    return this.audioCtx;
  }

  _playTone(freq, dur, type = 'sine', vol = 0.15) {
    if (!this.soundEnabled) return;
    try {
      const ctx = this._getCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + dur);
    } catch (e) {}
  }

  _seq(notes) {
    if (!this.soundEnabled) return;
    try {
      const ctx = this._getCtx();
      let t = ctx.currentTime;
      notes.forEach(([f, d, ty, v]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = ty || 'sine';
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(v || 0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + d);
        t += d * 0.7;
      });
    } catch (e) {}
  }

  _vibrate(pattern) {
    if (this.vibrationEnabled && 'vibrate' in navigator) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  _getRecorderMimeType() {
    if (typeof MediaRecorder === 'undefined') return 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
    return '';
  }

  _stopRecordingTimeout() {
    if (this._recordingTimeout) {
      clearTimeout(this._recordingTimeout);
      this._recordingTimeout = null;
    }
  }

  playMessageReceived() { this._seq([[880, 0.08, 'sine', 0.1], [1100, 0.12, 'sine', 0.08]]); this._vibrate([50]); }
  playMessageSent() { this._playTone(800, 0.06, 'sine', 0.06); this._vibrate([30]); }
  playUserJoined() { this._seq([[440, 0.08, 'sine', 0.1], [660, 0.08, 'sine', 0.1], [880, 0.12, 'sine', 0.08]]); this._vibrate([30, 50, 30]); }
  playUserLeft() { this._seq([[660, 0.1, 'sine', 0.08], [440, 0.12, 'sine', 0.06]]); }
  playConnected() { this._seq([[523, 0.06, 'sine', 0.1], [659, 0.06, 'sine', 0.1], [784, 0.08, 'sine', 0.1], [1047, 0.15, 'sine', 0.08]]); this._vibrate([50, 30, 80]); }
  playError() { this._seq([[200, 0.12, 'square', 0.06], [150, 0.15, 'square', 0.05]]); this._vibrate([100, 50, 100]); }
  playRinging() { this._seq([[800, 0.2, 'sine', 0.12], [600, 0.2, 'sine', 0.1]]); this._vibrate([200, 100, 200, 100, 200]); }

  // ─── VOICE RECORDING ─────────────────────────
  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      const mimeType = this._getRecorderMimeType();
      this.recorder = new MediaRecorder(stream, { mimeType });
      this._currentStream = stream;
      this.recordingChunks = [];
      this.recordingStartTime = Date.now();
      this.isRecording = true;

      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordingChunks.push(e.data);
      };

      this.recorder.onstop = () => {
        this._stopRecordingTimeout();
        if (this._currentStream) {
          this._currentStream.getTracks().forEach(t => t.stop());
          this._currentStream = null;
        }
        const duration = Math.round((Date.now() - this.recordingStartTime) / 1000);
        const blob = new Blob(this.recordingChunks, { type: mimeType });
        this.isRecording = false;
        if (duration < 1) {
          this._emit('recording-too-short');
          return;
        }
        this._emit('recording-complete', { blob, duration, mimeType });
      };

      this.recorder.start(250);
      this._recordingTimeout = setTimeout(() => {
        if (this.isRecording) this.stopRecording();
      }, this.maxRecordingDurationMs);
      this._emit('recording-started');
      return true;
    } catch (e) {
      this._emit('recording-error', { message: e?.message || 'Microphone access denied. Enable in browser settings.' });
      return false;
    }
  }

  stopRecording() {
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.stop();
    }
    this._stopRecordingTimeout();
    this.isRecording = false;
  }

  cancelRecording() {
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.onstop = () => {};
      this.recorder.stop();
      try {
        if (this._currentStream) this._currentStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
    }
    this._stopRecordingTimeout();
    this.isRecording = false;
    this.recordingChunks = [];
    this._currentStream = null;
    this._emit('recording-cancelled');
  }

  getRecordingDuration() {
    if (!this.isRecording) return 0;
    return Math.round((Date.now() - this.recordingStartTime) / 1000);
  }

  // ─── PLAYBACK ─────────────────────────────────
  playVoiceMessage(base64Data, mimeType = 'audio/webm') {
    try {
      const cleanBase64 = String(base64Data || '').replace(/^data:[^;]+;base64,/, '');
      const binary = atob(cleanBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = 'none';
      audio.play().catch(() => {});
      audio.onended = () => URL.revokeObjectURL(url);
      return audio;
    } catch (e) {
      console.error('[AUDIO] Playback error:', e);
      return null;
    }
  }

  on(e, cb) { if (!this._listeners[e]) this._listeners[e] = []; this._listeners[e].push(cb); }
  _emit(e, d) { (this._listeners[e] || []).forEach(cb => { try { cb(d); } catch (er) {} }); }
}

window.AudioSystem = AudioSystem;
