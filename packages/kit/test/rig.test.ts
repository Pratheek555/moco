import { describe, expect, it } from "vitest";
import { curveFor, gesture } from "../src/actions.ts";
import { DEFAULT_IDLE } from "../src/define.ts";
import { idleBlinkAt, rigStateAt, seededRandom } from "../src/rig.ts";

const actor = {
  actions: [
    { name: "blink", startFrame: 10, endFrame: 16 },
    { name: "raise_hand", startFrame: 20, endFrame: 60, params: { side: "left" } },
    { name: "turn_head", startFrame: 70, endFrame: 100 },
    { name: "speak", startFrame: 100, endFrame: 130 },
  ],
  expression: [{ name: "serious", atFrame: 0 }, { name: "smile", atFrame: 50 }],
};
const withIdle = { seed: "krishna", idle: DEFAULT_IDLE };
const frames = Array.from({ length: 300 }, (_, frame) => frame);

describe("actions", () => {
  it("start and end at exactly 0 and are inactive outside their frames", () => {
    const cases: [string, number][] = [["raise_hand", 12], ["raise_hand", 200], ["bless", 16], ["point", 10], ["turn_head", 8], ["smile", 8], ["play_flute", 40]];
    const edges = cases.map(([name, duration]) => [curveFor(name)(0, duration), curveFor(name)(duration - 1, duration)]);
    expect(edges.flat().every((amount) => Math.abs(amount) < 1e-9)).toBe(true);
    expect(rigStateAt(actor, 19, withIdle).actions.raise_hand).toBeUndefined();
    expect(rigStateAt(actor, 60, withIdle).actions.raise_hand).toBeUndefined();
    expect(rigStateAt(actor, 40, withIdle).actions.raise_hand).toMatchObject({ amount: 1, params: { side: "left" } });
  });

  it("winds up, overshoots, settles and holds", () => {
    const curve = frames.slice(0, 40).map((local) => gesture(local, 40));
    expect(Math.min(...curve.slice(0, 4))).toBeLessThan(-0.05); // anticipation: a small move the other way first
    expect(Math.max(...curve)).toBeGreaterThan(1.05); // overshoot
    expect(curve[15]).toBe(1); // settled, holding
  });

  it("blinks shut mid-blink and picks the latest expression", () => {
    const still = { seed: "krishna" }; // idle off: only the spec's blink
    expect(rigStateAt(actor, 13, still).blink).toBeCloseTo(1, 1);
    expect(rigStateAt(actor, 30, still).expression).toBe("serious");
    expect(rigStateAt(actor, 55, still).expression).toBe("smile");
  });

  it("speaks only while speak runs, following the viseme track", () => {
    const visemes = [{ frame: 0, viseme: "X" }, { frame: 105, viseme: "D" }, { frame: 112, viseme: "A" }];
    const speaking = { ...withIdle, visemes };
    expect(rigStateAt(actor, 99, speaking).viseme).toBeUndefined();
    expect(rigStateAt(actor, 104, speaking).viseme).toBe("X");
    expect(rigStateAt(actor, 110, speaking).viseme).toBe("D");
    expect(rigStateAt(actor, 112, speaking).viseme).toBe("A");
    expect(rigStateAt(actor, 110, withIdle).viseme).toMatch(/^[A-F]$/); // no track: seeded placeholder shapes
  });
});

describe("idle motion", () => {
  it("is identical for identical inputs", () => {
    const first = frames.map((frame) => rigStateAt(actor, frame, withIdle));
    const second = frames.map((frame) => rigStateAt(actor, frame, withIdle));
    expect(second).toEqual(first);
  });

  it("is off when the spec turns idle off", () => {
    const states = frames.map((frame) => rigStateAt({ actions: [], expression: [] }, frame, { seed: "krishna" }));
    expect(states.every((state) => state.breath === 0 && state.sway === 0 && state.blink === 0 && state.flex === 0)).toBe(true);
  });

  it("breathes and sways within small limits", () => {
    const states = frames.map((frame) => rigStateAt(actor, frame, withIdle));
    expect(Math.max(...states.map((state) => state.breathScale))).toBeLessThanOrEqual(1 + DEFAULT_IDLE.breathAmount);
    expect(Math.max(...states.map((state) => Math.abs(state.sway)))).toBeLessThanOrEqual(DEFAULT_IDLE.swayDegrees);
  });

  it("follows a reproducible blink schedule per seed, every 2–5 s, each blink blinkFrames long", () => {
    const long = Array.from({ length: 30 * 60 }, (_, frame) => frame); // a minute
    const blinks = (seed: string) => long.filter((frame) => idleBlinkAt(frame, DEFAULT_IDLE, seed) > 0);
    expect(blinks("krishna")).toEqual(blinks("krishna"));
    expect(blinks("krishna")).not.toEqual(blinks("arjuna"));

    const starts = blinks("krishna").filter((frame, index, all) => all[index - 1] !== frame - 1);
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30 * DEFAULT_IDLE.blinkMinSeconds);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(30 * DEFAULT_IDLE.blinkMaxSeconds);
    expect(blinks("krishna").length).toBe(starts.length * DEFAULT_IDLE.blinkFrames);
  });

  it("has a seeded random that depends only on its inputs", () => {
    expect(seededRandom("krishna", 3)).toBe(seededRandom("krishna", 3));
    expect(seededRandom("krishna", 3)).not.toBe(seededRandom("krishna", 4));
    const values = frames.map((index) => seededRandom("x", index));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
