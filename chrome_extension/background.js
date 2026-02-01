const DEFAULT_SERVER_URL = "http://127.0.0.1:9872";
const DEFAULT_SOURCE = "selection"; // selection | page
const DEFAULT_MODE = "default"; // default | custom | design | clone
const DEFAULT_CHUNK_SIZE = 420;
const DEFAULT_PLAYBACK_TARGET = "offscreen"; // offscreen | popup

const state = {
  requestId: 0,
  aborters: [],
};

console.log("[WebpageTTS] service worker loaded");

self.addEventListener("unhandledrejection", (event) => {
  console.error("[WebpageTTS] unhandled rejection", event.reason);
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[WebpageTTS] onInstalled");
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[WebpageTTS] onStartup");
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
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
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

  console.log("[WebpageTTS] content script missing, injecting");
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
    injectImmediately: true,
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    try {
      await sendToTab(tabId, { type: "ping" });
      console.log("[WebpageTTS] content script injected");
      return true;
    } catch (pingErr) {
      console.warn(
        "[WebpageTTS] content script ping failed",
        attempt + 1,
        pingErr?.message || pingErr
      );
    }
  }
  throw new Error("Content script injection failed");
}

let offscreenReady = false;
let offscreenCreating = null;

async function ensureOffscreen() {
  if (offscreenReady) return;
  if (offscreenCreating) return offscreenCreating;

  offscreenCreating = (async () => {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
      console.log("[WebpageTTS] creating offscreen document");
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play TTS audio without page autoplay restrictions.",
      });
    }
    console.log("[WebpageTTS] offscreen ready");
    offscreenReady = true;
  })();

  return offscreenCreating;
}

async function getTextFromTab(tabId, source) {
  let response;
  try {
    const tab = await chrome.tabs.get(tabId);
    console.log("[WebpageTTS] getTextFromTab url", tab?.url);
    if (isRestrictedUrl(tab?.url)) {
      throw new Error("Restricted URL");
    }
    await ensureContentScript(tabId);
    response = await sendToTab(tabId, { type: "get_text", source });
  } catch (err) {
    console.error("[WebpageTTS] getTextFromTab failed", err);
    throw new Error(
      "Content script not available on this page. Open a normal webpage (not chrome://, file://, or the Web Store) and try again."
    );
  }
  if (!response || !response.text) {
    throw new Error("No text found on page");
  }
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
  console.log("[WebpageTTS] sending TTS", {
    serverUrl,
    mode: payload.mode,
    textLen: payload.text?.length || 0,
    speaker: payload.speaker || null,
    instructionLen: payload.instruction?.length || 0,
    customModelSize: payload.custom_model_size || null,
    hasRefAudio: Boolean(payload.ref_audio_b64),
    hasRefText: Boolean(payload.ref_text),
  });
  const res = await fetch(`${serverUrl}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`TTS error ${res.status}: ${msg}`);
  }
  const buf = await res.arrayBuffer();
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

  state.aborters.forEach((c) => c.abort());
  state.aborters = [];

  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "offscreen_stop" });

  const rawText = await getTextFromTab(tab.id, source);
  const chunks = chunkText(rawText, chunkSize);
  console.log("[WebpageTTS] chunks", chunks.length);

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
    console.log("[WebpageTTS] received audio bytes", audioBuf.byteLength);

    if (requestId !== state.requestId) break;
    if (playbackTarget === "popup") {
      const handledByPopup = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "play_audio",
            audioBuffer: audioBuf,
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
        console.log("[WebpageTTS] popup handled audio");
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

    await ensureOffscreen();
    await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "offscreen_enqueue",
          audioBuffer: audioBuf,
        },
        (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.error("[WebpageTTS] offscreen enqueue error", err.message);
          } else {
            console.log("[WebpageTTS] offscreen enqueue ok", response);
          }
          resolve();
        }
      );
    });

    chrome.runtime.sendMessage({
      type: "progress",
      stage: "chunk",
      index: i + 1,
      total: chunks.length,
    });
  }

  chrome.runtime.sendMessage({ type: "progress", stage: "done" });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

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
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "resume") {
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ type: "offscreen_resume" });
    });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "ping") {
    sendResponse({ ok: true });
  }
});
