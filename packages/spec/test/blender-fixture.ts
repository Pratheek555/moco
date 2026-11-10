import { SceneSpec } from "../src/index.ts";

export const blenderShot = (durationFrames = 6) => SceneSpec.parse({
  shotId: "s01", durationFrames, background: { id: "studio" }, actors: [], captions: [],
  format: { width: 160, height: 240, fps: 6 },
  blender: {
    version: 1, cast: ["ball"],
    materials: [{ id: "coral", color: "#ff6348" }, { id: "floor", color: "#394866" }],
    objects: [
      { id: "ball", kind: "sphere", material: "coral", position: [0,0,0.6], keys: [
        { atFrame: 0, position: [-0.7,0,0.6] }, { atFrame: durationFrames - 1, position: [0.7,0,1.2] },
      ] },
      { id: "floor", kind: "plane", material: "floor", scale: [200,200,1] },
    ],
    lights: [{ id: "key", energy: 1200, position: [2,-3,5] }],
    camera: { lens: 40, keys: [{ atFrame: 0, eye: [0,-5,3], target: [0,0,0.7] }] },
  },
});
