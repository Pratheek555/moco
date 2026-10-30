// Golden stills and determinism for the premium Krishna scene (bench/scenes/premium-krishna-dawn.json, the
// engine's golden example plus its lip-sync track, grade and finish). Real Remotion renders, so opt-in:
//   MOCO_RENDER_TESTS=1 pnpm vitest run packages/renderer/test/golden.test.ts
//   MOCO_RENDER_TESTS=1 MOCO_UPDATE_GOLDEN=1 …   rewrites test/golden/*.png after a deliberate visual change
//
// Tolerance: each frame is hashed twice with dHash (512 bits, test/phash.ts): the whole frame, and the region
// where Krishna stands (CHARACTER_REGION; a small character barely moves a whole-frame hash). Both must be within
// GOLDEN_TOLERANCE bits of the stored still's. Measured on 2026-10-30 (M2 Max, macOS, Remotion 4.0.539 with its
// pinned Chrome Headless Shell):
//   - same code, same machine: 0 bits (renders are byte-identical, see the determinism test).
//   - real regressions at frame 90: no atmosphere → 28 (whole) / 69 (character); raise_hand missing → 3 / 20.
//   - neighbouring golden frames: at least 21 (whole) / 77 (character) apart.
//   - the same frame at scale 0.5 instead of 0.25 (anti-aliasing and resampling change everywhere): 6–7 / 21–29.
// 8 catches every regression above. It is not meant to survive a Chrome or Skia upgrade: after one, look at the
// fresh stills and, if they're right, rewrite the goldens with MOCO_UPDATE_GOLDEN=1. The stills are macOS
// renders; caption fonts may differ on other systems.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderFrames, renderStill, selectComposition } from "@remotion/renderer";
import { beforeAll, describe, expect, it } from "vitest";
import { KIT_ASSETS_DIR } from "@moco/kit/assets";
import { SceneSpec } from "@moco/spec";
import { dHash, decodePng, hammingDistance } from "./phash.ts";

const GOLDEN_FRAMES = [0, 30, 90, 150, 240];
const GOLDEN_TOLERANCE = 8;
const CHARACTER_REGION = { left: 0.25, top: 0.1, width: 0.5, height: 0.55 }; // above the captions
const GOLDEN_SCALE = 0.25; // 270×480 stills keep the stored files small (about 235 KB each)
const goldenDir = new URL("./golden/", import.meta.url).pathname;

describe.runIf(process.env.MOCO_RENDER_TESTS)("premium golden scene", () => {
  const scene = SceneSpec.parse(JSON.parse(readFileSync(new URL("../bench/scenes/premium-krishna-dawn.json", import.meta.url), "utf8")));
  const inputProps = { scene };
  let serveUrl = "";
  let composition: Awaited<ReturnType<typeof selectComposition>>;

  beforeAll(async () => {
    serveUrl = await bundle({ entryPoint: new URL("../src/remotion/index.ts", import.meta.url).pathname, publicDir: KIT_ASSETS_DIR });
    composition = await selectComposition({ serveUrl, id: "Scene", inputProps });
  }, 240_000);

  it("matches the stored stills by perceptual hash", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "moco-golden-"));
    const hashes: string[] = [];
    for (const frame of GOLDEN_FRAMES) {
      const output = join(outDir, `premium-${frame}.png`);
      await renderStill({ composition, serveUrl, inputProps, frame, scale: GOLDEN_SCALE, output });
      if (process.env.MOCO_UPDATE_GOLDEN) await writeFile(join(goldenDir, `premium-${frame}.png`), await readFile(output));
      const fresh = decodePng(await readFile(output));
      const stored = decodePng(await readFile(join(goldenDir, `premium-${frame}.png`)));
      const distances = { frame, whole: hammingDistance(dHash(fresh), dHash(stored)), character: hammingDistance(dHash(fresh, CHARACTER_REGION), dHash(stored, CHARACTER_REGION)) };
      expect(Math.max(distances.whole, distances.character), JSON.stringify(distances)).toBeLessThanOrEqual(GOLDEN_TOLERANCE);
      hashes.push(dHash(fresh));
    }
    // The hash must tell neighbouring moments apart, or the comparison above proves nothing.
    const neighbours = hashes.slice(1).map((hash, index) => hammingDistance(hashes[index]!, hash));
    expect(Math.min(...neighbours)).toBeGreaterThan(GOLDEN_TOLERANCE);
  }, 240_000);

  it("renders identical frames in two renders split differently over browser tabs", async () => {
    const render = async (concurrency: number) => {
      const byFrame = new Map<number, string>();
      await renderFrames({
        composition,
        serveUrl,
        inputProps,
        concurrency,
        scale: GOLDEN_SCALE,
        imageFormat: "png",
        outputDir: null,
        onStart: () => undefined,
        onFrameUpdate: () => undefined,
        onFrameBuffer: (buffer, frame) => {
          byFrame.set(frame, createHash("sha256").update(buffer).digest("hex"));
        },
      });
      return byFrame;
    };
    const first = await render(1);
    const second = await render(8);
    expect(first.size).toBe(scene.durationFrames);
    expect([...second].filter(([frame, hash]) => first.get(frame) !== hash).map(([frame]) => frame)).toEqual([]);
  }, 600_000);
});
