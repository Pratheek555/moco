// Turns the actions in a shot into a turn for each part on one frame. Pure maths, so any frame can be rendered alone.
import type { SceneAction, WorldModel, WorldMove } from "@moco/spec";

export type Turn = [number, number, number]; // degrees
export type Pose = Record<string, Turn>;

const FPS = 30;
const EASE_FRAMES = 8; // how long a non-looping action takes to settle in and out

// Keys for a walk-like cycle: legs and arms swing in opposite pairs, with the shin folding on the way forward.
function stride(reach: number, armReach: number, lean: number) {
  return [
    { at: 0, turn: { leg_L: [-reach, 0, 0], leg_R: [reach, 0, 0], shin_R: [reach * 1.2, 0, 0], arm_L: [armReach, 0, 0], arm_R: [-armReach, 0, 0], forearm_L: [-20, 0, 0], forearm_R: [-20, 0, 0], chest: [lean, 0, 0] } },
    { at: 0.25, turn: { leg_L: [0, 0, 0], leg_R: [0, 0, 0], shin_L: [reach * 0.4, 0, 0], arm_L: [0, 0, 0], arm_R: [0, 0, 0], forearm_L: [-20, 0, 0], forearm_R: [-20, 0, 0], chest: [lean, 0, 0] } },
    { at: 0.5, turn: { leg_L: [reach, 0, 0], leg_R: [-reach, 0, 0], shin_L: [reach * 1.2, 0, 0], arm_L: [-armReach, 0, 0], arm_R: [armReach, 0, 0], forearm_L: [-20, 0, 0], forearm_R: [-20, 0, 0], chest: [lean, 0, 0] } },
    { at: 0.75, turn: { leg_L: [0, 0, 0], leg_R: [0, 0, 0], shin_R: [reach * 0.4, 0, 0], arm_L: [0, 0, 0], arm_R: [0, 0, 0], forearm_L: [-20, 0, 0], forearm_R: [-20, 0, 0], chest: [lean, 0, 0] } },
    { at: 1, turn: { leg_L: [-reach, 0, 0], leg_R: [reach, 0, 0], shin_R: [reach * 1.2, 0, 0], arm_L: [armReach, 0, 0], arm_R: [-armReach, 0, 0], forearm_L: [-20, 0, 0], forearm_R: [-20, 0, 0], chest: [lean, 0, 0] } },
  ] as WorldMove["keys"];
}

// A pose held in the middle of an action: in over the first fifth, out over the last.
function held(turn: WorldMove["keys"][number]["turn"]): WorldMove["keys"] {
  return [{ at: 0, turn: {} }, { at: 0.2, turn }, { at: 0.8, turn }, { at: 1, turn: {} }];
}

// Moves every humanoid has. They use the same format the AI writes for its own creatures.
export const HUMANOID_MOVES: WorldMove[] = [
  { name: "walk", minFrames: 30, loop: true, keys: stride(26, 22, 3) },
  { name: "run", minFrames: 18, loop: true, keys: stride(46, 48, 12) },
  { name: "wave", minFrames: 40, loop: false, keys: [{ at: 0, turn: {} }, { at: 0.2, turn: { arm_R: [-170, 0, -12], forearm_R: [0, 0, -18] } }, { at: 0.4, turn: { arm_R: [-170, 0, -12], forearm_R: [0, 0, 18] } }, { at: 0.6, turn: { arm_R: [-170, 0, -12], forearm_R: [0, 0, -18] } }, { at: 0.8, turn: { arm_R: [-170, 0, -12], forearm_R: [0, 0, 18] } }, { at: 1, turn: {} }] },
  { name: "point", minFrames: 30, loop: false, keys: held({ arm_R: [-90, 0, 0], forearm_R: [-6, 0, 0], chest: [0, -12, 0], head: [0, -8, 0] }) },
  { name: "reach_out", minFrames: 30, loop: false, keys: held({ arm_R: [-80, 0, 8], arm_L: [-80, 0, -8], forearm_R: [-14, 0, 0], forearm_L: [-14, 0, 0], chest: [10, 0, 0] }) },
  { name: "nod", minFrames: 24, loop: false, keys: [{ at: 0, turn: {} }, { at: 0.3, turn: { head: [18, 0, 0] } }, { at: 0.55, turn: { head: [-3, 0, 0] } }, { at: 0.8, turn: { head: [12, 0, 0] } }, { at: 1, turn: {} }] },
  { name: "shake_head", minFrames: 24, loop: false, keys: [{ at: 0, turn: {} }, { at: 0.25, turn: { head: [0, 24, 0] } }, { at: 0.5, turn: { head: [0, -24, 0] } }, { at: 0.75, turn: { head: [0, 18, 0] } }, { at: 1, turn: {} }] },
  { name: "look_left", minFrames: 24, loop: false, keys: held({ head: [0, 42, 0], chest: [0, 12, 0] }) },
  { name: "look_right", minFrames: 24, loop: false, keys: held({ head: [0, -42, 0], chest: [0, -12, 0] }) },
  { name: "look_up", minFrames: 24, loop: false, keys: held({ head: [-30, 0, 0], chest: [-8, 0, 0] }) },
  { name: "look_down", minFrames: 24, loop: false, keys: held({ head: [30, 0, 0], chest: [8, 0, 0] }) },
  { name: "talk", minFrames: 30, loop: true, keys: [{ at: 0, turn: { arm_R: [-30, 0, 8], forearm_R: [-60, 0, 0], head: [4, 6, 0] } }, { at: 0.5, turn: { arm_R: [-44, 0, 14], forearm_R: [-84, 0, 0], head: [-3, -6, 0], arm_L: [-18, 0, -8] } }, { at: 1, turn: { arm_R: [-30, 0, 8], forearm_R: [-60, 0, 0], head: [4, 6, 0] } }] },
  { name: "celebrate", minFrames: 30, loop: false, keys: held({ arm_R: [-172, 0, 10], arm_L: [-172, 0, -10], forearm_R: [-12, 0, 0], forearm_L: [-12, 0, 0], chest: [-8, 0, 0], head: [-14, 0, 0] }) },
  { name: "slump", minFrames: 30, loop: false, keys: held({ chest: [22, 0, 0], head: [30, 0, 0], arm_R: [10, 0, 4], arm_L: [10, 0, -4] }) },
  { name: "fear", minFrames: 24, loop: false, keys: held({ chest: [-12, 0, 0], head: [-8, 0, 0], arm_R: [-90, 0, 18], arm_L: [-90, 0, -18], forearm_R: [-90, 0, 0], forearm_L: [-90, 0, 0] }) },
  { name: "think", minFrames: 30, loop: false, keys: held({ arm_R: [-50, 0, 12], forearm_R: [-125, 0, 0], head: [8, 8, 0] }) },
  { name: "kneel", minFrames: 30, loop: false, keys: held({ hips: [0, 0, 0], leg_L: [-92, 0, 0], shin_L: [92, 0, 0], leg_R: [6, 0, 0], shin_R: [84, 0, 0], chest: [8, 0, 0], head: [10, 0, 0] }) },
  { name: "sit", minFrames: 30, loop: false, keys: held({ leg_L: [-88, 0, 0], leg_R: [-88, 0, 0], shin_L: [88, 0, 0], shin_R: [88, 0, 0] }) },
];

// Every move a model can do: the humanoid set, then its own, which win on a shared name.
export function movesOf(model: Pick<WorldModel, "rig" | "moves">): WorldMove[] {
  const own = model.moves.map((move) => move.name);
  const built = model.rig === "humanoid" ? HUMANOID_MOVES.filter((move) => !own.includes(move.name)) : [];
  return [...built, ...model.moves];
}

const smooth = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
};

const blend = (from: Turn, to: Turn, amount: number): Turn => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
];

// The pose between the two keys around `moment` (0 to 1).
export function sampleMove(move: WorldMove, moment: number): Pose {
  const after = move.keys.findIndex((key) => key.at >= moment);
  const last = move.keys.length - 1;
  const next = move.keys[after < 0 ? last : after]!;
  const previous = move.keys[Math.max(0, (after < 0 ? last : after) - 1)]!;
  const span = next.at - previous.at;
  const amount = span > 0 ? smooth((moment - previous.at) / span) : 1;
  const joints = [...new Set([...Object.keys(previous.turn), ...Object.keys(next.turn)])];
  const zero: Turn = [0, 0, 0];
  return Object.fromEntries(joints.map((joint) => [joint, blend((previous.turn[joint] ?? zero) as Turn, (next.turn[joint] ?? zero) as Turn, amount)]));
}

// How far through a move this frame is, and how strongly it applies. Looping moves fade in and out at the action's
// edges; one-shot moves are stretched over the action and start and end at rest by their own keys.
function moveState(move: WorldMove, action: SceneAction, frame: number) {
  const elapsed = frame - action.startFrame;
  const length = action.endFrame - action.startFrame;
  if (!move.loop) return { moment: elapsed / length, weight: 1 };
  const edge = Math.min(smooth(elapsed / EASE_FRAMES), smooth((length - elapsed) / EASE_FRAMES));
  return { moment: (elapsed % move.minFrames) / move.minFrames, weight: edge };
}

function addPose(total: Pose, pose: Pose, weight: number): void {
  for (const [joint, turn] of Object.entries(pose)) {
    const sum = total[joint] ?? [0, 0, 0];
    total[joint] = [sum[0] + turn[0] * weight, sum[1] + turn[1] * weight, sum[2] + turn[2] * weight];
  }
}

// Living, even when nothing is asked of it: a slow breath and a small drift of the head.
function breathing(seed: number, frame: number): Pose {
  const breath = Math.sin(((frame + seed * 37) / 96) * Math.PI * 2);
  const drift = Math.sin(((frame + seed * 53) / 160) * Math.PI * 2);
  return { chest: [breath * 1.2, 0, 0], head: [breath * -0.6, drift * 3, drift * 1], arm_L: [0, 0, -breath * 1.1], arm_R: [0, 0, breath * 1.1] };
}

// Every part's added turn on one frame. A model without those joint names just ignores the idle pose.
export function poseAt(model: Pick<WorldModel, "rig" | "moves">, actions: SceneAction[], frame: number, seed: number): Pose {
  const total: Pose = {};
  if (model.rig === "humanoid") addPose(total, breathing(seed, frame), 1);
  const moves = movesOf(model);
  for (const action of actions) {
    const move = moves.find((candidate) => candidate.name === action.name);
    if (!move || frame < action.startFrame || frame >= action.endFrame) continue;
    const { moment, weight } = moveState(move, action, frame);
    addPose(total, sampleMove(move, moment), weight);
  }
  return total;
}

// Shut for four frames every few seconds, at times that differ per model.
export function isBlinking(seed: number, frame: number): boolean {
  const period = 100 + (seed % 7) * 17;
  return (frame + seed * 11) % period < 4;
}

// Degrees turned so far by a part's always-on spin.
export const spinAt = (degreesPerSecond: number, frame: number) => (degreesPerSecond * frame) / FPS;

// A steady number from a name, so each player gets its own rhythm.
export function seedOf(name: string): number {
  return [...name].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) % 9973, 7);
}
