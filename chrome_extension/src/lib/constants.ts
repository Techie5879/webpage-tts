export const DEFAULTS = {
  serverUrl: "http://127.0.0.1:9872",
  source: "selection" as const,
  chunkSize: 420,
  customModelSize: "0.6b" as const,
  speaker: "Vivian",
  playbackRate: 1,
  mode: "custom" as const,
  instruction: "",
  lastAppliedInstruction: "",
  lastAppliedAt: null as number | null,
  designPrompt: "",
  designName: "",
  cloneText: "",
  cloneName: "",
  cloneAudioB64: null as string | null,
  cloneAudioName: "",
  selectedVoiceId: "",
  theme: "light" as const,
  savedVoices: [] as SavedVoice[],
  collapsedSections: {
    session: false,
    voice: false,
    saved: false,
  } as Record<string, boolean>,
};

export const FALLBACK_SPEAKERS = [
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

export interface SavedVoice {
  id: string;
  name: string;
  type: "design" | "clone";
  createdAt?: string;
  sourceVoiceId?: string;
  customModelSize?: "0.6b" | "1.7b";
  speaker?: string;
  instruction?: string;
  refAudioB64?: string;
  refAudioName?: string;
  refAudioMimeType?: string;
  refText?: string;
}
