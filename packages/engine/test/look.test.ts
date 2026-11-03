// The AI looks at its own renders: models when the world is built, shots once the cut exists.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiRequest } from "@moco/ai";
import { taskOf } from "../src/testing/fakes.ts";
import { advance, approveNext, setup, testWorld } from "./helpers.ts";

// A director who scores `weak` low and everything else 5, by the ids the prompt lists for the images.
function director(weak: string, problem: string) {
  return (request: AiRequest) => {
    const ids = [...request.prompt.matchAll(/image \d+ = ([\w-]+)/g)].map((match) => match[1]!);
    return { verdicts: ids.map((id) => (id === weak ? { id, score: 2, problems: [problem], fix: "Change it." } : { id, score: 5, problems: [], fix: "" })), overall: "" };
  };
}

async function toPreview(engine: Awaited<ReturnType<typeof setup>>["engine"], seriesId: string) {
  for (let gate = 0; gate < 4; gate += 1) {
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
  }
  await advance(engine, seriesId); // scenes, then the preview waits
}

describe("looking at shots", () => {
  it("shows the director every shot and redoes only the weak one, with the notes", async () => {
    const { engine, ai } = await setup({ look_shots: director("s02", "the subject is out of frame") });
    ai.seesImages = true;
    const seriesId = await engine.createSeries({ idea: "Krishna and Arjuna", language: "en", episodes: 1 });
    await toPreview(engine, seriesId);

    const looks = ai.requests.filter((request) => taskOf(request) === "look_shots");
    const shots = ai.requests.filter((request) => taskOf(request) === "scene" && !request.prompt.includes("asked for changes")).length;
    // 12 images a call at most.
    expect(looks.map((request) => request.images!.length)).toEqual([12, shots - 12]);
    const redos = ai.requests.filter((request) => taskOf(request) === "scene" && request.prompt.includes("the subject is out of frame"));
    expect(redos).toHaveLength(1);
    expect(redos[0]!.prompt).toContain('"shotId": "s02"');
    expect((await engine.status(seriesId)).decisions.some((decision) => decision.category === "look" && decision.subject === "ep-01/s02")).toBe(true);
  });

  it("never asks a backend that can't see", async () => {
    const { engine, ai } = await setup();
    const seriesId = await engine.createSeries({ idea: "Krishna and Arjuna", language: "en", episodes: 1 });
    await toPreview(engine, seriesId);
    expect(ai.requests.some((request) => taskOf(request).startsWith("look_"))).toBe(false);
  });

  it("carries on when the review itself fails", async () => {
    const { engine, ai } = await setup({ look_shots: () => { throw new Error("vision down"); } });
    ai.seesImages = true;
    const seriesId = await engine.createSeries({ idea: "Krishna and Arjuna", language: "en", episodes: 1 });
    await toPreview(engine, seriesId);
    expect((await engine.status(seriesId)).next).toMatchObject({ kind: "waiting", key: "ep-01/preview" });
  });
});

describe("looking at models", () => {
  it("rebuilds a model that doesn't read, keeping its id and joints", async () => {
    const rebuilt = testWorld().models[1]!;
    rebuilt.parts.push({ id: "lid", parent: rebuilt.parts[0]!.id, shape: "box", size: [0.5, 0.1, 0.5], surface: Object.keys(rebuilt.surfaces)[0]! } as never);
    const { engine, ai, dir } = await setup({
      bible: () => ({ cast: [], style: { palette: [], captionStyle: "bold", mood: "adventure" } }),
      world: () => testWorld(),
      look_models: director("crate", "reads as a plain cube"),
      fix_model: () => rebuilt,
    });
    ai.seesImages = true;
    const seriesId = await engine.createSeries({ idea: "A sailor at an unfamiliar harbour", language: "en", episodes: 1 });
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
    await advance(engine, seriesId); // the bible builds the world

    const looks = ai.requests.filter((request) => taskOf(request) === "look_models");
    expect(looks).toHaveLength(1);
    expect(looks[0]!.images).toHaveLength(testWorld().models.length);
    const fixes = ai.requests.filter((request) => taskOf(request) === "fix_model");
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.images).toHaveLength(1);
    expect(fixes[0]!.prompt).toContain("reads as a plain cube");
    const world = JSON.parse(await readFile(join(dir, seriesId, "artifacts/world.json"), "utf8")).data;
    expect(world.models.find((model: { id: string }) => model.id === "crate").parts.map((part: { id: string }) => part.id)).toContain("lid");
  });
});
