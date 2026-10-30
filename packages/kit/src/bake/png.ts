// A minimal PNG encoder for baked kit assets (Node zlib only, no dependency).
// The same pixel function always gives the same bytes, so baked assets are reproducible.
import { crc32, deflateSync } from "node:zlib";

// One pixel as 0..1 values: [gray, alpha] for 2 channels, [red, green, blue, alpha] for 4.
export type Pixel = number[];

export interface Image {
  width: number;
  height: number;
  channels: 2 | 4; // gray + alpha, or RGBA
  pixel: (x: number, y: number) => Pixel;
}

export function encodePng(image: Image): Buffer {
  const { width, height, channels } = image;
  const rowBytes = 1 + width * channels; // each row starts with a filter byte (0 = none), already zero
  const raw = Buffer.alloc(rowBytes * height);

  // One pass over every pixel, row by row.
  for (let index = 0; index < width * height; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    raw.set(toBytes(image.pixel(x, y)), y * rowBytes + 1 + x * channels);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = channels === 4 ? 6 : 4; // colour type: RGBA or gray + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 0..1 values → 0..255 bytes, clamped.
function toBytes(pixel: Pixel): Uint8Array {
  return Uint8Array.from(pixel, (value) => Math.round(Math.min(1, Math.max(0, value)) * 255));
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
