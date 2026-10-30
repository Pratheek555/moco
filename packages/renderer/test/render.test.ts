// Real Remotion renders. Slow (bundles, may download Chrome Headless Shell on first run), so opt-in:
//   MOCO_RENDER_TESTS=1 pnpm vitest run packages/renderer
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { placeholderAudio } from "@moco/audio";
import { FPS, FRAME_HEIGHT, FRAME_WIDTH, type SceneSpec } from "@moco/spec";
import { createRemotionRenderPort } from "../src/index.ts";
import { demoScene } from "../src/remotion/demo.ts";

describe.runIf(process.env.MOCO_RENDER_TESTS)("remotion render port", () => {
  const port = createRemotionRenderPort();
  afterAll(() => port.close());

  it("renders stills of a valid scene", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "moco-stills-"));
    const result = await port.check(demoScene, { frames: [0, 75, 149], outDir });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.stills).toHaveLength(3);
  }, 240_000);

  it("reports an unknown action with its spec path", async () => {
    const bad: SceneSpec = structuredClone(demoScene);
    bad.actors[0]!.actions[1]!.name = "jump";
    const result = await port.check(bad, { frames: [0], outDir: await mkdtemp(join(tmpdir(), "moco-stills-")) });
    expect(result).toMatchObject({ ok: false, errors: [{ path: "actors[0].actions[1].name", message: "UnknownAction(krishna, jump)" }] });
  }, 120_000);

  it("renders an episode with audio to MP4", async () => {
    const dir = await mkdtemp(join(tmpdir(), "moco-episode-"));
    const vo = await placeholderAudio().tts([{ id: "l01", text: "Krishna smiled at Arjuna" }], { voiceId: "v", backend: "b" }, "en", dir);
    const episode = {
      episodeId: "ep-01",
      scenes: [demoScene, { ...demoScene, shotId: "demo-2", durationFrames: 60 }],
      audio: { voiceover: vo.file },
      export: { width: FRAME_WIDTH, height: FRAME_HEIGHT, fps: FPS } as const,
    };
    const result = await port.renderEpisode(episode, join(dir, "preview.mp4"), "preview");
    expect(result.durationSeconds).toBeCloseTo(210 / 30);
    expect((await stat(result.path)).size).toBeGreaterThan(10_000);
  }, 600_000);
});
