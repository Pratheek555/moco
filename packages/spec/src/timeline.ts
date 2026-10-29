import type { Episode, Shot } from './schema.ts';
import type { Transition } from './vocab.ts';

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const DEFAULT_FPS = 30;

/** Seconds of overlap with the previous shot for each transition. */
export const TRANSITION_SECONDS: Record<Transition, number> = {
  cut: 0,
  fade: 0.5,
  'dip-black': 0.6,
  'dip-white': 0.6,
  flash: 0.35,
  zoom: 0.4,
  'slide-left': 0.45,
  'slide-up': 0.45,
  whip: 0.3,
};

/** Transitions that cross-dissolve (both shots visible at once) rather than cover a cut. */
export const OVERLAPPING: ReadonlySet<Transition> = new Set(['fade', 'zoom', 'slide-left', 'slide-up', 'whip']);

export const toFrames = (seconds: number, fps: number) => Math.max(0, Math.round(seconds * fps));

export const shotSeconds = (shot: Shot) => Math.max(shot.duration, shot.voice ? shot.voice.duration + 0.35 : 0);

export interface TimelineEntry {
  shot: Shot;
  index: number;
  /** First frame of the shot in the episode. */
  from: number;
  /** Total frames the shot is on screen, including its incoming overlap. */
  durationInFrames: number;
  /** Frames at the start that overlap the previous shot. */
  overlapIn: number;
  /** Frames at the start used by the transition effect. */
  transitionFrames: number;
}

export function episodeTimeline(episode: Pick<Episode, 'shots' | 'fps'>): { entries: TimelineEntry[]; durationInFrames: number } {
  const fps = episode.fps || DEFAULT_FPS;
  const entries: TimelineEntry[] = [];
  let cursor = 0;
  episode.shots.forEach((shot, index) => {
    const own = Math.max(1, toFrames(shotSeconds(shot), fps));
    const transitionFrames = index === 0 ? 0 : toFrames(TRANSITION_SECONDS[shot.transition] ?? 0, fps);
    const overlapIn = OVERLAPPING.has(shot.transition) ? Math.min(transitionFrames, Math.floor(own / 2)) : 0;
    const from = Math.max(0, cursor - overlapIn);
    entries.push({ shot, index, from, durationInFrames: own, overlapIn, transitionFrames });
    cursor = from + own;
  });
  return { entries, durationInFrames: Math.max(1, cursor) };
}

export const episodeSeconds = (episode: Pick<Episode, 'shots' | 'fps'>) =>
  episodeTimeline(episode).durationInFrames / (episode.fps || DEFAULT_FPS);

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Spoken words per second used when there is no real voiceover yet. */
export const WORDS_PER_SECOND = 2.6;

/** Evenly spread words over a span when real word timings are missing. */
export function estimateWords(text: string, start: number, end: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const weights = words.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1.5);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0.2, end - start);
  let t = start;
  return words.map((text, i) => {
    const d = (span * weights[i]!) / total;
    const word = { text, start: t, end: t + d };
    t += d;
    return word;
  });
}
