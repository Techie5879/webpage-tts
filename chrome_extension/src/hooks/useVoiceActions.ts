import { useState } from "react";
import { useSettings } from "@/SettingsContext";
import { readFileAsBase64 } from "@/lib/audio";

export function useVoiceActions() {
  const { state, dispatch, saveField, saveFieldDebounced } = useSettings();
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");

  const hasSavedVoiceName = (name: string) => {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return false;
    return state.savedVoices.some(
      (v) => (v.name || "").trim().toLowerCase() === normalized
    );
  };

  const handleSaveDesign = () => {
    const name = state.designName.trim();
    const prompt = state.designPrompt.trim();
    if (!name || !prompt) return;
    if (hasSavedVoiceName(name)) return;
    const voice = {
      id: crypto.randomUUID(),
      name,
      type: "design" as const,
      instruction: prompt,
    };
    dispatch({ type: "ADD_SAVED_VOICE", voice });
    chrome.storage.local.set({
      savedVoices: [...state.savedVoices, voice],
    });
    setSelectedVoiceId(voice.id);
  };

  const handleSaveClone = async (file?: File) => {
    const name = state.cloneName.trim();
    let refAudioB64 = state.cloneAudioB64;
    if (!refAudioB64 && file) {
      refAudioB64 = await readFileAsBase64(file);
    }
    const refText = state.cloneText.trim();
    if (!name || !refAudioB64) return;
    if (hasSavedVoiceName(name)) return;
    if (!refText) return;
    const voice = {
      id: crypto.randomUUID(),
      name,
      type: "clone" as const,
      refAudioB64,
      refText,
    };
    dispatch({ type: "ADD_SAVED_VOICE", voice });
    chrome.storage.local.set({
      savedVoices: [...state.savedVoices, voice],
    });
    dispatch({ type: "SET_FIELD", field: "cloneAudioB64", value: null });
    setSelectedVoiceId(voice.id);
  };

  const handleApplyVoice = () => {
    const id = selectedVoiceId;
    if (!id || id === "_empty") return;
    const voice = state.savedVoices.find((v) => v.id === id);
    if (!voice) return;
    if (voice.type === "design") {
      dispatch({ type: "SET_FIELD", field: "mode", value: "design" });
      dispatch({ type: "SET_FIELD", field: "designPrompt", value: voice.instruction || "" });
      dispatch({ type: "SET_FIELD", field: "designName", value: voice.name || "" });
      saveField("mode", "design");
      saveField("designPrompt", voice.instruction || "");
      saveField("designName", voice.name || "");
    } else if (voice.type === "clone") {
      dispatch({ type: "SET_FIELD", field: "mode", value: "clone" });
      dispatch({ type: "SET_FIELD", field: "cloneAudioB64", value: voice.refAudioB64 || null });
      dispatch({ type: "SET_FIELD", field: "cloneText", value: voice.refText || "" });
      dispatch({ type: "SET_FIELD", field: "cloneName", value: voice.name || "" });
      saveField("mode", "clone");
      saveField("cloneText", voice.refText || "");
      saveField("cloneName", voice.name || "");
    }
  };

  const handleRemoveVoice = () => {
    const id = selectedVoiceId;
    if (!id || id === "_empty") return;
    const next = state.savedVoices.filter((v) => v.id !== id);
    dispatch({ type: "SET_FIELD", field: "savedVoices", value: next });
    chrome.storage.local.set({ savedVoices: next });
    setSelectedVoiceId("");
  };

  const handleCloneFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const b64 = await readFileAsBase64(file);
      dispatch({ type: "SET_FIELD", field: "cloneAudioB64", value: b64 });
    }
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
    handleRemoveVoice,
    handleCloneFileChange,
  };
}
