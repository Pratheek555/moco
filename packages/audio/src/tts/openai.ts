import type { TtsRequest, TtsResult, VoiceInfo } from './types.ts';

export const OPENAI_VOICES: VoiceInfo[] = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map((id) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  locale: 'multi',
  gender: '',
  provider: 'openai' as const,
}));

/** OpenAI text-to-speech (needs an API key). Word timings are estimated downstream. */
export async function openaiSynthesize(req: TtsRequest): Promise<TtsResult> {
  if (!req.apiKey) throw new Error('OpenAI voice needs an API key (Settings → AI)');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: req.voice || 'onyx', input: req.text, response_format: 'mp3', speed: req.rate ?? 1 }),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`OpenAI TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return { audio: Buffer.from(await res.arrayBuffer()), ext: '.mp3', words: [] };
}
