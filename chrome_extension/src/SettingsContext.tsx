import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULTS,
  FALLBACK_SPEAKERS,
  type SavedVoice,
} from "@/lib/constants";

export interface SettingsState {
  serverUrl: string;
  source: "selection" | "page";
  chunkSize: number;
  customModelSize: "0.6b" | "1.7b";
  speaker: string;
  playbackRate: number;
  mode: "custom" | "design" | "clone";
  instruction: string;
  lastAppliedInstruction: string;
  lastAppliedAt: number | null;
  designPrompt: string;
  designName: string;
  cloneText: string;
  cloneName: string;
  cloneAudioB64: string | null;
  cloneAudioName: string;
  selectedVoiceId: string;
  theme: "light" | "dark";
  savedVoices: SavedVoice[];
  collapsedSections: Record<string, boolean>;
  loaded: boolean;
}

type SettingsField = keyof SettingsState;
type SetFieldAction = {
  [K in SettingsField]: { type: "SET_FIELD"; field: K; value: SettingsState[K] };
}[SettingsField];

type SettingsAction =
  | { type: "SET_ALL"; payload: Partial<SettingsState> }
  | SetFieldAction
  | { type: "ADD_SAVED_VOICE"; voice: SavedVoice }
  | { type: "REMOVE_SAVED_VOICE"; id: string }
  | { type: "TOGGLE_SECTION"; section: string };

function setField<K extends SettingsField>(
  state: SettingsState,
  field: K,
  value: SettingsState[K]
): SettingsState {
  return { ...state, [field]: value };
}

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case "SET_ALL":
      return { ...state, ...action.payload, loaded: true };
    case "SET_FIELD":
      return setField(state, action.field, action.value);
    case "ADD_SAVED_VOICE":
      return {
        ...state,
        savedVoices: [...state.savedVoices, action.voice],
      };
    case "REMOVE_SAVED_VOICE":
      return {
        ...state,
        savedVoices: state.savedVoices.filter((v) => v.id !== action.id),
      };
    case "TOGGLE_SECTION":
      return {
        ...state,
        collapsedSections: {
          ...state.collapsedSections,
          [action.section]: !state.collapsedSections[action.section],
        },
      };
    default:
      return state;
  }
}

const initialState: SettingsState = {
  ...DEFAULTS,
  loaded: false,
};

type PersistedKey = keyof typeof DEFAULTS;
type PersistedSettings = Pick<SettingsState, PersistedKey>;
type StorageSettings = Omit<Partial<PersistedSettings>, "mode" | "theme"> & {
  mode?: SettingsState["mode"] | "default";
  theme?: SettingsState["theme"] | "default";
};

const SettingsContext = createContext<{
  state: SettingsState;
  dispatch: React.Dispatch<SettingsAction>;
  saveField: <K extends SettingsField>(key: K, value: SettingsState[K]) => void;
  saveFieldDebounced: <K extends SettingsField>(
    key: K,
    value: SettingsState[K]
  ) => void;
  toggleTheme: () => void;
} | null>(null);

const debounceDelays: Partial<Record<SettingsField, number>> = {
  instruction: 300,
  designPrompt: 300,
  designName: 300,
  cloneText: 300,
  cloneName: 300,
  serverUrl: 300,
};

const pendingSaves = new Map<SettingsField, ReturnType<typeof setTimeout>>();

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(settingsReducer, initialState);

  useEffect(() => {
    chrome.storage.local.get(DEFAULTS, (data: StorageSettings) => {
      const payload: Partial<SettingsState> = {};
      const persistedPayload: Partial<Record<PersistedKey, PersistedSettings[PersistedKey]>> = {};
      for (const key of Object.keys(DEFAULTS) as PersistedKey[]) {
        if (data[key] !== undefined) {
          persistedPayload[key] = data[key] as PersistedSettings[typeof key];
        }
      }
      Object.assign(payload, persistedPayload);
      const normalizedVoices = Array.isArray(payload.savedVoices) ? payload.savedVoices : [];
      payload.savedVoices = normalizedVoices;
      if (
        payload.selectedVoiceId &&
        !normalizedVoices.some((voice) => voice.id === payload.selectedVoiceId)
      ) {
        payload.selectedVoiceId = "";
      }
      if (data.theme === "default") payload.theme = "light";
      if (data.mode === "default") payload.mode = "custom";
      dispatch({ type: "SET_ALL", payload });
    });
  }, []);

  useEffect(() => {
    if (!state.loaded) return;
    document.documentElement.classList.toggle("dark", state.theme === "dark");
  }, [state.theme, state.loaded]);

  useEffect(() => {
    if (!state.loaded) return;
    const toSave: Partial<Record<PersistedKey, PersistedSettings[PersistedKey]>> = {};
    const toRemove: PersistedKey[] = [];
    for (const key of Object.keys(DEFAULTS) as PersistedKey[]) {
      const val = state[key];
      if (val !== undefined && JSON.stringify(val) !== JSON.stringify(DEFAULTS[key])) {
        toSave[key] = val as PersistedSettings[typeof key];
      } else {
        toRemove.push(key);
      }
    }
    if (toRemove.length > 0) {
      chrome.storage.local.remove(toRemove);
    }
    if (Object.keys(toSave).length > 0) {
      chrome.storage.local.set(toSave);
    }
  }, [state, state.loaded]);

  const saveField = useCallback(<K extends SettingsField>(key: K, value: SettingsState[K]) => {
    dispatch({ type: "SET_FIELD", field: key, value } as SetFieldAction);
    chrome.storage.local.set({ [key]: value });
  }, []);

  const saveFieldDebounced = useCallback(
    <K extends SettingsField>(key: K, value: SettingsState[K]) => {
    if (pendingSaves.has(key)) {
      const pending = pendingSaves.get(key);
      if (pending) clearTimeout(pending);
    }
    dispatch({ type: "SET_FIELD", field: key, value } as SetFieldAction);
    const delay = debounceDelays[key] ?? 300;
    const timeout = setTimeout(() => {
      chrome.storage.local.set({ [key]: value });
      pendingSaves.delete(key);
    }, delay);
    pendingSaves.set(key, timeout);
    },
    []
  );

  const toggleTheme = useCallback(() => {
    const next = state.theme === "dark" ? "light" : "dark";
    dispatch({ type: "SET_FIELD", field: "theme", value: next });
    chrome.storage.local.set({ theme: next });
  }, [state.theme]);

  return (
    <SettingsContext.Provider
      value={{
        state,
        dispatch,
        saveField,
        saveFieldDebounced,
        toggleTheme,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export async function fetchSpeakers(serverUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${serverUrl}/speakers`);
    if (!res.ok) throw new Error("Bad response");
    const data = (await res.json()) as { speakers?: string[] };
    if (Array.isArray(data.speakers) && data.speakers.length > 0) {
      return data.speakers;
    }
    return FALLBACK_SPEAKERS;
  } catch {
    return FALLBACK_SPEAKERS;
  }
}

export function useSpeakers(serverUrl: string) {
  const [speakers, setSpeakers] = useState<string[]>(FALLBACK_SPEAKERS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!serverUrl?.trim()) return;
    setLoading(true);
    fetchSpeakers(serverUrl.trim())
      .then(setSpeakers)
      .finally(() => setLoading(false));
  }, [serverUrl]);

  return { speakers, loading };
}
