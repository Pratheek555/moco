import { expect, it } from "vitest";
import { sampleKeys, blendVector } from "../src/stages/world/timeline.ts";
import { placePlayer } from "../src/stages/world/shots.ts";
import { ScenePlayer, WorldModel } from "@moco/spec";
it("supports holds, fractional frames, clamped ends and deterministic seeking", () => {
  const keys = [{ atFrame: 0, easing: "hold" }, { atFrame: 10 }, { atFrame: 20, easing: "smooth" }];
  expect(sampleKeys(keys, 9.5).amount).toBe(0);
  expect(sampleKeys(keys, 15).amount).toBe(0.5);
  expect(sampleKeys(keys, -2).amount).toBe(0);
  expect(sampleKeys(keys, 25).previous.atFrame).toBe(20);
  expect(blendVector([0,0,0], [2,4,6], 0.5)).toEqual([1,2,3]);
});
it("places movement in mark coordinates and takes the short rotation across 360 degrees", () => {
  const player = ScenePlayer.parse({ id: "hero", model: "hero", at: [0,0,0], motionKeys: [{ atFrame: 0, at: [0,0,0], facing: 350 }, { atFrame: 10, at: [2,0,0], facing: 10 }] });
  const placed = placePlayer(player, { id: "hero", height: 2 } as WorldModel, { id: "mark", hint: "stage", at: [10,0,0], facing: 0 }, 5, 11);
  expect(placed.position.x).toBe(11); expect(placed.facing).toBe(360);
});
