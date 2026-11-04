import type { ScenePlayer, VisemeTrack } from "@moco/spec";

const REST = { mouthOpen: 0, smile: 0, brow: 0, eyeOpen: 1 };
export type FaceState = typeof REST;

// Each channel interpolates independently; random frame access never depends on a previous render.
export function faceAt(player: Pick<ScenePlayer, "face" | "speak">, frame: number, visemes: VisemeTrack = []): FaceState {
  const face = { ...REST };
  for (const channel of Object.keys(REST) as (keyof FaceState)[]) {
    const keys = (player.face ?? []).filter((key) => key[channel] !== undefined).sort((a, b) => a.atFrame - b.atFrame);
    const before = keys.filter((key) => key.atFrame <= frame).at(-1);
    const after = keys.find((key) => key.atFrame > frame);
    const start = before?.atFrame ?? 0;
    const value = before?.[channel] ?? REST[channel];
    face[channel] = after ? value + (after[channel]! - value) * Math.max(0, (frame - start) / (after.atFrame - start)) : value;
  }
  if (player.speak !== false) {
    const shape = visemes.filter((key) => key.frame <= frame).at(-1)?.viseme ?? "X";
    face.mouthOpen = Math.max(face.mouthOpen, ({ X: 0, A: 0.1, B: 0.3, C: 0.6, D: 1, E: 0.6, F: 0.3 } as Record<string, number>)[shape] ?? 0);
  }
  return face;
}
