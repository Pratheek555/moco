// Synthetic measurements where we decide what happened on every frame and word.
import { analyseSpeech, type AudioRaw, type Word } from "../src/audio.ts";
import type { ReferenceMeta } from "../src/fetch.ts";
import { combine, type Measurements } from "../src/measure.ts";
import { analyseVideo, type VideoRaw } from "../src/video.ts";

const KEYS = ["cut", "hist", "zoom", "rot", "dx", "dy", "tracked", "inliers", "residual", "active", "res50", "res90", "luma", "sat", "warm", "flow"] as const;
type Values = Record<(typeof KEYS)[number], number>;

// A 30 fps clip; `fill` overrides the calm defaults (slow creep in, plenty of features) frame by frame.
export function clip(frames: number, fill: (frame: number) => Partial<Values> = () => ({})): VideoRaw {
  const series = Object.fromEntries(KEYS.map((key) => [key, [] as number[]])) as unknown as VideoRaw["series"];
  for (let f = 0; f < frames; f += 1) {
    const values: Values = { cut: 12, hist: 0.005, zoom: 1.002, rot: 0, dx: 0, dy: 0, tracked: 300, inliers: 280, residual: 5, active: 0.1, res50: 0.3, res90: 1, luma: 120, sat: 90, warm: 10, flow: 1, ...fill(f) };
    for (const key of KEYS) series[key].push(values[key]);
  }
  return { tool: "test", fps: 30, width: 1080, height: 1920, frames, analysisWidth: 360, series, loop: { histCorrel: 0.9, meanDiff: 5 } };
}

// Words from "text", one every `step` seconds, each lasting 80% of the step; "|" adds a 0.4 s pause.
export function speak(text: string, step = 0.3, start = 0): Word[] {
  const words: Word[] = [];
  let t = start;
  for (const token of text.split(" ")) {
    if (token === "|") {
      t += 0.4;
      continue;
    }
    words.push({ w: token, start: Number(t.toFixed(3)), end: Number((t + step * 0.8).toFixed(3)), p: 0.9 });
    t += step;
  }
  return words;
}

export function audio(words: Word[], duration: number): AudioRaw {
  const levels = Array.from({ length: Math.round(duration / 0.05) }, (_, i) => (words.some((word) => i * 0.05 + 0.025 > word.start && i * 0.05 + 0.025 < word.end) ? -14 : -30));
  const pitch = Array.from({ length: Math.round(duration / 0.02) }, (_, i) => (words.some((word) => i * 0.02 >= word.start && i * 0.02 <= word.end) ? 160 + (i % 10) * 4 : 0));
  return { tool: "test", model: "test", language: "en", languageProbability: 1, duration, words, segments: [], levels: { hop: 0.05, db: levels }, pitch: { hop: 0.02, hz: pitch } };
}

export const meta: ReferenceMeta = { id: "file-test", source: "test.mp4", title: "Test clip", fps: 30, width: 1080, height: 1920, duration: 6 };

export function measurements(raw: VideoRaw, words: Word[]): Measurements {
  const { camera: _camera, ...video } = analyseVideo(raw);
  return combine(meta, video, analyseSpeech(audio(words, video.duration), video.duration), words);
}
