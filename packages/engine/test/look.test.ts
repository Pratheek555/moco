// The AI looks at its own renders: models when the world is built, shots once the cut exists.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiRequest } from "@moco/ai";
import { taskOf } from "../src/testing/fakes.ts";
import { advance, approveNext, sceneFor, setup, testWorld } from "./helpers.ts";

// The ids a review prompt lists for its images: "image 1 = crate" for models, "images 1–3 = s01 (…)" for shots.
const idsOf = (request: AiRequest) => [...request.prompt.matchAll(/images? [\d–]+ = ([\w-]+)/g)].map((match) => match[1]!);

// A director who scores `weak` low and everything else 5. `again` is the weak one's score when it is looked at again.
function director(weak: string, problem: string, again = 4) {
  const seen = new Set<string>();
  return (request: AiRequest) => {
    const verdicts = idsOf(request).map((id) => {
      if (id !== weak) return { id, score: 5, problems: [], fix: "" };
      const first = !seen.has(id);
      seen.add(id);
      return first ? { id, score: 2, problems: [problem], fix: "Change it." } : { id, score: again, problems: [], fix: "" };
    });
    return { verdicts, overall: "Shots keep losing their subject at the edge of frame." };
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
    // Three frames a shot (start, middle, end), whole shots packed into calls of at most 12 images; then the repair
    // is looked at again on its own.
    const firstPass = looks.slice(0, -1).map((request) => request.images!.length);
    expect(firstPass.every((count) => count <= 12 && count % 3 === 0)).toBe(true);
    expect(firstPass.reduce((a, b) => a + b, 0)).toBe(shots * 3);
    expect(idsOf(looks.at(-1)!)).toEqual(["s02"]);
    const redos = ai.requests.filter((request) => taskOf(request) === "scene" && request.prompt.includes("the subject is out of frame"));
    expect(redos).toHaveLength(1);
    expect(redos[0]!.prompt).toContain('"shotId": "s02"');
    expect((await engine.status(seriesId)).decisions.some((decision) => decision.category === "look" && decision.subject === "ep-01/s02")).toBe(true);
  });

  it("keeps a repair only if it scores at least as well, and saves every score as the episode's critique", async () => {
    // The repair is marked (a camera amount nothing else uses), so the test can tell which version was kept.
    const scene = (request: AiRequest) => {
      const spec = sceneFor(request.prompt);
      if (request.prompt.includes("the subject is out of frame")) spec.camera[0]!.amount = 0.33;
      return spec;
    };
    const { engine, ai, dir } = await setup({ look_shots: director("s02", "the subject is out of frame", 1), scene });
    ai.seesImages = true;
    const seriesId = await engine.createSeries({ idea: "Krishna and Arjuna", language: "en", episodes: 1 });
    await toPreview(engine, seriesId);

    // The repair scored 1, worse than the 2 it replaced: the old shot is back, as a newer revision.
    const spec = JSON.parse(await readFile(join(dir, seriesId, "episodes/ep-01/shots/s02/spec.json"), "utf8")).data;
    expect(spec.camera[0].amount).not.toBe(0.33);
    expect((await engine.history({ seriesId, file: "episodes/ep-01/shots/s02/spec.json" })).length).toBeGreaterThanOrEqual(3);
    const critique = JSON.parse(await readFile(join(dir, seriesId, "episodes/ep-01/artifacts/critique.json"), "utf8")).data;
    expect(critique.shots.find((shot: { shotId: string }) => shot.shotId === "s02")).toMatchObject({ score: 2, problems: ["the subject is out of frame"], repaired: { score: 1, kept: false } });
    expect(critique.shots.filter((shot: { score: number }) => shot.score === 5).length).toBe(critique.shots.length - 1);
    expect(critique.overall).toContain("edge of frame");
    expect((await engine.status(seriesId)).decisions.some((decision) => decision.subject === "ep-01/s02" && decision.detail.includes("reverted"))).toBe(true);
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
