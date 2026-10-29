import {
  EXPRESSION_VECTORS,
  POSE_VECTORS,
  blendExpression,
  blendPose,
  blinkAt,
  clamp,
  hashString,
  talkAt,
  type ExpressionVector,
  type PoseVector,
} from '@moco/kit';
import type { Action, Actor, EnterFrom, Pose, Prop, Word } from '@moco/spec';

export const easeInOut = (t: number) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const springy = (t: number) => {
  const x = clamp(t, 0, 1);
  return 1 - Math.cos(x * Math.PI * 2.5) * Math.exp(-x * 5.5);
};
const ease = (kind: string, t: number) => (kind === 'linear' ? clamp(t, 0, 1) : kind === 'spring' ? springy(t) : easeInOut(t));

export interface Placement {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  /** Extra offset from enter/exit, in frame fractions. */
  dx: number;
  dy: number;
  /** Multiplier from `pop` enters. */
  pop: number;
}

type MotionAction =
  | { type: 'move'; at: number; duration: number; x?: number; y?: number; scale?: number; ease: string }
  | { type: 'enter'; at: number; from: EnterFrom; duration: number }
  | { type: 'exit'; at: number; to: EnterFrom; duration: number };

function offsetFor(dir: EnterFrom): [number, number] {
  switch (dir) {
    case 'left':
      return [-1.1, 0];
    case 'right':
      return [1.1, 0];
    case 'bottom':
      return [0, 0.7];
    case 'top':
      return [0, -1.2];
    default:
      return [0, 0];
  }
}

/** Position/visibility over time for anything with move/enter/exit actions. */
export function placementAt(base: { x: number; y: number; scale: number }, actions: MotionAction[], t: number): Placement {
  let { x, y, scale } = base;
  let opacity = 1;
  let dx = 0;
  let dy = 0;
  let pop = 1;
  const sorted = [...actions].sort((a, b) => a.at - b.at);
  const firstEnter = sorted.find((a) => a.type === 'enter');
  if (firstEnter && t < firstEnter.at) opacity = 0;
  for (const a of sorted) {
    if (a.at > t) break;
    const k = (t - a.at) / Math.max(0.001, a.duration);
    if (a.type === 'move') {
      const e = ease(a.ease, k);
      if (a.x !== undefined) x += (a.x - x) * e;
      if (a.y !== undefined) y += (a.y - y) * e;
      if (a.scale !== undefined) scale += (a.scale - scale) * e;
    } else if (a.type === 'enter') {
      const e = easeOut(k);
      opacity = 1;
      if (a.from === 'fade') opacity = clamp(k, 0, 1);
      else if (a.from === 'pop') {
        pop = springy(k);
        opacity = clamp(k * 4, 0, 1);
      } else {
        const [ox, oy] = offsetFor(a.from);
        dx = ox * (1 - e);
        dy = oy * (1 - e);
      }
    } else if (a.type === 'exit') {
      const e = easeInOut(k);
      if (a.to === 'fade') opacity = 1 - clamp(k, 0, 1);
      else if (a.to === 'pop') {
        pop = 1 - e;
        opacity = 1 - clamp((k - 0.6) * 3, 0, 1);
      } else {
        const [ox, oy] = offsetFor(a.to);
        dx = ox * e;
        dy = oy * e;
        if (k >= 1) opacity = 0;
      }
    }
  }
  return { x, y, scale, opacity, dx, dy, pop };
}

export interface ActorFrame {
  placement: Placement;
  facing: number;
  pose: PoseVector;
  poseName: Pose;
  expression: ExpressionVector;
  blink: number;
  talk: number;
  round: number;
  look: { x: number; y: number };
  nod: number;
  walk: number;
  time: number;
}

const LOOK: Record<string, { x: number; y: number }> = {
  camera: { x: 0, y: 0 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0.1, y: -1 },
  down: { x: 0.1, y: 1 },
};

/** Is someone mid-word at time t? Used for lip-flap when real word timings exist. */
function speakingAt(words: Word[], t: number) {
  for (const w of words) {
    if (t >= w.start - 0.03 && t <= w.end + 0.03) return 1;
  }
  return 0;
}

export function actorFrame(actor: Actor, t: number, ground: number, speech: { words: Word[]; start: number; end: number } | null): ActorFrame {
  const seed = hashString(actor.id + actor.character);
  const actions = [...actor.actions].sort((a, b) => a.at - b.at);

  let pose = POSE_VECTORS[actor.pose];
  let poseName: Pose = actor.pose;
  let expression = EXPRESSION_VECTORS[actor.expression];
  let facing = actor.facing === 'left' ? -1 : 1;
  let look = { x: 0.25, y: 0 };
  let nod = 0;
  let talk = 0;
  let round = 0;

  const motion: MotionAction[] = [];
  for (const a of actions as Action[]) {
    if (a.type === 'move' || a.type === 'enter' || a.type === 'exit') motion.push(a as MotionAction);
    if (a.at > t) continue;
    const since = t - a.at;
    switch (a.type) {
      case 'pose': {
        const k = easeInOut(since / Math.max(0.05, a.duration));
        pose = blendPose(pose, POSE_VECTORS[a.pose], k);
        if (k > 0.5) poseName = a.pose;
        break;
      }
      case 'expression': {
        const k = easeInOut(since / 0.25);
        expression = blendExpression(expression, EXPRESSION_VECTORS[a.expression], k);
        break;
      }
      case 'look': {
        const target = LOOK[a.direction] ?? LOOK.camera!;
        const k = easeInOut(since / 0.22);
        const tx = target.x * facing;
        look = { x: look.x + (tx - look.x) * k, y: look.y + (target.y - look.y) * k };
        break;
      }
      case 'turn': {
        const to = a.facing === 'left' ? -1 : 1;
        if (to !== facing) {
          const k = easeInOut(since / 0.3);
          facing = facing + (to - facing) * k;
        }
        break;
      }
      case 'nod': {
        if (since < 0.6) nod += Math.sin((since / 0.6) * Math.PI) * 14;
        break;
      }
      case 'speak': {
        if (since <= a.duration) {
          const m = talkAt(t, seed);
          const edge = Math.min(1, since / 0.08, (a.duration - since) / 0.08);
          talk = Math.max(talk, m.talk * edge);
          round = m.round;
        }
        break;
      }
    }
  }

  if (speech && t >= speech.start && t <= speech.end) {
    const active = speech.words.length ? speakingAt(speech.words, t) : 1;
    if (active) {
      const m = talkAt(t, seed);
      talk = Math.max(talk, m.talk);
      round = m.round;
    }
  }

  const blink = expression.eyeClosed > 0.5 ? 0 : blinkAt(t, seed);
  const placement = placementAt({ x: actor.x, y: actor.y ?? ground, scale: actor.scale }, motion, t);
  return {
    placement,
    facing,
    pose,
    poseName,
    expression,
    blink,
    talk,
    round,
    look,
    nod,
    walk: t * Math.PI * 2 * 1.6,
    time: t + (seed % 100) / 37,
  };
}

export function propPlacement(prop: Prop, t: number, ground: number): Placement {
  return placementAt({ x: prop.x, y: prop.y ?? ground, scale: prop.scale }, prop.actions as MotionAction[], t);
}
