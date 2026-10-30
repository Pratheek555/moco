// The golden test decodes both stills with the same hand-written decoder, so a decoder bug would hide itself.
// These pixel values were read once from a golden still with an independent decoder (Pillow 11, RGB mode).
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "./phash.ts";

const PILLOW_PIXELS: [number, number, [number, number, number]][] = [
  [0, 0, [34, 29, 35]],
  [135, 120, [150, 90, 90]],
  [135, 300, [156, 83, 36]],
  [269, 479, [54, 35, 21]],
  [60, 400, [130, 87, 54]],
  [200, 50, [88, 63, 75]],
];

it("decodes a Chrome PNG to the same pixels as Pillow", () => {
  const image = decodePng(readFileSync(new URL("./golden/premium-150.png", import.meta.url)));
  expect([image.width, image.height]).toEqual([270, 480]);
  const decoded = PILLOW_PIXELS.map(([x, y]) => {
    const at = (y * image.width + x) * image.channels;
    return [x, y, Array.from(image.data.subarray(at, at + 3))];
  });
  expect(decoded).toEqual(PILLOW_PIXELS);
});
