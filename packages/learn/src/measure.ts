// Measures one reference: runs measure.py (video, audio) and ffmpeg's loudness meter, then derives pace and sync.
// Each tool's raw output is kept next to the video, so re-running the pipeline only redoes what changed.
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyseSpeech, parseEbur128, type AudioRaw, type Loudness, type SpeechAnalysis, type Word } from "./audio.ts";
import { extractAudio, type ReferenceMeta } from "./fetch.ts";
import { round, spread, type Spread } from "./stats.ts";
import { runMeasure, runTool, type Tools } from "./tools.ts";
import { analyseVideo, type VideoAnalysis, type VideoRaw } from "./video.ts";

export interface Pace {
  pictureEvery: number; // seconds per shot, on average
  shotSeconds: Spread;
  wordsPerShot: Spread;
  firstChange: number; // seconds until the first transition
  hook: { text: string; end: number }; // the first sentence
  ending: { text: string; start: number }; // the last sentence
  loopFrameSimilarity: number; // last frame vs first frame, histogram correlation (1 = same picture)
}

export interface Sync {
  // Transitions on a word onset (±2 frames) or on a clause start (±4 frames), with the rate chance alone would give.
  cutsOnWord: number;
  cutsOnWordChance: number;
  cutsOnClause: number;
  cutsOnClauseChance: number;
  // Motion bursts vs the nearest clause start after them, in frames at 30 fps (+ = the motion finishes first).
  motionLead: Spread;
  motionBursts: number;
}

export interface Measurements {
  tool: "learn/measure v1";
  ref: ReferenceMeta;
  video: Omit<VideoAnalysis, "camera">;
  speech: SpeechAnalysis;
  words: Word[];
  shotWords: string[]; // the words spoken during each shot
  pace: Pace;
  sync: Sync;
}

export interface MeasureOptions {
  whisperModel: string;
  language?: string;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

export async function measureReference(dir: string, meta: ReferenceMeta, tools: Tools, options: MeasureOptions): Promise<{ measurements: Measurements; camera: VideoAnalysis["camera"] }> {
  const video = join(dir, "source.mp4");
  const videoJson = join(dir, "video.json");
  const audioJson = join(dir, "audio.json");
  const loudnessJson = join(dir, "loudness.json");
  const timeoutMs = Math.max(10 * 60_000, meta.duration * 20_000);

  if (!(await isFresh(videoJson, video))) {
    options.log?.("measuring every frame (cuts, camera, motion)");
    await runMeasure(tools, ["video", video, videoJson], { timeoutMs, signal: options.signal, onLine: options.log });
  }
  const wav = await extractAudio(dir, tools, options.signal);
  if (!(await isFresh(audioJson, wav))) {
    options.log?.(`transcribing with whisper ${options.whisperModel}`);
    const args = ["audio", wav, audioJson, "--model", options.whisperModel];
    if (options.language) args.push("--language", options.language);
    await runMeasure(tools, args, { timeoutMs, signal: options.signal, onLine: options.log });
  }
  if (!(await isFresh(loudnessJson, video))) {
    const { stderr } = await runTool(tools.ffmpeg, ["-hide_banner", "-nostats", "-i", video, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { timeoutMs, signal: options.signal });
    await writeFile(loudnessJson, JSON.stringify(parseEbur128(stderr) ?? null));
  }

  const rawVideo = JSON.parse(await readFile(videoJson, "utf8")) as VideoRaw;
  const rawAudio = JSON.parse(await readFile(audioJson, "utf8")) as AudioRaw;
  const loudness = (JSON.parse(await readFile(loudnessJson, "utf8")) as Loudness | null) ?? undefined;
  const { camera, ...analysis } = analyseVideo(rawVideo);
  const speech = analyseSpeech(rawAudio, analysis.duration, loudness);
  const measurements = combine(meta, analysis, speech, rawAudio.words);
  await writeFile(join(dir, "measurements.json"), JSON.stringify(measurements, null, 2));
  await writeFile(join(dir, "camera.json"), JSON.stringify(camera));
  return { measurements, camera };
}

export function combine(ref: ReferenceMeta, video: Omit<VideoAnalysis, "camera">, speech: SpeechAnalysis, words: Word[]): Measurements {
  const fps = video.fps;
  const shotWords = video.shots.map((shot) => {
    const from = shot.start / fps;
    const to = (shot.end + 1) / fps;
    return words.filter((word) => (word.start + word.end) / 2 >= from && (word.start + word.end) / 2 < to).map((word) => word.w).join(" ");
  });

  const onsets = words.map((word) => word.start * fps);
  const clauses = speech.clauseStarts.map((t) => t * fps);
  const cuts = video.transitions.map((transition) => transition.at);
  const near = (frame: number, targets: number[], within: number) => targets.some((target) => Math.abs(target - frame) <= within);
  const share = (frames: number[], targets: number[], within: number) => (frames.length === 0 ? 0 : round(frames.filter((frame) => near(frame, targets, within)).length / frames.length, 3));
  const allFrames = Array.from({ length: video.frames }, (_, f) => f);

  const leads = video.events.flatMap((event) => {
    const next = clauses.find((clause) => clause >= event.onset - 3);
    return next === undefined || next - event.end > 45 ? [] : [((next - event.end) * 30) / fps];
  });

  const sentences = speech.sentences;
  return {
    tool: "learn/measure v1",
    ref,
    video,
    speech,
    words,
    shotWords,
    pace: {
      pictureEvery: round(video.duration / Math.max(1, video.shots.length), 2),
      shotSeconds: spread(video.shots.map((shot) => shot.duration), 2),
      wordsPerShot: spread(shotWords.map((text) => (text ? text.split(" ").length : 0)), 1),
      firstChange: round((video.transitions[0]?.at ?? video.frames) / fps, 2),
      hook: { text: sentences[0]?.text ?? "", end: round(sentences[0]?.end ?? 0, 2) },
      ending: { text: sentences.at(-1)?.text ?? "", start: round(sentences.at(-1)?.start ?? 0, 2) },
      loopFrameSimilarity: round(video.loop.histCorrel, 3),
    },
    sync: {
      cutsOnWord: share(cuts, onsets, 2),
      cutsOnWordChance: share(allFrames, onsets, 2),
      cutsOnClause: share(cuts, clauses, 4),
      cutsOnClauseChance: share(allFrames, clauses, 4),
      motionLead: spread(leads, 1),
      motionBursts: video.events.length,
    },
  };
}

// A spread as text for prompts and reports, e.g. "2.2s (p10–p90 1.1–3.4s, n=14)".
export function describeSpread(value: Spread, unit: string, digits = 1): string {
  if (!Number.isFinite(value.median)) return "n/a";
  return `${round(value.median, digits)}${unit} (p10–p90 ${round(value.p10, digits)}–${round(value.p90, digits)}${unit}, n=${value.n})`;
}

export function frames30(frames: number, fps: number): number {
  return round((frames * 30) / fps, 1);
}

async function isFresh(output: string, input: string): Promise<boolean> {
  try {
    const [out, src] = await Promise.all([stat(output), stat(input)]);
    return out.size > 0 && out.mtimeMs >= src.mtimeMs;
  } catch {
    return false;
  }
}
