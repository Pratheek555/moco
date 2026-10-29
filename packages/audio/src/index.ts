import { estimateWords } from '@moco/spec';
import { ELEVENLABS_DEFAULT_VOICES, elevenlabsSynthesize, elevenlabsVoices } from './tts/elevenlabs.ts';
import { OPENAI_VOICES, openaiSynthesize } from './tts/openai.ts';
import { systemSynthesize, systemVoices } from './tts/system.ts';
import type { TtsProvider, TtsRequest, TtsResult, VoiceInfo } from './tts/types.ts';
import { audioDuration } from './wav.ts';

export { renderMusic, composeMusic } from './music.ts';
export { renderSfx } from './sfx.ts';
export { audioDuration, encodeWav, mp3Duration, wavDuration } from './wav.ts';
export { ELEVENLABS_DEFAULT_VOICES, OPENAI_VOICES };
export type { TtsProvider, TtsRequest, TtsResult, VoiceInfo };

export const TTS_PROVIDERS: { id: TtsProvider; name: string; description: string; needsKey: boolean }[] = [
  { id: 'system', name: 'System voices', description: 'Free and offline. Uses the voices installed on this computer (install Hindi/Indian English speech packs for local accents).', needsKey: false },
  { id: 'elevenlabs', name: 'ElevenLabs', description: 'Studio-quality multilingual voices (Hindi included) with exact word timings. Bring your own API key.', needsKey: true },
  { id: 'openai', name: 'OpenAI voices', description: 'Natural multilingual voices. Uses your OpenAI API key.', needsKey: true },
  { id: 'none', name: 'No voiceover', description: 'Captions and music only.', needsKey: false },
];

export async function listVoices(provider: TtsProvider, apiKey?: string): Promise<VoiceInfo[]> {
  if (provider === 'system') return systemVoices();
  if (provider === 'openai') return OPENAI_VOICES;
  if (provider === 'elevenlabs') return elevenlabsVoices(apiKey);
  return [];
}

export interface SpeechResult extends TtsResult {
  duration: number;
  provider: TtsProvider;
  /** Set when the requested provider failed and we fell back to system voices. */
  fallbackReason?: string;
}

/**
 * Synthesise speech, measure its duration and fill in word timings. If a cloud
 * provider fails (no key, offline, quota), fall back to the OS voice so a render
 * never blocks on the network.
 */
export async function synthesize(provider: TtsProvider, req: TtsRequest): Promise<SpeechResult> {
  if (provider === 'none') throw new Error('Voiceover is turned off');
  const attempt = async (p: TtsProvider): Promise<SpeechResult> => {
    const r = p === 'elevenlabs' ? await elevenlabsSynthesize(req) : p === 'openai' ? await openaiSynthesize(req) : await systemSynthesize({ ...req, voice: p === provider ? req.voice : undefined });
    const duration = audioDuration(r.audio, r.ext) || (r.words.at(-1)?.end ?? 0) + 0.3;
    const words = r.words.length ? r.words : estimateWords(req.text, 0.05, Math.max(0.3, duration - 0.1));
    return { ...r, words, duration, provider: p };
  };
  try {
    return await attempt(provider);
  } catch (err) {
    if (provider === 'system' || req.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { ...(await attempt('system')), fallbackReason: reason };
  }
}
