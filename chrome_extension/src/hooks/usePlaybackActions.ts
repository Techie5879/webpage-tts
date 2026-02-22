import { useSettings } from "@/SettingsContext";
import { usePlayback } from "@/PlaybackContext";
import {
  type BasicResponse,
  type OffscreenEnqueueMessage,
  type SetPlaybackRateMessage,
  sendMessage,
  type SpeakMessage,
} from "@/lib/messages";
import { arrayBufferToBase64 } from "@/lib/audio";

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function usePlaybackActions() {
  const { state: settings, saveField } = useSettings();
  const { state: playback, dispatch } = usePlayback();

  const serverUrl = settings.serverUrl.trim() || "http://127.0.0.1:9872";
  const hasPlayback = Number.isFinite(playback.totalSec) && playback.totalSec > 0;
  const percent = hasPlayback
    ? Math.min(100, Math.round((playback.playedSec / playback.totalSec) * 100))
    : 0;

  let progressLabel = "Idle";
  if (hasPlayback) {
    const isComplete = playback.playedSec >= playback.totalSec - 0.05;
    progressLabel =
      playback.status === "paused"
        ? "Paused"
        : playback.status === "stopped"
          ? "Stopped"
          : playback.status === "buffering"
            ? "Buffering"
            : playback.status === "done" || (playback.status === "idle" && isComplete)
              ? "Done"
              : playback.status === "idle"
                ? "Idle"
                : "Playing";
  } else if (playback.totalChunks > 0) {
    progressLabel = "Buffering";
  }

  const progressText = hasPlayback
    ? `${progressLabel} ${formatClock(playback.playedSec)} / ${formatClock(playback.totalSec)}`
    : playback.totalChunks > 0
      ? (playback.statusText || `Buffering chunk ${playback.chunkIndex}/${playback.totalChunks}`)
      : "Idle.";

  const handleSpeak = async () => {
    if (playback.status === "paused") {
      const resumeResponse = await sendMessage<{ type: "resume" }, BasicResponse>({
        type: "resume",
      });
      console.log("[WebpageTTS] sidepanel speak->resume response", resumeResponse);
      return;
    }

    const mode = settings.mode;
    let refAudioB64: string | null = null;
    let refText: string | null = null;

    if (mode === "clone") {
      refAudioB64 = settings.cloneAudioB64;
      refText = settings.cloneText.trim() || null;
      if (!refAudioB64 || !refText) return;
    }

    const instruction =
      mode === "custom"
        ? settings.instruction.trim() || null
        : mode === "design"
          ? settings.designPrompt.trim() || null
          : null;

    if (mode === "design" && !instruction) return;

    const chunkSize = Number(settings.chunkSize) > 0 ? Number(settings.chunkSize) : 420;

    const payload: SpeakMessage = {
      type: "speak",
      serverUrl,
      source: settings.source,
      chunkSize,
      playbackTarget: "offscreen",
      mode,
      playbackRate: settings.playbackRate,
      customModelSize: settings.customModelSize,
      speaker: mode === "custom" ? settings.speaker : undefined,
      instruction,
      refAudioB64,
      refText,
    };

    console.log("[WebpageTTS] sidepanel speak payload", payload);

    const response = await sendMessage<SpeakMessage, BasicResponse>(payload);
    console.log("[WebpageTTS] sidepanel speak response", response);
    if (mode === "custom" && response?.ok) {
      saveField("lastAppliedInstruction", instruction || "");
      saveField("lastAppliedAt", Date.now());
    }
    if (!response?.ok) {
      dispatch({ type: "STOPPED" });
    }
  };

  const handleTestTone = async () => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 440;
      gain.gain.value = 0.1;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (err) {
      console.error("[WebpageTTS] test tone failed", err);
    }
  };

  const handleTestTts = async () => {
    try {
      await sendMessage<{ type: "ensure_offscreen" }, BasicResponse>({
        type: "ensure_offscreen",
      });
      const res = await fetch(`${serverUrl}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "custom",
          backend: "mlx",
          text: "Hello. This is a short MLX test.",
        }),
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const audioB64 = arrayBufferToBase64(buf);
      const enqueueMessage: OffscreenEnqueueMessage = {
        type: "offscreen_enqueue",
        audioB64,
        playbackRate: settings.playbackRate,
      };
      await sendMessage<OffscreenEnqueueMessage, BasicResponse>(enqueueMessage);
    } catch (err) {
      console.error("[WebpageTTS] test TTS failed", err);
    }
  };

  const handleStop = () => {
    sendMessage<{ type: "stop" }, BasicResponse>({ type: "stop" });
    dispatch({ type: "STOPPED" });
  };

  const handlePause = () =>
    sendMessage<{ type: "pause" }, BasicResponse>({ type: "pause" });

  const handleResume = () =>
    sendMessage<{ type: "resume" }, BasicResponse>({ type: "resume" });

  const setPlaybackRate = (rate: number) => {
    saveField("playbackRate", rate);
    const message: SetPlaybackRateMessage = { type: "set_playback_rate", rate };
    sendMessage<SetPlaybackRateMessage, BasicResponse>(message);
  };

  return {
    settings,
    playback,
    serverUrl,
    hasPlayback,
    percent,
    progressLabel,
    progressText,
    handleSpeak,
    handleTestTone,
    handleTestTts,
    handleStop,
    handlePause,
    handleResume,
    setPlaybackRate,
  };
}
