function relayLog(level, msg, data = null) {
  try {
    chrome.runtime.sendMessage({ type: "offscreen_log", level, msg, data });
  } catch (_) {
    // ignore
  }
}

function logInfo(msg, data) {
  console.log("[WebpageTTS] offscreen", msg, data || "");
  relayLog("log", msg, data);
}

function logError(msg, data) {
  console.error("[WebpageTTS] offscreen", msg, data || "");
  relayLog("error", msg, data);
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

function readAscii(view, offset, length) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

function inspectWavHeader(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    return { ok: false, reason: "not arraybuffer", type: typeof arrayBuffer };
  }
  const byteLength = arrayBuffer.byteLength || 0;
  if (byteLength < 12) {
    return { ok: false, reason: "too short", byteLength };
  }
  const view = new DataView(arrayBuffer);
  const riff = readAscii(view, 0, 4);
  const wave = readAscii(view, 8, 4);
  const info = {
    ok: riff === "RIFF" && wave === "WAVE",
    riff,
    wave,
    byteLength,
  };
  if (byteLength < 44) return info;
  info.fmt = readAscii(view, 12, 4);
  info.fmtSize = view.getUint32(16, true);
  info.audioFormat = view.getUint16(20, true);
  info.channels = view.getUint16(22, true);
  info.sampleRate = view.getUint32(24, true);
  info.byteRate = view.getUint32(28, true);
  info.blockAlign = view.getUint16(32, true);
  info.bitsPerSample = view.getUint16(34, true);
  info.dataTag = readAscii(view, 36, 4);
  info.dataSize = view.getUint32(40, true);
  return info;
}

function logAudioBufferMeta(arrayBuffer) {
  const header = inspectWavHeader(arrayBuffer);
  const prefixBytes = arrayBuffer instanceof ArrayBuffer ? arrayBuffer.slice(0, 32) : null;
  const prefixHex = prefixBytes ? toHex(new Uint8Array(prefixBytes)) : null;
  logInfo("audio buffer meta", { header, prefixHex });
}

function base64ToArrayBuffer(b64) {
  const raw = b64.startsWith("data:") ? b64.split(",", 2)[1] : b64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function attachAudioDebug(audio) {
  const logEvent = (event) => {
    logInfo(`audio event ${event.type}`, {
      currentTime: audio.currentTime,
      duration: audio.duration,
      paused: audio.paused,
      readyState: audio.readyState,
      networkState: audio.networkState,
    });
  };
  audio.addEventListener("loadedmetadata", logEvent);
  audio.addEventListener("canplay", logEvent);
  audio.addEventListener("canplaythrough", logEvent);
  audio.addEventListener("stalled", logEvent);
  audio.addEventListener("waiting", logEvent);
  audio.addEventListener("play", logEvent);
  audio.addEventListener("pause", logEvent);
  audio.addEventListener("ended", logEvent);
  audio.addEventListener("abort", logEvent);
  audio.addEventListener("suspend", logEvent);
}

class AudioQueue {
  constructor() {
    this.queue = [];
    this.current = null;
    this.currentUrl = null;
    this.paused = false;
    this.playbackRate = 1;
    this.totalDurationSec = 0;
    this.playedDurationSec = 0;
    this.currentDurationSec = 0;
    this.lastProgressSentAt = 0;
    this.requestId = null;
  }

  _emitProgress(state = null, force = false) {
    const now = Date.now();
    if (!force && now - this.lastProgressSentAt < 200) return;
    this.lastProgressSentAt = now;
    const currentTime = this.current ? this.current.currentTime || 0 : 0;
    const playedSec = this.playedDurationSec + currentTime;
    const totalSec = this.totalDurationSec;
    const resolvedState =
      state || (this.paused ? "paused" : this.current ? "playing" : "idle");
    chrome.runtime.sendMessage({
      type: "playback_progress",
      playedSec,
      totalSec,
      state: resolvedState,
      requestId: this.requestId,
    });
  }

  reset(requestId = null) {
    this.stop();
    this.totalDurationSec = 0;
    this.playedDurationSec = 0;
    this.currentDurationSec = 0;
    this.requestId = requestId;
    this._emitProgress("idle", true);
  }

  enqueue(audioBuffer, playbackRate = null, durationSec = null, requestId = null) {
    logAudioBufferMeta(audioBuffer);
    const rate = playbackRate ?? this.playbackRate;
    if (requestId && this.requestId && requestId !== this.requestId) {
      this.reset(requestId);
    } else if (requestId) {
      this.requestId = requestId;
    }
    if (Number.isFinite(durationSec) && durationSec > 0) {
      this.totalDurationSec += durationSec;
    }
    this.queue.push({ buffer: audioBuffer, playbackRate: rate, durationSec: durationSec || 0 });
    logInfo("queue length", this.queue.length);
    this._emitProgress("buffering", true);
    if (!this.current && !this.paused) {
      this._playNext();
    }
  }

  async _playNext() {
    if (this.queue.length === 0 || this.paused) {
      if (!this.current) {
        const isComplete =
          this.totalDurationSec > 0 && this.playedDurationSec >= this.totalDurationSec - 0.05;
        const state = this.paused ? "paused" : isComplete ? "done" : "idle";
        this._emitProgress(state, true);
      }
      return;
    }

    const item = this.queue.shift();
    const buffer = item?.buffer || item;
    const rate = item?.playbackRate || this.playbackRate || 1;
    const durationSec = item?.durationSec || 0;
    const blob = new Blob([buffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.src = url;
    audio.preload = "auto";
    audio.playbackRate = rate;
    logInfo("audio element created", {
      canPlayWav: audio.canPlayType("audio/wav"),
      canPlayPcm: audio.canPlayType("audio/wav; codecs=1"),
      blobSize: blob.size,
      blobType: blob.type,
      playbackRate: rate,
    });
    attachAudioDebug(audio);

    this.current = audio;
    this.currentUrl = url;
    this.currentDurationSec = durationSec;

    audio.onended = () => {
      const finished = Number.isFinite(audio.duration) ? audio.duration : this.currentDurationSec;
      if (finished > 0) {
        this.playedDurationSec += finished;
      }
      if (this.current === audio) {
        this._cleanupCurrent();
        this._emitProgress("buffering", true);
        this._playNext();
      }
    };

    audio.onerror = () => {
      logError("audio error", { code: audio.error?.code || null });
      if (this.current === audio) {
        this._cleanupCurrent();
        this._playNext();
      }
    };

    audio.ontimeupdate = () => {
      this._emitProgress();
    };

    try {
      const playPromise = audio.play();
      logInfo("audio play called", { promise: Boolean(playPromise) });
      await playPromise;
      logInfo("audio play resolved", { duration: audio.duration || null });
      this._emitProgress("playing", true);
    } catch (err) {
      logError("audio play failed", err?.message || String(err));
      if (this.current === audio) {
        this._cleanupCurrent();
        this._playNext();
      }
    }
  }

  _cleanupCurrent() {
    if (this.current) {
      this.current.onended = null;
      this.current.onerror = null;
      this.current.ontimeupdate = null;
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
    }
    this.current = null;
    this.currentUrl = null;
  }

  stop() {
    this.queue = [];
    if (this.current) {
      try {
        this.current.pause();
        this.current.currentTime = 0;
      } catch (_) {
        // ignore
      }
      this._cleanupCurrent();
    }
    this.totalDurationSec = 0;
    this.playedDurationSec = 0;
    this.currentDurationSec = 0;
    this._emitProgress("stopped", true);
  }

  pause() {
    this.paused = true;
    if (this.current) {
      try {
        this.current.pause();
      } catch (_) {
        // ignore
      }
    }
    this._emitProgress("paused", true);
  }

  resume() {
    this.paused = false;
    if (this.current) {
      this.current.playbackRate = this.playbackRate || 1;
      this.current.play().catch((err) => {
        logError("audio resume failed", err?.message || String(err));
      });
      this._emitProgress("playing", true);
      return;
    }
    this._playNext();
  }

  setPlaybackRate(rate) {
    const normalized = Number(rate);
    if (!Number.isFinite(normalized) || normalized <= 0) return;
    this.playbackRate = normalized;
    this.queue = this.queue.map((item) => ({
      buffer: item?.buffer || item,
      playbackRate: normalized,
    }));
    if (this.current) {
      try {
        this.current.playbackRate = normalized;
      } catch (_) {
        // ignore
      }
    }
  }
}

const player = new AudioQueue();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "offscreen_enqueue") {
    let audioBuffer = message.audioBuffer;
    if (!audioBuffer && message.audioB64) {
      logInfo("audio base64 length", message.audioB64.length);
      audioBuffer = base64ToArrayBuffer(message.audioB64);
    }
    player.enqueue(
      audioBuffer,
      message.playbackRate,
      Number(message.durationSec) || null,
      message.requestId || null
    );
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "offscreen_reset") {
    player.reset(message.requestId || null);
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

  if (message.type === "offscreen_set_rate") {
    player.setPlaybackRate(message.rate);
    sendResponse({ ok: true });
    return;
  }
});
