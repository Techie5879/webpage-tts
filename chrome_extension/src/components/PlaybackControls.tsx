import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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

function formatClock(seconds: number): string {
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

export function PlaybackControls() {
  const { state: settings, saveField } = useSettings();
  const { state: playback, dispatch } = usePlayback();

  const serverUrl = settings.serverUrl.trim() || "http://127.0.0.1:9872";
  const hasPlayback =
    Number.isFinite(playback.totalSec) && playback.totalSec > 0;
  const percent = hasPlayback
    ? Math.min(
        100,
        Math.round((playback.playedSec / playback.totalSec) * 100)
      )
    : 0;

  let progressText = "Idle.";
  if (hasPlayback) {
    const isComplete =
      playback.playedSec >= playback.totalSec - 0.05;
    const label =
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
    progressText = `${label} ${formatClock(playback.playedSec)} / ${formatClock(playback.totalSec)}`;
  } else if (playback.totalChunks > 0) {
    progressText = playback.statusText || `Buffering chunk ${playback.chunkIndex}/${playback.totalChunks}`;
  }

  const handleSpeak = async () => {
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

    const payload: SpeakMessage = {
      type: "speak",
      serverUrl,
      source: settings.source,
      chunkSize: Number(settings.chunkSize) || 420,
      playbackTarget: "offscreen",
      mode,
      playbackRate: settings.playbackRate,
      customModelSize: settings.customModelSize,
      speaker: mode === "custom" ? settings.speaker : undefined,
      instruction,
      refAudioB64,
      refText,
    };

    const response = await sendMessage<SpeakMessage, BasicResponse>(payload);
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

  const handlePause = () => sendMessage<{ type: "pause" }, BasicResponse>({ type: "pause" });
  const handleResume = () => sendMessage<{ type: "resume" }, BasicResponse>({ type: "resume" });

  return (
    <Card className="rounded-none border-x-0 border-b-0 border-t border-border shadow-none">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Playback
          </span>
          <span className="text-xs text-muted-foreground">Live controls</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <div>
          <Progress value={percent} className="h-2" />
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {progressText}
          </p>
        </div>
        <div>
          <Label className="text-xs">Speed</Label>
          <RadioGroup
            value={String(settings.playbackRate)}
            onValueChange={(v) => {
              const rate = Number(v);
              saveField("playbackRate", rate);
              const message: SetPlaybackRateMessage = { type: "set_playback_rate", rate };
              sendMessage<SetPlaybackRateMessage, BasicResponse>(message);
            }}
            className="mt-1 flex gap-2"
          >
            {[0.75, 1, 1.25, 1.5].map((r) => (
              <div key={r} className="flex items-center space-x-2">
                <RadioGroupItem value={String(r)} id={`rate-${r}`} />
                <Label
                  htmlFor={`rate-${r}`}
                  className="cursor-pointer text-xs font-normal"
                >
                  {r}x
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleSpeak}>
            Speak
          </Button>
          <Button variant="ghost" size="sm" onClick={handleTestTone}>
            Test Tone
          </Button>
          <Button variant="ghost" size="sm" onClick={handleTestTts}>
            Test TTS (MLX)
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handlePause}>
            Pause
          </Button>
          <Button variant="ghost" size="sm" onClick={handleResume}>
            Resume
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={handleStop}
          >
            Stop
          </Button>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {playback.statusText}
        </p>
      </CardContent>
    </Card>
  );
}
