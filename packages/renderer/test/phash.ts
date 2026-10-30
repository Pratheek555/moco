// Perceptual hash for golden stills: dHash. Shrink the image to 17×32 grey cells, then one bit per cell pair:
// "is this cell brighter than the one to its right" (16 × 32 = 512 bits). The usual 9×8 grid is too coarse for a
// 9:16 frame where the character is small: Krishna raising his arm flipped only 1 of its 64 bits. Even at 512
// bits a small pose change barely moves a whole-frame hash, so callers also hash the character's region.
// Includes a minimal PNG decoder for what Chrome writes (8-bit RGB or RGBA, not interlaced), so no dependency.
import { inflateSync } from "node:zlib";

export interface Pixels {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array; // rows of width × channels bytes, no padding
}

export function decodePng(png: Buffer): Pixels {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const [bitDepth, colorType, , , interlace] = png.subarray(24, 29);
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace}`);
  }
  const channels = colorType === 6 ? 4 : 3;

  // The image data is every IDAT chunk's body, joined, then inflated.
  const bodies: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") bodies.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length; // length + type + body + crc
  }
  const raw = inflateSync(Buffer.concat(bodies));

  // Undo the per-row filters in one pass over every output byte. Each row in `raw` starts with its filter type.
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let index = 0; index < data.length; index += 1) {
    const y = Math.floor(index / stride);
    const x = index % stride;
    const value = raw[y * (stride + 1) + 1 + x]!;
    const left = x >= channels ? data[index - channels]! : 0;
    const up = y > 0 ? data[index - stride]! : 0;
    const upLeft = x >= channels && y > 0 ? data[index - stride - channels]! : 0;
    data[index] = (value + predictor(raw[y * (stride + 1)]!, left, up, upLeft)) & 255;
  }
  return { width, height, channels, data };
}

// PNG filter types 0–4: None, Sub, Up, Average, Paeth.
function predictor(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) return paeth(left, up, upLeft);
  throw new Error(`unknown PNG filter ${filter}`);
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

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
