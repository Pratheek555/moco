// Bring-your-own-key cloud narration. Credentials are sent only to ElevenLabs,
// never written to the audio cache or included in provider errors.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TimedWord } from "@moco/spec";
import type { Line } from "./index.ts";
import { amplitudeVisemes, parseWav, type Pcm } from "./lipsync.ts";
import { joinLines, wavFrom, type VoiceInfo } from "./system.ts";
import { ELEVENLABS_MODEL, elevenLabsSupports } from "./elevenlabs-config.ts";

const API = "https://api.elevenlabs.io";
const SAMPLE_RATE = 22_050; // Raw signed 16-bit little-endian PCM, no Pro-tier 44.1 kHz requirement.

export interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  rate?: number;
}

async function request(apiKey: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  if (!apiKey.trim()) throw new Error("Add your ElevenLabs API key in Settings → Voice & narration.");
  const timeout = AbortSignal.timeout(180_000);
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { "xi-api-key": apiKey.trim(), "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    signal?.throwIfAborted();
    throw new Error(timeout.aborted ? "ElevenLabs timed out. Retry to reuse completed narration lines." : "Could not reach ElevenLabs. Check your internet connection and retry.");
  }
  if (!response.ok) {
    // Provider messages may echo submitted text or credentials. Show only our own guidance.
    const failure = await response.json().catch(() => undefined) as { detail?: { status?: string } } | undefined;
    const reason = failure?.detail?.status;
    const guidance = reason === "quota_exceeded" ? "Your ElevenLabs character allowance has been reached. Add credits or renew the allowance, then retry; completed narration takes will be reused."
      : reason === "missing_permissions" ? "The ElevenLabs key is missing permission for this operation. Check its Text to Speech / Voices permissions."
      : reason === "detected_unusual_activity" ? "ElevenLabs has restricted this account's requests. Check the account with ElevenLabs before retrying."
      : response.status === 401 ? "Check your API key in Settings → Voice & narration."
      : response.status === 403 ? "Check the key's Text to Speech / Voices permissions and access to the selected voice."
      : response.status === 402 ? "Check your ElevenLabs credits and subscription."
      : response.status === 429 ? "Your account's rate, concurrency or credit limit was reached. Check your ElevenLabs account, then retry."
      : response.status === 404 ? "The selected voice is unavailable. Load your voices again in Settings."
      : "Check your ElevenLabs account and selected voice, then retry. Completed lines will be reused.";
    throw new Error(`ElevenLabs request failed (${response.status}). ${guidance}`);
  }
  try { return await response.json(); } catch {
    signal?.throwIfAborted();
    throw new Error(timeout.aborted ? "ElevenLabs timed out while returning speech. Retry to reuse completed lines." : "ElevenLabs returned an unreadable response. Retry the request.");
  }
}

export async function elevenLabsVoices(apiKey: string): Promise<VoiceInfo[]> {
  const voices = new Map<string, VoiceInfo>();
  const seen = new Set<string>();
  let token = "";
  do {
    const query = new URLSearchParams({ page_size: "100", include_total_count: "false" });
    if (token) query.set("next_page_token", token);
    const data = await request(apiKey, `/v2/voices?${query}`) as { voices?: { voice_id: string; name: string; labels?: { language?: string } }[]; has_more?: boolean; next_page_token?: string };
    if (!data || !Array.isArray(data.voices)) throw new Error("ElevenLabs returned an invalid voice list.");
    for (const voice of data.voices) {
      if (typeof voice?.voice_id !== "string" || !voice.voice_id || typeof voice.name !== "string") throw new Error("ElevenLabs returned an invalid voice list.");
      voices.set(voice.voice_id, { id: voice.voice_id, name: voice.name, locale: voice.labels?.language ?? "" });
    }
    if (!data.has_more) break;
    token = data.next_page_token ?? "";
    if (!token || seen.has(token)) throw new Error("ElevenLabs could not finish loading your voices. Try again.");
    seen.add(token);
  } while (true);
  return [...voices.values()];
}

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}
interface Take { audio_base64: string; alignment: Alignment }
export { decodeTake as decodeElevenLabsTake };

// Use original-text alignment so normalized numbers stay attached to script words.
// Character entries can be Unicode code points or graphemes, so match by UTF-16 offsets.
function decodeTake(value: unknown, line: Line): { pcm: Pcm; words: TimedWord[] } {
  const take = value as Take | undefined;
  const alignment = take?.alignment;
  if (!take || typeof take.audio_base64 !== "string" || take.audio_base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(take.audio_base64)
    || !alignment || !Array.isArray(alignment.characters) || !Array.isArray(alignment.character_start_times_seconds) || !Array.isArray(alignment.character_end_times_seconds)) {
    throw new Error("ElevenLabs returned invalid audio or missing character timestamps.");
  }
  const bytes = Buffer.from(take.audio_base64, "base64");
  if (!bytes.length || bytes.length % 2) throw new Error("ElevenLabs returned invalid PCM audio.");
  const pcm: Pcm = { sampleRate: SAMPLE_RATE, samples: new Float32Array(bytes.length / 2) };
  pcm.samples.forEach((_, index) => { pcm.samples[index] = bytes.readInt16LE(index * 2) / 32768; });
  const duration = pcm.samples.length / SAMPLE_RATE;
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (characters.length !== starts.length || starts.length !== ends.length || characters.some(char => typeof char !== "string" || !char.length) || characters.join("") !== line.text) {
    throw new Error("ElevenLabs timestamps did not match the narration text. Retry this take.");
  }
  let offset = 0;
  const spans = characters.map((char, index) => {
    const start = starts[index]!, end = ends[index]!;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + 0.05 || (index > 0 && (start < starts[index - 1]! || end < ends[index - 1]!))) {
      throw new Error("ElevenLabs returned invalid character timestamps.");
    }
    const span = { from: offset, to: offset + char.length, start: Math.min(start, duration), end: Math.min(end, duration) };
    offset = span.to;
    return span;
  });
  const words = [...line.text.matchAll(/\S+/gu)].map(match => {
    const first = spans.find(span => span.to > match.index)!;
    const last = spans.find(span => span.to >= match.index + match[0].length)!;
    return { text: match[0], lineId: line.id, start: first.start, end: last.end };
  });
  if (!words.length) throw new Error("ElevenLabs returned no timed narration words.");
  return { pcm, words };
}

export function elevenLabsAudio(options: ElevenLabsOptions) {
  return {
    async voices() { return elevenLabsVoices(options.apiKey); },
    async tts(lines: Line[], voice: { voiceId: string; backend: string }, language: string, outDir: string, signal?: AbortSignal, onProgress?: (completed: number, total: number) => void) {
      signal?.throwIfAborted();
      if (!options.apiKey.trim()) throw new Error("Add your ElevenLabs API key in Settings → Voice & narration.");
      const narrator = voice.voiceId && voice.voiceId !== "default" ? voice.voiceId : options.voiceId;
      if (!narrator?.trim()) throw new Error("Choose an ElevenLabs voice in Settings → Voice & narration.");
      if (!elevenLabsSupports(language)) throw new Error(`ElevenLabs Multilingual v2 does not support ${language}. Choose a supported story language.`);
      const rate = options.rate ?? 1;
      if (!Number.isFinite(rate) || rate < 0.7 || rate > 1.2) throw new Error("ElevenLabs narration speed must be between 0.7 and 1.2.");
      if (!lines.length || lines.some(line => !line.text.trim())) throw new Error("Narration must contain non-empty lines.");
      const cacheDir = join(outDir, ".voice-cache");
      await mkdir(cacheDir, { recursive: true });
      const clips: Pcm[] = [], words: TimedWord[] = [];
      let offset = 0;
      onProgress?.(0, lines.length);
      for (const [index, line] of lines.entries()) {
        signal?.throwIfAborted();
        const voiceId = line.voiceId && line.voiceId !== "default" ? line.voiceId : narrator;
        const body = { text: line.text, model_id: ELEVENLABS_MODEL, voice_settings: { speed: rate },
          previous_text: lines[index - 1]?.text, next_text: lines[index + 1]?.text };
        const hash = createHash("sha256").update(JSON.stringify({ version: 1, voiceId, language, format: "pcm_22050", ...body })).digest("hex");
        const cache = join(cacheDir, `elevenlabs-${hash}.json`);
        let decoded: ReturnType<typeof decodeTake> | undefined;
        try { decoded = decodeTake(JSON.parse(await readFile(cache, "utf8")), line); } catch { /* Regenerate missing/damaged takes. */ }
        if (!decoded) {
          const take = await request(options.apiKey, `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=pcm_22050`, body, signal);
          decoded = decodeTake(take, line);
          const temporary = `${cache}.${randomUUID()}.tmp`;
          try {
            const { audio_base64, alignment } = take as Take;
            await writeFile(temporary, JSON.stringify({ audio_base64, alignment }), { mode: 0o600 });
            await rename(temporary, cache);
          } finally { await rm(temporary, { force: true }); }
        }
        clips.push(decoded.pcm);
        words.push(...decoded.words.map(word => ({ ...word, start: word.start + offset / SAMPLE_RATE, end: word.end + offset / SAMPLE_RATE })));
        offset += decoded.pcm.samples.length + Math.round((line.delivery?.pauseAfterMs ?? 250) * SAMPLE_RATE / 1000);
        onProgress?.(index + 1, lines.length);
      }
      signal?.throwIfAborted();
      const joined = joinLines(lines, clips);
      const file = join(outDir, "vo.wav");
      await writeFile(file, wavFrom(joined.pcm));
      return { file, durationSeconds: joined.pcm.samples.length / SAMPLE_RATE, words, backend: "elevenlabs" };
    },
    async align(): Promise<TimedWord[]> { throw new Error("ElevenLabs returns measured word timings from tts()."); },
    async visemes(file: string, words: TimedWord[]) { return amplitudeVisemes(parseWav(await readFile(file)), words); },
  };
}
