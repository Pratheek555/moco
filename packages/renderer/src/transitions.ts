import type { ShotTransition } from "@moco/spec";

// Incoming-shot time only: do not overlap/shorten narration or change any word/cut time.
export function transitionAt(transition: ShotTransition | undefined, frame: number, durationFrames: number) {
  const length = Math.min(transition?.durationFrames ?? 1, durationFrames);
  if (!transition || transition.type === "cut" || length <= 1 || frame >= length) return { outgoing: 0, incoming: 1 };
  const p = Math.max(0, frame / (length - 1));
  return transition.type === "dissolve"
    ? { outgoing: 1, incoming: p }
    : { outgoing: Math.max(0, 1 - 2 * p), incoming: Math.max(0, 2 * p - 1) };
}
