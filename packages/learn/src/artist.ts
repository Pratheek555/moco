// The learner remains independent of @moco/spec. This structural type matches
// ArtistProduction; the engine validates it again when reading the template.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import type { Measurements } from "./measure.ts";
import { runTool, type Tools } from "./tools.ts";

export const LearnProduction = z.object({
  mode: z.literal("artist"),
  format: z.object({ width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096), fps: z.number().int().min(1).max(60) }),
  targetSeconds: z.number().positive().optional(),
  localOnly: z.boolean().optional(),
  imageGeneration: z.literal("gpt-image-2").optional(),
});
export type LearnProduction = z.infer<typeof LearnProduction>;

export function parseStyleImages(images: string[]): { bytes: Buffer; extension: string }[] {
  if (images.length > 5) throw Error("Choose up to five PNG, JPEG or WebP style frames, each under 3 MB");
  return images.map((image) => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!match || image.length > 4_000_064) throw Error("Use PNG, JPEG or WebP style frames, each under 3 MB");
    const bytes = Buffer.from(match[2]!, "base64"), extension = match[1]!;
    if (bytes.length > 3_000_000) throw Error("Style frames must be under 3 MB");
    const valid = extension === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : extension === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid) throw Error("Style frame data does not match its image type");
    return { bytes, extension };
  });
}

export interface ReferenceFrame {
  reference: string;
  frame: number;
  fps: number;
  path: string;
}

// Spread references across the selection first, then add shots from each video.
// Mid-shot frames avoid transition smear; these are source frames, not generated artwork.
export function representativeFrames(all: Measurements[], cap = 5): ReferenceFrame[] {
  if (cap <= 0 || all.length === 0) return [];
  const selected = all.length <= cap ? all : Array.from({ length: cap }, (_, i) => all[Math.round(i * (all.length - 1) / Math.max(1, cap - 1))]!);
  const candidates = selected.map((m) => {
    const shots = m.video.shots;
    const count = Math.min(shots.length, Math.ceil(cap / selected.length));
    return Array.from({ length: count }, (_, index) => {
      const shot = shots[Math.round(index * (shots.length - 1) / Math.max(1, count - 1))]!;
      return { reference: m.ref.id, frame: Math.round((shot.start + shot.end) / 2), fps: m.video.fps };
    });
  });
  const result: ReferenceFrame[] = [];
  for (let index = 0; result.length < cap && candidates.some((items) => items[index]); index++) {
    for (const items of candidates) {
      if (items[index] && result.length < cap) result.push({ ...items[index]!, path: `references/${result.length}.png` });
    }
  }
  return result;
}

export async function extractReferenceFrames(all: Measurements[], dir: string, tools: Tools, signal?: AbortSignal, offset = 0): Promise<ReferenceFrame[]> {
  const frames = representativeFrames(all, 5 - offset).map((item, index) => ({ ...item, path: `references/${offset + index}.png` }));
  await mkdir(join(dir, "references"), { recursive: true });
  for (const item of frames) {
    await runTool(tools.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(item.frame / item.fps), "-i", join(dir, "refs", item.reference, "source.mp4"), "-frames:v", "1", "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease", "-update", "1", join(dir, item.path)], { timeoutMs: 60_000, signal });
  }
  await writeFile(join(dir, "reference-frames.json"), JSON.stringify({ version: 1, frames }, null, 2));
  return frames;
}
