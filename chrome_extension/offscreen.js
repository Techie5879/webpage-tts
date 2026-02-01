class AudioQueue {
  constructor() {
    this.ctx = null;
    this.queue = [];
    this.current = null;
    this.paused = false;
  }

  async _ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      console.log("[WebpageTTS] AudioContext created", this.ctx.sampleRate);
    }
    if (this.ctx.state === "suspended" && !this.paused) {
      try {
        await this.ctx.resume();
        console.log("[WebpageTTS] AudioContext resumed");
      } catch (err) {
        console.error("[WebpageTTS] AudioContext resume failed", err);
      }
    }
  }

  async enqueue(audioBuffer) {
    await this._ensureContext();
    this.queue.push(audioBuffer);
    console.log("[WebpageTTS] queue length", this.queue.length);
    if (!this.current && !this.paused) {
      this._playNext();
    }
  }

  async _playNext() {
    if (this.queue.length === 0 || this.paused) {
      return;
    }

    const buffer = this.queue.shift();
    let decoded;
    try {
      decoded = await this.ctx.decodeAudioData(buffer.slice(0));
    } catch (err) {
      console.error("Failed to decode audio", err);
      this._playNext();
      return;
    }
    console.log("[WebpageTTS] decoded audio", decoded.duration, "sec");

    const source = this.ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(this.ctx.destination);
    this.current = source;

    source.onended = () => {
      if (this.current === source) {
        this.current = null;
        this._playNext();
      }
    };

    source.start(0);
  }

  stop() {
    this.queue = [];
    if (this.current) {
      try {
        this.current.onended = null;
        this.current.stop();
      } catch (_) {
        // ignore
      }
      this.current = null;
    }
  }

  async pause() {
    this.paused = true;
    if (this.ctx && this.ctx.state === "running") {
      await this.ctx.suspend();
    }
  }

  async resume() {
    this.paused = false;
    if (this.ctx && this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    if (!this.current) {
      this._playNext();
    }
  }
}

const player = new AudioQueue();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "offscreen_enqueue") {
    player.enqueue(message.audioBuffer);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "offscreen_stop") {
    player.stop();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "offscreen_pause") {
    player.pause();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "offscreen_resume") {
    player.resume();
    sendResponse({ ok: true });
    return;
  }
});
