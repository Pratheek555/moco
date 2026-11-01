import { describe, expect, it } from "vitest";
import { PLACES, RIGS, shotState } from "../src/stages/race-circuit/rigs.ts";
import { poseAt, TRACK_LENGTH } from "../src/stages/race-circuit/track.ts";

const stage = { camera: "chase", place: "hairpin", subject: "blue", leadStart: -10, leadEnd: 5 };
const distanceAlong = (a: number, b: number) => a - b;

describe("race circuit rigs", () => {
  it("runs an overtake: the subject starts behind and ends ahead", () => {
    const first = shotState(stage, 0, 120);
    const last = shotState(stage, 120, 120);
    expect(distanceAlong(first.subject.distance, first.other.distance)).toBeCloseTo(-10);
    expect(distanceAlong(last.subject.distance, last.other.distance)).toBeCloseTo(5);
  });

  it("gives the same answer for the same frame", () => {
    expect(shotState(stage, 37, 120).eye).toEqual(shotState(stage, 37, 120).eye);
  });

  it("keeps every lens off the ground and looking at something, in every place", () => {
    const rigs = Object.keys(RIGS);
    const pairs = rigs.flatMap((camera) => Object.keys(PLACES).map((place) => ({ camera, place })));
    expect(pairs.every(({ camera, place }) => {
      const shot = shotState({ ...stage, camera, place }, 45, 90);
      return shot.eye.y > 0.1 && shot.eye.distanceTo(shot.target) > 0.5;
    })).toBe(true);
  });

  it("only parked cars nod, and the nod returns to level", () => {
    const parked = { ...stage, place: "parc_ferme", leadStart: 0, leadEnd: 0 };
    expect(shotState(stage, 100, 120).nod).toBe(0);
    expect(shotState(parked, 100, 120).nod).toBeGreaterThan(0.1);
    expect(shotState(parked, 120, 120).nod).toBeCloseTo(0);
  });

  it("closes the lap", () => {
    expect(poseAt(TRACK_LENGTH).position.distanceTo(poseAt(0).position)).toBeLessThan(0.01);
  });
});
