// Pure frame sampling: seeking or rendering frames in parallel produces the same result.
export function sampleKeys<T extends { atFrame: number; easing?: string }>(keys: T[], frame: number) {
  const next = keys.find((key) => key.atFrame > frame);
  const previous = keys.filter((key) => key.atFrame <= frame).at(-1) ?? keys[0]!;
  const end = next ?? previous;
  let amount = end.atFrame === previous.atFrame ? 0 : Math.max(0, (frame - previous.atFrame) / (end.atFrame - previous.atFrame));
  if (previous.easing === "hold") amount = 0;
  if (previous.easing === "smooth") amount = amount * amount * (3 - 2 * amount);
  return { previous, next: end, amount };
}
export const blendVector = (a: number[], b: number[], t: number): [number, number, number] => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as [number, number, number];
