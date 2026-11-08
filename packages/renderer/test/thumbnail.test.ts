// Real JPEG exports exercise the shared layout at native portrait and landscape sizes.
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SceneSpec, THUMBNAIL_STYLES } from "@moco/spec";
import { createRemotionRenderPort } from "../src/index.ts";

describe.runIf(process.env.MOCO_RENDER_TESTS)("thumbnail JPEG exports", () => {
  const port = createRemotionRenderPort();
  afterAll(() => port.close());
  it("renders distinct styles and a clean image at each composition's size", async () => {
    const dir = resolve("artifacts/thumbnail-exports");
    await mkdir(dir, { recursive: true });
    const source = `ctx.fillStyle='#182d46';ctx.fillRect(0,0,scene.width,scene.height);
      const s=scene.width; const h=scene.height;
      ctx.fillStyle='#397b87';ctx.beginPath();ctx.arc(s*.52,h*.42,s*.28,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#e6bd88';ctx.beginPath();ctx.arc(s*.52,h*.36,s*.13,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#14263c';ctx.fillRect(s*.43,h*.32,s*.04,s*.02);ctx.fillRect(s*.57,h*.32,s*.04,s*.02);`;
    for (const [width, height] of [[1080, 1920], [1280, 720]]) {
      const spec = SceneSpec.parse({ shotId: "cover", durationFrames: 60, format: { width, height, fps: 30 }, background: { id: "custom" }, actors: [], captions: [], canvas: { version: 1, source } });
      const pictures: Buffer[] = [];
      for (const style of THUMBNAIL_STYLES) {
        const out = resolve(dir, `${width}-${style.id}.jpg`);
        await port.thumbnail(spec, { frame: 29, text: "One choice", design: { style: style.id, position: "lower", accent: "yellow" }, out });
        const bytes = await readFile(out);
        expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
        // Read the JPEG start-of-frame segment to verify actual export dimensions.
        let offset = 2;
        while (offset < bytes.length && ![0xc0, 0xc2].includes(bytes[offset + 1]!)) offset += 2 + bytes.readUInt16BE(offset + 2);
        expect(bytes.readUInt16BE(offset + 5)).toBe(height);
        expect(bytes.readUInt16BE(offset + 7)).toBe(width);
        expect(pictures.every(previous => !previous.equals(bytes))).toBe(true);
        pictures.push(bytes);
      }
      const clean = resolve(dir, `${width}-clean.jpg`);
      await port.thumbnail(spec, { frame: 29, text: "", out: clean });
      expect((await readFile(clean)).equals(pictures[0]!)).toBe(false);
    }
  }, 240_000);
});
