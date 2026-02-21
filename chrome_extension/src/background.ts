import { chunkText } from "@/lib/text";
import { arrayBufferToBase64, inspectWavHeader } from "@/lib/audio";
import {
  type BackgroundToOffscreenMessage,
  type BasicResponse,
  type ContentRequestMessage,
  type GetTextResponse,
  isRuntimeMessage,
  isSidebarToBackgroundMessage,
  type ModelSize,
  type PlaybackTarget,
  type ProgressMessage,
  type SpeakMessage,
  type TextSource,
  type TtsMode,
} from "@/lib/messages";

const DEFAULT_SERVER_URL = "http://127.0.0.1:9872";
const DEFAULT_SOURCE: TextSource = "selection";
const DEFAULT_MODE: TtsMode = "custom";
const DEFAULT_CHUNK_SIZE = 420;
const DEFAULT_PLAYBACK_TARGET: PlaybackTarget = "offscreen";

const state = {
  requestId: 0,
  aborters: [] as AbortController[],
};

function logInfo(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(`[WebpageTTS] ${message}`, data);
  } else {
    console.log(`[WebpageTTS] ${message}`);
  }
}

function logWarn(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.warn(`[WebpageTTS] ${message}`, data);
  } else {
    console.warn(`[WebpageTTS] ${message}`);
  }
}

function logError(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.error(`[WebpageTTS] ${message}`, data);
  } else {
    console.error(`[WebpageTTS] ${message}`);
  }
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if ((err as Error).name === "AbortError") return true;
  const msg = String((err as Error).message || err);
  return msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("signal");
}

logInfo("service worker loaded");

self.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  logError("unhandled rejection", event.reason);
});

chrome.runtime.onInstalled.addListener(() => {
  logInfo("onInstalled");
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .then(() => logInfo("side panel behavior set"))
      .catch((err) => logWarn("side panel behavior failed", (err as Error)?.message || err));
  }
});

chrome.runtime.onStartup.addListener(() => {
  logInfo("onStartup");
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .then(() => logInfo("side panel behavior set"))
      .catch((err) => logWarn("side panel behavior failed", (err as Error)?.message || err));
  }
});

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;
  const lowered = url.toLowerCase();
  return (
    lowered.startsWith("chrome://") ||
    lowered.startsWith("chrome-extension://") ||
    lowered.startsWith("edge://") ||
    lowered.startsWith("brave://") ||
    lowered.startsWith("devtools://") ||
    lowered.startsWith("about:") ||
    lowered.startsWith("file://") ||
    lowered.startsWith("chrome.google.com/webstore")
  );
}

async function sendToTab(
  tabId: number,
  message: ContentRequestMessage
): Promise<GetTextResponse | BasicResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        logWarn("sendToTab error", err.message);
        reject(new Error(err.message));
        return;
      }
      resolve(response as GetTextResponse | BasicResponse);
    });
  });
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await sendToTab(tabId, { type: "ping" });
    return;
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (!msg.includes("Receiving end does not exist")) {
      throw err;
    }
  }

  logInfo("content script missing, injecting");
  const manifest = chrome.runtime.getManifest();
  const contentScript = manifest.content_scripts?.[0]?.js?.[0];
  const files = contentScript ? [contentScript] : ["src/content.ts"];
  await chrome.scripting.executeScript({
    target: { tabId },
    files,
    injectImmediately: true,
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    try {
      await sendToTab(tabId, { type: "ping" });
      logInfo("content script injected");
      return;
    } catch (pingErr) {
      logWarn("content script ping failed", {
        attempt: attempt + 1,
        error: (pingErr as Error)?.message || pingErr,
      });
    }
  }
  throw new Error("Content script injection failed");
}

let offscreenReady = false;
let offscreenCreating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) {
    const has = await chrome.offscreen.hasDocument();
    logInfo("offscreen hasDocument (cached)", has);
    if (has) return;
    logWarn("offscreen missing, resetting state");
    offscreenReady = false;
    offscreenCreating = null;
  }
  if (offscreenCreating) return offscreenCreating;

  offscreenCreating = (async () => {
    const has = await chrome.offscreen.hasDocument();
    logInfo("offscreen hasDocument", has);
    if (!has) {
      logInfo("creating offscreen document");
      await chrome.offscreen.createDocument({
        url: "src/offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play TTS audio without page autoplay restrictions.",
      });
    }
    logInfo("offscreen ready");
    offscreenReady = true;
  })();

  return offscreenCreating;
}

async function sendToOffscreen(
  message: BackgroundToOffscreenMessage,
  { retry = true }: { retry?: boolean } = {}
): Promise<BasicResponse | null> {
  await ensureOffscreen();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, async (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        logError("offscreen send error", err.message);
        if (
          retry &&
          (err.message?.includes("message port closed") ||
            err.message?.includes("Receiving end does not exist"))
        ) {
          logWarn("offscreen send retrying after reset");
          offscreenReady = false;
          offscreenCreating = null;
          try {
            await ensureOffscreen();
            chrome.runtime.sendMessage(message, (retryResponse) => {
              const retryErr = chrome.runtime.lastError;
              if (retryErr) {
                logError("offscreen send retry error", retryErr.message);
              } else {
                logInfo("offscreen send retry ok", retryResponse);
              }
              resolve(retryResponse ?? null);
            });
            return;
          } catch (retryCreateErr) {
            logError(
              "offscreen recreate failed",
              (retryCreateErr as Error)?.message || retryCreateErr
            );
          }
        }
        resolve(null);
        return;
      }
      resolve(response ?? null);
    });
  });
}

async function getTextFromTab(tabId: number, source: TextSource): Promise<string> {
  let response: GetTextResponse | BasicResponse;
  try {
    const tab = await chrome.tabs.get(tabId);
    logInfo("getTextFromTab url", tab?.url);
    if (isRestrictedUrl(tab?.url)) {
      throw new Error("Restricted URL");
    }
    await ensureContentScript(tabId);
    response = await sendToTab(tabId, { type: "get_text", source });
  } catch (err) {
    logError("getTextFromTab failed", err);
    throw new Error(
      "Content script not available on this page. Open a normal webpage (not chrome://, file://, or the Web Store) and try again."
    );
  }
  if (!("text" in response) || !response.text) {
    logWarn("getTextFromTab empty response", response);
    throw new Error("No text found on page");
  }
  logInfo("getTextFromTab text length", response.text.length);
  return response.text;
}

async function fetchAudio(
  serverUrl: string,
  payload: {
    mode: TtsMode;
    text: string;
    speaker: string | null;
    instruction: string | null;
    custom_model_size: ModelSize | null;
    ref_audio_b64: string | null;
    ref_text: string | null;
  },
  signal: AbortSignal
): Promise<ArrayBuffer> {
  logInfo("sending TTS", {
    serverUrl,
    mode: payload.mode,
    textLen: (payload.text as string)?.length || 0,
    speaker: payload.speaker || null,
    instructionLen: (payload.instruction as string)?.length || 0,
    customModelSize: payload.custom_model_size || null,
    hasRefAudio: Boolean(payload.ref_audio_b64),
    hasRefText: Boolean(payload.ref_text),
  });
  const startedAt = Date.now();
  const res = await fetch(`${serverUrl}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const msg = await res.text();
    logError("TTS error response", { status: res.status, body: msg });
    throw new Error(`TTS error ${res.status}: ${msg}`);
  }
  logInfo("TTS response headers", {
    contentType: res.headers.get("content-type"),
    contentLength: res.headers.get("content-length"),
    sampleRate: res.headers.get("x-sample-rate"),
  });
  const buf = await res.arrayBuffer();
  logInfo("TTS response", { status: res.status, ms: Date.now() - startedAt });
  return buf;
}

async function runSpeak(
  message: SpeakMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tab =
    sender?.tab ?? (await getActiveTab());
  if (!tab?.id) throw new Error("No active tab");

  const serverUrl = message.serverUrl.trim() || DEFAULT_SERVER_URL;
  const source = message.source || DEFAULT_SOURCE;
  const mode = message.mode || DEFAULT_MODE;
  const chunkSize = Number(message.chunkSize) > 0 ? Number(message.chunkSize) : DEFAULT_CHUNK_SIZE;
  const playbackTarget = message.playbackTarget || DEFAULT_PLAYBACK_TARGET;

  const speaker = message.speaker ?? null;
  const instruction = message.instruction ?? null;
  const customModelSize = message.customModelSize ?? null;
  const refAudioB64 = message.refAudioB64 ?? null;
  const refText = message.refText ?? null;
  const playbackRate =
    Number.isFinite(Number(message.playbackRate)) && Number(message.playbackRate) > 0
      ? Number(message.playbackRate)
      : 1;

  state.requestId += 1;
  const requestId = state.requestId;
  let stopped = false;

  logInfo("runSpeak start", {
    requestId,
    tabId: tab.id,
    url: tab.url,
    source,
    mode,
    chunkSize,
    playbackTarget,
    playbackRate,
  });

  state.aborters.forEach((c) => c.abort());
  state.aborters = [];

  await ensureOffscreen();
  const offscreenStopMessage: BackgroundToOffscreenMessage = { type: "offscreen_stop" };
  const offscreenResetMessage: BackgroundToOffscreenMessage = {
    type: "offscreen_reset",
    requestId,
  };
  chrome.runtime.sendMessage(offscreenStopMessage);
  chrome.runtime.sendMessage(offscreenResetMessage);

  const rawText = await getTextFromTab(tab.id, source);
  const chunks = chunkText(rawText, chunkSize);
  logInfo("chunks", chunks.length);

  const startProgress: ProgressMessage = {
    type: "progress",
    stage: "start",
    chunks: chunks.length,
  };
  chrome.runtime.sendMessage(startProgress);

  for (let i = 0; i < chunks.length; i += 1) {
    if (requestId !== state.requestId) break;

    const controller = new AbortController();
    state.aborters.push(controller);

    const payload = {
      mode,
      text: chunks[i],
      speaker,
      instruction,
      custom_model_size: customModelSize,
      ref_audio_b64: refAudioB64,
      ref_text: refText,
    };

    let audioBuf: ArrayBuffer;
    try {
      audioBuf = await fetchAudio(serverUrl, payload, controller.signal);
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        logInfo("TTS fetch aborted", { requestId, index: i + 1 });
        stopped = true;
        break;
      }
      throw err;
    }

    const wavMeta = inspectWavHeader(audioBuf);
    let chunkDurationSec: number | null = null;
    if (
      wavMeta?.sampleRate &&
      wavMeta?.dataSize &&
      wavMeta?.channels &&
      wavMeta?.bitsPerSample
    ) {
      const bytesPerSample =
        ((wavMeta.bitsPerSample || 0) / 8) * (wavMeta.channels || 1);
      const samples =
        bytesPerSample ? (wavMeta.dataSize || 0) / bytesPerSample : 0;
      if (samples > 0 && (wavMeta.sampleRate || 0) > 0) {
        chunkDurationSec = samples / (wavMeta.sampleRate || 1);
      }
    }
    logInfo("received audio bytes", audioBuf.byteLength);
    const audioB64 = arrayBufferToBase64(audioBuf);

    if (requestId !== state.requestId) break;

    await sendToOffscreen(
      {
        type: "offscreen_enqueue",
        audioB64,
        playbackRate,
        durationSec: chunkDurationSec,
        requestId,
      },
      { retry: true }
    );

    const chunkProgress: ProgressMessage = {
      type: "progress",
      stage: "chunk",
      index: i + 1,
      total: chunks.length,
      durationSec: chunkDurationSec ?? undefined,
    };
    chrome.runtime.sendMessage(chunkProgress);
  }

  if (requestId !== state.requestId || stopped) {
    const stoppedProgress: ProgressMessage = { type: "progress", stage: "stopped" };
    chrome.runtime.sendMessage(stoppedProgress);
    logInfo("runSpeak stopped", { requestId });
    return;
  }

  const doneProgress: ProgressMessage = { type: "progress", stage: "done" };
  chrome.runtime.sendMessage(doneProgress);
  logInfo("runSpeak done", { requestId });
}

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BasicResponse) => void
  ) => {
    if (!isRuntimeMessage(rawMessage)) return;
    if (!isSidebarToBackgroundMessage(rawMessage)) return;
    const message = rawMessage;

    logInfo("onMessage", { type: message.type, fromTabId: sender?.tab?.id });

    if (message.type === "speak") {
      runSpeak(message, sender)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: (err as Error).message }));
      return true;
    }

    if (message.type === "stop") {
      state.requestId += 1;
      state.aborters.forEach((c) => c.abort());
      state.aborters = [];
      logInfo("stop", { requestId: state.requestId });
      const progressMessage: ProgressMessage = { type: "progress", stage: "stopped" };
      chrome.runtime.sendMessage(progressMessage);
      ensureOffscreen().then(() => {
        const offscreenStopMessage: BackgroundToOffscreenMessage = { type: "offscreen_stop" };
        chrome.runtime.sendMessage(offscreenStopMessage);
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "pause") {
      ensureOffscreen().then(() => {
        const offscreenPauseMessage: BackgroundToOffscreenMessage = { type: "offscreen_pause" };
        chrome.runtime.sendMessage(offscreenPauseMessage);
      });
      logInfo("pause");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "set_playback_rate") {
      const rate =
        Number.isFinite(Number(message.rate)) && Number(message.rate) > 0
          ? Number(message.rate)
          : 1;
      ensureOffscreen().then(() => {
        const offscreenRateMessage: BackgroundToOffscreenMessage = {
          type: "offscreen_set_rate",
          rate,
        };
        chrome.runtime.sendMessage(offscreenRateMessage);
      });
      logInfo("set playback rate", { rate });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "resume") {
      ensureOffscreen().then(() => {
        const offscreenResumeMessage: BackgroundToOffscreenMessage = { type: "offscreen_resume" };
        chrome.runtime.sendMessage(offscreenResumeMessage);
      });
      logInfo("resume");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "ensure_offscreen") {
      ensureOffscreen().then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "ping") {
      sendResponse({ ok: true });
    }
  }
);
