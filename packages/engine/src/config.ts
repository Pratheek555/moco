// Engine configuration: where projects live, limits, and the default voice.
export interface EngineLimits {
  maxAttemptsPerShot: number; // generate → validate → fix rounds before the fallback shot
  maxAttemptsPerPlanStage: number; // same, for plan/bible/script/shot list/memory
  maxAiCallsPerEpisode: number; // hard cap on AI calls for one episode
  maxSendBacks: number; // VO-duration send-backs to the script before asking the user
  aiConcurrency: number; // parallel AI calls (subscription rate limits)
  aiTimeoutMs: number;
}

export interface EngineConfig {
  projectsDir: string;
  limits: EngineLimits;
  // Script fitting: target seconds of 30–60 per episode.
  targetSeconds: { min: number; max: number };
  // Shot length bounds in seconds.
  shotSeconds: { min: number; max: number };
  // Speaking rate per language (words per minute), used to budget script length.
  // shortcut: only English is a known rate; set Hindi etc. from the TTS spike results.
  wordsPerMinute: Record<string, number>;
  // Narrator voice. Engine-chosen, not AI-chosen, so the bible can't invent a voice.
  voice: { voiceId: string; backend: string };
}

export const defaultConfig = (projectsDir: string): EngineConfig => ({
  projectsDir,
  limits: {
    maxAttemptsPerShot: 3,
    maxAttemptsPerPlanStage: 3,
    maxAiCallsPerEpisode: 60,
    maxSendBacks: 2,
    aiConcurrency: 2,
    aiTimeoutMs: 180_000,
  },
  targetSeconds: { min: 30, max: 60 },
  shotSeconds: { min: 1.5, max: 6 },
  wordsPerMinute: { en: 150 },
  voice: { voiceId: "default", backend: "kokoro" },
});

// Words-per-minute for a language, falling back to English's rate.
export function wordsPerMinute(config: EngineConfig, language: string): number {
  return config.wordsPerMinute[language] ?? config.wordsPerMinute.en ?? 150;
}
