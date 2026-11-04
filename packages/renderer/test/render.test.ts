// Real Remotion renders. Slow (bundles, may download Chrome Headless Shell on first run), so opt-in:
//   MOCO_RENDER_TESTS=1 pnpm vitest run packages/renderer
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { placeholderAudio } from "@moco/audio";
import { FPS, FRAME_HEIGHT, FRAME_WIDTH, SceneSpec, WorldLocation, WorldModel } from "@moco/spec";
import { createRemotionRenderPort } from "../src/index.ts";
import { demoScene } from "../src/remotion/demo.ts";

describe.runIf(process.env.MOCO_RENDER_TESTS)("remotion render port", () => {
  const port = createRemotionRenderPort();
  afterAll(() => port.close());

  it("animates a generated character mouth from its own speaker track", async () => {
    const model = WorldModel.parse({ id: "hero", rig: "humanoid", height: 1.7, character: { build: "average", skin: "#d9a98a", hair: { style: "short", colour: "#3a2a20" }, top: { kind: "shirt", colour: "#3366aa" }, bottom: { kind: "trousers", colour: "#333333" } } });
    const location = WorldLocation.parse({ id: "room", hint: "Plain stage", sky: { top: "#203060", middle: "#6080b0", horizon: "#f0c090", sunAzimuth: 60, sunElevation: 20, sunColour: "#ffe0b0", sunStrength: 3, fill: 1, fog: "#f0c090", fogDensity: 0.005 }, ground: { kind: "land", surface: { colour: "#806b50" } }, marks: [{ id: "centre", hint: "Centre", at: [0, 0, 0] }] });
    const scene = SceneSpec.parse({ shotId: "dialogue", durationFrames: 60, background: { id: "room" }, actors: [], captions: [], world: { location, models: [model], look: "toon" }, stage: { camera: "close", place: "centre", subject: "hero", players: [{ id: "hero", model: "hero", at: [0, 0, 0] }] }, speech: [{ speaker: "hero", visemes: [{ frame: 0, viseme: "D" }] }] });
    const check = async (spec: SceneSpec) => {
      const result = await port.check(spec, { frames: [0], outDir: await mkdtemp(join(tmpdir(), "moco-face-")) });
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return readFile(result.stills[0]!);
    };
    scene.stage!.cameraKeys = [{ atFrame: 0, eye: [1,1.7,3.5], target: [0,1.3,0], fov: 35 }, { atFrame: 59, eye: [0.4,1.6,2.6], target: [0,1.4,0], fov: 30 }];
    scene.stage!.players[0]!.poseKeys = [{ atFrame: 0, turn: { head: [0,0,0] } }, { atFrame: 59, turn: { head: [0,20,8] } }];
    scene.stage!.players[0]!.motionKeys = [{ atFrame: 0, at: [0,0,0], facing: 0 }, { atFrame: 59, at: [0.15,0,0], facing: 10 }];
    const timeline = await port.check(scene, { frames: [0,30,59], outDir: await mkdtemp(join(tmpdir(), "moco-timeline-")) });
    expect(timeline.ok).toBe(true);
    if (timeline.ok) expect((await readFile(timeline.stills[0]!)).equals(await readFile(timeline.stills[2]!))).toBe(false);
    const speaking = await check(scene);
    scene.speech![0]!.speaker = "narrator";
    const listening = await check(scene);
    expect(speaking.equals(listening)).toBe(false);
    scene.stage!.players[0]!.speak = false;
    scene.speech![0]!.speaker = "hero";
    expect((await check(scene)).equals(listening)).toBe(true);
  }, 240_000);

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
