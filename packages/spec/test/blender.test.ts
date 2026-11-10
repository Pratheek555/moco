import { describe, expect, it } from "vitest";
import { BlenderScene, blenderSceneIssues } from "../src/index.ts";
import { blenderShot } from "./blender-fixture.ts";

describe("Blender scene contract", () => {
  it("accepts bounded scene data and drops executable source and external file fields", () => {
    const scene = BlenderScene.parse({ ...blenderShot().blender, source: "import os", file: "C:/secret.blend" });
    expect(scene).not.toHaveProperty("source");
    expect(scene).not.toHaveProperty("file");
    expect(blenderSceneIssues(scene, 6)).toEqual([]);
    expect(BlenderScene.safeParse({ ...scene, camera: { ...scene.camera, lens: Infinity } }).success).toBe(false);
    expect(BlenderScene.safeParse({ ...scene, objects: [{ ...scene.objects[0], kind: "python" }] }).success).toBe(false);
  });

  it("rejects dangling materials, duplicate ids and cyclic parenting before Blender runs", () => {
    const scene = blenderShot().blender!;
    scene.objects[0]!.material = "missing";
    scene.objects[0]!.parent = "floor";
    scene.objects[1]!.parent = "ball";
    scene.materials.push(scene.materials[0]!);
    const issues = blenderSceneIssues(scene, 6);
    expect(issues.map(issue => issue.problem)).toEqual(expect.arrayContaining(["unknown material", "duplicate id", "parent cycle"]));
  });

  it("rejects invalid animation time and cameras aimed at themselves", () => {
    const scene = blenderShot().blender!;
    scene.objects[0]!.keys[1]!.atFrame = 6;
    scene.camera.keys[0]!.atFrame = 1;
    scene.camera.keys[0]!.target = scene.camera.keys[0]!.eye;
    expect(blenderSceneIssues(scene, 6).map(issue => issue.problem)).toEqual(expect.arrayContaining([
      "keys must be strictly increasing and inside the shot", "camera must start at frame 0", "camera eye and target coincide",
    ]));
  });

  it("validates native cutout contours and orthographic cameras", () => {
    const scene = BlenderScene.parse({...blenderShot().blender, renderStyle:"illustration", animationStep:2,
      camera:{projection:"orthographic",orthoScale:8,keys:[{atFrame:0,eye:[0,0,20],target:[0,0,0],orthoScale:8}]},
      objects:[{id:"paper",kind:"path",material:"coral",path:{points:[[0,0],[1,0],[1,1]],closed:true}}],
    });
    expect(blenderSceneIssues(scene,6)).toEqual([]);
    scene.objects[0]!.path!.closed=false;
    scene.camera.orthoScale=undefined;
    expect(blenderSceneIssues(scene,6).map(issue=>issue.problem)).toEqual(expect.arrayContaining([
      "filled paths need a closed contour with at least three points", "orthographic cameras need a positive scale",
    ]));
  });
});
