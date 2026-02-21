import {
  AudioQueue,
  base64ToArrayBuffer,
  HTMLAudioStrategy,
} from "@/lib/audio";
import {
  type BackgroundToOffscreenMessage,
  type BasicResponse,
  isBackgroundToOffscreenMessage,
  isRuntimeMessage,
  type PlaybackProgressMessage,
  type PlaybackRuntimeState,
} from "@/lib/messages";

function toPlaybackRuntimeState(state: string): PlaybackRuntimeState {
  switch (state) {
    case "buffering":
    case "playing":
    case "paused":
    case "stopped":
    case "done":
      return state;
    default:
      return "idle";
  }
}

function emitProgress(data: { playedSec: number; totalSec: number; state: string }): void {
  const progressMessage: PlaybackProgressMessage = {
    type: "playback_progress",
    playedSec: data.playedSec,
    totalSec: data.totalSec,
    state: toPlaybackRuntimeState(data.state),
  };
  chrome.runtime.sendMessage(progressMessage);
}

const strategy = new HTMLAudioStrategy(emitProgress);
const player = new AudioQueue(strategy, null);

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BasicResponse) => void
  ) => {
    if (!isRuntimeMessage(rawMessage)) return;
    if (!isBackgroundToOffscreenMessage(rawMessage)) return;
    const message: BackgroundToOffscreenMessage = rawMessage;

    if (message.type === "offscreen_enqueue") {
      let audioBuffer: ArrayBuffer | undefined;
      if (message.audioB64) {
        audioBuffer = base64ToArrayBuffer(message.audioB64);
      }
      if (audioBuffer) {
        player.enqueue(
          audioBuffer,
          message.playbackRate,
          Number(message.durationSec) || null,
          message.requestId ?? null
        );
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "offscreen_reset") {
      player.reset(message.requestId ?? null);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "offscreen_stop") {
      player.stop();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "offscreen_pause") {
      player.pause();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "offscreen_resume") {
      player.resume();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "offscreen_set_rate") {
      player.setPlaybackRate(message.rate ?? 1);
      sendResponse({ ok: true });
      return;
    }
  }
);
