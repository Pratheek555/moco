import { expect, it } from "vitest";
import { ScenePlayer } from "@moco/spec";
import { faceAt } from "../src/stages/world/face.ts";

it("interpolates independent face channels and is deterministic when seeking", () => {
  const player = { face: [{ atFrame: 0, smile: -1 }, { atFrame: 30, smile: 1 }, { atFrame: 20, brow: 1 }] };
  expect(faceAt(player, 15)).toMatchObject({ smile: 0, brow: 0.75, eyeOpen: 1 });
  const first = faceAt(player, 7);
  faceAt(player, 29);
  expect(faceAt(player, 7)).toEqual(first);
});

it("follows audio only when speaking is enabled and validates primitive bounds", () => {
  const track = [{ frame: 0, viseme: "D" }, { frame: 10, viseme: "X" }];
  expect(faceAt({}, 5, track).mouthOpen).toBe(1);
  expect(faceAt({}, 10, track).mouthOpen).toBe(0);
  expect(faceAt({ speak: false }, 5, track).mouthOpen).toBe(0);
  expect(faceAt({ face: [{ atFrame: 0, mouthOpen: 0.5 }] }, 10, track).mouthOpen).toBe(0.5);
  expect(ScenePlayer.safeParse({ id: "hero", model: "hero", at: [0, 0, 0], face: [{ atFrame: 0, smile: 2 }] }).success).toBe(false);
});
