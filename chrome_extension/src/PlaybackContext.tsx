import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from "react";
import {
  type BackgroundToSidebarMessage,
  isBackgroundToSidebarMessage,
  isRuntimeMessage,
  type PlaybackRuntimeState,
} from "@/lib/messages";

export interface PlaybackState {
  status: "idle" | "buffering" | "playing" | "paused" | "stopped" | "done";
  playedSec: number;
  totalSec: number;
  chunkIndex: number;
  totalChunks: number;
  statusText: string;
}

type PlaybackAction =
  | { type: "SPEAK_START"; totalChunks: number }
  | { type: "CHUNK_RECEIVED"; index: number; total: number }
  | {
      type: "PLAYBACK_PROGRESS";
      playedSec: number;
      totalSec: number;
      state: PlaybackRuntimeState;
    }
  | { type: "DONE" }
  | { type: "STOPPED" }
  | { type: "RESET" };

function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case "SPEAK_START":
      return {
        ...state,
        status: "buffering",
        totalChunks: action.totalChunks,
        chunkIndex: 0,
        statusText: `Speaking... ${action.totalChunks} chunk(s).`,
      };
    case "CHUNK_RECEIVED":
      return {
        ...state,
        chunkIndex: action.index,
        totalChunks: action.total,
        statusText: `Speaking chunk ${action.index}/${action.total}`,
      };
    case "PLAYBACK_PROGRESS":
      return {
        ...state,
        playedSec: action.playedSec,
        totalSec: action.totalSec,
        status:
          action.state === "done"
            ? "done"
            : action.state === "stopped"
              ? "stopped"
              : action.state === "paused"
                ? "paused"
                : action.state === "playing"
                  ? "playing"
                  : action.state === "buffering"
                    ? "buffering"
                    : state.status,
      };
    case "DONE":
      return {
        ...state,
        status: "done",
        statusText: "Done.",
      };
    case "STOPPED":
      return {
        ...state,
        status: "stopped",
        playedSec: 0,
        totalSec: 0,
        chunkIndex: 0,
        totalChunks: 0,
        statusText: "Stopped.",
      };
    case "RESET":
      return {
        status: "idle",
        playedSec: 0,
        totalSec: 0,
        chunkIndex: 0,
        totalChunks: 0,
        statusText: "Idle.",
      };
    default:
      return state;
  }
}

const initialState: PlaybackState = {
  status: "idle",
  playedSec: 0,
  totalSec: 0,
  chunkIndex: 0,
  totalChunks: 0,
  statusText: "Idle.",
};

const PlaybackContext = createContext<{
  state: PlaybackState;
  dispatch: React.Dispatch<PlaybackAction>;
} | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playbackReducer, initialState);

  useEffect(() => {
    const listener = (
      rawMessage: unknown,
      _sender: chrome.runtime.MessageSender
    ) => {
      if (!isRuntimeMessage(rawMessage)) return;
      if (!isBackgroundToSidebarMessage(rawMessage)) return;
      const message: BackgroundToSidebarMessage = rawMessage;

      if (message.type === "progress") {
        if (message.stage === "start") {
          dispatch({ type: "SPEAK_START", totalChunks: message.chunks || 0 });
        } else if (message.stage === "chunk") {
          dispatch({
            type: "CHUNK_RECEIVED",
            index: message.index || 0,
            total: message.total || 0,
          });
        } else if (message.stage === "done") {
          dispatch({ type: "DONE" });
        } else if (message.stage === "stopped") {
          dispatch({ type: "STOPPED" });
        }
      }

      if (message.type === "playback_progress") {
        if (Number.isFinite(message.playedSec) || Number.isFinite(message.totalSec)) {
          dispatch({
            type: "PLAYBACK_PROGRESS",
            playedSec: Number(message.playedSec) || 0,
            totalSec: Number(message.totalSec) || 0,
            state: message.state,
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return (
    <PlaybackContext.Provider value={{ state, dispatch }}>
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used within PlaybackProvider");
  return ctx;
}
