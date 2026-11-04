import { systemAudio } from "@moco/audio";
import { chatterboxAudio } from "@moco/audio/chatterbox";
import type { Settings } from "../shared/api.ts";
import { join } from "node:path";
import { modelForLanguage, modelReady, type VoiceRuntime } from "./voice-models.ts";
import { voiceLanguageProblem } from "../shared/voice-availability.ts";

// Preview and production must use exactly the same voice configuration.
export function narrationAudio(voice: Settings["voice"], runtime: VoiceRuntime) {
  if (voice.backend !== "chatterbox") return systemAudio(voice);
  const voices = Object.fromEntries((voice.characterVoices ?? []).map(({ id, reference }) => [id, reference]));
  const base = chatterboxAudio({ voices });
  return { ...base, async tts(...args: Parameters<typeof base.tts>) {
    if (voiceLanguageProblem(args[2], voice, null, null) === "not supported by Chatterbox") throw new Error(`Chatterbox does not support ${args[2]}. Choose a supported language or a system voice.`);
    const modelId = modelForLanguage(args[2]);
    if (!await modelReady(runtime.modelsDir, modelId)) throw new Error("Download this language's voice model in Settings → Voice & narration first.");
    return chatterboxAudio({ rate: voice.rate, reference: voice.reference || undefined, voices,
      python: runtime.python, worker: join(runtime.workerDir, "narrate.py"), modelDir: join(runtime.modelsDir, modelId),
      expressiveness: voice.expressiveness ?? 0.65 }).tts(...args);
  } };
}
