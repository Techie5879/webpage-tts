export interface WavHeaderInfo {
  ok: boolean;
  reason?: string;
  riff?: string;
  wave?: string;
  byteLength?: number;
  fmt?: string;
  fmtSize?: number;
  audioFormat?: number;
  channels?: number;
  sampleRate?: number;
  byteRate?: number;
  blockAlign?: number;
  bitsPerSample?: number;
  dataTag?: string;
  dataSize?: number;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

export function inspectWavHeader(arrayBuffer: ArrayBuffer): WavHeaderInfo {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    return { ok: false, reason: "not arraybuffer", type: typeof arrayBuffer } as WavHeaderInfo & {
      type: string;
    };
  }
  const byteLength = arrayBuffer.byteLength || 0;
  if (byteLength < 12) {
    return { ok: false, reason: "too short", byteLength };
  }
  const view = new DataView(arrayBuffer);
  const riff = readAscii(view, 0, 4);
  const wave = readAscii(view, 8, 4);
  const info: WavHeaderInfo = {
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

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const raw = b64.startsWith("data:") ? b64.split(",", 2)[1] : b64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface ProgressCallback {
  (data: { playedSec: number; totalSec: number; state: string }): void;
}

export interface PlaybackStrategy {
  enqueue(
    audioBuffer: ArrayBuffer,
    playbackRate: number,
    durationSec: number | null,
    requestId: number | null
  ): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setPlaybackRate(rate: number): void;
  reset(requestId: number | null): void;
}

export class AudioQueue {
  private strategy: PlaybackStrategy;
  private onProgress: ProgressCallback | null;

  constructor(strategy: PlaybackStrategy, onProgress: ProgressCallback | null = null) {
    this.strategy = strategy;
    this.onProgress = onProgress;
  }

  enqueue(
    audioBuffer: ArrayBuffer,
    playbackRate: number | null = null,
    durationSec: number | null = null,
    requestId: number | null = null
  ): void {
    this.strategy.enqueue(
      audioBuffer,
      playbackRate ?? 1,
      durationSec,
      requestId
    );
  }

  stop(): void {
    this.strategy.stop();
  }

  pause(): void {
    this.strategy.pause();
  }

  resume(): void {
    this.strategy.resume();
  }

  setPlaybackRate(rate: number): void {
    this.strategy.setPlaybackRate(rate);
  }

  reset(requestId: number | null): void {
    this.strategy.reset(requestId);
  }
}

export class HTMLAudioStrategy implements PlaybackStrategy {
  private queue: Array<{
    buffer: ArrayBuffer;
    playbackRate: number;
    durationSec: number;
  }> = [];
  private current: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private paused = false;
  private playbackRate = 1;
  private totalDurationSec = 0;
  private playedDurationSec = 0;
  private currentDurationSec = 0;
  private lastProgressSentAt = 0;
  private requestId: number | null = null;
  private onProgress: ProgressCallback | null;

  constructor(onProgress: ProgressCallback | null = null) {
    this.onProgress = onProgress;
  }

  private emitProgress(state: string | null = null, force = false): void {
    const now = Date.now();
    if (!force && now - this.lastProgressSentAt < 200) return;
    this.lastProgressSentAt = now;
    const currentTime = this.current ? this.current.currentTime || 0 : 0;
    const playedSec = this.playedDurationSec + currentTime;
    const totalSec = this.totalDurationSec;
    const resolvedState =
      state || (this.paused ? "paused" : this.current ? "playing" : "idle");
    if (this.onProgress) {
      this.onProgress({ playedSec, totalSec, state: resolvedState });
    } else if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "playback_progress",
        playedSec,
        totalSec,
        state: resolvedState,
        requestId: this.requestId,
      });
    }
  }

  reset(requestId: number | null): void {
    this.stop();
    this.totalDurationSec = 0;
    this.playedDurationSec = 0;
    this.currentDurationSec = 0;
    this.requestId = requestId;
    this.emitProgress("idle", true);
  }

  enqueue(
    audioBuffer: ArrayBuffer,
    playbackRate: number | null = null,
    durationSec: number | null = null,
    requestId: number | null = null
  ): void {
    const rate = playbackRate ?? this.playbackRate;
    if (requestId && this.requestId && requestId !== this.requestId) {
      this.reset(requestId);
    } else if (requestId) {
      this.requestId = requestId;
    }
    if (Number.isFinite(durationSec) && durationSec && durationSec > 0) {
      this.totalDurationSec += durationSec;
    }
    this.queue.push({
      buffer: audioBuffer,
      playbackRate: rate,
      durationSec: durationSec || 0,
    });
    console.log("[WebpageTTS] offscreen queue length", this.queue.length);
    this.emitProgress("buffering", true);
    if (!this.current && !this.paused) {
      this.playNext();
    }
  }

  private cleanupCurrent(): void {
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

  private playNext(): void {
    if (this.queue.length === 0 || this.paused) {
      if (!this.current) {
        const isComplete =
          this.totalDurationSec > 0 &&
          this.playedDurationSec >= this.totalDurationSec - 0.05;
        const state = this.paused ? "paused" : isComplete ? "done" : "idle";
        this.emitProgress(state, true);
      }
      return;
    }

    const item = this.queue.shift()!;
    const buffer = item.buffer;
    const rate = item.playbackRate;
    const durationSec = item.durationSec;
    const blob = new Blob([buffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.src = url;
    audio.preload = "auto";
    audio.playbackRate = rate;

    this.current = audio;
    this.currentUrl = url;
    this.currentDurationSec = durationSec;

    audio.onended = () => {
      const finished = Number.isFinite(audio.duration)
        ? audio.duration
        : this.currentDurationSec;
      if (finished > 0) {
        this.playedDurationSec += finished;
      }
      if (this.current === audio) {
        this.cleanupCurrent();
        this.emitProgress("buffering", true);
        this.playNext();
      }
    };

    audio.onerror = () => {
      console.error("[WebpageTTS] offscreen audio error", audio.error?.code);
      if (this.current === audio) {
        this.cleanupCurrent();
        this.playNext();
      }
    };

    audio.ontimeupdate = () => {
      this.emitProgress();
    };

    audio.play().then(
      () => {
        this.emitProgress("playing", true);
      },
      (err) => {
        console.error("[WebpageTTS] offscreen audio play failed", err);
        if (this.current === audio) {
          this.cleanupCurrent();
          this.playNext();
        }
      }
    );
  }

  stop(): void {
    this.queue = [];
    if (this.current) {
      try {
        this.current.pause();
        this.current.currentTime = 0;
      } catch {
        /* ignore */
      }
      this.cleanupCurrent();
    }
    this.totalDurationSec = 0;
    this.playedDurationSec = 0;
    this.currentDurationSec = 0;
    this.emitProgress("stopped", true);
  }

  pause(): void {
    this.paused = true;
    if (this.current) {
      try {
        this.current.pause();
      } catch {
        /* ignore */
      }
    }
    this.emitProgress("paused", true);
  }

  resume(): void {
    this.paused = false;
    if (this.current) {
      this.current.playbackRate = this.playbackRate || 1;
      this.current.play().catch((err) => {
        console.error("[WebpageTTS] offscreen resume failed", err);
      });
      this.emitProgress("playing", true);
      return;
    }
    this.playNext();
  }

  setPlaybackRate(rate: number): void {
    const normalized = Number(rate);
    if (!Number.isFinite(normalized) || normalized <= 0) return;
    this.playbackRate = normalized;
    this.queue = this.queue.map((item) => ({
      ...item,
      playbackRate: normalized,
    }));
    if (this.current) {
      try {
        this.current.playbackRate = normalized;
      } catch {
        /* ignore */
      }
    }
  }
}
