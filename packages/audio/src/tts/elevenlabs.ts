import type { TtsRequest, TtsResult, VoiceInfo } from './types.ts';

const API = 'https://api.elevenlabs.io/v1';

/** A few stock voices that exist on every ElevenLabs account. */
export const ELEVENLABS_DEFAULT_VOICES: VoiceInfo[] = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam — deep narrator', locale: 'multi', gender: 'male', provider: 'elevenlabs' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel — authoritative', locale: 'multi', gender: 'male', provider: 'elevenlabs' },
  { id: '21m00Tcm4TlvDq8xNO2T', name: 'Rachel — calm', locale: 'multi', gender: 'female', provider: 'elevenlabs' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte — warm', locale: 'multi', gender: 'female', provider: 'elevenlabs' },
];

export async function elevenlabsVoices(apiKey?: string): Promise<VoiceInfo[]> {
  if (!apiKey) return ELEVENLABS_DEFAULT_VOICES;
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs voices failed (${res.status})`);
  const json = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] };
  return json.voices.map((v) => ({ id: v.voice_id, name: v.name, locale: v.labels?.accent ?? 'multi', gender: v.labels?.gender ?? '', provider: 'elevenlabs' as const }));
}

/** ElevenLabs multilingual TTS with character timestamps → exact word timings for captions. */
export async function elevenlabsSynthesize(req: TtsRequest): Promise<TtsResult> {
  if (!req.apiKey) throw new Error('ElevenLabs voice needs an API key (Settings → Voice)');
  const voice = req.voice || ELEVENLABS_DEFAULT_VOICES[0]!.id;
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': req.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: req.text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: req.rate ?? 1 } }),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    audio_base64: string;
    alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  };
  const words: TtsResult['words'] = [];
  const a = json.alignment;
  if (a) {
    let cur = '';
    let start = 0;
    let end = 0;
    a.characters.forEach((ch, i) => {
      if (/\s/.test(ch)) {
        if (cur) words.push({ text: cur, start, end });
        cur = '';
        return;
      }
      if (!cur) start = a.character_start_times_seconds[i] ?? end;
      cur += ch;
      end = a.character_end_times_seconds[i] ?? end;
    });
    if (cur) words.push({ text: cur, start, end });
  }
  return { audio: Buffer.from(json.audio_base64, 'base64'), ext: '.mp3', words };
}
