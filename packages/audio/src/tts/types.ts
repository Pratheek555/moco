export type TtsProvider = 'system' | 'elevenlabs' | 'openai' | 'none';

export interface TtsRequest {
  text: string;
  voice?: string;
  /** 1 = normal speed. */
  rate?: number;
  /** Hz offset (edge only). */
  pitch?: number;
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TtsResult {
  audio: Buffer;
  ext: '.mp3' | '.wav';
  /** Word timings in seconds; empty if the engine can't report them. */
  words: { text: string; start: number; end: number }[];
}

export interface VoiceInfo {
  id: string;
  name: string;
  locale: string;
  gender: string;
  provider: TtsProvider;
}
