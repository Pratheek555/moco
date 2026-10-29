import { extractJson, JsonExtractError, type AiProvider } from '@moco/ai';
import { renderMusic, renderSfx, synthesize, type TtsProvider } from '@moco/audio';
import { CHARACTERS } from '@moco/kit/catalog';
import {
  CAPTION_STYLES,
  DEMO_EPISODE,
  EpisodeSchema,
  SFX,
  SeriesSchema,
  episodeSeconds,
  type Brand,
  type Episode,
  type Series,
  type SfxId,
  type Shot,
} from '@moco/spec';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SYSTEM_PROMPT, fixRenderErrorPrompt, planPrompt, repairPrompt, reviseShotPrompt, writeEpisodePrompt, type PlanInput } from './prompts.ts';
import type { ProjectStore } from './store.ts';
import { checkShot, sanitizeMusic, sanitizeShot, stripInvalid } from './validate.ts';

export interface Progress {
  stage?: string;
  /** 0..1 */
  progress?: number;
  /** Streamed model text. */
  text?: string;
  log?: string;
  level?: 'info' | 'warn' | 'error';
}
export type OnProgress = (p: Progress) => void;

export interface VoiceSettings {
  provider: TtsProvider;
  voice?: string;
  rate?: number;
  apiKey?: string;
}

export interface EngineOptions {
  store: ProjectStore;
  /** Resolved lazily so settings changes apply to the next job. */
  ai: () => AiProvider;
  brand?: () => Partial<Brand>;
  maxRepairs?: number;
}

type Json = Record<string, unknown>;
const MAX_REPAIRS_DEFAULT = 2;

export function createEngine(opts: EngineOptions) {
  const { store } = opts;
  const maxRepairs = opts.maxRepairs ?? MAX_REPAIRS_DEFAULT;

  async function askJson<T>(prompt: string, ctx: { seriesId?: string; label: string; onProgress?: OnProgress; signal?: AbortSignal }): Promise<T> {
    const ai = opts.ai();
    const run = async (p: string) => {
      const res = await ai.complete({
        system: SYSTEM_PROMPT,
        prompt: p,
        signal: ctx.signal,
        onText: (text) => ctx.onProgress?.({ text }),
        onStatus: (s) => ctx.onProgress?.({ stage: `${ctx.label} · ${s}` }),
      });
      ctx.onProgress?.({ log: `${ai.label}${res.model ? ` (${res.model})` : ''} answered in ${(res.durationMs / 1000).toFixed(1)}s` });
      if (ctx.seriesId) await store.log(ctx.seriesId, { label: ctx.label, provider: ai.id, model: res.model, ms: res.durationMs, prompt: p.length > 20000 ? `${p.slice(0, 2000)}…[${p.length} chars]` : p, reply: res.text });
      return res.text;
    };
    const first = await run(prompt);
    try {
      return extractJson<T>(first);
    } catch (err) {
      if (!(err instanceof JsonExtractError)) throw err;
      ctx.onProgress?.({ log: `Reply wasn't clean JSON (${err.message}) — asking again`, level: 'warn' });
      const retry = await run(`Your previous reply could not be parsed: ${err.message}\nReply again with ONLY the complete JSON value, no prose, no markdown.\n\nPREVIOUS REPLY:\n${first.slice(0, 60000)}`);
      return extractJson<T>(retry);
    }
  }

  /** Validate shots, send failures back to the AI, and strip what still fails. The auto-fix loop. */
  async function settleShots(rawShots: unknown[], ctx: { seriesId: string; onProgress?: OnProgress; signal?: AbortSignal; keepIds?: string[] }): Promise<Shot[]> {
    const used = new Set<string>();
    let shots: Json[] = rawShots.map((s, i) => sanitizeShot(s, i, used));
    if (ctx.keepIds) shots.forEach((s, i) => ctx.keepIds![i] && (s.id = ctx.keepIds![i]));
    for (let round = 0; round <= maxRepairs; round++) {
      const checks = shots.map((s, i) => ({ i, ...checkShot(s, `shots[${i}]`) }));
      const bad = checks.filter((c) => c.issues.length);
      if (!bad.length) return checks.map((c) => c.shot!);
      if (round === maxRepairs) break;
      ctx.onProgress?.({ stage: `Fixing ${bad.length} shot${bad.length > 1 ? 's' : ''} (attempt ${round + 1})`, log: bad.flatMap((b) => b.issues).slice(0, 12).join('\n'), level: 'warn' });
      const payload = JSON.stringify({ shots: bad.map((b) => shots[b.i]) });
      // Re-number issue paths to match the subset we send back.
      const issues = bad.flatMap((b, k) => b.issues.map((x) => x.replace(/^shots\[\d+\]/, `shots[${k}]`)));
      const fixed = await askJson<{ shots?: unknown[] } | unknown[]>(repairPrompt(payload, issues, 'episode'), {
        seriesId: ctx.seriesId,
        label: 'Auto-fix',
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      }).catch((err) => {
        ctx.onProgress?.({ log: `Auto-fix request failed: ${err instanceof Error ? err.message : err}`, level: 'warn' });
        return null;
      });
      const list = Array.isArray(fixed) ? fixed : Array.isArray(fixed?.shots) ? fixed.shots : [];
      bad.forEach((b, k) => {
        if (!list[k]) return;
        const keep = shots[b.i]!.id as string;
        const others = new Set(shots.filter((_, j) => j !== b.i).map((s) => String(s.id)));
        const next = sanitizeShot(list[k], b.i, others);
        next.id = keep;
        shots[b.i] = next;
      });
    }
    // Last resort: strip invalid parts; drop shots that still fail.
    const out: Shot[] = [];
    shots.forEach((s, i) => {
      const { shot, removed } = stripInvalid(s);
      if (removed.length) ctx.onProgress?.({ log: `Shot ${s.id}: removed ${removed.join(', ')}`, level: 'warn' });
      const c = checkShot(shot, `shots[${i}]`);
      if (c.shot && !c.issues.some((x) => /unknown|no actor|no prop|not a/.test(x))) out.push(c.shot);
      else ctx.onProgress?.({ log: `Dropped shot ${s.id}: ${c.issues.slice(0, 3).join('; ')}`, level: 'error' });
    });
    if (!out.length) throw new Error('The AI could not produce a valid scene after several attempts. Try again or simplify the idea.');
    return out;
  }

  const brand = () => opts.brand?.() ?? {};

  return {
    store,

    async planSeries(input: PlanInput, onProgress?: OnProgress, signal?: AbortSignal): Promise<Series> {
      onProgress?.({ stage: 'Planning the series', progress: 0.05 });
      const raw = await askJson<Json>(planPrompt(input), { label: 'Planning', onProgress, signal });
      const charIds = CHARACTERS.map((c) => c.id);
      const cast = (Array.isArray(raw.cast) ? raw.cast : [])
        .filter((c): c is Json => !!c && typeof c === 'object')
        .map((c) => ({ character: String(c.character ?? '').toLowerCase().trim(), name: String(c.name ?? c.character ?? '').slice(0, 60), role: String(c.role ?? '').slice(0, 240) }))
        .filter((c) => charIds.includes(c.character) && c.name);
      const outlines = (Array.isArray(raw.episodes) ? raw.episodes : [])
        .filter((e): e is Json => !!e && typeof e === 'object')
        .slice(0, input.episodes)
        .map((e, i) => ({
          number: i + 1,
          title: String(e.title ?? `Episode ${i + 1}`).slice(0, 120),
          hook: String(e.hook ?? '').slice(0, 240),
          summary: String(e.summary ?? '').slice(0, 1200),
          beats: (Array.isArray(e.beats) ? e.beats : []).map((b) => String(b).slice(0, 300)).slice(0, 16),
          status: 'planned' as const,
        }));
      if (!outlines.length) throw new Error('The AI did not return any episodes.');
      const title = String(raw.title ?? input.idea).slice(0, 120) || 'Untitled series';
      const now = new Date().toISOString();
      const captions = (CAPTION_STYLES as readonly string[]).includes(String(raw.captions)) ? String(raw.captions) : 'bold';
      const series = SeriesSchema.parse({
        id: store.newSeriesId(title),
        title,
        logline: String(raw.logline ?? '').slice(0, 400),
        idea: input.idea.slice(0, 4000),
        language: input.language,
        style: input.style.slice(0, 60),
        secondsPerEpisode: input.seconds,
        setting: String(raw.setting ?? '').slice(0, 600),
        tone: String(raw.tone ?? '').slice(0, 300),
        cast,
        episodes: outlines,
        memory: { storySoFar: [], notes: String(raw.notes ?? '').slice(0, 4000) },
        music: sanitizeMusic(raw.music),
        captions,
        createdAt: now,
        updatedAt: now,
      });
      await store.saveSeries(series);
      onProgress?.({ stage: 'Series planned', progress: 1, log: `${series.episodes.length} episodes, cast: ${series.cast.map((c) => c.name).join(', ')}` });
      return series;
    },

    async writeEpisode(seriesId: string, number: number, onProgress?: OnProgress, signal?: AbortSignal): Promise<Episode> {
      const series = await store.getSeries(seriesId);
      await store.setStatus(seriesId, number, 'writing');
      try {
        onProgress?.({ stage: `Writing episode ${number}`, progress: 0.05 });
        const raw = await askJson<Json>(writeEpisodePrompt(series, number), { seriesId, label: `Episode ${number}`, onProgress, signal });
        const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
        if (!rawShots.length) throw new Error('The AI returned no shots.');
        onProgress?.({ stage: 'Checking scenes', progress: 0.75 });
        const shots = await settleShots(rawShots, { seriesId, onProgress, signal });
        const outline = series.episodes.find((e) => e.number === number);
        const episode = EpisodeSchema.parse({
          id: `${seriesId}-ep${number}`,
          seriesId,
          number,
          title: String(raw.title ?? outline?.title ?? `Episode ${number}`).slice(0, 120),
          hook: String(raw.hook ?? outline?.hook ?? '').slice(0, 240),
          summary: String(raw.summary ?? outline?.summary ?? '').slice(0, 1200),
          language: series.language,
          shots,
          music: { mood: sanitizeMusic(raw.music ?? series.music) },
          captions: { style: series.captions },
          brand: brand(),
        });
        await store.saveEpisode(seriesId, episode);
        // Memory: what happened, plus any new continuity facts, for later episodes.
        const fresh = await store.getSeries(seriesId);
        fresh.memory.storySoFar[number - 1] = episode.summary;
        fresh.memory.storySoFar = Array.from(fresh.memory.storySoFar, (s) => s ?? '');
        if (typeof raw.notes === 'string' && raw.notes.trim()) fresh.memory.notes = `${fresh.memory.notes}\n${raw.notes.trim()}`.trim().slice(-4000);
        const o = fresh.episodes.find((e) => e.number === number);
        if (o) {
          o.status = 'scripted';
          o.title = episode.title;
          o.updatedAt = new Date().toISOString();
        }
        await store.saveSeries(fresh);
        onProgress?.({ stage: 'Episode written', progress: 1, log: `${episode.shots.length} shots, ${episodeSeconds(episode).toFixed(1)}s` });
        return episode;
      } catch (err) {
        await store.setStatus(seriesId, number, 'error').catch(() => undefined);
        throw err;
      }
    },

    async reviseShot(seriesId: string, number: number, shotId: string, instruction: string, onProgress?: OnProgress, signal?: AbortSignal): Promise<Episode> {
      const series = await store.getSeries(seriesId);
      const episode = await store.getEpisode(seriesId, number);
      if (!episode) throw new Error('Episode not found');
      const index = episode.shots.findIndex((s) => s.id === shotId);
      if (index < 0) throw new Error('Shot not found');
      const old = episode.shots[index]!;
      onProgress?.({ stage: 'Revising shot', progress: 0.1 });
      const raw = await askJson<Json>(reviseShotPrompt(series, episode, old, instruction), { seriesId, label: 'Revise shot', onProgress, signal });
      const [shot] = await settleShots([raw], { seriesId, onProgress, signal, keepIds: [old.id] });
      if (!shot) throw new Error('Revision failed');
      if (shot.narration.trim() === old.narration.trim() && old.voice) shot.voice = old.voice;
      episode.shots[index] = shot;
      await store.saveEpisode(seriesId, episode);
      if (!shot.voice && old.voice) await store.setStatus(seriesId, number, 'scripted');
      onProgress?.({ stage: 'Shot revised', progress: 1 });
      return episode;
    },

    /** Auto-fix after a failed render: find the shot named in the error and have the AI repair it. */
    async repairFromRenderError(seriesId: string, number: number, error: string, onProgress?: OnProgress, signal?: AbortSignal): Promise<boolean> {
      const m = /\[shot:([a-z0-9-]+)\]/.exec(error);
      if (!m) return false;
      const episode = await store.getEpisode(seriesId, number);
      const index = episode?.shots.findIndex((s) => s.id === m[1]) ?? -1;
      if (!episode || index < 0) return false;
      const old = episode.shots[index]!;
      onProgress?.({ stage: `Auto-fixing shot ${old.id}`, log: error.slice(0, 600), level: 'warn' });
      const raw = await askJson<Json>(fixRenderErrorPrompt(old, error), { seriesId, label: 'Render fix', onProgress, signal });
      const [shot] = await settleShots([raw], { seriesId, onProgress, signal, keepIds: [old.id] });
      if (!shot) return false;
      if (shot.narration.trim() === old.narration.trim() && old.voice) shot.voice = old.voice;
      episode.shots[index] = shot;
      await store.saveEpisode(seriesId, episode);
      return true;
    },

    /** Voiceover per shot (cached by text+voice), then a music bed fitted to the final length. */
    async voiceEpisode(seriesId: string, number: number, voice: VoiceSettings, onProgress?: OnProgress, signal?: AbortSignal): Promise<{ episode: Episode; warnings: string[] }> {
      const episode = await store.getEpisode(seriesId, number);
      if (!episode) throw new Error('Write the episode first');
      const dir = store.episodeDir(seriesId, number);
      const audioDir = path.join(dir, 'audio');
      await mkdir(audioDir, { recursive: true });
      const indexFile = path.join(audioDir, 'index.json');
      const cache: Record<string, { hash: string; file: string; duration: number; words: { text: string; start: number; end: number }[] }> = existsSync(indexFile) ? JSON.parse(await readFile(indexFile, 'utf8')) : {};
      const warnings: string[] = [];
      const spoken = episode.shots.filter((s) => s.narration.trim());
      let done = 0;
      for (const shot of episode.shots) {
        if (signal?.aborted) throw new Error('Cancelled');
        const text = shot.narration.trim();
        if (!text || voice.provider === 'none') {
          delete shot.voice;
          continue;
        }
        const hash = createHash('sha1').update(`${voice.provider}|${voice.voice ?? ''}|${voice.rate ?? 1}|${text}`).digest('hex').slice(0, 12);
        const hit = cache[shot.id];
        if (hit && hit.hash === hash && existsSync(path.join(dir, hit.file))) {
          shot.voice = { src: hit.file, duration: hit.duration, words: hit.words };
        } else {
          onProgress?.({ stage: `Voicing shot ${done + 1} of ${spoken.length}`, progress: 0.05 + (0.8 * done) / Math.max(1, spoken.length) });
          const res = await synthesize(voice.provider, { text, voice: voice.voice, rate: voice.rate, apiKey: voice.apiKey, signal });
          if (res.fallbackReason && !warnings.length) warnings.push(`Used system voice: ${res.fallbackReason}`);
          const file = `audio/${shot.id}-${hash}${res.ext}`;
          await writeFile(path.join(dir, file), res.audio);
          cache[shot.id] = { hash, file, duration: res.duration, words: res.words };
          shot.voice = { src: file, duration: res.duration, words: res.words };
        }
        done++;
      }
      await writeFile(indexFile, JSON.stringify(cache, null, 2));
      const seconds = episodeSeconds(episode);
      if (episode.music.mood !== 'none') {
        onProgress?.({ stage: 'Composing music', progress: 0.9 });
        const file = `audio/music-${episode.music.mood}-${seconds.toFixed(1)}.wav`;
        if (!existsSync(path.join(dir, file))) await writeFile(path.join(dir, file), renderMusic(episode.music.mood, seconds, number));
        episode.music.src = file;
      } else delete episode.music.src;
      await store.saveEpisode(seriesId, episode);
      await store.setStatus(seriesId, number, 'voiced');
      for (const w of warnings) onProgress?.({ log: w, level: 'warn' });
      onProgress?.({ stage: 'Voice & music ready', progress: 1, log: `${seconds.toFixed(1)}s total` });
      return { episode, warnings };
    },

    /** Generate (once) and return absolute paths of every sound effect. */
    async ensureSfx(): Promise<Record<SfxId, string>> {
      const dir = path.join(store.cacheDir(), 'sfx');
      await mkdir(dir, { recursive: true });
      const out = {} as Record<SfxId, string>;
      for (const id of SFX) {
        const file = path.join(dir, `${id}.wav`);
        if (!existsSync(file)) await writeFile(file, renderSfx(id));
        out[id] = file;
      }
      return out;
    },

    /** A ready-made series so the app has something to play on first launch. */
    async createDemo(): Promise<Series> {
      const id = 'demo-song-of-god';
      const existing = await store.getSeries(id).catch(() => null);
      if (existing) return existing;
      const now = new Date().toISOString();
      const series = SeriesSchema.parse({
        id,
        title: 'The Song of God',
        logline: 'On the eve of the Mahabharat war, Krishna turns a broken warrior into a hero — told in three reels.',
        idea: 'The Bhagavad Gita as a three-part reel series',
        language: 'en',
        style: 'epic devotional',
        secondsPerEpisode: 30,
        setting: 'Kurukshetra at dusk, two vast armies, dust and banners',
        tone: 'awe, doubt, then resolve',
        cast: [
          { character: 'krishna', name: 'Krishna', role: 'Charioteer and divine guide' },
          { character: 'arjuna', name: 'Arjuna', role: 'The great archer who loses heart' },
          { character: 'bhishma', name: 'Bhishma', role: 'Grandsire on the opposing side' },
        ],
        episodes: [
          { number: 1, title: 'The Song of God', hook: DEMO_EPISODE.hook, summary: DEMO_EPISODE.summary, beats: [], status: 'scripted', updatedAt: now },
          { number: 2, title: 'The Undying Self', hook: 'What if the ones you fear to kill cannot die?', summary: 'Krishna teaches that the soul is eternal — weapons cannot cut it, fire cannot burn it.', beats: ['Arjuna still trembles', 'Krishna: the self is never born and never dies', 'Images of fire, water, wind failing to touch the soul', 'Arjuna looks up, curious'], status: 'planned' },
          { number: 3, title: 'Karma Yoga', hook: 'Act — but let go of the result.', summary: 'Krishna explains selfless action; Arjuna lifts the Gandiva as the conch shells sound.', beats: ['Krishna on action without attachment', 'Examples: the sun, the river, the farmer', 'Arjuna rises', 'Conch shells — the war begins'], status: 'planned' },
        ],
        memory: { storySoFar: [DEMO_EPISODE.summary], notes: 'Krishna is Arjuna’s charioteer; the chariot flies a saffron banner. Bhishma leads the opposing army.' },
        music: 'devotional',
        captions: 'bold',
        createdAt: now,
        updatedAt: now,
      });
      await store.saveSeries(series);
      await store.saveEpisode(id, EpisodeSchema.parse({ ...DEMO_EPISODE, id: `${id}-ep1`, seriesId: id, brand: { ...DEMO_EPISODE.brand, ...brand() } }));
      return series;
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
