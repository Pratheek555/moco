// Reading back the stills the render check writes: a minimal PNG decoder for what Chrome writes (8-bit RGB or RGBA,
// not interlaced), so no dependency, and the test for a frame that shows nothing.
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

// Captions are drawn over the shot (from 64% of the height down), so they're left out: white words on a black frame
// are still a black frame.
const CAPTION_BAND = { top: 0.6, bottom: 0.88 };
const BLACK = 20; // of 255. Shots that rendered black measured 0–7 here, the darkest good ones 90 and up
const FLAT = 6; // levels between the darkest and brightest pixels of a frame that is one colour

// Why a frame shows nothing, or undefined when it shows something. A 3D lens behind a wall, inside a model or deep in
// fog gives a flat or black picture, and no shot is meant to look like that. Judged on the darkest and brightest 1%
// of the picture, so a few stray pixels can't decide it either way.
export function blankReason(image: Pixels): string | undefined {
  const levels = new Uint32Array(256);
  let counted = 0;
  for (let y = 0; y < image.height; y += 2) {
    const down = y / image.height;
    if (down >= CAPTION_BAND.top && down < CAPTION_BAND.bottom) continue;
    for (let x = 0; x < image.width; x += 2) {
      const at = (y * image.width + x) * image.channels;
      levels[Math.round(0.299 * image.data[at]! + 0.587 * image.data[at + 1]! + 0.114 * image.data[at + 2]!)]! += 1;
      counted += 1;
    }
  }
  const level = (share: number) => {
    let seen = 0;
    return levels.findIndex((count) => (seen += count) >= share * counted);
  };
  const darkest = level(0.01);
  const brightest = level(0.99);
  if (brightest < BLACK) return "almost black";
  if (brightest - darkest < FLAT) return "a single flat colour";
  return undefined;
}
