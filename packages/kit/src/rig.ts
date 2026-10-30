// The shared rig: turns a scene actor's timed actions, plus its always-on idle motion, into what a character
// should look like at one frame. Pure functions of (frame, spec, seed), no React and no clock, so the renderer
// (and the tests) get exactly the same pose for the same frame every time.
import { FPS, type SceneActor, type VisemeTrack } from "@moco/spec";
import { curveFor } from "./actions.ts";
import type { IdleProfile } from "./index.ts";

export interface ActiveAction {
  amount: number; // how far the action is applied; 0..1, dipping below 0 (wind-up) and above 1 (overshoot)
  progress: number; // 0..1, linear through the action
  params: Record<string, unknown>;
}

export interface RigState {
  frame: number;
  blink: number; // 0 = eyes open, 1 = closed
  expression: string;
  actions: Record<string, ActiveAction>; // only actions running at this frame
  viseme?: string; // mouth shape while speaking
  breath: number; // -1..1, the breathing cycle (0 with idle off)
  breathScale: number; // torso scale from breathing, ~1.0
  sway: number; // degrees, idle head sway
  secondary: number; // degrees, delayed follow-through of hair, cloth and jewellery (around the neck)
  flex: number; // degrees, the swaying part of the headwear, trailing the head
}

export interface RigOptions {
  seed: string; // the castId: each character blinks and breathes on its own schedule
  idle?: IdleProfile; // undefined = idle motion off (the spec set idle: false)
  visemes?: VisemeTrack; // the shot's lip-sync track, read while the actor speaks
}

type RigActor = Pick<SceneActor, "actions" | "expression">;

export function rigStateAt(actor: RigActor, frame: number, options: RigOptions): RigState {
  const actions = actionsAt(actor, frame);
  const idle = options.idle;
  const breath = idle ? breathAt(frame, idle, options.seed) : 0;
  const sway = idle ? swayAt(frame, idle, options.seed) : 0;
  const delay = idle?.secondaryDelayFrames ?? 0;

  return {
    frame,
    blink: Math.max(actions.blink?.amount ?? 0, idle ? idleBlinkAt(frame, idle, options.seed) : 0),
    expression: expressionAt(actor.expression, frame, actions),
    actions,
    viseme: actions.speak ? visemeAt(options.visemes ?? [], frame, options.seed) : undefined,
    breath,
    breathScale: 1 + (idle?.breathAmount ?? 0) * ((breath + 1) / 2),
    sway,
    // Hanging things follow the head's sway a few frames late.
    secondary: idle ? 0.6 * swayAt(frame - delay, idle, options.seed) : 0,
    // The feather lags behind head turns (inertia) and flutters a little on its own.
    flex: idle ? flexAt(actor, frame, delay, idle, options.seed) : 0,
  };
}

// How far an action is applied right now (0 when it isn't running).
export function amountOf(rig: RigState, action: string): number {
  return rig.actions[action]?.amount ?? 0;
}

// The arm an action uses; "right" means the character's right (the viewer's left).
export function sideOf(rig: RigState, action: string, fallback: "left" | "right" = "right"): "left" | "right" {
  const side = rig.actions[action]?.params.side;
  return side === "left" || side === "right" ? side : fallback;
}

// ---------- actions ----------

function actionsAt(actor: RigActor, frame: number): Record<string, ActiveAction> {
  const running = actor.actions.filter((action) => frame >= action.startFrame && frame < action.endFrame);
  const actions: Record<string, ActiveAction> = {};
  for (const action of running) {
    const duration = action.endFrame - action.startFrame;
    const local = frame - action.startFrame;
    actions[action.name] = { amount: curveFor(action.name)(local, duration), progress: local / duration, params: action.params ?? {} };
  }
  return actions;
}

// The latest expression set at or before this frame; smiling and blessing show a smile while held.
function expressionAt(expressions: SceneActor["expression"], frame: number, actions: Record<string, ActiveAction>): string {
  if ((actions.smile?.amount ?? 0) > 0.5 || (actions.bless?.amount ?? 0) > 0.5) return "smile";
  const set = expressions.filter((expression) => expression.atFrame <= frame).sort((a, b) => a.atFrame - b.atFrame);
  return set.at(-1)?.name ?? "neutral";
}

// ---------- idle motion ----------

// A number in [0, 1) that depends only on (seed, index): FNV-1a hash, then a murmur-style finaliser.
// Stands in for Remotion's random(seed) so the kit stays free of Remotion (reference R4).
export function seededRandom(seed: string, index: number): number {
  let hash = 2166136261;
  const text = `${seed}:${index}`;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

// Fixed per-seed phases, so two characters don't breathe or sway in step.
const PHASE = { breath: 1000, swaySlow: 1001, swayFast: 1002, flutter: 1003 };
function phase(seed: string, which: number): number {
  return 2 * Math.PI * seededRandom(seed, which);
}

function breathAt(frame: number, idle: IdleProfile, seed: string): number {
  return Math.sin((2 * Math.PI * frame) / idle.breathPeriodFrames + phase(seed, PHASE.breath));
}

// Two sines at unrelated periods, so the sway never looks like a metronome.
function swayAt(frame: number, idle: IdleProfile, seed: string): number {
  const slow = Math.sin((2 * Math.PI * frame) / idle.swayPeriodFrames + phase(seed, PHASE.swaySlow));
  const fast = Math.sin((2 * Math.PI * frame) / (idle.swayPeriodFrames * 0.43) + phase(seed, PHASE.swayFast));
  return idle.swayDegrees * (0.7 * slow + 0.3 * fast);
}

// Idle blinks: the first 0.5–2 s in, then one every blinkMin–blinkMax seconds, all chosen by the seed.
// Walks the schedule from frame 0; a shot has at most a few dozen blinks, so this stays cheap.
export function idleBlinkAt(frame: number, idle: IdleProfile, seed: string): number {
  let start = Math.round(FPS * (0.5 + 1.5 * seededRandom(seed, 0)));
  for (let index = 1; start <= frame; index += 1) {
    if (frame < start + idle.blinkFrames) return Math.sin((Math.PI * (frame - start + 0.5)) / idle.blinkFrames);
    const gapSeconds = idle.blinkMinSeconds + (idle.blinkMaxSeconds - idle.blinkMinSeconds) * seededRandom(seed, index);
    start += Math.max(1, Math.round(FPS * gapSeconds)); // at least one frame, so the walk always moves on
  }
  return 0;
}

// The head turn the actions ask for at one frame (0..1, can overshoot).
function turnAt(actor: RigActor, frame: number): number {
  return actionsAt(actor, frame).turn_head?.amount ?? 0;
}

function flexAt(actor: RigActor, frame: number, delay: number, idle: IdleProfile, seed: string): number {
  const headNow = swayAt(frame, idle, seed) - 4 * turnAt(actor, frame);
  const headBefore = swayAt(frame - delay, idle, seed) - 4 * turnAt(actor, frame - delay);
  const flutter = 1.5 * Math.sin((2 * Math.PI * frame) / (idle.swayPeriodFrames * 0.6) + phase(seed, PHASE.flutter));
  return 2.5 * (headBefore - headNow) + flutter;
}

// ---------- speech ----------

// The track's shape at this frame: the last key at or before it (resting before the first key).
function visemeAt(track: VisemeTrack, frame: number, seed: string): string {
  if (track.length === 0) return chatterAt(frame, seed);
  return track.filter((key) => key.frame <= frame).at(-1)?.viseme ?? "X";
}

// ponytail: a spec with no viseme track (hand-written, or made before 0.2.0) gets seeded open shapes every
// 3 frames; specs from the engine always carry the track from the voiceover audio.
const CHATTER = ["B", "C", "D", "C", "E", "B", "A", "C"];
function chatterAt(frame: number, seed: string): string {
  const step = Math.floor(frame / 3);
  return CHATTER[Math.floor(seededRandom(seed, 5000 + step) * CHATTER.length)]!;
}

