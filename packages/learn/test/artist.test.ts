import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractReferenceFrames, LearnProduction, parseStyleImages, representativeFrames } from "../src/artist.ts";
import { ArtistTemplateDraft, TemplateDraft } from "../src/merge.ts";
import { renderTemplate } from "../src/skill.ts";
import { clip, measurements, meta, speak } from "./helpers.ts";

const m = measurements(clip(180, (frame) => frame === 60 || frame === 120 ? { cut: 100, hist: 0.9 } : {}), speak("An original sample."));
const png = `data:image/png;base64,${Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")}`;
const ffmpeg = process.env.MOCO_FFMPEG ?? "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"], { windowsHide: true, stdio: "ignore" }).status === 0;

describe("Canvas learning inputs and frame evidence", () => {
  it("retains explicit production settings without importing the engine or spec", () => {
    const production = { mode: "artist", format: { width: 1920, height: 1080, fps: 60 }, targetSeconds: 12, localOnly: true };
    expect(LearnProduction.parse(production)).toEqual(production);
    expect(() => LearnProduction.parse({ ...production, format: { ...production.format, fps: 0 } })).toThrow();
  });

  it("checks source still count, bytes and image signature before learning starts", () => {
    expect(parseStyleImages([png])[0]!.extension).toBe("png");
    expect(() => parseStyleImages(Array(6).fill(png))).toThrow("up to five");
    expect(() => parseStyleImages(["data:image/png;base64,dGV4dA=="])).toThrow("does not match");
    expect(() => parseStyleImages([`data:image/png;base64,${Buffer.alloc(3_000_001).toString("base64")}`])).toThrow("3 MB");
    expect(() => parseStyleImages(["https://example.com/frame.png"])).toThrow();
  });

  it("selects mid-shot source frames across references, bounded to the available image slots", () => {
    const all = Array.from({ length: 10 }, (_, index) => ({ ...m, ref: { ...meta, id: `R${index}` } }));
    const selected = representativeFrames(all);
    expect(selected.map((frame) => frame.reference)).toEqual(["R0", "R2", "R5", "R7", "R9"]);
    expect(selected.map((frame) => frame.path)).toEqual(Array.from({ length: 5 }, (_, i) => `references/${i}.png`));
    for (const item of selected) expect(m.video.shots.some((shot) => item.frame === Math.round((shot.start + shot.end) / 2))).toBe(true);
    expect(representativeFrames(all, 2)).toHaveLength(2);
    expect(representativeFrames(all, 0)).toEqual([]);
    expect(representativeFrames([])).toEqual([]);
  });

  it.skipIf(!hasFfmpeg)("extracts an actual local source frame and records its frame provenance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "learn-frame-"));
    await mkdir(join(dir, "refs", meta.id), { recursive: true });
    const generated = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "refs", meta.id, "source.mp4")], { windowsHide: true });
    expect(generated.status, generated.stderr.toString()).toBe(0);
    const frames = await extractReferenceFrames([measurements(clip(30), speak("Original."))], dir, { python: "unused", ffmpeg, ffprobe: "unused" }, undefined, 2);
    expect(frames).toEqual([{ reference: meta.id, frame: 15, fps: 30, path: "references/2.png" }]);
    expect((await readFile(join(dir, frames[0]!.path))).subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(JSON.parse(await readFile(join(dir, "reference-frames.json"), "utf8")).frames).toEqual(frames);
  });
});

describe("Canvas template compilation", () => {
  it("adds show and artist guidance without changing the legacy stage schema", () => {
    const stages = { series: "s", series_extend: "e", bible: "b", world: "", script: "sc", shots: "sh", scene: "sn", publish: "p" };
    const template = { info: {} as never, stages: { ...stages, show: "original identity", artist: "shared drawing functions" } };
    const rendered = renderTemplate(template, "illustrated", [meta]);
    expect(rendered).toContain("# show\noriginal identity");
    expect(rendered).toContain("# artist\nshared drawing functions");
    expect(rendered).toContain("authored Canvas artwork");
    expect(TemplateDraft.shape.stages.safeParse(stages).success).toBe(true);
    expect(ArtistTemplateDraft.shape.stages.safeParse(stages).success).toBe(false);
    expect(ArtistTemplateDraft.shape.stages.safeParse(template.stages).success).toBe(true);
  });
});
