import { describe, expect, it } from "vitest";
import { ShowBible, World } from "@moco/spec";
import { defaultConfig } from "../src/config.ts";
import { selectBlocks } from "../src/generator/prompts.ts";
import { checkShow, episodeSeconds, shotSecondsFor } from "../src/planner/show.ts";
import { checkWorld } from "../src/planner/world.ts";
import { taskOf } from "../src/testing/fakes.ts";
import { advance, approveNext, section, setup, showData, testWorld } from "./helpers.ts";

const config = defaultConfig("/tmp");
const show = (patch: (data: ReturnType<typeof showData>) => void = () => {}) => {
  const data = showData();
  patch(data);
  return ShowBible.parse(data);
};

describe("show bible", () => {
  it("accepts a sound show bible", () => {
    expect(checkShow(show(), config)).toEqual([]);
  });

  it("holds episode and shot lengths to the engine's limits", () => {
    const problems = checkShow(show((data) => { data.format.targetSeconds = 85; data.format.shotSeconds = { min: 0.2, max: 6 }; }), config).map((issue) => issue.path);
    expect(problems).toEqual(["format.targetSeconds", "format.shotSeconds"]);
  });

  it("sets the episode length and shot range a series runs at, clamped to the engine's window", () => {
    expect(episodeSeconds(config, undefined)).toBe(45);
    expect(episodeSeconds(config, show((data) => { data.format.targetSeconds = 33; }))).toBe(33);
    expect(shotSecondsFor(config, undefined)).toEqual(config.shotSeconds);
    expect(shotSecondsFor(config, show((data) => { data.format.shotSeconds = { min: 0.9, max: 9 }; }))).toEqual({ min: 0.9, max: 9 });
  });

  it("needs a world model for every character in the show bible's cast", () => {
    expect(checkWorld(World.parse(testWorld()), ["hero", "villain"]).map((issue) => issue.problem).join()).toContain("villain");
  });

  it("keeps only the prompt blocks for the shot's kind of stage", () => {
    const text = "intro\n<!-- when: kit -->\nkit rules\n<!-- end -->\n<!-- when: race -->\nrace rules\n<!-- end -->\nend";
    expect(selectBlocks(text, "kit")).toBe("intro\nkit rules\nend");
    expect(selectBlocks(text, "world")).toBe("intro\nend");
  });

  it("is written before casting and reaches every later stage's prompt", async () => {
    const { engine, ai } = await setup();
    const seriesId = await engine.createSeries({ idea: "Krishna guides Arjuna", language: "en", episodes: 1 });
    await advance(engine, seriesId); // series plan
    await approveNext(engine, seriesId);
    await advance(engine, seriesId); // show bible + bible
    await approveNext(engine, seriesId);
    await advance(engine, seriesId); // script
    await approveNext(engine, seriesId);
    await advance(engine, seriesId); // voiceover, shot list, sample

    const tasks = ai.requests.map(taskOf);
    expect(tasks.indexOf("show")).toBeLessThan(tasks.indexOf("bible"));
    const prompt = (task: string) => ai.requests.find((request) => taskOf(request) === task)!.prompt;
    expect(section<{ cast: { id: string }[] }>(prompt("bible"), "Show bible — the cast and look you are casting for").cast.map((member) => member.id)).toEqual(["krishna", "arjuna"]);
    expect(section<{ rules: string[] }>(prompt("script"), "Show bible — this series' tone, narration and rules").rules).toEqual(["Krishna never hurries."]);
    expect(section<{ camera: string }>(prompt("shots"), "Show bible — pacing, camera grammar and places").camera).toContain("close on feeling");
    expect(section<{ rubric: string[] }>(prompt("scene"), "Show bible — this series' rules for this shot").rubric).toHaveLength(3);
    // A kit shot reads the kit's rules and nothing about race cars.
    const system = ai.requests.find((request) => taskOf(request) === "scene")!.system;
    expect(system).toContain("layered SVG characters");
    expect(system).not.toContain("leadStart");
  });
});
