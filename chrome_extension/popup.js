const DEFAULTS = {
  serverUrl: "http://127.0.0.1:9872",
  source: "selection",
  mode: "custom",
  chunkSize: 420,
  playbackTarget: "offscreen",
  speaker: "Vivian",
  customModelSize: "0.6b",
  instruction: "",
  designPrompt: "",
  designName: "",
  cloneText: "",
  cloneName: "",
  theme: "light",
  savedVoices: [],
};

const FALLBACK_SPEAKERS = [
  "Vivian",
  "Serena",
  "Uncle_Fu",
  "Dylan",
  "Eric",
  "Ryan",
  "Aiden",
  "Ono_Anna",
  "Sohee",
];

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
      console.log("[WebpageTTS] popup AudioContext created", this.ctx.sampleRate);
    }
    if (this.ctx.state === "suspended" && !this.paused) {
      try {
        await this.ctx.resume();
        console.log("[WebpageTTS] popup AudioContext resumed");
      } catch (err) {
        console.error("[WebpageTTS] popup AudioContext resume failed", err);
      }
    }
  }

  async unlock() {
    await this._ensureContext();
    if (!this.ctx) return;
    try {
      const buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start(0);
      source.stop(0);
      console.log("[WebpageTTS] popup AudioContext unlocked");
    } catch (err) {
      console.error("[WebpageTTS] popup unlock failed", err);
    }
  }

  async enqueue(audioBuffer) {
    await this._ensureContext();
    this.queue.push(audioBuffer);
    console.log("[WebpageTTS] popup queue length", this.queue.length);
    if (!this.current && !this.paused) {
      this._playNext();
    }
  }

  async _playNext() {
    if (this.queue.length === 0 || this.paused) return;

    const buffer = this.queue.shift();
    let decoded;
    try {
      decoded = await this.ctx.decodeAudioData(buffer.slice(0));
      console.log("[WebpageTTS] popup decoded audio", decoded.duration, "sec");
    } catch (err) {
      console.error("[WebpageTTS] popup decode failed", err);
      this._playNext();
      return;
    }

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
}

const els = {
  serverUrl: document.getElementById("serverUrl"),
  source: document.getElementById("source"),
  playbackTarget: document.getElementById("playbackTarget"),
  chunkSize: document.getElementById("chunkSize"),
  speakerButtons: document.getElementById("speakerButtons"),
  customModelSize: document.getElementById("customModelSize"),
  customModelSizeInputs: Array.from(document.querySelectorAll("input[name=\"customModelSize\"]")),
  instruction: document.getElementById("instruction"),
  designPrompt: document.getElementById("designPrompt"),
  designName: document.getElementById("designName"),
  saveDesign: document.getElementById("saveDesign"),
  cloneAudio: document.getElementById("cloneAudio"),
  cloneText: document.getElementById("cloneText"),
  cloneName: document.getElementById("cloneName"),
  saveClone: document.getElementById("saveClone"),
  savedVoices: document.getElementById("savedVoices"),
  applyVoice: document.getElementById("applyVoice"),
  removeVoice: document.getElementById("removeVoice"),
  speak: document.getElementById("speak"),
  testTone: document.getElementById("testTone"),
  testTts: document.getElementById("testTts"),
  pause: document.getElementById("pause"),
  resume: document.getElementById("resume"),
  stop: document.getElementById("stop"),
  status: document.getElementById("status"),
  themeToggle: document.getElementById("themeToggle"),
  modeButtons: Array.from(document.querySelectorAll(".mode-btn")),
  modePanels: {
    custom: document.getElementById("mode-custom"),
    design: document.getElementById("mode-design"),
    clone: document.getElementById("mode-clone"),
  },
};

let cachedVoices = [];
let activeCloneAudioB64 = null;
let selectedSpeaker = DEFAULTS.speaker;
const popupPlayer = new AudioQueue();

function setStatus(text, tone = "info") {
  els.status.textContent = text;
  els.status.style.color = tone === "error" ? "#b04a4a" : "#5c6b73";
  console.log("[WebpageTTS]", text);
}

function setMode(mode) {
  els.modeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  Object.entries(els.modePanels).forEach(([key, panel]) => {
    if (panel) {
      panel.classList.toggle("active", key === mode);
    }
  });
  chrome.storage.local.set({ mode });
}

function renderSpeakerButtons(list, selected) {
  els.speakerButtons.innerHTML = "";
  list.forEach((speaker) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "speaker-btn";
    button.textContent = speaker;
    if (speaker === selected) button.classList.add("active");
    button.addEventListener("click", () => {
      selectedSpeaker = speaker;
      saveSetting("speaker", speaker);
      renderSpeakerButtons(list, speaker);
    });
    els.speakerButtons.appendChild(button);
  });
}

async function fetchSpeakers(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/speakers`);
    if (!res.ok) throw new Error("Bad response");
    const data = await res.json();
    return data.speakers || FALLBACK_SPEAKERS;
  } catch (err) {
    return FALLBACK_SPEAKERS;
  }
}

function renderSavedVoices(voices, selectedId = null) {
  els.savedVoices.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "No saved voices";
  if (voices.length === 0) {
    els.savedVoices.appendChild(placeholder);
    return;
  }

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Select a saved voice";
  els.savedVoices.appendChild(empty);

  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = `${voice.name} (${voice.type})`;
    if (voice.id === selectedId) option.selected = true;
    els.savedVoices.appendChild(option);
  });
}

function getSelectedModelSize() {
  return (
    els.customModelSizeInputs.find((input) => input.checked)?.value ||
    DEFAULTS.customModelSize
  );
}

function setSelectedModelSize(value) {
  let matched = false;
  els.customModelSizeInputs.forEach((input) => {
    const isMatch = input.value === value;
    input.checked = isMatch;
    if (isMatch) matched = true;
  });
  if (!matched && els.customModelSizeInputs[0]) {
    els.customModelSizeInputs[0].checked = true;
  }
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  els.serverUrl.value = settings.serverUrl;
  els.source.value = settings.source;
  els.playbackTarget.value = settings.playbackTarget || DEFAULTS.playbackTarget;
  els.chunkSize.value = settings.chunkSize;
  setSelectedModelSize(settings.customModelSize || DEFAULTS.customModelSize);
  els.instruction.value = settings.instruction || "";
  els.designPrompt.value = settings.designPrompt || "";
  els.designName.value = settings.designName || "";
  els.cloneText.value = settings.cloneText || "";
  els.cloneName.value = settings.cloneName || "";
  applyTheme(settings.theme || DEFAULTS.theme);

  const initialMode = settings.mode === "default" ? "custom" : settings.mode;
  setMode(initialMode || "custom");

  cachedVoices = settings.savedVoices || [];
  renderSavedVoices(cachedVoices);

  const speakers = await fetchSpeakers(settings.serverUrl);
  selectedSpeaker = settings.speaker || DEFAULTS.speaker;
  renderSpeakerButtons(speakers, selectedSpeaker);
}

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = normalized;
  if (els.themeToggle) {
    const icon = els.themeToggle.querySelector(".theme-icon");
    const text = els.themeToggle.querySelector(".theme-text");
    if (icon) icon.textContent = normalized === "dark" ? "☾" : "☀︎";
    if (text) text.textContent = normalized === "dark" ? "Dark" : "Light";
  }
}

function saveSetting(key, value) {
  chrome.storage.local.set({ [key]: value });
}

const pendingSaves = new Map();
function saveSettingDebounced(key, value, delay = 300) {
  if (pendingSaves.has(key)) {
    clearTimeout(pendingSaves.get(key));
  }
  const timeout = setTimeout(() => {
    saveSetting(key, value);
    pendingSaves.delete(key);
  }, delay);
  pendingSaves.set(key, timeout);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function currentMode() {
  return els.modeButtons.find((btn) => btn.classList.contains("active"))?.dataset
    .mode;
}

function getSavedVoiceById(id) {
  return cachedVoices.find((voice) => voice.id === id);
}

function hasSavedVoiceName(name) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return cachedVoices.some((voice) => (voice.name || "").trim().toLowerCase() === normalized);
}

async function refreshSpeakers() {
  const serverUrl = els.serverUrl.value.trim() || DEFAULTS.serverUrl;
  const speakers = await fetchSpeakers(serverUrl);
  renderSpeakerButtons(speakers, selectedSpeaker || DEFAULTS.speaker);
}

els.serverUrl.addEventListener("change", () => {
  saveSetting("serverUrl", els.serverUrl.value.trim());
  refreshSpeakers();
});

els.source.addEventListener("change", () => saveSetting("source", els.source.value));
els.playbackTarget.addEventListener("change", () =>
  saveSetting("playbackTarget", els.playbackTarget.value)
);
els.chunkSize.addEventListener("change", () =>
  saveSetting("chunkSize", Number(els.chunkSize.value))
);
els.customModelSize.addEventListener("change", (event) => {
  if (event.target?.name !== "customModelSize") return;
  saveSetting("customModelSize", getSelectedModelSize());
});
els.instruction.addEventListener("input", () =>
  saveSettingDebounced("instruction", els.instruction.value)
);
els.designPrompt.addEventListener("input", () =>
  saveSettingDebounced("designPrompt", els.designPrompt.value)
);
els.designName.addEventListener("input", () =>
  saveSettingDebounced("designName", els.designName.value)
);
els.cloneText.addEventListener("input", () =>
  saveSettingDebounced("cloneText", els.cloneText.value)
);
els.cloneName.addEventListener("input", () =>
  saveSettingDebounced("cloneName", els.cloneName.value)
);

if (els.themeToggle) {
  els.themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    saveSetting("theme", nextTheme);
  });
}

els.cloneAudio.addEventListener("change", () => {
  activeCloneAudioB64 = null;
});

els.modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

els.saveDesign.addEventListener("click", async () => {
  const name = els.designName.value.trim();
  const prompt = els.designPrompt.value.trim();
  if (!name || !prompt) {
    setStatus("Add a name and voice description before saving.", "error");
    return;
  }
  if (hasSavedVoiceName(name)) {
    setStatus("A saved voice with that name already exists.", "error");
    return;
  }
  const voice = { id: crypto.randomUUID(), name, type: "design", instruction: prompt };
  cachedVoices.push(voice);
  await chrome.storage.local.set({ savedVoices: cachedVoices });
  renderSavedVoices(cachedVoices, voice.id);
  setStatus(`Saved voice: ${name}`);
});

els.saveClone.addEventListener("click", async () => {
  const name = els.cloneName.value.trim();
  const refText = els.cloneText.value.trim();

  let refAudioB64 = activeCloneAudioB64;
  const file = els.cloneAudio.files[0];
  if (!refAudioB64 && file) {
    refAudioB64 = await readFileAsBase64(file);
  }

  if (!name || !refAudioB64) {
    setStatus("Provide a name and reference audio before saving.", "error");
    return;
  }
  if (hasSavedVoiceName(name)) {
    setStatus("A saved voice with that name already exists.", "error");
    return;
  }
  if (!refText) {
    setStatus("Reference text is required for voice cloning.", "error");
    return;
  }

  const voice = {
    id: crypto.randomUUID(),
    name,
    type: "clone",
    refAudioB64,
    refText,
  };
  cachedVoices.push(voice);
  await chrome.storage.local.set({ savedVoices: cachedVoices });
  renderSavedVoices(cachedVoices, voice.id);
  setStatus(`Saved voice: ${name}`);
});

els.applyVoice.addEventListener("click", () => {
  const voice = getSavedVoiceById(els.savedVoices.value);
  if (!voice) {
    setStatus("Select a saved voice to apply.", "error");
    return;
  }

  if (voice.type === "design") {
    setMode("design");
    els.designPrompt.value = voice.instruction || "";
    els.designName.value = voice.name || "";
    saveSetting("designPrompt", els.designPrompt.value);
    saveSetting("designName", els.designName.value);
    setStatus(`Applied design voice: ${voice.name}`);
  } else if (voice.type === "clone") {
    setMode("clone");
    activeCloneAudioB64 = voice.refAudioB64 || null;
    els.cloneText.value = voice.refText || "";
    els.cloneName.value = voice.name || "";
    saveSetting("cloneText", els.cloneText.value);
    saveSetting("cloneName", els.cloneName.value);
    setStatus(`Applied clone voice: ${voice.name}`);
  }
});

els.removeVoice.addEventListener("click", async () => {
  const id = els.savedVoices.value;
  if (!id) {
    setStatus("Select a voice to remove.", "error");
    return;
  }
  cachedVoices = cachedVoices.filter((voice) => voice.id !== id);
  await chrome.storage.local.set({ savedVoices: cachedVoices });
  renderSavedVoices(cachedVoices);
  setStatus("Removed saved voice.");
});

els.speak.addEventListener("click", async () => {
  const mode = currentMode() || "default";
  const serverUrl = els.serverUrl.value.trim() || DEFAULTS.serverUrl;
  const source = els.source.value;
  const chunkSize = Number(els.chunkSize.value) || DEFAULTS.chunkSize;
  const playbackTarget = els.playbackTarget.value || DEFAULTS.playbackTarget;

  const payload = {
    type: "speak",
    serverUrl,
    source,
    chunkSize,
    playbackTarget,
    mode,
  };
  payload.customModelSize = getSelectedModelSize();

  if (mode === "custom") {
    payload.speaker = selectedSpeaker;
    payload.instruction = els.instruction.value.trim() || null;
  }

  if (mode === "design") {
    const instruction = els.designPrompt.value.trim();
    if (!instruction) {
      setStatus("Voice description is required for voice design.", "error");
      return;
    }
    payload.instruction = instruction;
  }

  if (mode === "clone") {
    let refAudioB64 = activeCloneAudioB64;
    const file = els.cloneAudio.files[0];
    if (!refAudioB64 && file) {
      refAudioB64 = await readFileAsBase64(file);
    }

    if (!refAudioB64) {
      setStatus("Reference audio is required for voice cloning.", "error");
      return;
    }

    const refText = els.cloneText.value.trim();
    if (!refText) {
      setStatus("Reference text is required for voice cloning.", "error");
      return;
    }

    payload.refAudioB64 = refAudioB64;
    payload.refText = refText || null;
  }

  await popupPlayer.unlock();
  setStatus("Sending request...");
  chrome.runtime.sendMessage(payload, (response) => {
    if (!response?.ok) {
      setStatus(response?.error || "Request failed.", "error");
    }
  });
});

els.testTone.addEventListener("click", async () => {
  await popupPlayer.unlock();
  try {
    const ctx = popupPlayer.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 440;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    setStatus("Test tone played.");
  } catch (err) {
    console.error("[WebpageTTS] test tone failed", err);
    setStatus("Test tone failed.", "error");
  }
});

els.testTts.addEventListener("click", async () => {
  await popupPlayer.unlock();
  const serverUrl = els.serverUrl.value.trim() || DEFAULTS.serverUrl;
  setStatus("Testing MLX TTS...");
  try {
    const res = await fetch(`${serverUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "default",
        backend: "mlx",
        text: "Hello. This is a short MLX test.",
      }),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    console.log("[WebpageTTS] test TTS bytes", buf.byteLength);
    popupPlayer.enqueue(buf);
    setStatus("Test TTS queued.");
  } catch (err) {
    console.error("[WebpageTTS] test TTS failed", err);
    setStatus("Test TTS failed.", "error");
  }
});

els.pause.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "pause" });
});

els.resume.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "resume" });
});

els.stop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop" });
  popupPlayer.stop();
  setStatus("Stopped.");
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "progress") return;
  if (message.stage === "start") {
    setStatus(`Speaking... ${message.chunks} chunk(s).`);
  } else if (message.stage === "chunk") {
    setStatus(`Speaking chunk ${message.index}/${message.total}`);
  } else if (message.stage === "done") {
    setStatus("Done.");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "play_audio") return;
  let audioBuffer = message.audioBuffer;
  if (!audioBuffer && message.audioB64) {
    const b64 = message.audioB64.startsWith("data:")
      ? message.audioB64.split(",", 2)[1]
      : message.audioB64;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    audioBuffer = bytes.buffer;
  }
  console.log("[WebpageTTS] popup received audio bytes", audioBuffer?.byteLength);
  if (audioBuffer) {
    popupPlayer.enqueue(audioBuffer);
  }
  sendResponse({ handled: true });
  return true;
});

loadSettings().catch((err) => {
  setStatus(`Failed to load settings: ${err.message}`, "error");
});
