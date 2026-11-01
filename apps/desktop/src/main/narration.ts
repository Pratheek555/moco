import { systemAudio } from "@moco/audio";
import { chatterboxAudio } from "@moco/audio/chatterbox";
import type { Settings } from "../shared/api.ts";
import { join } from "node:path";
import { modelForLanguage, modelReady, type VoiceRuntime } from "./voice-models.ts";

// Preview and production must use exactly the same voice configuration.
export function narrationAudio(voice: Settings["voice"], runtime: VoiceRuntime) {
  if (voice.backend !== "chatterbox") return systemAudio(voice);
  const base = chatterboxAudio();
  return { ...base, async tts(...args: Parameters<typeof base.tts>) {
    const modelId = modelForLanguage(args[2]);
    if (!await modelReady(runtime.modelsDir, modelId)) throw new Error("Download this language's voice model in Settings → Voice & narration first.");
    return chatterboxAudio({ rate: voice.rate, reference: voice.reference || undefined,
      python: runtime.python, worker: join(runtime.workerDir, "narrate.py"), modelDir: join(runtime.modelsDir, modelId),
      expressiveness: voice.expressiveness ?? 0.65 }).tts(...args);
  } };
}
