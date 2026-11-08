import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CanvasLabel, SceneSpec } from "@moco/spec";
import { canvasDocument } from "../src/canvas-document.ts";
import { createRemotionRenderPort } from "../src/index.ts";
import { decodePng } from "../src/pixels.ts";

const label = CanvasLabel.parse({ id: "reward", text: "Dopamine", x: 100, y: 30, width: 400, height: 60, fontSize: 32, startFrame: 2, endFrame: 10 });
const shot = (text = label.text) => SceneSpec.parse({ shotId: "s01", format: { width: 640, height: 360, fps: 30 }, durationFrames: 12, background: { id: "board" }, actors: [], captions: [], canvas: { version: 1, source: "if(config.labels)throw Error('Labels leaked into artwork');ctx.fillStyle='#f3e3cd';ctx.fillRect(0,0,640,360);helpers.circle(320+scene.frame,240,60,'#48767a');", labels: [{ ...label, text }] } });

it("keeps editable values out of the artwork document and validates label input", () => {
  const a = shot(), b = shot("Reward signal");
  expect(canvasDocument(a.canvas!, 640, 360)).toBe(canvasDocument(b.canvas!, 640, 360));
  expect(canvasDocument(a.canvas!, 640, 360)).not.toContain("Dopamine");
  expect(CanvasLabel.safeParse({ ...label, text: "x\ny" }).success).toBe(false);
  expect(CanvasLabel.safeParse({ ...label, text: " " }).success).toBe(false);
  expect(CanvasLabel.safeParse({ ...label, fontSize: 0 }).success).toBe(false);
});

describe.runIf(process.env.MOCO_RENDER_TESTS)("bounded labels in real renderer", () => {
  const port = createRemotionRenderPort();
  afterAll(() => port.close());
  it("changes pixels only inside the label box, preserves timing, and renders out of order", async () => {
    const root = await mkdtemp(join(tmpdir(), "moco-label-pixels-"));
    const a = await port.check(shot(), { frames: [9, 0, 2, 10], outDir: join(root, "before") });
    const b = await port.check(shot("Reward signal"), { frames: [2, 10, 9, 0], outDir: join(root, "after") });
    if (!a.ok || !b.ok) throw Error(JSON.stringify({ a, b }));
    for (const frame of [0, 2, 9, 10]) {
      const before = decodePng(await readFile(join(root, "before", `${frame}.png`)));
      const after = decodePng(await readFile(join(root, "after", `${frame}.png`)));
      expect([after.width, after.height, after.channels]).toEqual([before.width, before.height, before.channels]);
      let changed = 0;
      for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
        const index = (y * before.width + x) * before.channels;
        if (before.data.slice(index, index + before.channels).some((value, channel) => value !== after.data[index + channel])) {
          changed++;
          // check() produces half-resolution stills.
          expect(x).toBeGreaterThanOrEqual(label.x / 2); expect(x).toBeLessThan((label.x + label.width) / 2);
          expect(y).toBeGreaterThanOrEqual(label.y / 2); expect(y).toBeLessThan((label.y + label.height) / 2);
        }
      }
      expect(changed > 0).toBe(frame >= 2 && frame < 10);
    }
    const repeated = await port.check(shot("Reward signal"), { frames: [9], outDir: join(root, "again") });
    expect(repeated.ok).toBe(true);
    expect(await readFile(join(root, "again/9.png"))).toEqual(await readFile(join(root, "after/9.png")));
    // Episode export lazy-loads Canvas data via RemoteCanvas; labels must survive that path too.
    const out = join(root, "labels.mp4"), scene = shot("Reward signal");
    await port.renderEpisode({ episodeId: "ep", scenes: [scene], audio: { voiceover: "" }, export: scene.format! }, out, "preview");
    expect((await stat(out)).size).toBeGreaterThan(1000);
  }, 240_000);

  it("rejects overflow, invalid timing/bounds and missing fonts instead of reflowing text", async () => {
    for (const patch of [{ text: "W".repeat(200) }, { endFrame: 50 }, { x: 630 }, { fontFamily: "Missing Font" }]) {
      const scene = shot(); Object.assign(scene.canvas!.labels![0]!, patch);
      const result = await port.check(scene, { frames: [0], outDir: await mkdtemp(join(tmpdir(), "moco-label-invalid-")) });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.path).toBe("canvas.labels");
    }
    // A corrected scene must recover after cancelRender, just as an author
    // fixing an invalid label does before the shared browser can be released.
    const repaired = await port.check(shot(), { frames: [2], outDir: await mkdtemp(join(tmpdir(), "moco-label-repaired-")) });
    expect(repaired.ok).toBe(true);
    const embedded = shot();
    const font = await readFile(new URL("../../engine/assets/fonts/LilitaOne-Regular.ttf", import.meta.url));
    embedded.canvas!.fonts = { "Lilita One": `data:font/ttf;base64,${font.toString("base64")}` };
    embedded.canvas!.labels![0]!.fontFamily = "Lilita One";
    const withFont = await port.check(embedded, { frames: [2], outDir: await mkdtemp(join(tmpdir(), "moco-label-font-")) });
    expect(withFont.ok).toBe(true);
  }, 180_000);
});
