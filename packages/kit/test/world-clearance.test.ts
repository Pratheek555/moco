import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WorldLocation, WorldModel, type ScenePlayer, type SceneStage } from "@moco/spec";
import { measureModel } from "../src/stages/world/build.ts";
import { blockersOf, clearShare, smooth, steadyLens, type Framing } from "../src/stages/world/clearance.ts";
import { lensFor, placePlayer, RIGS } from "../src/stages/world/shots.ts";

const metal = { colour: "#888888" };
const box = (id: string, size: number[], at: number[], surface = "metal") => ({ id, shape: "box", size, at, surface });

// A closed maintenance duct, 2.1 m wide and 1.8 m tall inside, 27 m long, like the one that rendered black.
const duct = WorldModel.parse({
  id: "duct",
  height: 1.9,
  surfaces: { metal },
  parts: [box("floor", [2.1, 0.08, 3], [0, 0.04, 0]), box("wall_L", [0.08, 1.8, 3], [1.05, 0.9, 0]), box("wall_R", [0.08, 1.8, 3], [-1.05, 0.9, 0]), box("ceiling", [2.2, 0.08, 3], [0, 1.8, 0])],
});
const cap = WorldModel.parse({ id: "cap", height: 1.9, surfaces: { metal }, parts: [box("plate", [2.2, 1.9, 0.08], [0, 0.95, 0])] });
const glass = WorldModel.parse({ id: "glass", height: 3, surfaces: { pane: { colour: "#aaccff", opacity: 0.2 } }, parts: [box("pane", [6, 3, 0.05], [0, 1.5, 0], "pane")] });
const robot = WorldModel.parse({
  id: "robot",
  height: 0.9,
  surfaces: { metal },
  parts: [box("body", [0.5, 0.55, 0.4], [0, 0.28, 0]), { id: "head", shape: "sphere", size: [0.42, 0.36, 0.36], at: [0, 0.72, 0], surface: "metal" }],
});
const models = [duct, cap, glass, robot];

const marks = [
  { id: "mid", hint: "middle of the duct", at: [0, 0.08, -3], facing: 0 },
  { id: "turned", hint: "by the bucket", at: [0.1, 0.08, -8.4], facing: 20 },
];
const location = (set: { model: string; at: number[]; turn?: number }[]) =>
  WorldLocation.parse({
    id: "place",
    hint: "a place",
    sky: { top: "#05070d", middle: "#0a1020", horizon: "#141c30", sunAzimuth: 60, sunElevation: 20, sunColour: "#8fb4ff", sunStrength: 0.6, fill: 0.9, fog: "#0a1020", fogDensity: 0.05 },
    ground: { kind: "none", surface: metal },
    set,
    marks,
  });
const ductSet = [...Array.from({ length: 9 }, (_, index) => ({ model: "duct", at: [0, 0, -12 + index * 3] })), { model: "cap", at: [0, 0, -13.6] }, { model: "cap", at: [0, 0, 13.6] }];
const closed = location(ductSet);
const open = location([]);

const DURATION = 90;
const player = (extra: Partial<ScenePlayer>): ScenePlayer => ({ id: "robot", model: "robot", at: [0, 0, 0], facing: 0, actions: [], ...extra });
const stageFor = (camera: string, place = "mid", players = [player({}), player({ id: "friend", at: [-0.3, 0, 0.7] })]): SceneStage => ({ camera, place, subject: "robot", leadStart: 0, leadEnd: 0, players });

// Who is where on each frame, as World.tsx works it out.
function framingFor(stage: SceneStage, where: WorldLocation): Framing {
  const mark = where.marks.find((candidate) => candidate.id === stage.place)!;
  return (frame) =>
    stage.players.map((one) => {
      const { height, ...size } = measureModel(robot);
      return placePlayer(one, { ...robot, height }, mark, frame, DURATION, size);
    });
}
const lensAt = (stage: SceneStage, where: WorldLocation, frame: number) => steadyLens(stage, framingFor(stage, where), frame, DURATION, blockersOf(where, models));
const middleOf = (stage: SceneStage, where: WorldLocation, frame: number) => framingFor(stage, where)(frame)[0]!.position.clone().setY(0.08 + 0.45);

describe("world camera clearance", () => {
  it("stops the lens in front of any surface between it and the subject", () => {
    const blockers = blockersOf(closed, models);
    const inside = new THREE.Vector3(0, 0.5, -3);
    const stop = (eye: THREE.Vector3) => inside.clone().lerp(eye, clearShare(inside, eye, blockers));
    expect(clearShare(inside, new THREE.Vector3(0, 0.8, 3), blockers)).toBe(1); // straight down the duct
    // Through the wall, whose inner face is at x = 1.01: in front of it, with room.
    expect(stop(new THREE.Vector3(3, 0.8, -3)).x).toBeGreaterThan(0.6);
    expect(stop(new THREE.Vector3(3, 0.8, -3)).x).toBeLessThan(0.9);
    // Inside the wall itself is no good either: from in there its faces turn away and vanish.
    expect(stop(new THREE.Vector3(1.05, 0.8, -3)).x).toBeLessThan(0.95);
  });

  it("sees a subject inside a closed duct from every rig, on every frame", () => {
    for (const camera of Object.keys(RIGS)) {
      for (const place of ["mid", "turned"]) {
        const stage = stageFor(camera, place);
        for (const frame of [0, 30, 45, 89]) {
          const { eye } = lensAt(stage, closed, frame);
          const where = `${camera} at ${place}, frame ${frame}: eye ${eye.toArray().map((value) => value.toFixed(2))}`;
          expect(Math.abs(eye.x), where).toBeLessThan(1.01);
          expect(eye.y, where).toBeGreaterThan(0.08);
          expect(eye.y, where).toBeLessThan(1.76);
          expect(Math.abs(eye.z), where).toBeLessThan(13.56);
          expect(clearShare(middleOf(stage, closed, frame), eye, blockersOf(closed, models)), where).toBe(1);
        }
      }
    }
  });

  it("turns to look down a narrow duct rather than squeezing against its wall", () => {
    const stage = stageFor("medium", "turned");
    const subject = framingFor(stage, closed)(45)[0]!.position;
    const meant = lensFor(stage, framingFor(stage, closed)(45), 45, DURATION);
    const { eye, fov } = lensAt(stage, closed, 45);
    expect(Math.abs(eye.z - subject.z)).toBeGreaterThan(Math.abs(eye.x - subject.x) * 2);
    expect(eye.distanceTo(subject)).toBeGreaterThan(meant.eye.distanceTo(subject) * 0.85);
    expect(fov).toBeCloseTo(meant.fov);
  });

  it("eases in and out as walls come and go, with no jumps between frames", () => {
    for (const camera of ["orbit", "establishing", "pull_back", "high_down"]) {
      const stage = stageFor(camera, "turned");
      const eyes = Array.from({ length: DURATION }, (_, frame) => lensAt(stage, closed, frame).eye);
      const steps = eyes.slice(1).map((eye, index) => eye.distanceTo(eyes[index]!));
      expect(Math.max(...steps), camera).toBeLessThan(0.2);
    }
  });

  it("widens the lens when it has to come closer, so the framing holds", () => {
    const stage = stageFor("establishing");
    const meant = lensFor(stage, framingFor(stage, closed)(0), 0, DURATION);
    const lens = lensAt(stage, closed, 0);
    expect(lens.eye.distanceTo(lens.target)).toBeLessThan(meant.eye.distanceTo(meant.target));
    expect(lens.fov).toBeGreaterThan(meant.fov);
    expect(lens.fov).toBeLessThanOrEqual(75);
  });

  it("changes nothing in the open, behind glass, or with walls that aren't in the way", () => {
    const behindGlass = location([{ model: "glass", at: [0, 0, 2] }]);
    const farWall = location([{ model: "cap", at: [0, 0, -30] }]);
    for (const camera of Object.keys(RIGS)) {
      for (const where of [open, behindGlass, farWall]) {
        const stage = stageFor(camera);
        const meant = lensFor(stage, framingFor(stage, where)(40), 40, DURATION);
        const lens = lensAt(stage, where, 40);
        expect(lens.eye.distanceTo(meant.eye), camera).toBeLessThan(1e-6);
        expect(lens.fov).toBe(meant.fov);
      }
    }
  });

  it("smooths without ever going further out than a frame allows", () => {
    const shares = [1, 1, 1, 0.3, 1, 1, 1, 1, 0.6, 1];
    const smoothed = smooth(shares, 2);
    smoothed.forEach((value, index) => expect(value).toBeLessThanOrEqual(shares[index]!));
    expect(smoothed[3]).toBe(0.3);
    expect(Math.max(...smoothed.slice(1).map((value, index) => Math.abs(value - smoothed[index]!)))).toBeLessThan(0.4);
  });
});
