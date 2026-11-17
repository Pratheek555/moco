import type { GeminiNarration } from "./types.ts";

/** Apply only after the provider's subscription-auth filter. Never mutate inherited env. */
export function narrationEnvironment(env: NodeJS.ProcessEnv, narration?: GeminiNarration): NodeJS.ProcessEnv {
  return narration ? { ...env, GEMINI_API_KEY: narration.key, MOCO_GEMINI_TTS_VOICE: narration.voice } : env;
}
