import { alignedAudio, systemAudio } from "@moco/audio";
import { chatterboxAudio } from "@moco/audio/chatterbox";
import { elevenLabsAudio } from "@moco/audio/elevenlabs";
import type { Settings } from "../shared/api.ts";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { modelForLanguage, modelReady, type VoiceRuntime } from "./voice-models.ts";
import { voiceLanguageProblem } from "../shared/voice-availability.ts";

// Preview and production must use exactly the same voice configuration.
export function narrationAudio(voice: Settings["voice"], runtime: VoiceRuntime, elevenLabsKey = "") {
  if (voice.backend === "elevenlabs") return elevenLabsAudio({ apiKey: elevenLabsKey, voiceId: voice.elevenlabs?.voiceId ?? "", rate: voice.rate });
  if (voice.backend !== "chatterbox") return systemAudio(voice);
  const voices = Object.fromEntries((voice.characterVoices ?? []).map(({ id, reference }) => [id, reference]));
  const base = chatterboxAudio({ voices });
  return { ...base, async tts(...args: Parameters<typeof base.tts>) {
    if (voiceLanguageProblem(args[2], voice, null, null) === "not supported by Chatterbox") throw new Error(`Chatterbox does not support ${args[2]}. Choose a supported language or a system voice.`);
    const modelId = modelForLanguage(args[2]);
    if (!await modelReady(runtime.modelsDir, modelId)) throw new Error("Download this language's voice model in Settings → Voice & narration first.");
    return chatterboxAudio({ rate: voice.rate, reference: voice.reference || undefined, voices,
      device: voice.device ?? "auto",
      python: runtime.python, worker: join(runtime.workerDir, "narrate.py"), modelDir: join(runtime.modelsDir, modelId),
      expressiveness: voice.expressiveness ?? 0.65 }).tts(...args);
  } };
}

// Template canvas cuts need real word boundaries. Keep previews and existing
// productions on their current route, and load local ASR only when requested.
export function productionNarrationAudio(voice: Settings["voice"], runtime: VoiceRuntime, elevenLabsKey = "") {
  const base = narrationAudio(voice,runtime,elevenLabsKey);
  if (voice.backend === "elevenlabs") return { ...base, ttsMeasured: base.tts };
  const python = process.env.MOCO_ALIGN_PYTHON ?? fileURLToPath(new URL(
    process.platform === "win32" ? "../../../../.venv-learn/Scripts/python.exe" : "../../../../.venv-learn/bin/python",import.meta.url));
  const measured = alignedAudio(base,{python,worker:join(runtime.workerDir,"align.py"),model:process.env.MOCO_ALIGN_MODEL ?? "small"});
  return {...base,ttsMeasured:async (...args:Parameters<typeof measured.tts>)=>{
    if(!await stat(python).then(info=>info.isFile(),()=>false)) throw Error("Canvas narration needs local word timing. Run pnpm learn:setup and cache the faster-whisper small model, or set MOCO_ALIGN_PYTHON to a Python runtime with faster-whisper and a cached model. No remote voice service is used.");
    return measured.tts(...args);
  }};
}
