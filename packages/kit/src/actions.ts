// The action library: how strongly each action is applied at each frame, and the shared humanoid arm poses.
// Every curve is a pure function of (frame - startFrame, duration), so a frame always renders the same.

// ---------- easing ----------

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

// Smooth 0→1.
export function easeInOut(t: number): number {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}

// 0→1, overshooting to about 1.1 before settling at 1 (follow-through).
export function easeOutBack(t: number): number {
  const overshoot = 1.70158;
  const x = clamp01(t) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
}

// ---------- curves ----------

// How much of the action is applied `local` frames after it starts, for an action lasting `duration` frames.
// 0 on the first and last frame, so actions never pop in or out.
export type Curve = (local: number, duration: number) => number;

// A gesture: a small wind-up in the opposite direction (anticipation), a move that overshoots and settles,
// a hold, then an eased return.
export const gesture: Curve = (local, duration) => {
  const { attack, release } = phases(duration);
  if (local < attack) {
    const t = local / attack;
    const windUp = 0.2; // the first 20% of the attack goes the wrong way a little
    if (t < windUp) return -0.08 * Math.sin((Math.PI * t) / windUp);
    return easeOutBack((t - windUp) / (1 - windUp));
  }
  return holdThenRelease(local, duration, release);
};

// Like a gesture, without the wind-up: heads turn straight away but still overshoot and settle.
export const turn: Curve = (local, duration) => {
  const { attack, release } = phases(duration);
  if (local < attack) return easeOutBack(local / attack);
  return holdThenRelease(local, duration, release);
};

// Plain ease in, hold, ease out (expressions).
export const ease: Curve = (local, duration) => {
  const { attack, release } = phases(duration);
  if (local < attack) return easeInOut(local / attack);
  return holdThenRelease(local, duration, release);
};

// A quick close-and-open (blinks): peaks in the middle of the action.
export const pulse: Curve = (local, duration) => Math.sin((Math.PI * (local + 0.5)) / duration);

// On for the whole action (speech: the visemes do the moving).
export const hold: Curve = () => 1;

// The curve each action uses. Anything not listed (raise_hand, bless, point, play_flute, draw_bow, …) is a gesture.
const CURVES: Record<string, Curve> = { blink: pulse, smile: ease, speak: hold, turn_head: turn, lower_head: turn };

export function curveFor(action: string): Curve {
  return CURVES[action] ?? gesture;
}

// Attack and release lengths in frames: about a third and a quarter of the action, within sensible limits,
// and never more than the action itself.
function phases(duration: number): { attack: number; release: number } {
  const attack = Math.min(Math.max(Math.round(duration * 0.3), 4), 14, Math.floor(duration / 2));
  const release = Math.min(Math.max(Math.round(duration * 0.25), 4), 12, duration - attack);
  return { attack, release };
}

// 1 until the release starts, then eased down so the last frame of the action is exactly 0.
function holdThenRelease(local: number, duration: number, release: number): number {
  const releaseStart = duration - release;
  if (local < releaseStart) return 1;
  return 1 - easeInOut((local - releaseStart + 1) / release);
}

// ---------- humanoid arm poses ----------

export interface ArmPose {
  upper: number; // degrees, rotation of the upper arm at the shoulder (0 = hanging straight down)
  fore: number; // degrees, rotation of the forearm at the elbow, relative to the upper arm
}

// Blend from one pose to another by `amount` (0..1; slightly outside during anticipation and overshoot).
export function blendPose(from: ArmPose, to: ArmPose, amount: number): ArmPose {
  return { upper: from.upper + (to.upper - from.upper) * amount, fore: from.fore + (to.fore - from.fore) * amount };
}

// Mirror a pose written for the right arm so it works for the left arm.
export function mirror(pose: ArmPose): ArmPose {
  return { upper: -pose.upper, fore: -pose.fore };
}

// Poses written for the right arm (the character's right, the viewer's left).
export const ARM_POSES = {
  rest: { upper: 8, fore: -8 },
  raise: { upper: 150, fore: 18 }, // arm lifted high, as if calling out
  bless: { upper: 40, fore: 118 }, // abhaya mudra: forearm up beside the chest, palm out
  point: { upper: 86, fore: 4 }, // straight out to the side
} satisfies Record<string, ArmPose>;
