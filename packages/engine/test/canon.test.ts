// Growing canon (v2 phase 5): a later episode adds characters and places, built only as additions.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiRequest } from "@moco/ai";
import { World } from "@moco/spec";
import { checkExtension, checkRequest } from "../src/canon/grow.ts";
import { taskOf } from "../src/testing/fakes.ts";
import { advance, approveNext, section, setup, showData, testWorld } from "./helpers.ts";

const keeperSheet = { ...showData().cast[0]!, id: "keeper", name: "The Keeper", role: "guards the lighthouse" };
const lighthouse = { id: "lighthouse", name: "The lighthouse", description: "A white tower on black rocks.", mood: "lonely" };

// The new character's model and the new place's location, built like the test world's own.
function extension() {
  const world = testWorld();
  return {
    models: [{ ...world.models[0]!, id: "keeper" }],
    locations: [{ ...world.locations[0]!, id: "lighthouse", hint: "The top of the lighthouse." }],
    cast: [{ id: "keeper", model: "keeper", description: "Guards the lighthouse." }],
  };
}

describe("growing canon", () => {
  it("only accepts new ids, a handful per episode, and a sound merged world", () => {
    const request = { reason: "", cast: [keeperSheet, { ...keeperSheet, id: "hero" }], places: [lighthouse] };
    expect(checkRequest(request, ["hero"], ["harbour"]).map((issue) => issue.problem)).toEqual(['"hero" is already in the canon']);
    const world = World.parse(testWorld());
    const parse = (raw: unknown) => World.pick({ models: true, locations: true, cast: true }).parse(raw);
    expect(checkExtension(parse(extension()), world, { reason: "", cast: [keeperSheet], places: [lighthouse] })).toEqual([]);
    const clash = parse({ ...extension(), models: [{ ...testWorld().models[1]! }] }); // "crate" again, and no model for the keeper
    const problems = checkExtension(clash, world, { reason: "", cast: [keeperSheet], places: [lighthouse] }).map((issue) => issue.problem);
    expect(problems).toContain('"crate" already exists');
    expect(problems.some((problem) => problem.includes('"keeper", which is not a model'))).toBe(true);
  });

  it("adds what a later episode needs as an addition: episode 2 uses it, and nothing approved changes", async () => {
    const reviewed: string[][] = [];
    const answers = {
      bible: () => ({ cast: [], style: { palette: [], captionStyle: "bold", mood: "adventure" } }),
      world: () => testWorld(),
      // Episode 2 needs a keeper and his lighthouse; nothing else does.
      canon: (request: AiRequest) => section<{ id: string }>(request.prompt, "Episode").id === "ep-02"
        ? { reason: "Episode 2 meets the lighthouse keeper.", cast: [keeperSheet], places: [lighthouse] }
        : { reason: "Covered.", cast: [], places: [] },
      world_extend: () => extension(),
      memory: (request: AiRequest) => ({ storySoFar: "The sailor reached the harbour.", newFacts: [{ entity: "hero", fact: "The hero is tired.", sinceEpisode: section<{ episodeId: string }>(request.prompt, "Approved episode").episodeId }] }),
      look_models: (request: AiRequest) => {
        const ids = [...request.prompt.matchAll(/image \d+ = ([\w-]+)/g)].map((match) => match[1]!);
        reviewed.push(ids);
        return { verdicts: ids.map((id) => ({ id, score: 5, problems: [], fix: "" })), overall: "" };
      },
      // Shots go wherever the shot list says they can: the newest location once there is one.
      shots: (request: AiRequest) => {
        const locations = section<{ id: string }[]>(request.prompt, "Locations").map((location) => location.id);
        const words = section<unknown[]>(request.prompt, "Words");
        const cuts = Array.from({ length: Math.ceil(words.length / 8) }, (_, i) => i * 8);
        return { shots: cuts.map((fromWord, i) => ({ id: `s${String(i + 1).padStart(2, "0")}`, fromWord, intent: "Show it.", characters: [], location: locations.at(-1)! })) };
      },
    };
    const { engine, ai, dir } = await setup(answers);
    ai.seesImages = true;
    const seriesId = await engine.createSeries({ idea: "A sailor and a lighthouse", language: "en", episodes: 2 });
    const read = (file: string) => readFile(join(dir, seriesId, file), "utf8");

    let worldBefore = "";
    let ep1Before: string[] = [];
    for (let round = 0; round < 20; round += 1) {
      await advance(engine, seriesId);
      const status = await engine.status(seriesId);
      // Snapshot the approved world and episode 1's shots before episode 2 starts.
      if (!worldBefore && status.stages.find((stage) => stage.key === "ep-01/memory_update")?.status === "done") {
        worldBefore = await read("artifacts/world.json");
        const shots = await readdir(join(dir, seriesId, "episodes/ep-01/shots"));
        ep1Before = await Promise.all(shots.map((shot) => read(`episodes/ep-01/shots/${shot}/spec.json`)));
      }
      if (status.stages.find((stage) => stage.key === "ep-02/shot_list")?.status === "done") break;
      if (status.next.kind === "waiting") await approveNext(engine, seriesId);
    }

    // Saved as episode 2's addition; its new model was reviewed on its own.
    const addition = JSON.parse(await read("artifacts/canon/ep-02.json")).data;
    expect(addition).toMatchObject({ episodeId: "ep-02", cast: [{ id: "keeper" }], places: [{ id: "lighthouse" }] });
    expect(reviewed.at(-1)).toEqual(["keeper"]);
    // Episode 2's writers could cast the keeper, and its shot list could use the lighthouse.
    const ep2Script = ai.requests.filter((request) => taskOf(request) === "script").at(-1)!;
    expect(section<{ cast: { id: string }[] }>(ep2Script.prompt, "Show bible — this series' tone, narration and rules").cast.map((member) => member.id)).toContain("keeper");
    const ep2Shots = JSON.parse(await read("episodes/ep-02/artifacts/shot_list.json")).data;
    expect(ep2Shots.shots[0].location).toBe("lighthouse");
    // Nothing approved changed: the base world and episode 1's shots are byte for byte the same.
    expect(await read("artifacts/world.json")).toBe(worldBefore);
    const shots = await readdir(join(dir, seriesId, "episodes/ep-01/shots"));
    expect(await Promise.all(shots.map((shot) => read(`episodes/ep-01/shots/${shot}/spec.json`)))).toEqual(ep1Before);
    expect((await engine.status(seriesId)).decisions.some((decision) => decision.category === "canon" && decision.detail.includes("The Keeper"))).toBe(true);
  });
});
