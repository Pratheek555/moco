import { expect, it } from "vitest";
import { SceneSpec, type EpisodeSpec } from "@moco/spec";
import { serveEpisodeInput } from "../src/episode-input.ts";
import { demoScene } from "../src/remotion/demo.ts";

it("keeps large episode drawings out of Chrome's protocol and serves them without changing saved scenes", async () => {
  const scene = SceneSpec.parse({
    shotId: "canvas", durationFrames: 2, background: { id: "custom" },
    actors: [], captions: [], canvas: { version: 1, source: "ctx.fillRect(0,0,640,360)",
      fonts: { Test: `data:font/ttf;base64,${"A".repeat(1_000_000)}` },
      assets: { picture: "data:image/png;base64,aGVsbG8=" } },
  });
  const episode: EpisodeSpec = {
    episodeId: "large", scenes: Array.from({length: 112}, (_, index) => ({ ...scene, shotId: `s${index}` })),
    audio: { voiceover: "voice.wav" }, export: { width: 640, height: 360, fps: 60 },
  };
  // The former input exceeds Chrome's 100 MiB message buffer even before CDP escaping.
  expect(Buffer.byteLength(JSON.stringify(episode))).toBeGreaterThan(100 * 1024 * 1024);
  const input = await serveEpisodeInput(episode);
  const url = input.episode.scenes[0]!.canvasUrl!;
  try {
    expect(Buffer.byteLength(JSON.stringify(input.episode))).toBeLessThan(100_000);
    expect(input.episode.scenes.every((shot) => !shot.canvas)).toBe(true);
    expect(episode.scenes[0]!.canvas).toBe(scene.canvas);
    expect(input.episode.scenes.map(s => s.durationFrames)).toEqual(episode.scenes.map(s => s.durationFrames));
    for (const shot of [input.episode.scenes[0]!, input.episode.scenes[111]!]) {
      const response = await fetch(shot.canvasUrl!);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toEqual(scene.canvas);
    }
    expect((await fetch(new URL("/unknown", url))).status).toBe(404);
  } finally {
    await input.close();
  }
  await expect(fetch(url)).rejects.toThrow();
});

it("supports kit-only and mixed episodes without changing the kit scenes", async () => {
  const episode: EpisodeSpec = { episodeId: "kit", scenes: [demoScene], audio: { voiceover: "" }, export: { width: 1080, height: 1920, fps: 30 } };
  const input = await serveEpisodeInput(episode);
  expect(input.episode).toBe(episode);
  await input.close();
  const mixed = await serveEpisodeInput({ ...episode, scenes: [demoScene, { ...demoScene, canvas: { version: 1, source: "draw", assets: {}, cast: [], cues: [] } }] });
  try {
    expect(mixed.episode.scenes[0]).toBe(demoScene);
    expect(mixed.episode.scenes[1]!.canvasUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
  } finally { await mixed.close(); }
});
