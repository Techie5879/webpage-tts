import { useSettings } from "@/SettingsContext";
import { readFileAsBase64 } from "@/lib/audio";
import { type SavedVoice } from "@/lib/constants";

function parseMimeTypeFromDataUrl(dataUrl: string | null): string | undefined {
  if (!dataUrl || !dataUrl.startsWith("data:")) return undefined;
  const match = dataUrl.match(/^data:([^;,]+)[;,]/i);
  return match?.[1];
}

export function useVoiceActions() {
  const { state, dispatch, saveField, saveFieldDebounced } = useSettings();
  const selectedVoiceId = state.selectedVoiceId || "";

  const setSelectedVoiceId = (id: string, autoApply = true) => {
    const normalizedId = id === "_empty" ? "" : id;
    dispatch({ type: "SET_FIELD", field: "selectedVoiceId", value: normalizedId });
    chrome.storage.local.set({ selectedVoiceId: normalizedId });
    if (autoApply && normalizedId) {
      // Auto-apply: load the voice fields immediately on dropdown selection
      const voice = state.savedVoices.find((v) => v.id === normalizedId);
      if (voice) {
        if (voice.type === "design") {
          saveField("mode", "design");
          saveField("designPrompt", voice.instruction || "");
          saveField("designName", voice.name || "");
        } else if (voice.type === "clone") {
          saveField("mode", "clone");
          saveField("cloneAudioB64", voice.refAudioB64 || null);
          saveField("cloneText", voice.refText || "");
          saveField("cloneName", voice.name || "");
          saveField("cloneAudioName", voice.refAudioName || "");
        }
      }
    }
  };

  const hasSavedVoiceName = (name: string) => {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return false;
    return state.savedVoices.some(
      (v) => (v.name || "").trim().toLowerCase() === normalized
    );
  };

  const findVoiceByName = (name: string): SavedVoice | undefined => {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return undefined;
    return state.savedVoices.find(
      (v) => (v.name || "").trim().toLowerCase() === normalized
    );
  };

  const getCopyName = (baseName: string) => {
    const normalized = baseName.trim() || "Voice";
    let attempt = `${normalized} (copy)`;
    let copyIndex = 2;
    while (hasSavedVoiceName(attempt)) {
      attempt = `${normalized} (copy ${copyIndex})`;
      copyIndex += 1;
    }
    return attempt;
  };

  const persistVoiceLibrary = (nextVoices: SavedVoice[], nextSelectedVoiceId: string) => {
    dispatch({ type: "SET_FIELD", field: "savedVoices", value: nextVoices });
    dispatch({ type: "SET_FIELD", field: "selectedVoiceId", value: nextSelectedVoiceId });
    chrome.storage.local.set({
      savedVoices: nextVoices,
      selectedVoiceId: nextSelectedVoiceId,
    });
  };

  const handleSaveDesign = () => {
    const name = state.designName.trim();
    const prompt = state.designPrompt.trim();
    if (!name || !prompt) return;
    const existing = findVoiceByName(name);
    if (existing) {
      // Update the existing voice in-place
      const updated: SavedVoice = {
        ...existing,
        instruction: prompt,
        customModelSize: state.customModelSize,
        speaker: state.speaker,
      };
      const nextVoices = state.savedVoices.map((v) =>
        v.id === existing.id ? updated : v
      );
      persistVoiceLibrary(nextVoices, existing.id);
      return;
    }
    const createdAt = new Date().toISOString();
    const voice = {
      id: crypto.randomUUID(),
      name,
      type: "design" as const,
      instruction: prompt,
      createdAt,
      customModelSize: state.customModelSize,
      speaker: state.speaker,
    };
    const nextVoices = [...state.savedVoices, voice];
    persistVoiceLibrary(nextVoices, voice.id);
  };

  const handleSaveClone = async (file?: File) => {
    const name = state.cloneName.trim();
    let refAudioB64 = state.cloneAudioB64;
    if (!refAudioB64 && file) {
      refAudioB64 = await readFileAsBase64(file);
    }
    const refText = state.cloneText.trim();
    if (!name || !refAudioB64) return;
    if (!refText) return;
    const refAudioName = file?.name || state.cloneAudioName || "reference-audio";
    const refAudioMimeType = file?.type || parseMimeTypeFromDataUrl(refAudioB64);
    const existing = findVoiceByName(name);
    if (existing) {
      // Update the existing clone voice in-place
      const updated: SavedVoice = {
        ...existing,
        refAudioB64,
        refText,
        refAudioName,
        refAudioMimeType,
        customModelSize: state.customModelSize,
        speaker: state.speaker,
      };
      const nextVoices = state.savedVoices.map((v) =>
        v.id === existing.id ? updated : v
      );
      persistVoiceLibrary(nextVoices, existing.id);
      saveField("cloneAudioB64", null);
      saveField("cloneAudioName", refAudioName);
      return;
    }
    const createdAt = new Date().toISOString();
    const voice = {
      id: crypto.randomUUID(),
      name,
      type: "clone" as const,
      refAudioB64,
      refText,
      refAudioName,
      refAudioMimeType,
      createdAt,
      customModelSize: state.customModelSize,
      speaker: state.speaker,
    };
    const nextVoices = [...state.savedVoices, voice];
    persistVoiceLibrary(nextVoices, voice.id);
    saveField("cloneAudioB64", null);
    saveField("cloneAudioName", refAudioName);
  };

  const applyVoiceById = (id: string) => {
    if (!id || id === "_empty") return;
    const voice = state.savedVoices.find((v) => v.id === id);
    if (!voice) return;
    if (voice.type === "design") {
      saveField("mode", "design");
      saveField("designPrompt", voice.instruction || "");
      saveField("designName", voice.name || "");
    } else if (voice.type === "clone") {
      saveField("mode", "clone");
      saveField("cloneAudioB64", voice.refAudioB64 || null);
      saveField("cloneText", voice.refText || "");
      saveField("cloneName", voice.name || "");
      saveField("cloneAudioName", voice.refAudioName || "");
    }
  };

  const handleApplyVoice = () => {
    applyVoiceById(selectedVoiceId);
  };

  const handleCloneSavedVoice = () => {
    const id = selectedVoiceId;
    if (!id || id === "_empty") return;
    const sourceVoice = state.savedVoices.find((v) => v.id === id);
    if (!sourceVoice) return;

    const createdAt = new Date().toISOString();
    const clonedVoice: SavedVoice = {
      ...sourceVoice,
      id: crypto.randomUUID(),
      name: getCopyName(sourceVoice.name),
      sourceVoiceId: sourceVoice.id,
      createdAt,
    };

    const nextVoices = [...state.savedVoices, clonedVoice];
    persistVoiceLibrary(nextVoices, clonedVoice.id);
  };

  const handleRemoveVoice = () => {
    const id = selectedVoiceId;
    if (!id || id === "_empty") return;
    const next = state.savedVoices.filter((v) => v.id !== id);
    persistVoiceLibrary(next, "");
  };

  const handleCloneFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      saveField("cloneAudioB64", null);
      saveField("cloneAudioName", "");
      return;
    }
    const b64 = await readFileAsBase64(file);
    saveField("cloneAudioB64", b64);
    saveField("cloneAudioName", file.name);
  };

  return {
    state,
    dispatch,
    saveField,
    saveFieldDebounced,
    selectedVoiceId,
    setSelectedVoiceId,
    handleSaveDesign,
    handleSaveClone,
    handleApplyVoice,
    applyVoiceById,
    handleCloneSavedVoice,
    handleRemoveVoice,
    handleCloneFileChange,
  };
}
