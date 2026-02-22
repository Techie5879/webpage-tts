import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings, useSpeakers } from "@/SettingsContext";
import { usePlaybackActions } from "@/hooks/usePlaybackActions";
import { useVoiceActions } from "@/hooks/useVoiceActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Play,
  Pause,
  Square,
  Moon,
  Sun,
  Zap,
  Volume2,
  Check,
} from "lucide-react";
import { formatClock } from "@/hooks/usePlaybackActions";

export default function V5Accordion() {
  const { state, dispatch, saveField, saveFieldDebounced, toggleTheme } = useSettings();
  const { speakers } = useSpeakers(state.serverUrl);
  const pb = usePlaybackActions();
  const voice = useVoiceActions();
  const [chunkSizeInput, setChunkSizeInput] = useState<string>(
    state.chunkSize > 0 ? String(state.chunkSize) : ""
  );
  const [flashSaveDesign, setFlashSaveDesign] = useState(false);
  const [flashSaveClone, setFlashSaveClone] = useState(false);
  const [flashApply, setFlashApply] = useState(false);
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => flashTimers.current.forEach(clearTimeout);
  }, []);

  const flash = useCallback((setter: (v: boolean) => void) => {
    setter(true);
    const t = setTimeout(() => setter(false), 1500);
    flashTimers.current.push(t);
  }, []);
  const trimmedInstruction = state.instruction.trim();
  const isStyleApplied =
    trimmedInstruction.length > 0 &&
    trimmedInstruction === state.lastAppliedInstruction.trim();
  const lastAppliedClock = state.lastAppliedAt
    ? new Date(state.lastAppliedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  useEffect(() => {
    setChunkSizeInput(state.chunkSize > 0 ? String(state.chunkSize) : "");
  }, [state.chunkSize]);

  return (
    <div className="flex h-full min-h-[400px] flex-col bg-background text-foreground">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Webpage TTS</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Read any page aloud</p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          {state.theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
      </div>

      <div className="border-t border-border" />

      {/* ── All sections, scrollable ──────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Playback section */}
        <SectionHeader title="Playback" subtitle={pb.progressLabel} />
        <div className="px-5 pb-5 pt-1 space-y-4">
          <div className="space-y-1">
            <Progress value={pb.percent} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatClock(pb.playback.playedSec)}</span>
              <span>{formatClock(pb.playback.totalSec)}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Speed</Label>
            <div className="mt-1.5 flex gap-1">
              {[0.75, 1, 1.25, 1.5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => pb.setPlaybackRate(r)}
                  className={cn(
                    "flex-1 rounded py-2 text-sm font-medium transition-colors",
                    state.playbackRate === r
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {r}x
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={pb.handleSpeak} className="flex-1 gap-1.5 text-sm h-10">
              <Play className="h-4 w-4" />
              {pb.playback.status === "paused" ? "Resume" : "Speak"}
            </Button>
            <Button
              variant="outline"
              onClick={pb.playback.status === "paused" ? pb.handleResume : pb.handlePause}
              className="px-3 h-10"
            >
              {pb.playback.status === "paused" ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
            </Button>
            <Button variant="outline" onClick={pb.handleStop} className="px-3 h-10 text-destructive">
              <Square className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Voice section */}
        <SectionHeader title="Voice" subtitle={`${state.mode} mode`} />
        <div className="px-5 pb-5 pt-1 space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <div className="mt-1.5 flex gap-1">
              {(["custom", "design", "clone"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    dispatch({ type: "SET_FIELD", field: "mode", value: m });
                    saveField("mode", m);
                  }}
                  className={cn(
                    "flex-1 rounded py-2 text-sm font-medium capitalize transition-colors",
                    state.mode === m
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {state.mode === "custom" && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Style instruction</Label>
                <Textarea
                  rows={2}
                  placeholder="calm, warm, podcast style"
                  value={state.instruction}
                  onChange={(e) => {
                    dispatch({ type: "SET_FIELD", field: "instruction", value: e.target.value });
                    saveFieldDebounced("instruction", e.target.value);
                  }}
                  className="mt-1.5 text-sm"
                />
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  {trimmedInstruction.length === 0 ? (
                    <span className="text-muted-foreground/70">No style instruction set</span>
                  ) : isStyleApplied ? (
                    <span className="text-emerald-500">Applied to latest custom playback</span>
                  ) : (
                    <span className="text-amber-500">Updated. Press Speak to apply</span>
                  )}
                  {isStyleApplied && lastAppliedClock ? (
                    <span className="text-muted-foreground/70">{lastAppliedClock}</span>
                  ) : null}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Speaker</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {speakers.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        dispatch({ type: "SET_FIELD", field: "speaker", value: s });
                        saveField("speaker", s);
                      }}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs transition-colors",
                        state.speaker === s
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {state.mode === "design" && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Voice description</Label>
                <Textarea
                  rows={3}
                  placeholder="A confident British narrator with a smooth, warm tone"
                  value={state.designPrompt}
                  onChange={(e) => {
                    dispatch({ type: "SET_FIELD", field: "designPrompt", value: e.target.value });
                    saveFieldDebounced("designPrompt", e.target.value);
                  }}
                  className="mt-1.5 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Save as..."
                  value={state.designName}
                  onChange={(e) => {
                    dispatch({ type: "SET_FIELD", field: "designName", value: e.target.value });
                    saveFieldDebounced("designName", e.target.value);
                  }}
                  className="h-9 text-sm flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    voice.handleSaveDesign();
                    flash(setFlashSaveDesign);
                  }}
                  className={cn(
                    "h-9 text-sm gap-1.5 transition-colors duration-300",
                    flashSaveDesign && "bg-emerald-600 hover:bg-emerald-600 text-white"
                  )}
                >
                  {flashSaveDesign ? <><Check className="h-3.5 w-3.5" /> Saved</> : "Save voice"}
                </Button>
              </div>
            </>
          )}

          {state.mode === "clone" && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Reference audio</Label>
                <input
                  id="v5-clone-audio"
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    voice.handleCloneFileChange(e);
                  }}
                  className="hidden"
                />
                <div className="mt-1.5 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 text-sm shrink-0"
                    onClick={() => document.getElementById("v5-clone-audio")?.click()}
                  >
                    Choose file
                  </Button>
                  <span className="text-sm text-muted-foreground truncate">
                    {state.cloneAudioName || "No file chosen"}
                  </span>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Reference text</Label>
                <Textarea
                  rows={2}
                  placeholder="Exact words spoken in reference audio"
                  value={state.cloneText}
                  onChange={(e) => {
                    dispatch({ type: "SET_FIELD", field: "cloneText", value: e.target.value });
                    saveFieldDebounced("cloneText", e.target.value);
                  }}
                  className="mt-1.5 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Clone name"
                  value={state.cloneName}
                  onChange={(e) => {
                    dispatch({ type: "SET_FIELD", field: "cloneName", value: e.target.value });
                    saveFieldDebounced("cloneName", e.target.value);
                  }}
                  className="h-9 text-sm flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const el = document.getElementById("v5-clone-audio") as HTMLInputElement;
                    voice.handleSaveClone(el?.files?.[0]);
                    flash(setFlashSaveClone);
                  }}
                  className={cn(
                    "h-9 text-sm gap-1.5 transition-colors duration-300",
                    flashSaveClone && "bg-emerald-600 hover:bg-emerald-600 text-white"
                  )}
                >
                  {flashSaveClone ? <><Check className="h-3.5 w-3.5" /> Saved</> : "Save voice"}
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-border" />

        {/* Session section */}
        <SectionHeader title="Session" subtitle={`${state.source} / ${state.customModelSize}`} />
        <div className="px-5 pb-5 pt-1 space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Server URL</Label>
            <Input
              type="text"
              value={state.serverUrl}
              onChange={(e) => {
                const v = e.target.value;
                dispatch({ type: "SET_FIELD", field: "serverUrl", value: v });
                saveFieldDebounced("serverUrl", v);
              }}
              onBlur={(e) => saveField("serverUrl", e.target.value.trim())}
              className="mt-1.5 h-9 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Model</Label>
              <div className="mt-1.5 flex gap-1">
                {(["0.6b", "1.7b"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      dispatch({ type: "SET_FIELD", field: "customModelSize", value: m });
                      saveField("customModelSize", m);
                    }}
                    className={cn(
                      "flex-1 rounded py-2 text-sm font-medium transition-colors",
                      state.customModelSize === m
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {m === "0.6b" ? "0.6B Fast" : "1.7B HD"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Chunk size</Label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={chunkSizeInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!/^\d*$/.test(raw)) return;
                  setChunkSizeInput(raw);
                  const parsed = raw === "" ? 0 : Number(raw);
                  dispatch({ type: "SET_FIELD", field: "chunkSize", value: parsed });
                }}
                onBlur={() => {
                  const parsed = chunkSizeInput === "" ? 0 : Number(chunkSizeInput);
                  saveField("chunkSize", Number.isFinite(parsed) ? parsed : 0);
                }}
                className="mt-1.5 h-9 text-sm"
              />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <Label className="text-xs text-muted-foreground">Text source</Label>
              <span className="text-[11px] text-muted-foreground/70">
                {state.source === "selection" ? "selection only" : "whole page"}
              </span>
            </div>
            <div className="mt-1.5 flex gap-1">
              {(["selection", "page"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    dispatch({ type: "SET_FIELD", field: "source", value: s });
                    saveField("source", s);
                  }}
                  className={cn(
                    "flex-1 rounded py-2 text-sm font-medium capitalize transition-colors",
                    state.source === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Saved voices section */}
        <SectionHeader title="Saved Voices" subtitle={`${state.savedVoices.length} saved`} />
        <div className="px-5 pb-5 pt-1 space-y-4">
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 max-w-[220px] flex-1">
              <Select
                value={voice.selectedVoiceId || "_empty"}
                onValueChange={(v) => voice.setSelectedVoiceId(v === "_empty" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_empty">
                    {state.savedVoices.length === 0 ? "No saved voices" : "Select a voice"}
                  </SelectItem>
                  {state.savedVoices.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} ({v.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                voice.handleApplyVoice();
                if (voice.selectedVoiceId && voice.selectedVoiceId !== "_empty") {
                  flash(setFlashApply);
                }
              }}
              className={cn(
                "h-8 px-2.5 text-xs gap-1 transition-colors duration-300",
                flashApply && "border-emerald-600 bg-emerald-600/10 text-emerald-500"
              )}
            >
              {flashApply ? <><Check className="h-3 w-3" /> Applied</> : "Apply"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={voice.handleCloneSavedVoice}
              className="h-8 px-2.5 text-xs"
            >
              Clone
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={voice.handleRemoveVoice}
              className="h-8 px-2.5 text-xs text-destructive"
            >
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* ── Footer: test buttons ────────────────────── */}
      <div className="flex items-center gap-2 border-t border-border px-5 py-3 shrink-0 bg-card mt-auto">
        <Button variant="ghost" size="sm" onClick={pb.handleTestTone} className="flex-1 gap-1.5 text-sm h-9">
          <Zap className="h-4 w-4" />
          Test Tone
        </Button>
        <Button variant="ghost" size="sm" onClick={pb.handleTestTts} className="flex-1 gap-1.5 text-sm h-9">
          <Volume2 className="h-4 w-4" />
          Test TTS
        </Button>
      </div>
    </div>
  );
}

/* ── Section header (non-collapsible) ────────────── */
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex w-full items-center justify-between px-5 py-4">
      <span className="text-base font-bold text-foreground">
        {title}
      </span>
      <span className="text-xs text-muted-foreground capitalize">{subtitle}</span>
    </div>
  );
}
