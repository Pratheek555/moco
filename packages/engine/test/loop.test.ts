// The scene auto-fix loop, driven through the real pipeline with scripted AI answers.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiRequest } from "@moco/ai";
import { catalog } from "@moco/kit";
import { defaultConfig } from "../src/config.ts";
import { createEngine } from "../src/index.ts";
import { FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import { formatIssue } from "../src/loop/feedback.ts";
import { shotLook } from "../src/loop/validate.ts";
import { advance, approveNext, sceneFor, section, setup } from "./helpers.ts";

// Approve plan, bible, script and the sample shot, then generate every scene (stops at the preview gate).
async function toScenes(engine: Awaited<ReturnType<typeof setup>>["engine"]) {
  const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
  for (let gate = 0; gate < 4; gate += 1) {
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
  }
  await advance(engine, seriesId);
  return seriesId;
}

// Scene answers that are wrong on the first `badTries` attempts of shot s01, then right.
function flakyScene(badTries: number, bad: (request: AiRequest) => unknown) {
  let s01Tries = 0;
  return (request: AiRequest) => {
    const isS01 = section<{ shotId: string }>(request.prompt, "Shot brief").shotId === "s01"; // the golden example is s01 too
    if (!isS01) return sceneFor(request.prompt);
    s01Tries += 1;
    return s01Tries <= badTries ? bad(request) : sceneFor(request.prompt);
  };
}

describe("scene loop", () => {
  it("fixes a schema error on the retry", async () => {
    const { engine, dir } = await setup({ scene: flakyScene(1, () => ({ shotId: "s01" })) });
    const seriesId = await toScenes(engine);
    const attempts = await readdir(join(dir, seriesId, "episodes/ep-01/shots/s01/attempts"));
    expect(attempts).toEqual(["01.json", "02.json"]);
    const first = JSON.parse(await readFile(join(dir, seriesId, "episodes/ep-01/shots/s01/attempts/01.json"), "utf8"));
    expect(first.issues.length).toBeGreaterThan(0);
  });

  it("fixes an unknown action using the allowed-values hint", async () => {
    const jump = (request: AiRequest) => {
      const scene = sceneFor(request.prompt);
      scene.actors[0]!.actions = [{ name: "jump", startFrame: 0, endFrame: 10 }];
      return scene;
    };
    const { engine, ai } = await setup({ scene: flakyScene(1, jump) });
    await toScenes(engine);
    const retry = ai.requests.find((request) => request.prompt.includes("Your previous attempt"))!;
    const allowed = catalog.characters.find((character) => character.id === "krishna")!.actions.map((action) => action.name).join(", ");
    expect(retry.prompt).toContain(`actors[0].actions[0].name: "jump" is not in krishna's rig. Allowed: ${allowed}. Pick one.`);
  });

  it("feeds renderer errors back (L3)", async () => {
    let failures = 1;
    const render = new FakeRenderPort((spec) => (spec.shotId === "s01" && failures-- > 0 ? [{ shotId: "s01", frame: 3, message: "UnknownLayer arm_r", path: "actors[0]" }] : []));
    const { dir, ai } = await setup();
    const engine = createEngine({ projectsDir: dir, ai, render, audio: new FakeAudio(0.4) });
    const seriesId = await toScenes(engine);
    const first = JSON.parse(await readFile(join(dir, seriesId, "episodes/ep-01/shots/s01/attempts/01.json"), "utf8"));
    expect(first.issues[0].problem).toContain("renderer error at frame 3: UnknownLayer arm_r");
  });

  it("falls back to a safe shot after 3 failures and records it", async () => {
    const { engine, dir } = await setup({ scene: flakyScene(99, () => "not a scene") });
    const seriesId = await toScenes(engine);
    const spec = JSON.parse(await readFile(join(dir, seriesId, "episodes/ep-01/shots/s01/spec.json"), "utf8"));
    expect(spec.data.fallback).toBe(true);
    expect(spec.meta.producedBy).toBe("engine");
    const status = await engine.status(seriesId);
    expect(status.decisions.map((decision) => decision.category)).toContain("fallback");
    // The other shots are unaffected, and the episode still reaches the preview gate.
    expect(status.next).toMatchObject({ kind: "waiting", key: "ep-01/preview" });
  });

  it("stops at the per-episode AI call cap", async () => {
    const { dir, ai } = await setup({ scene: () => "never valid" });
    const limits = { ...defaultConfig(dir).limits, maxAiCallsPerEpisode: 4 }; // script + shot list + 2 scene attempts
    const engine = createEngine({ projectsDir: dir, ai, render: new FakeRenderPort(), audio: new FakeAudio(0.4), config: { limits } });
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    for (let gate = 0; gate < 3; gate += 1) {
      await advance(engine, seriesId);
      await approveNext(engine, seriesId);
    }
    const job = await engine.waitForJob(await engine.runStage({ seriesId }));
    expect(job.error).toMatchObject({ code: "cap_reached" });
  });

  // Phase 6 cinematography rules: each one rejects the first attempt with a model-readable fix, the retry passes.
  const firstAttemptBreaks: [string, (scene: ReturnType<typeof sceneFor>) => void, string][] = [
    ["a still stretch over 3 s", (scene) => (scene.camera = []), "nothing moves from frame 0 to 96 (3.2 s; the limit is 3 s). Add a camera move"],
    ["an emphasised line without a push-in", (scene) => {
      scene.camera = [{ move: "pan_left", startFrame: 0, endFrame: scene.durationFrames, amount: 0.2 }];
      Object.assign(scene.captions[0]!, { emphasis: true });
    }, "captions[0].emphasis: the emphasised line \"word0x0\" (frames 0–11) has no push_in or focus_on during it. Allowed: push_in, focus_on."],
    ["an unknown atmosphere", (scene) => Object.assign(scene, { atmosphere: [{ id: "fog" }] }), `atmosphere[0].id: "fog" is not a known atmosphere. Allowed: ${catalog.atmosphere.map((entry) => entry.id).join(", ")}. Pick one.`],
    ["an atmosphere on a missing background layer", (scene) => Object.assign(scene, { atmosphere: [{ id: "dust", layer: "river" }] }), `atmosphere[0].layer: "river" is not a known kurukshetra layer. Allowed: ${catalog.backgrounds.find((background) => background.id === "kurukshetra")!.layers.map((layer) => layer.id).join(", ")}.`],
  ];
  it.each(firstAttemptBreaks)("rejects %s once, then accepts the fix", async (_name, breakIt, message) => {
    const { engine, ai, dir } = await setup({ scene: flakyScene(1, (request) => {
      const scene = sceneFor(request.prompt);
      breakIt(scene);
      return scene;
    }) });
    const seriesId = await toScenes(engine);
    const retries = ai.requests.filter((request) => request.prompt.includes("Your previous attempt"));
    expect(retries).toHaveLength(1);
    expect(retries[0]!.prompt).toContain(message);
    const attempts = await readdir(join(dir, seriesId, "episodes/ep-01/shots/s01/attempts"));
    expect(attempts).toEqual(["01.json", "02.json"]);
  });

  it("breaks 3 same-looking shots in a row by regenerating the third, told what to avoid", async () => {
    const answered = new Set<string>();
    const scene = (request: AiRequest) => {
      const brief = section<{ shotId: string; avoid?: unknown }>(request.prompt, "Shot brief");
      // First pass: every shot is a medium push-in. When told to avoid that, ignore it once (L2 must catch it).
      if (!brief.avoid || !answered.has(brief.shotId)) {
        if (brief.avoid) answered.add(brief.shotId);
        return sceneFor(request.prompt, { move: "push_in", size: "medium" });
      }
      return sceneFor(request.prompt);
    };
    const { engine, ai, dir } = await setup({ scene });
    const seriesId = await toScenes(engine);

    const looks = await Promise.all(
      Array.from({ length: 14 }, (_, index) => readFile(join(dir, seriesId, `episodes/ep-01/shots/s${String(index + 1).padStart(2, "0")}/spec.json`), "utf8")),
    );
    const specs = looks.map((text) => JSON.parse(text).data);
    const repeats = specs.slice(2).filter((spec, index) => shotLook(spec).cameraPreset === shotLook(specs[index]).cameraPreset && shotLook(spec).cameraPreset === shotLook(specs[index + 1]).cameraPreset);
    expect(repeats).toEqual([]);

    const retry = ai.requests.find((request) => request.prompt.includes("Your previous attempt") && request.prompt.includes('"shotId": "s03"'))!;
    expect(retry.prompt).toContain('camera: the main camera move is "push_in", which would make 3 shots in a row with the same move. Allowed: static, pull_out, pan_left, pan_right, focus_on.');
    const status = await engine.status(seriesId);
    expect(status.decisions.filter((decision) => decision.category === "regenerate").map((decision) => decision.subject)).toContain("ep-01/s03");
  });

  it("keeps a repeated-looking shot rather than replacing it with a fallback when the fix never works", async () => {
    const { engine, dir } = await setup({ scene: (request) => sceneFor(request.prompt, { move: "push_in", size: "medium" }) });
    const seriesId = await toScenes(engine);
    const s03 = JSON.parse(await readFile(join(dir, seriesId, "episodes/ep-01/shots/s03/spec.json"), "utf8"));
    expect(s03.data.fallback).toBe(false);
    expect(s03.data.actors).toHaveLength(1);
    const status = await engine.status(seriesId);
    expect(status.decisions.some((decision) => decision.subject === "ep-01/s03" && decision.detail.startsWith("kept the previous spec"))).toBe(true);
  });

  it("formats issues for the model", () => {
    expect(formatIssue({ path: "a.b", problem: "is wrong", allowed: ["x", "y"], fix: "Pick one." })).toBe("a.b: is wrong. Allowed: x, y. Pick one.");
  });
});
