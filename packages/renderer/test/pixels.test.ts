import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankReason, decodePng, type Pixels } from "../src/pixels.ts";

const WIDTH = 540; // the size the render check writes its stills at
const HEIGHT = 960;

function picture(paint: (x: number, y: number) => [number, number, number]): Pixels {
  const data = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) data.set(paint(x, y), (y * WIDTH + x) * 3);
  }
  return { width: WIDTH, height: HEIGHT, channels: 3, data };
}

// White caption words where the captions sit, over whatever is behind them.
const captioned = (behind: [number, number, number]) => (x: number, y: number): [number, number, number] =>
  y > HEIGHT * 0.65 && y < HEIGHT * 0.72 && x % 9 < 5 ? [255, 255, 255] : behind;

describe("blank frames", () => {
  it("calls a black frame black, whatever the captions on it say", () => {
    expect(blankReason(picture(captioned([1, 1, 2])))).toBe("almost black");
    expect(blankReason(picture(captioned([6, 6, 7])))).toBe("almost black");
  });

  it("isn't fooled by a few stray bright pixels", () => {
    expect(blankReason(picture((x, y) => (x === 270 && y % 40 === 0 ? [250, 250, 250] : [2, 2, 3])))).toBe("almost black");
  });

  it("calls a picture of nothing but fog flat", () => {
    expect(blankReason(picture(captioned([96, 104, 120])))).toBe("a single flat colour");
  });

  it("passes a dark night shot with its subject lit, and a normal shot", () => {
    // A lit figure covering about 3% of an otherwise near-black frame.
    const night = picture((x, y) => (Math.hypot(x - 270, y - 300) < 60 ? [210, 180, 140] : [4, 5, 9]));
    expect(blankReason(night)).toBeUndefined();
    expect(blankReason(decodePng(readFileSync(new URL("./golden/premium-150.png", import.meta.url))))).toBeUndefined();
  });
});
