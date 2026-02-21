import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings, useSpeakers } from "@/SettingsContext";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function SessionPanel() {
  const { state, saveField, saveFieldDebounced, dispatch } = useSettings();
  const { speakers } = useSpeakers(state.serverUrl);
  const isCollapsed = state.collapsedSections?.session ?? false;

  const handleOpenChange = (open: boolean) => {
    dispatch({ type: "TOGGLE_SECTION", section: "session" });
    chrome.storage.local.set({
      collapsedSections: {
        ...state.collapsedSections,
        session: !open,
      },
    });
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
                  Session
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                Source + playback
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4 p-4 pt-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="serverUrl" className="text-xs">
                  Server URL
                </Label>
                <Input
                  id="serverUrl"
                  type="text"
                  placeholder="http://127.0.0.1:9872"
                  value={state.serverUrl}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    dispatch({ type: "SET_FIELD", field: "serverUrl", value: v });
                    saveFieldDebounced("serverUrl", v);
                  }}
                  onBlur={(e) => saveField("serverUrl", e.target.value.trim())}
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Model size</Label>
                <RadioGroup
                  value={state.customModelSize}
                  onValueChange={(v) => {
                    const modelSize = v as "0.6b" | "1.7b";
                    dispatch({
                      type: "SET_FIELD",
                      field: "customModelSize",
                      value: modelSize,
                    });
                    saveField("customModelSize", modelSize);
                  }}
                  className="mt-1 flex gap-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="0.6b" id="model-0.6b" />
                    <Label htmlFor="model-0.6b" className="cursor-pointer text-xs font-normal">
                      0.6B Fast
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="1.7b" id="model-1.7b" />
                    <Label htmlFor="model-1.7b" className="cursor-pointer text-xs font-normal">
                      1.7B Quality
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              <div>
                <Label htmlFor="chunkSize" className="text-xs">
                  Chunk size
                </Label>
                <Input
                  id="chunkSize"
                  type="number"
                  min={200}
                  max={1200}
                  step={20}
                  value={state.chunkSize}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 420;
                    dispatch({ type: "SET_FIELD", field: "chunkSize", value: v });
                    saveField("chunkSize", v);
                  }}
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label htmlFor="source" className="text-xs">
                  Text source
                </Label>
                <Select
                  value={state.source}
                  onValueChange={(v) => {
                    const source = v as "selection" | "page";
                    dispatch({
                      type: "SET_FIELD",
                      field: "source",
                      value: source,
                    });
                    saveField("source", source);
                  }}
                >
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="selection">
                      Selection (fallback to page)
                    </SelectItem>
                    <SelectItem value="page">Whole page</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {state.mode === "custom" && (
              <div>
                <Label className="text-xs">Speaker</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {speakers.map((speaker) => (
                    <button
                      key={speaker}
                      type="button"
                      onClick={() => {
                        dispatch({ type: "SET_FIELD", field: "speaker", value: speaker });
                        saveField("speaker", speaker);
                      }}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs transition-colors",
                        state.speaker === speaker
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/80"
                      )}
                    >
                      {speaker}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
