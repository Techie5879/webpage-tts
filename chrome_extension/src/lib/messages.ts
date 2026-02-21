export type TextSource = "selection" | "page";
export type TtsMode = "custom" | "design" | "clone";
export type ModelSize = "0.6b" | "1.7b";
export type PlaybackTarget = "offscreen";
export type PlaybackRuntimeState =
  | "idle"
  | "buffering"
  | "playing"
  | "paused"
  | "stopped"
  | "done";

export type SpeakMessage = {
  type: "speak";
  serverUrl: string;
  source: TextSource;
  chunkSize: number;
  playbackTarget: PlaybackTarget;
  mode: TtsMode;
  playbackRate: number;
  customModelSize: ModelSize;
  speaker?: string;
  instruction?: string | null;
  refAudioB64?: string | null;
  refText?: string | null;
};

export type StopMessage = { type: "stop" };
export type PauseMessage = { type: "pause" };
export type ResumeMessage = { type: "resume" };
export type EnsureOffscreenMessage = { type: "ensure_offscreen" };
export type SetPlaybackRateMessage = { type: "set_playback_rate"; rate: number };
export type PingMessage = { type: "ping" };

export type ProgressMessage = {
  type: "progress";
  stage: "start" | "chunk" | "done" | "stopped";
  chunks?: number;
  index?: number;
  total?: number;
  durationSec?: number;
};

export type PlaybackProgressMessage = {
  type: "playback_progress";
  playedSec: number;
  totalSec: number;
  state: PlaybackRuntimeState;
  requestId?: number | null;
};

export type GetTextMessage = { type: "get_text"; source: TextSource };

export type ContentRequestMessage = GetTextMessage | PingMessage;

export type OffscreenEnqueueMessage = {
  type: "offscreen_enqueue";
  audioB64: string;
  playbackRate?: number;
  durationSec?: number | null;
  requestId?: number | null;
};
export type OffscreenResetMessage = {
  type: "offscreen_reset";
  requestId?: number | null;
};
export type OffscreenStopMessage = { type: "offscreen_stop" };
export type OffscreenPauseMessage = { type: "offscreen_pause" };
export type OffscreenResumeMessage = { type: "offscreen_resume" };
export type OffscreenSetRateMessage = { type: "offscreen_set_rate"; rate: number };

export type SidebarToBackgroundMessage =
  | SpeakMessage
  | StopMessage
  | PauseMessage
  | ResumeMessage
  | EnsureOffscreenMessage
  | SetPlaybackRateMessage
  | PingMessage;

export type BackgroundToSidebarMessage = ProgressMessage | PlaybackProgressMessage;

export type BackgroundToOffscreenMessage =
  | OffscreenEnqueueMessage
  | OffscreenResetMessage
  | OffscreenStopMessage
  | OffscreenPauseMessage
  | OffscreenResumeMessage
  | OffscreenSetRateMessage;

export type RuntimeMessage =
  | SidebarToBackgroundMessage
  | BackgroundToSidebarMessage
  | ContentRequestMessage
  | BackgroundToOffscreenMessage;

export type BasicResponse = { ok: boolean; error?: string };
export type GetTextResponse = { text: string };

function hasTypeField(value: unknown): value is { type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!hasTypeField(value)) return false;
  switch (value.type) {
    case "speak":
    case "stop":
    case "pause":
    case "resume":
    case "ensure_offscreen":
    case "set_playback_rate":
    case "progress":
    case "playback_progress":
    case "get_text":
    case "ping":
    case "offscreen_enqueue":
    case "offscreen_reset":
    case "offscreen_stop":
    case "offscreen_pause":
    case "offscreen_resume":
    case "offscreen_set_rate":
      return true;
    default:
      return false;
  }
}

export function isSidebarToBackgroundMessage(
  message: RuntimeMessage
): message is SidebarToBackgroundMessage {
  switch (message.type) {
    case "speak":
    case "stop":
    case "pause":
    case "resume":
    case "ensure_offscreen":
    case "set_playback_rate":
    case "ping":
      return true;
    default:
      return false;
  }
}

export function isContentRequestMessage(
  message: RuntimeMessage
): message is ContentRequestMessage {
  return message.type === "get_text" || message.type === "ping";
}

export function isBackgroundToSidebarMessage(
  message: RuntimeMessage
): message is BackgroundToSidebarMessage {
  return message.type === "progress" || message.type === "playback_progress";
}

export function isBackgroundToOffscreenMessage(
  message: RuntimeMessage
): message is BackgroundToOffscreenMessage {
  switch (message.type) {
    case "offscreen_enqueue":
    case "offscreen_reset":
    case "offscreen_stop":
    case "offscreen_pause":
    case "offscreen_resume":
    case "offscreen_set_rate":
      return true;
    default:
      return false;
  }
}

export function sendMessage<M extends RuntimeMessage, R>(
  message: M
): Promise<R | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.log("[WebpageTTS] sendMessage error", chrome.runtime.lastError.message);
        resolve(undefined);
        return;
      }
      resolve(response as R);
    });
  });
}
