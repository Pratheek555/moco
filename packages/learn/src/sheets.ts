// Tile sheets: the frames the agents look at, picked from the measurements and drawn by measure.py.
// Every tile carries its frame number and the word being spoken, so timing is read frame by frame, not guessed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Word } from "./audio.ts";
import type { Measurements } from "./measure.ts";
import { round } from "./stats.ts";
import { runMeasure, type Tools } from "./tools.ts";
import type { CameraFrame, MotionEvent, Shot, Transition } from "./video.ts";

export interface Swatch {
  hex: string;
  share: number;
}

export interface SheetSet {
  overview: string[];
  transitions: { file: string; index: number }[]; // index into measurements.video.transitions
  events: { file: string; index: number }[]; // index into measurements.video.events
  bursts: { file: string; shot: number }[];
  charts: { camera: string; audio: string };
  palettes: Record<string, Swatch[]>; // by shot label, "S1"…
}

interface Tile {
  frame: number;
  label: string;
  caption?: string;
  mark?: boolean;
}

interface SheetPlan {
  name: string;
  title: string;
  cols: number;
  tileWidth: number;
  tiles: Tile[];
}

interface ChartPlan {
  name: string;
  title: string;
  width: number;
  height: number;
  duration: number;
  markers: number[];
  panels: { label: string; series: { label: string; color: [number, number, number]; hop: number; values: (number | null)[] }[]; bands?: [number, number][]; minScale?: number }[];
}

const MAX_PIXELS = 1_250_000; // about what the model sees at full detail per image
const MAX_EDGE = 1900;

export function planSheets(m: Measurements, camera: (CameraFrame | null)[], dir: string) {
  const { video } = m;
  const fps = video.fps;
  const portrait = video.height >= video.width;
  const aspect = video.height / video.width;
  const sheets: SheetPlan[] = [];
  const caption = captionsFor(m.words, fps);

  // Overview: one frame from the middle of every shot, with the words spoken over it.
  const perSheet = portrait ? 24 : 16;
  const cols = portrait ? 6 : 4;
  const overview: string[] = [];
  for (let i = 0; i < video.shots.length; i += perSheet) {
    const shots = video.shots.slice(i, i + perSheet);
    const name = `overview-${overview.length + 1}`;
    overview.push(name);
    sheets.push({
      name,
      title: `Shots ${shots[0]!.index}-${shots.at(-1)!.index}: middle frame of each shot, with its words`,
      cols,
      tileWidth: tileWidth(cols, Math.ceil(shots.length / cols), aspect, true),
      tiles: shots.map((shot) => ({
        frame: Math.round((shot.start + shot.end) / 2),
        label: `S${shot.index} ${round(shot.start / fps, 1)}s +${round(shot.duration, 1)}s`,
        caption: firstWords(m.shotWords[shot.index - 1] ?? "", 7),
      })),
    });
  }

  // Transitions: every frame either side of the change.
  const transitions = pickTransitions(video.transitions, video.duration).map((index) => {
    const transition = video.transitions[index]!;
    const name = `transition-${index + 1}`;
    const frames = frameRange(transition.start - 6, transition.end + 6, video.frames, 18);
    sheets.push({
      name,
      title: `Transition ${index + 1} (${transition.kind}) at ${round(transition.at / fps, 2)}s: red = the change; captions = words, ">" marks a word's first frame`,
      cols: 6,
      tileWidth: tileWidth(6, Math.ceil(frames.length / 6), aspect, true),
      tiles: frames.map((frame) => ({ frame, label: `f${frame}`, caption: caption(frame), mark: frame >= transition.start && frame <= transition.end })),
    });
    return { file: name, index };
  });

  // Motion bursts: the frames of each candidate gesture or face change, with the words around it.
  const events = pickEvents(video.events, video.duration).map((index) => {
    const event = video.events[index]!;
    const name = `motion-${index + 1}`;
    const frames = frameRange(event.onset - 4, event.end + 8, video.frames, 18);
    sheets.push({
      name,
      title: `Motion burst ${index + 1} in S${event.shot}: red = measured motion (frames ${event.onset}-${event.end}); ">" marks a word's first frame`,
      cols: 6,
      tileWidth: tileWidth(6, Math.ceil(frames.length / 6), aspect, true),
      tiles: frames.map((frame) => ({ frame, label: `f${frame}`, caption: caption(frame), mark: frame >= event.onset && frame <= event.end })),
    });
    return { file: name, index };
  });

  // Bursts: one second of consecutive frames from a few shots, to see creep and continuous motion.
  const bursts = pickBurstShots(video.shots).map((shot) => {
    const name = `burst-s${shot.index}`;
    const first = Math.min(shot.start + 2, shot.end);
    const frames = frameRange(first, Math.min(shot.end, first + 29), video.frames, 30);
    sheets.push({
      name,
      title: `S${shot.index}: ${frames.length} consecutive frames (camera ${shot.camera.profile}, ${shot.camera.dominant})`,
      cols: 6,
      tileWidth: tileWidth(6, Math.ceil(frames.length / 6), aspect, true),
      tiles: frames.map((frame) => ({ frame, label: `f${frame}`, caption: caption(frame) })),
    });
    return { file: name, shot: shot.index };
  });

  const markers = video.transitions.map((transition) => transition.at / fps);
  const values = (key: keyof CameraFrame) => camera.map((frame) => (frame ? frame[key] : null));
  const charts: ChartPlan[] = [
    {
      name: "chart-camera",
      title: "Camera per frame (lavender lines = transitions; gaps = blur or lost tracking)",
      width: 1800,
      height: 1000,
      duration: video.duration,
      markers,
      panels: [
        { label: "zoom %/fr (+in)", series: [{ label: "zoom", color: [200, 40, 40], hop: 1 / fps, values: values("zoom") }], minScale: 0.5 },
        { label: "pan x %/fr (+right)", series: [{ label: "pan x", color: [40, 90, 200], hop: 1 / fps, values: values("panX") }], minScale: 0.5 },
        { label: "pan y %/fr (+up)", series: [{ label: "pan y", color: [40, 150, 90], hop: 1 / fps, values: values("panY") }], minScale: 0.5 },
        { label: "speed %/fr", series: [{ label: "speed", color: [30, 30, 30], hop: 1 / fps, values: values("speed") }], minScale: 0.5 },
      ],
    },
    {
      name: "chart-audio",
      title: "Voice level (dB above -80) and pitch (Hz); green bars = words; lavender lines = transitions",
      width: 1800,
      height: 700,
      duration: video.duration,
      markers,
      panels: [
        { label: "level dB+80", series: [{ label: "level", color: [40, 40, 40], hop: 0.05, values: [] }], bands: m.words.map((word) => [word.start, word.end]) },
        { label: "pitch Hz", series: [{ label: "pitch", color: [160, 60, 160], hop: 0.02, values: [] }] },
      ],
    },
  ];

  return {
    plan: {
      video: join(dir, "source.mp4"),
      outDir: join(dir, "sheets"),
      sheets,
      charts,
      palettes: video.shots.map((shot) => ({ key: `S${shot.index}`, frame: Math.round((shot.start + shot.end) / 2) })),
    },
    set: { overview, transitions, events, bursts },
  };
}

export async function renderSheets(m: Measurements, camera: (CameraFrame | null)[], dir: string, tools: Tools, signal?: AbortSignal): Promise<SheetSet> {
  const { plan, set } = planSheets(m, camera, dir);
  // The audio chart needs the raw envelope and pitch track, which only audio.json has.
  const audio = JSON.parse(await readFile(join(dir, "audio.json"), "utf8")) as { levels: { db: number[] }; pitch: { hz: number[] } };
  const [levels, pitch] = plan.charts[1]!.panels;
  levels!.series[0]!.values = audio.levels.db.map((db) => Math.max(0, db + 80));
  pitch!.series[0]!.values = audio.pitch.hz.map((hz) => (hz > 0 ? hz : null));

  await mkdir(plan.outDir, { recursive: true });
  const planFile = join(plan.outDir, "plan.json");
  await writeFile(planFile, JSON.stringify(plan));
  await runMeasure(tools, ["sheets", planFile], { timeoutMs: Math.max(10 * 60_000, m.video.duration * 10_000), signal });
  const palettes = JSON.parse(await readFile(join(plan.outDir, "palettes.json"), "utf8")) as Record<string, Swatch[]>;
  const file = (name: string) => join(plan.outDir, `${name}.png`);
  return {
    overview: set.overview.map(file),
    transitions: set.transitions.map((entry) => ({ ...entry, file: file(entry.file) })),
    events: set.events.map((entry) => ({ ...entry, file: file(entry.file) })),
    bursts: set.bursts.map((entry) => ({ ...entry, file: file(entry.file) })),
    charts: { camera: file("chart-camera"), audio: file("chart-audio") },
    palettes,
  };
}

// The widest tile that keeps the whole sheet within what the model reads at full detail.
export function tileWidth(cols: number, rows: number, aspect: number, captions: boolean): number {
  const label = captions ? 40 : 22;
  for (let width = 360; width > 80; width -= 4) {
    const sheetWidth = cols * (width + 6) + 6;
    const sheetHeight = 34 + rows * (Math.round(width * aspect) + label + 6);
    if (sheetWidth * sheetHeight <= MAX_PIXELS && Math.max(sheetWidth, sheetHeight) <= MAX_EDGE) return width;
  }
  return 80;
}

// For each frame: the word being spoken, prefixed with ">" on the frame it starts.
function captionsFor(words: Word[], fps: number): (frame: number) => string {
  return (frame) => {
    const from = frame / fps;
    const to = (frame + 1) / fps;
    const starting = words.find((word) => word.start >= from && word.start < to);
    if (starting) return `>${starting.w}`;
    return words.find((word) => word.start < from && word.end > from)?.w ?? "";
  };
}

function frameRange(first: number, last: number, frames: number, cap: number): number[] {
  const a = Math.max(0, first);
  const b = Math.min(frames - 1, last);
  const all = Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  if (all.length <= cap) return all;
  return Array.from({ length: cap }, (_, i) => all[Math.round((i * (all.length - 1)) / (cap - 1))]!);
}

function firstWords(text: string, count: number): string {
  const words = text.split(" ").filter(Boolean);
  return words.length > count ? `${words.slice(0, count).join(" ")}~` : words.join(" ");
}

// More sheets for longer, busier references: about one transition sheet per 6 s, one motion sheet per 5 s.
export function pickTransitions(transitions: Transition[], duration: number): number[] {
  const budget = Math.min(transitions.length, clamp(Math.ceil(duration / 6), 3, 12));
  const fastest = transitions.map((t, index) => ({ index, speed: (t.speedIn || 0) + (t.speedOut || 0) })).sort((a, b) => b.speed - a.speed);
  const chosen = new Set(fastest.slice(0, Math.ceil(budget / 2)).map((entry) => entry.index));
  // The rest spread over the whole short, so ordinary cuts are seen too.
  for (let i = 0; chosen.size < budget && i < transitions.length; i += 1) {
    chosen.add(Math.round((i * (transitions.length - 1)) / Math.max(1, budget - 1)) % transitions.length);
  }
  return [...chosen].sort((a, b) => a - b);
}

export function pickEvents(events: MotionEvent[], duration: number): number[] {
  const budget = clamp(Math.ceil(duration / 5), 4, 14);
  const perShot = new Map<number, number>();
  const chosen: number[] = [];
  for (const { index } of events.map((event, index) => ({ index, strength: event.strength })).sort((a, b) => b.strength - a.strength)) {
    const shot = events[index]!.shot;
    if ((perShot.get(shot) ?? 0) >= 2) continue;
    perShot.set(shot, (perShot.get(shot) ?? 0) + 1);
    chosen.push(index);
    if (chosen.length >= budget) break;
  }
  return chosen.sort((a, b) => a - b);
}

export function pickBurstShots(shots: Shot[]): Shot[] {
  const budget = Math.min(shots.length, clamp(Math.ceil(shots.length / 8), 2, 5));
  const byLength = [...shots].sort((a, b) => b.duration - a.duration);
  const byMotion = [...shots].filter((shot) => Number.isFinite(shot.camera.speedMid)).sort((a, b) => b.camera.speedMid - a.camera.speedMid);
  const chosen = new Map<number, Shot>();
  for (let i = 0; chosen.size < budget && i < shots.length; i += 1) {
    for (const list of [byLength, byMotion]) if (list[i] && chosen.size < budget) chosen.set(list[i]!.index, list[i]!);
  }
  return [...chosen.values()].sort((a, b) => a.index - b.index);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
