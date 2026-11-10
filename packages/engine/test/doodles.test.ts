import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findTemplate, TEMPLATE_STAGES } from "../src/templates/index.ts";
import { DOODLES_PROMPT } from "../src/templates/doodles.ts";
import { allTemplates } from "../src/templates/registry.ts";
import { loadPrompt, promptRef } from "../src/generator/prompts.ts";
import { advance, approveNext, setup, showData } from "./helpers.ts";

it("lists Doodles for the desktop picker with portrait, local artist defaults", () => {
  const template = allTemplates().find(t => t.id === "doodles")!;
  expect(template).toBe(findTemplate("doodles"));
  expect(template.name).toBe("Doodles");
  expect(template.production).toEqual({ mode: "artist", localOnly: true, format: { width: 1080, height: 1920, fps: 30 } });
  expect(template.production?.targetSeconds).toBeUndefined();
  expect(template.creativePrompt).toBe(DOODLES_PROMPT);
});

it("carries the complete style brief into planning and drawing, with hash-tracked prompts", () => {
  for (const stage of TEMPLATE_STAGES) {
    const prompt = loadPrompt(stage, "doodles");
    expect(prompt).toContain("## Template: Doodles");
    expect(prompt).toContain(DOODLES_PROMPT);
    expect(promptRef(stage, "doodles").contentHash).not.toBe(promptRef(stage).contentHash);
  }
});

it("selects the artist route without an explicit production override and skips kit/world casting", async () => {
  const { engine, dir, ai } = await setup({ show: () => ({ ...showData(), cast: [{ ...showData().cast[0]!, id: "keeper", name: "Keeper", appearance: "Original pale egg-headed doodle in an ink-stained apron" }], requirements: [{ id: "draw", text: "Original doodle illustration", support: "available", reason: "Canvas" }] }) });
  Object.assign(ai, { supportsArtist: true });
  const id = await engine.createSeries({ idea: "An original water-clock keeper", language: "en", template: "doodles" });
  const status = await engine.status(id);
  expect(status.series).toMatchObject({ template: "doodles", episodes: 1, production: findTemplate("doodles")!.production });
  await advance(engine, id);
  await approveNext(engine, id);
  await advance(engine, id);
  const bible = JSON.parse(await readFile(join(dir, id, "artifacts/bible.json"), "utf8"));
  expect(bible.data.cast).toEqual([{ id: "keeper", kitCharacterId: "keeper", description: "Original pale egg-headed doodle in an ink-stained apron" }]);
  expect(ai.requests.some(r => r.system.includes("prompt: world"))).toBe(false);
  expect(ai.requests.some(r => r.system.includes("prompt: bible"))).toBe(false);
  expect(ai.requests.find(r => r.system.includes("prompt: show"))!.system).toContain(DOODLES_PROMPT);
});
