import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { SeriesPlan, EpisodeScript, ShowBible } from "@moco/spec";
import { findTemplate, TEMPLATE_STAGES } from "../src/templates/index.ts";
import { templateGuide } from "../src/templates/guide.ts";
import { checkShotPlan } from "../src/planner/script.ts";
import { advance, approveNext, setup } from "./helpers.ts";
import { createEngine } from "../src/index.ts";

it("offers the original 2D template without forcing short-form timing onto a master", async () => {
  const template = findTemplate("kurzgesat-style")!;
  expect(template.name).toBe("kurzgesat style");
  expect(template.production).toMatchObject({ mode: "artist", format: { width: 1920, height: 1080, fps: 60 } });
  expect(template.production?.targetSeconds).toBeUndefined();
  for (const stage of TEMPLATE_STAGES) {
    const guide = templateGuide(template.id, stage);
    expect(guide).toContain("script AND storyboard approval");
    expect(guide).toContain("ONE master episode and THREE derivative edits");
  }
});

it("keeps the ocean master and all derivative edits contiguous, source-linked and approval-only", async () => {
  const plan = JSON.parse(await readFile(new URL("../../../examples/series/deep-ocean.plan.json", import.meta.url), "utf8"));
  expect(SeriesPlan.parse(plan.seriesPlan).episodes).toHaveLength(1);
  expect(ShowBible.safeParse(plan.show).success).toBe(true);
  const script = EpisodeScript.parse(plan.script);
  expect(script.targetSeconds).toBe(300);
  expect(checkShotPlan(script)).toEqual([]);
  expect(plan.approval).toMatchObject({ script: false, storyboard: false, productionAuthorized: false, paidCalls: 0, generatedAssets: 0 });
  expect(plan.shots).toHaveLength(40);
  expect(plan.shorts).toHaveLength(3);
  const sources = new Set(plan.sources.map((s: { id: string }) => s.id));
  const assets = new Set(plan.assets.map((a: { id: string }) => a.id));
  const master = new Map<string, { start: number; end: number }>(plan.shots.map((s: { id: string; start: number; end: number }) => [s.id, s]));
  for (const film of [{ shots: plan.shots, duration: 300 }, ...plan.shorts]) {
    let end = 0;
    for (const shot of film.shots) {
      expect(shot.start).toBe(end);
      expect(shot.end).toBeGreaterThan(shot.start);
      expect(shot.sourceIds.length).toBeGreaterThan(0);
      for (const id of shot.sourceIds) expect(sources.has(id), id).toBe(true);
      if (shot.parentShotId) {
        const parent = master.get(shot.parentShotId)!;
        expect(shot.parentRange).toEqual({ start: parent.start, end: parent.end });
        for (const id of shot.reuseAssetIds) expect(assets.has(id), id).toBe(true);
      }
      end = shot.end;
    }
    expect(end).toBe(film.duration);
  }
});

it("blocks a changed narration backend before invoking speech", async () => {
  const { engine, audio, ai, render, dir } = await setup();
  const id = await engine.createSeries({ idea: "A scientific discovery", language: "en", episodes: 1 });
  for (let gate = 0; gate < 3; gate++) { await advance(engine, id); await approveNext(engine, id); }
  const original = audio.tts;
  let calls = 0;
  audio.tts = async (...args) => { calls++; return original.apply(audio, args); };
  const runner = createEngine({ projectsDir: dir, ai, audio, render, config: { voice: { voiceId: "default", backend: "another-service" } } });
  const job = await runner.waitForJob(await runner.runStage({ seriesId: id, key: "ep-01/voiceover" }));
  expect(job.error).toMatchObject({ code: "stage_blocked" });
  expect(job.error?.message).toContain("no substitute voice was used");
  expect(calls).toBe(0);
});
