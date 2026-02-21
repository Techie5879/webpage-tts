import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useSettings } from "@/SettingsContext";
import { readFileAsBase64 } from "@/lib/audio";
import { ChevronDown, ChevronRight } from "lucide-react";

export function VoicePanel() {
  const { state, dispatch, saveField, saveFieldDebounced } = useSettings();
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const isCollapsed = state.collapsedSections?.voice ?? false;

  const handleOpenChange = (open: boolean) => {
    dispatch({ type: "TOGGLE_SECTION", section: "voice" });
    chrome.storage.local.set({
      collapsedSections: {
        ...state.collapsedSections,
        voice: !open,
      },
    });
  };

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

  return (
    <Collapsible open={!isCollapsed} onOpenChange={handleOpenChange}>
      <Card className="border-border shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Voice
                </span>
              </div>
              <span className="text-xs text-muted-foreground">Mode + styling</span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4 p-4 pt-0">
            <Tabs
              value={state.mode}
              onValueChange={(v) => {
                const mode = v as "custom" | "design" | "clone";
                dispatch({ type: "SET_FIELD", field: "mode", value: mode });
                saveField("mode", mode);
              }}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="custom">Custom</TabsTrigger>
                <TabsTrigger value="design">Design</TabsTrigger>
                <TabsTrigger value="clone">Clone</TabsTrigger>
              </TabsList>
              <TabsContent value="custom" className="mt-3">
                <Label htmlFor="instruction" className="text-xs">
                  Optional style instruction
                </Label>
                <Textarea
                  id="instruction"
                  rows={2}
                  placeholder="calm, warm, podcast style"
                  value={state.instruction}
                  onChange={(e) => {
                    const v = e.target.value;
                    dispatch({ type: "SET_FIELD", field: "instruction", value: v });
                    saveFieldDebounced("instruction", v);
                  }}
                  className="mt-1"
                />
              </TabsContent>
              <TabsContent value="design" className="mt-3 space-y-3">
                <div>
                  <Label htmlFor="designPrompt" className="text-xs">
                    Voice description
                  </Label>
                  <Textarea
                    id="designPrompt"
                    rows={3}
                    placeholder="A confident British narrator with a smooth, warm tone"
                    value={state.designPrompt}
                    onChange={(e) => {
                      const v = e.target.value;
                      dispatch({ type: "SET_FIELD", field: "designPrompt", value: v });
                      saveFieldDebounced("designPrompt", v);
                    }}
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="designName" className="text-xs">
                      Save as
                    </Label>
                    <Input
                      id="designName"
                      placeholder="My narrator"
                      value={state.designName}
                      onChange={(e) => {
                        const v = e.target.value;
                        dispatch({ type: "SET_FIELD", field: "designName", value: v });
                        saveFieldDebounced("designName", v);
                      }}
                      className="mt-1 h-9"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button variant="ghost" size="sm" onClick={handleSaveDesign}>
                      Save voice
                    </Button>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="clone" className="mt-3 space-y-3">
                <div>
                  <Label htmlFor="cloneAudio" className="text-xs">
                    Reference audio (wav/mp3)
                  </Label>
                  <Input
                    id="cloneAudio"
                    type="file"
                    accept="audio/*"
                    onChange={handleCloneFileChange}
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <Label htmlFor="cloneText" className="text-xs">
                    Reference text
                  </Label>
                  <Textarea
                    id="cloneText"
                    rows={2}
                    placeholder="The exact words spoken in the reference audio"
                    value={state.cloneText}
                    onChange={(e) => {
                      const v = e.target.value;
                      dispatch({ type: "SET_FIELD", field: "cloneText", value: v });
                      saveFieldDebounced("cloneText", v);
                    }}
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="cloneName" className="text-xs">
                      Save as
                    </Label>
                    <Input
                      id="cloneName"
                      placeholder="My cloned voice"
                      value={state.cloneName}
                      onChange={(e) => {
                        const v = e.target.value;
                        dispatch({ type: "SET_FIELD", field: "cloneName", value: v });
                        saveFieldDebounced("cloneName", v);
                      }}
                      className="mt-1 h-9"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const el = document.getElementById("cloneAudio") as HTMLInputElement;
                        handleSaveClone(el?.files?.[0]);
                      }}
                    >
                      Save voice
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="savedVoices" className="text-xs">
                  Saved voices
                </Label>
                <Select
                  value={selectedVoiceId || "_empty"}
                  onValueChange={(v) => setSelectedVoiceId(v === "_empty" ? "" : v)}
                >
                  <SelectTrigger id="savedVoices" className="mt-1 h-9">
                    <SelectValue placeholder="Select a saved voice" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_empty">
                      {state.savedVoices.length === 0 ? "No saved voices" : "Select a saved voice"}
                    </SelectItem>
                    {state.savedVoices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} ({v.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-1">
                <Button variant="ghost" size="sm" onClick={handleApplyVoice}>
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={handleRemoveVoice}
                >
                  Remove
                </Button>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
