// Perceptual hash for golden stills: dHash. Shrink the image to 17×32 grey cells, then one bit per cell pair:
// "is this cell brighter than the one to its right" (16 × 32 = 512 bits). The usual 9×8 grid is too coarse for a
// 9:16 frame where the character is small: Krishna raising his arm flipped only 1 of its 64 bits. Even at 512
// bits a small pose change barely moves a whole-frame hash, so callers also hash the character's region.
// Stills are read with the renderer's own PNG decoder (src/pixels.ts).
import type { Pixels } from "../src/pixels.ts";

export { decodePng } from "../src/pixels.ts";

const GRID = { columns: 17, rows: 32 };

// Part of the image to hash, as fractions of its width and height.
export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}
const WHOLE: Region = { left: 0, top: 0, width: 1, height: 1 };

// 512-bit dHash of a region (default: the whole image) as 128 hex digits.
export function dHash(image: Pixels, region: Region = WHOLE): string {
  // Average grey per cell, in one pass over the pixels; pixels outside the region are skipped.
  const sums = new Float64Array(GRID.columns * GRID.rows);
  const counts = new Float64Array(GRID.columns * GRID.rows);
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const u = ((pixel % image.width) / image.width - region.left) / region.width; // 0..1 across the region
    const v = (Math.floor(pixel / image.width) / image.height - region.top) / region.height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const cell = Math.floor(v * GRID.rows) * GRID.columns + Math.floor(u * GRID.columns);
    const at = pixel * image.channels;
    sums[cell]! += 0.299 * image.data[at]! + 0.587 * image.data[at + 1]! + 0.114 * image.data[at + 2]!;
    counts[cell]! += 1;
  }
  const grey = Array.from(sums, (sum, cell) => sum / counts[cell]!);

  // 8 comparisons per row × 8 rows = 64 bits.
  const perRow = GRID.columns - 1;
  const bits = Array.from({ length: perRow * GRID.rows }, (_, bit) => {
    const cell = Math.floor(bit / perRow) * GRID.columns + (bit % perRow);
    return grey[cell]! > grey[cell + 1]! ? 1n : 0n;
  });
  const hash = bits.reduce<bigint>((total, bit) => (total << 1n) | bit, 0n);
  return hash.toString(16).padStart(bits.length / 4, "0");
}

// How many of the bits differ.
export function hammingDistance(a: string, b: string): number {
  return (BigInt(`0x${a}`) ^ BigInt(`0x${b}`)).toString(2).replaceAll("0", "").length;
}
