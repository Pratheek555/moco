import type { Expression, Pose } from '@moco/spec';
import { EXPRESSION_VECTORS, POSE_VECTORS } from './poses.ts';
import type { RigState } from './types.ts';

/** A rig at rest in one pose/expression — handy for thumbnails and sheets. */
export function restRig(pose: Pose = 'stand', expression: Expression = 'neutral', time = 0): RigState {
  return {
    pose: POSE_VECTORS[pose],
    expression: EXPRESSION_VECTORS[expression],
    blink: 0,
    talk: 0,
    round: 0,
    look: { x: 0.25, y: 0 },
    time,
    walk: time * Math.PI * 2 * 1.6,
    nod: 0,
  };
}

/** Blink amount (0..1) at time t for an actor seeded by `seed`. Natural, irregular. */
export function blinkAt(t: number, seed: number) {
  const period = 3.2 + (seed % 7) * 0.31;
  const offset = (seed % 13) * 0.37;
  const local = (t + offset) % period;
  const second = (seed % 3 === 0) && local > 0.22 && local < 0.42 ? local - 0.22 : -1;
  const pulse = (x: number) => (x < 0 || x > 0.2 ? 0 : Math.sin((x / 0.2) * Math.PI));
  return Math.max(pulse(local), pulse(second));
}

/** Mouth flap for speech: deterministic pseudo-syllables at ~8/sec. */
export function talkAt(t: number, seed: number) {
  const s = t * 8.3 + seed;
  const a = Math.abs(Math.sin(s * 1.7) * 0.6 + Math.sin(s * 3.1 + 1.3) * 0.4);
  const round = (Math.sin(s * 0.9 + seed) + 1) / 2;
  return { talk: Math.min(1, a * 0.9 + 0.05), round: round * 0.6 };
}
