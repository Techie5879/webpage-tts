const DEFAULT_SERVER_URL = "http://127.0.0.1:9872";
const DEFAULT_SOURCE = "selection"; // selection | page
const DEFAULT_MODE = "default"; // default | custom | design | clone
const DEFAULT_CHUNK_SIZE = 420;
const DEFAULT_PLAYBACK_TARGET = "offscreen"; // offscreen | popup

const state = {
  requestId: 0,
  aborters: [],
};

function logInfo(message, data) {
  if (data !== undefined) {
    console.log(`[WebpageTTS] ${message}`, data);
  } else {
    console.log(`[WebpageTTS] ${message}`);
  }
}

function logWarn(message, data) {
  if (data !== undefined) {
    console.warn(`[WebpageTTS] ${message}`, data);
  } else {
    console.warn(`[WebpageTTS] ${message}`);
  }
}

function logError(message, data) {
  if (data !== undefined) {
    console.error(`[WebpageTTS] ${message}`, data);
  } else {
    console.error(`[WebpageTTS] ${message}`);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
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

logInfo("service worker loaded");

self.addEventListener("unhandledrejection", (event) => {
  logError("unhandled rejection", event.reason);
});

chrome.runtime.onInstalled.addListener(() => {
  logInfo("onInstalled");
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .then(() => logInfo("side panel behavior set"))
      .catch((err) => logWarn("side panel behavior failed", err?.message || err));
  }
});

chrome.runtime.onStartup.addListener(() => {
  logInfo("onStartup");
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .then(() => logInfo("side panel behavior set"))
      .catch((err) => logWarn("side panel behavior failed", err?.message || err));
  }
});

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isRestrictedUrl(url) {
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

async function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    logInfo("sendToTab", { tabId, type: message?.type });
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        logWarn("sendToTab error", err.message);
        reject(new Error(err.message));
        return;
      }
      logInfo("sendToTab response", { tabId, type: message?.type, response });
      resolve(response);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    await sendToTab(tabId, { type: "ping" });
    return true;
  } catch (err) {
    const msg = String(err?.message || err);
    if (!msg.includes("Receiving end does not exist")) {
      throw err;
    }
  }

  logInfo("content script missing, injecting");
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
    injectImmediately: true,
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    try {
      await sendToTab(tabId, { type: "ping" });
      logInfo("content script injected");
      return true;
    } catch (pingErr) {
      logWarn("content script ping failed", {
        attempt: attempt + 1,
        error: pingErr?.message || pingErr,
      });
    }
  }
  throw new Error("Content script injection failed");
}

let offscreenReady = false;
let offscreenCreating = null;

async function ensureOffscreen() {
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
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play TTS audio without page autoplay restrictions.",
      });
    }
    logInfo("offscreen ready");
    offscreenReady = true;
  })();

  return offscreenCreating;
}

async function sendToOffscreen(message, { retry = true } = {}) {
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
              resolve(retryResponse || null);
            });
            return;
          } catch (retryCreateErr) {
            logError("offscreen recreate failed", retryCreateErr?.message || retryCreateErr);
          }
        }
        resolve(null);
        return;
      }
      resolve(response || null);
    });
  });
}

async function getTextFromTab(tabId, source) {
  let response;
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
  if (!response || !response.text) {
    logWarn("getTextFromTab empty response", response);
    throw new Error("No text found on page");
  }
  logInfo("getTextFromTab text length", response.text.length);
  return response.text;
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function chunkText(text, maxLen) {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + maxLen, cleaned.length);
    let slice = cleaned.slice(start, end);

    let splitAt = -1;
    const punctMatches = [". ", "! ", "? "];
    for (const punct of punctMatches) {
      const idx = slice.lastIndexOf(punct);
      if (idx > splitAt) splitAt = idx;
    }

    if (splitAt > 0 && end < cleaned.length) {
      end = start + splitAt + 1;
    } else if (end < cleaned.length) {
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace > 0) end = start + lastSpace;
    }

    const chunk = cleaned.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
  }
  return chunks;
}

async function fetchAudio(serverUrl, payload, signal) {
  logInfo("sending TTS", {
    serverUrl,
    mode: payload.mode,
    textLen: payload.text?.length || 0,
    speaker: payload.speaker || null,
    instructionLen: payload.instruction?.length || 0,
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

async function runSpeak(message, sender) {
  const tab = sender?.tab ?? (await getActiveTab());
  if (!tab || !tab.id) throw new Error("No active tab");

  const settings = await chrome.storage.local.get({
    serverUrl: DEFAULT_SERVER_URL,
    source: DEFAULT_SOURCE,
    mode: DEFAULT_MODE,
    chunkSize: DEFAULT_CHUNK_SIZE,
    playbackTarget: DEFAULT_PLAYBACK_TARGET,
  });

  logInfo("settings", settings);

  const serverUrl = message.serverUrl || settings.serverUrl;
  const source = message.source || settings.source;
  const mode = message.mode || settings.mode;
  const chunkSize = message.chunkSize || settings.chunkSize;
  const playbackTarget = message.playbackTarget || settings.playbackTarget;

  const speaker = message.speaker || null;
  const instruction = message.instruction || null;
  const customModelSize = message.customModelSize || null;
  const refAudioB64 = message.refAudioB64 || null;
  const refText = message.refText || null;

  state.requestId += 1;
  const requestId = state.requestId;

  logInfo("runSpeak start", {
    requestId,
    tabId: tab.id,
    url: tab.url,
    source,
    mode,
    chunkSize,
    playbackTarget,
  });

  state.aborters.forEach((c) => c.abort());
  state.aborters = [];

  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "offscreen_stop" });

  const rawText = await getTextFromTab(tab.id, source);
  const chunks = chunkText(rawText, chunkSize);
  logInfo("chunks", chunks.length);
  if (chunks.length > 0) {
    logInfo("chunk sample lengths", {
      first: chunks[0]?.length || 0,
      last: chunks[chunks.length - 1]?.length || 0,
    });
  }

  chrome.runtime.sendMessage({
    type: "progress",
    stage: "start",
    chunks: chunks.length,
  });

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

    const audioBuf = await fetchAudio(serverUrl, payload, controller.signal);
    logInfo("received audio bytes", audioBuf.byteLength);
    logAudioBufferMeta(audioBuf);
    const audioB64 = arrayBufferToBase64(audioBuf);
    logInfo("audio base64 length", audioB64.length);

    if (requestId !== state.requestId) break;
    if (playbackTarget === "popup") {
      const handledByPopup = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "play_audio",
            audioB64,
          },
          (response) => {
            const err = chrome.runtime.lastError;
            if (err) {
              resolve(false);
              return;
            }
            resolve(Boolean(response?.handled));
          }
        );
      });

      if (handledByPopup) {
        logInfo("popup handled audio");
      }
      if (handledByPopup) {
        chrome.runtime.sendMessage({
          type: "progress",
          stage: "chunk",
          index: i + 1,
          total: chunks.length,
        });
        continue;
      }
    }

    const response = await sendToOffscreen(
      {
        type: "offscreen_enqueue",
        audioB64,
      },
      { retry: true }
    );
    if (response) {
      logInfo("offscreen enqueue ok", response);
    }

    chrome.runtime.sendMessage({
      type: "progress",
      stage: "chunk",
      index: i + 1,
      total: chunks.length,
    });
  }

  chrome.runtime.sendMessage({ type: "progress", stage: "done" });
  logInfo("runSpeak done", { requestId });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  logInfo("onMessage", { type: message.type, fromTabId: sender?.tab?.id });

  if (message.type === "speak") {
    runSpeak(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "stop") {
    state.requestId += 1;
    state.aborters.forEach((c) => c.abort());
    state.aborters = [];
    logInfo("stop", { requestId: state.requestId });
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ type: "offscreen_stop" });
    });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "pause") {
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ type: "offscreen_pause" });
    });
    logInfo("pause");
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "resume") {
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ type: "offscreen_resume" });
    });
    logInfo("resume");
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "offscreen_log") {
    const level = message.level || "log";
    const msg = message.msg || "";
    if (typeof console[level] === "function") {
      console[level](`[WebpageTTS] offscreen ${msg}`, message.data || "");
    } else {
      console.log(`[WebpageTTS] offscreen ${msg}`, message.data || "");
    }
    logInfo("offscreen relay", { level, msg });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "ping") {
    sendResponse({ ok: true });
  }
});
