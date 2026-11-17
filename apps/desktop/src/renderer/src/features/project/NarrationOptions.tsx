import type { NarrationEngine } from "../../../../shared/api.ts";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group.tsx";
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

export const narrationLabels = { default: "Use story default", kokoro: "Kokoro", zonos: "Zonos", gemini: "Gemini" };

export function NarrationOptions({ value, onChange, disabled, idPrefix }: { value: NarrationEngine | null; onChange(value: NarrationEngine | null): void; disabled?: boolean; idPrefix: string }) {
  const [gemini, setGemini] = useState(false);
  useEffect(() => { let live = true; void api.narrationStatus().then(status => { if (live) setGemini(status.keySet); }).catch(() => {}); return () => { live = false; }; }, []);
  return <div className="space-y-3">
    <RadioGroup aria-label="Narration voice" aria-describedby={`${idPrefix}-help`} value={value ?? "default"} onValueChange={next => onChange(next === "default" ? null : next as NarrationEngine)} disabled={disabled} className="gap-2 p-1">
      {([
        ["default", "Keep the voice chosen in your story."],
        ["kokoro", "Fast local narration."],
        ["zonos", "Expressive local narration with emotion controls."],
        ["gemini", gemini ? "Narration with your own Gemini key." : "Save a key in Settings → Narration to use Gemini."],
      ] as const).filter(([engine]) => engine !== "gemini" || gemini || value === "gemini").map(([engine, description]) => <label key={engine} htmlFor={`${idPrefix}-${engine}`} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border bg-card p-3 transition-colors duration-150 hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring">
        <RadioGroupItem id={`${idPrefix}-${engine}`} value={engine} disabled={engine === "gemini" && !gemini} aria-label={narrationLabels[engine]} className="mt-0.5" />
        <span className="min-w-0 space-y-1"><span className="block font-medium">{narrationLabels[engine]}</span><span className="block text-[13px] leading-5 text-muted-foreground">{description}</span></span>
      </label>)}
    </RadioGroup>
    <p id={`${idPrefix}-help`} className="text-xs leading-5 text-muted-foreground">Zonos downloads its model on first use. An NVIDIA CUDA GPU is recommended; CPU generation can be slow. Uploaded narration keeps its original voice.</p>
  </div>;
}
