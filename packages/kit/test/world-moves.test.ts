import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ScenePlayer, WorldModel } from "@moco/spec";
import { HUMANOID_MOVES, movesOf, poseAt, sampleMove } from "../src/stages/world/moves.ts";
import { lensFor, placePlayer, RIGS } from "../src/stages/world/shots.ts";
import { WORLD_CAMERAS } from "../src/stages/world/options.ts";

const person = { rig: "humanoid", moves: [] } as Pick<WorldModel, "rig" | "moves">;
const model = { id: "m", rig: "humanoid", height: 2, surfaces: {}, parts: [], moves: [] } as WorldModel;
const mark = { id: "here", hint: "", at: [10, 0, 0] as [number, number, number], facing: 0 };
const player = (extra: Partial<ScenePlayer>): ScenePlayer => ({ id: "m", model: "m", at: [0, 0, 0], facing: 0, actions: [], ...extra });

describe("world moves", () => {
  it("blends between keys and lands exactly on them", () => {
    const move = { name: "lift", minFrames: 10, loop: false, keys: [{ at: 0, turn: { arm: [0, 0, 0] as [number, number, number] } }, { at: 1, turn: { arm: [90, 0, 0] as [number, number, number] } }] };
    expect(sampleMove(move, 0).arm).toEqual([0, 0, 0]);
    expect(sampleMove(move, 0.5).arm![0]).toBeCloseTo(45);
    expect(sampleMove(move, 1).arm).toEqual([90, 0, 0]);
  });

  it("only applies a move inside its action, and returns to rest at the end", () => {
    const wave = [{ name: "wave", startFrame: 10, endFrame: 50 }];
    const idle = poseAt(person, [], 5, 3).arm_R!;
    expect(poseAt(person, wave, 5, 3).arm_R).toEqual(idle);
    expect(Math.abs(poseAt(person, wave, 30, 3).arm_R![0])).toBeGreaterThan(100);
    expect(Math.abs(poseAt(person, wave, 49, 3).arm_R![0])).toBeLessThan(40);
  });

  it("gives the same pose for the same frame, so frames can render in any order", () => {
    const walk = [{ name: "walk", startFrame: 0, endFrame: 90 }];
    expect(poseAt(person, walk, 41, 9)).toEqual(poseAt(person, walk, 41, 9));
  });

  it("lets a model's own move replace a built-in of the same name", () => {
    const own = { name: "walk", minFrames: 12, loop: true, keys: [{ at: 0, turn: {} }, { at: 1, turn: {} }] };
    const moves = movesOf({ rig: "humanoid", moves: [own] });
    expect(moves.filter((move) => move.name === "walk")).toEqual([own]);
    expect(moves).toHaveLength(HUMANOID_MOVES.length);
    expect(movesOf({ rig: "none", moves: [] })).toEqual([]);
  });
});

describe("world shots", () => {
  it("offers exactly the cameras it can draw", () => {
    expect(WORLD_CAMERAS.map((camera) => camera.id).sort()).toEqual(Object.keys(RIGS).sort());
  });

  it("moves a player from `at` to `to`, relative to the mark, turning it that way", () => {
    const walker = player({ at: [0, 0, 0], to: [4, 0, 0] });
    expect(placePlayer(walker, model, mark, 0, 100).position.x).toBe(10);
    expect(placePlayer(walker, model, mark, 50, 100).position.x).toBe(12);
    expect(placePlayer(walker, model, mark, 100, 100).position.x).toBe(14);
    expect(placePlayer(walker, model, mark, 50, 100).facing).toBeCloseTo(90);
  });

  it("stays on the arrival spot after arriveFrame", () => {
    const walker = player({ at: [0, 0, 0], to: [4, 0, 0], arriveFrame: 20 });
    expect(placePlayer(walker, model, mark, 80, 100).position.x).toBe(14);
  });

  it("keeps every rig's lens away from the subject and aimed at something else", () => {
    const placed = [placePlayer(player({}), model, mark, 0, 100), placePlayer(player({ id: "other", at: [2, 0, 0] }), model, mark, 0, 100)];
    const lenses = Object.keys(RIGS).map((camera) => lensFor({ camera, place: "here", subject: "m", leadStart: 0, leadEnd: 0, players: [] }, placed, 30, 100));
    lenses.forEach(({ eye, target }) => expect(eye.distanceTo(target)).toBeGreaterThan(0.5));
    lenses.forEach(({ eye }) => expect(eye.toArray().every(Number.isFinite)).toBe(true));
    expect(lenses.every(({ eye }) => eye instanceof THREE.Vector3)).toBe(true);
  });

  it("backs off for a head wider than the narrow frame", () => {
    const stage = { camera: "close", place: "here", subject: "m", leadStart: 0, leadEnd: 0, players: [] };
    const slim = placePlayer(player({}), model, mark, 0, 100, { face: 1.7, width: 0.6, headWidth: 0.3 });
    const wide = placePlayer(player({}), model, mark, 0, 100, { face: 1.7, width: 1.6, headWidth: 1.4 });
    const distance = (placed: typeof slim) => lensFor(stage, [placed], 0, 100).eye.distanceTo(placed.position);
    expect(distance(wide)).toBeGreaterThan(distance(slim) * 1.5);
  });
});
