// The publish stage: YouTube details written after the final render, the series defaults, and user edits.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkYoutube, hashtagsIn, tagsLength, type PublishKit } from "@moco/spec";
import { describe, expect, it } from "vitest";
import { advance, approveNext, setup } from "./helpers.ts";

// Run a one-episode series to the end, approving every gate.
async function finishedSeries(overrides: Parameters<typeof setup>[0] = {}) {
  const env = await setup(overrides);
  const seriesId = await env.engine.createSeries({ idea: "Krishna and Arjuna", language: "en", episodes: 1 });
  for (let round = 0; round < 10; round += 1) {
    await advance(env.engine, seriesId);
    if ((await env.engine.status(seriesId)).next.kind !== "waiting") break;
    await approveNext(env.engine, seriesId);
  }
  const kit = async () => JSON.parse(await readFile(join(env.dir, seriesId, "episodes/ep-01/artifacts/publish.json"), "utf8")).data as PublishKit;
  return { ...env, seriesId, kit };
}

describe("publish", () => {
  it("writes the kit after the final render, with hashtags and the language filled in", async () => {
    const { engine, seriesId, kit, ai } = await finishedSeries();
    const byKey = Object.fromEntries((await engine.status(seriesId)).stages.map((stage) => [stage.key, stage.status]));
    expect(byKey["ep-01/publish"]).toBe("done");

    const { youtube } = await kit();
    expect(youtube.title).toBe("Krishna lifts the bow | Gita Shorts Ep 1");
    expect(youtube.description).toBe("Arjuna freezes on the battlefield.\nWhat does Krishna tell him next?\n\n#krishna #mahabharat #shorts");
    expect(youtube).toMatchObject({ language: "en", category: "Entertainment", madeForKids: false });
    // The AI saw the narration it is describing.
    const prompt = ai.requests.find((request) => request.system.includes("prompt: publish"))!.prompt;
    expect(prompt).toContain("## Narration");
  });

  it("puts the series defaults into the next kit: footer last, default hashtags first, no duplicates", async () => {
    const { engine, seriesId, kit } = await finishedSeries();
    await engine.setPublishDefaults(seriesId, { footer: "Follow for daily episodes.", hashtags: ["#Krishna", "devotional"], madeForKids: true, category: "Education" });
    await engine.waitForJob(await engine.rewritePublish({ seriesId, episodeId: "ep-01" }));

    const { youtube } = await kit();
    expect(youtube.description.split("\n\n").slice(1)).toEqual(["#Krishna #devotional #mahabharat #shorts", "Follow for daily episodes."]);
    expect(youtube).toMatchObject({ madeForKids: true, category: "Education" });
  });

  it("rewrites one kit with a note, without running anything else", async () => {
    const { engine, seriesId, ai } = await finishedSeries();
    const before = ai.requests.length;
    const job = await engine.waitForJob(await engine.rewritePublish({ seriesId, episodeId: "ep-01" }, "More devotional tone"));
    expect(job.stagesRun).toEqual(["ep-01/publish"]);
    expect(ai.requests).toHaveLength(before + 1);
    expect(ai.requests.at(-1)!.prompt).toContain("More devotional tone");
  });

  it("asks the AI to fix details that break YouTube's limits, then falls back to plain ones", async () => {
    const long = { youtube: { title: "x".repeat(140), description: "Too long.", hashtags: ["#a"], tags: ["a"] } };
    const { engine, seriesId, kit, ai } = await finishedSeries({ publish: () => long });
    expect(ai.requests.filter((request) => request.system.includes("prompt: publish")).length).toBeGreaterThan(1);
    expect(ai.requests.at(-1)!.prompt).toContain("YouTube allows 100");

    const status = await engine.status(seriesId);
    expect(status.stages.find((stage) => stage.key === "ep-01/publish")!.status).toBe("done");
    expect(status.decisions.some((decision) => decision.category === "fallback" && decision.subject === "ep-01/publish")).toBe(true);
    expect(checkYoutube((await kit()).youtube)).toEqual([]);
  });

  it("saves the user's edits as a new revision, and refuses ones Studio would reject", async () => {
    const { engine, seriesId, kit } = await finishedSeries();
    const edited = await kit();
    edited.youtube.title = "Arjuna's doubt | Ep 1";
    await engine.savePublish({ seriesId, episodeId: "ep-01" }, edited);
    expect((await kit()).youtube.title).toBe("Arjuna's doubt | Ep 1");
    expect(await engine.history({ seriesId, file: "episodes/ep-01/artifacts/publish.json" })).toHaveLength(2);

    await expect(engine.savePublish({ seriesId, episodeId: "ep-01" }, { youtube: { ...edited.youtube, title: "<b>bold</b>" } })).rejects.toMatchObject({ code: "validation_failed" });
    expect((await kit()).youtube.title).toBe("Arjuna's doubt | Ep 1");
  });
});

describe("YouTube limits", () => {
  it("counts tags the way Studio does and finds hashtags in any script", () => {
    expect(tagsLength(["krishna", "bhagavad gita"])).toBe(7 + 1 + 13 + 2);
    expect(hashtagsIn("कृष्ण की कथा #कृष्ण #Mahabharat_Shorts end")).toEqual(["#कृष्ण", "#Mahabharat_Shorts"]);
  });

  it("measures descriptions in bytes, so Devanagari counts three per letter", () => {
    const hindi = "क".repeat(1700); // 5100 bytes
    expect(checkYoutube({ title: "t", description: hindi, tags: [] }).map((problem) => problem.field)).toEqual(["description"]);
    expect(checkYoutube({ title: "t", description: "क".repeat(1600), tags: [] })).toEqual([]);
  });

  it("flags too many hashtags, long titles and angle brackets", () => {
    const hashtags = Array.from({ length: 16 }, (_, i) => `#t${i}`).join(" ");
    const fields = checkYoutube({ title: "a".repeat(101), description: hashtags, tags: ["<x>"] }).map((problem) => problem.field);
    expect(fields).toEqual(["title", "description", "tags"]);
  });
});
