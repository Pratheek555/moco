import { expect, it } from "vitest";
import { cameraAt, FOCUS_POINT, focusFraming } from "../src/camera.ts";

it("push-in zooms over its range and holds after it ends", () => {
  const moves = [{ move: "push_in" as const, startFrame: 0, endFrame: 100, amount: 1 }];
  expect(cameraAt(moves, 0).scale).toBe(1);
  expect(cameraAt(moves, 100).scale).toBeCloseTo(1.35);
  expect(cameraAt(moves, 200).scale).toBeCloseTo(1.35);
});

it("shake only moves while active", () => {
  const moves = [{ move: "shake" as const, startFrame: 10, endFrame: 20, amount: 0.3 }];
  expect(cameraAt(moves, 5)).toEqual({ scale: 1, x: 0, y: 0 });
  expect(cameraAt(moves, 15).x).not.toBe(0);
  expect(cameraAt(moves, 25)).toEqual({ scale: 1, x: 0, y: 0 });
});

it("focus_on eases to a framing that puts the face at the focus point, above the captions", () => {
  const face = { x: 600, y: 900 };
  const moves = [{ move: "focus_on" as const, castId: "krishna", startFrame: 0, endFrame: 30, amount: 1 }];
  expect(cameraAt(moves, 0, { krishna: face })).toEqual({ scale: 1, x: 0, y: 0 });
  const framed = cameraAt(moves, 30, { krishna: face });
  // Where the face lands on screen: centre + scale·(face − centre) − camera.
  expect(540 + framed.scale * (face.x - 540) - framed.x).toBeCloseTo(FOCUS_POINT.x);
  expect(960 + framed.scale * (face.y - 960) - framed.y).toBeCloseTo(FOCUS_POINT.y);
  expect(FOCUS_POINT.y).toBeLessThan(1920 * 0.64); // captions start at 64%
});

it("focus_on never pans past the backgrounds' edge room", () => {
  const corner = focusFraming({ x: 0, y: 1900 }, 0.5);
  expect(Math.abs(corner.x)).toBeLessThanOrEqual(250 + (corner.scale - 1) * 540);
  expect(Math.abs(corner.y)).toBeLessThanOrEqual(250 + (corner.scale - 1) * 960);
});

import { parseRange } from "../src/index.ts";

it("parses HTTP byte ranges for the audio server", () => {
  expect(parseRange(undefined, 100)).toBeUndefined();
  expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
  expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
  expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  expect(parseRange("bytes=0-500", 100)).toEqual({ start: 0, end: 99 });
  expect(parseRange("bytes=200-300", 100)).toBe("invalid");
});
