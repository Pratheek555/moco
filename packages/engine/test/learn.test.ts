// Learning (v2 phase 4): the retro keeps the playbook from what the critic saw, and lessons reach later episodes.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiRequest } from "@moco/ai";
import type { Critique, Playbook } from "@moco/spec";
import { checkRetro, mergeRetro } from "../src/learn/playbook.ts";
import { taskOf } from "../src/testing/fakes.ts";
import { advance, approveNext, section, setup } from "./helpers.ts";

const critique: Critique = {
  episodeId: "ep-02",
  shots: [
    { shotId: "s01", score: 5, problems: [], fix: "" },
    { shotId: "s02", score: 2, problems: ["Dev's face is under the caption"], fix: "Raise the camera.", repaired: { score: 4, kept: true } },
  ],
  overall: "Faces keep sinking under the captions.",
};
const lesson = (id: string, extra: Partial<Playbook["lessons"][number]> = {}): Playbook["lessons"][number] => ({ id, rule: `rule ${id}`, stage: "scene", source: "critic", since: "ep-01", evidence: [], held: 0, broken: 0, status: "active", ...extra });

describe("the episode retro", () => {
  it("counts held and broken lessons, retires ones that keep breaking, and grounds new lessons in scores", () => {
    const playbook: Playbook = { lessons: [lesson("L001", { held: 2 }), lesson("L002", { broken: 1 }), lesson("L003")] };
    const merged = mergeRetro(playbook, {
      checks: [
        { id: "L001", outcome: "held", note: "" },
        { id: "L002", outcome: "broken", note: "s02 broke it" },
        { id: "L003", outcome: "untested", note: "" },
      ],
      lessons: [{ rule: "Keep faces above the lower third", stage: "scene", source: "critic", evidence: [{ shotId: "s02", note: "face under the caption" }] }],
    }, "ep-02", critique);
    expect(merged.lessons.map(({ id, held, broken, status }) => ({ id, held, broken, status }))).toEqual([
      { id: "L001", held: 3, broken: 0, status: "active" },
      { id: "L002", held: 0, broken: 2, status: "retired" }, // broke twice, never held
      { id: "L003", held: 0, broken: 0, status: "active" },
      { id: "L004", held: 0, broken: 0, status: "active" },
    ]);
    expect(merged.lessons[1]!.evidence.at(-1)).toMatchObject({ episodeId: "ep-02", note: "s02 broke it" });
    // The new lesson carries the score its shot had, and what the repair got.
    expect(merged.lessons[3]!.evidence[0]).toMatchObject({ episodeId: "ep-02", shotId: "s02", before: 2, after: 4 });
  });

  it("must check every active lesson, can't repeat one, and can only cite this episode's shots", () => {
    const playbook: Playbook = { lessons: [lesson("L001"), lesson("L002")] };
    const problems = checkRetro({
      checks: [{ id: "L001", outcome: "held", note: "" }, { id: "L009", outcome: "held", note: "" }],
      lessons: [
        { rule: "Rule L001!", stage: "scene", source: "critic", evidence: [{ note: "again" }] },
        { rule: "Something new", stage: "shots", source: "critic", evidence: [{ shotId: "s77", note: "?" }] },
      ],
    }, playbook.lessons, critique, playbook).map((issue) => issue.path + ": " + issue.problem);
    expect(problems).toEqual([
      "checks: lesson L002 isn't checked",
      'checks[1].id: "L009" is not an active lesson',
      "lessons[0].rule: the playbook already has this lesson",
      'lessons[1].evidence[0].shotId: "s77" is not a shot of this episode',
    ]);
  });
});

describe("the learning loop", () => {
  it("learns from episode 1's critique and the user's note, and episode 2's director follows the lesson", async () => {
    const projects = await mkdtemp(join(tmpdir(), "moco-learn-"));
    let retros = 0;
    const director = (request: AiRequest) => {
      const ids = [...request.prompt.matchAll(/images? [\d–]+ = ([\w-]+)/g)].map((match) => match[1]!);
      return { verdicts: ids.map((id) => ({ id, score: id === "s02" ? 2 : 5, problems: id === "s02" ? ["Krishna is cut off at the edge"] : [], fix: id === "s02" ? "Centre him." : "" })), overall: "Subjects drift to the frame edge." };
    };
    const retro = (request: AiRequest) => {
      retros += 1;
      const active = section<{ id: string }[]>(request.prompt, "Active lessons to check");
      if (retros === 1) {
        // Episode 1: the critic's pattern and the user's note are both in front of the retro.
        expect(section<{ overall: string }>(request.prompt, "What the critic saw in this episode").overall).toContain("frame edge");
        expect(section<{ note: string }[]>(request.prompt, "The user's notes on this episode")[0]!.note).toBe("Slower, please.");
        return { checks: [], lessons: [{ rule: "Keep the speaking character inside the middle 60% of the frame", stage: "scene", source: "critic", evidence: [{ shotId: "s02", note: "cut off at the edge" }] }] };
      }
      return { checks: active.map(({ id }) => ({ id, outcome: "held", note: "" })), lessons: [] };
    };
    const { engine, ai, dir } = await setup({ look_shots: director, retro }, projects);
    ai.seesImages = true;
    const seriesId = await engine.createSeries({ idea: "Krishna and Arjuna", language: "en", episodes: 2 });

    let noted = false;
    for (let round = 0; round < 20; round += 1) {
      await advance(engine, seriesId);
      const status = await engine.status(seriesId);
      if (status.next.kind === "finished") break;
      if (status.next.kind !== "waiting") continue;
      // One note from the user on episode 1's preview: it rewrites the shots, and the retro must hear it.
      if (!noted && status.next.key === "ep-01/preview") {
        noted = true;
        await engine.reject({ seriesId, key: "ep-01/preview" }, "Slower, please.");
        continue;
      }
      await approveNext(engine, seriesId);
    }

    expect(retros).toBe(2);
    const playbook = JSON.parse(await readFile(join(dir, seriesId, "artifacts/playbook.json"), "utf8")).data as Playbook;
    expect(playbook.lessons[0]).toMatchObject({ id: "L001", since: "ep-01", held: 1, status: "active" });
    // Every episode 2 shot was directed with the lesson in front of it; no episode 1 shot was.
    const scenes = ai.requests.filter((request) => taskOf(request) === "scene");
    const ep2 = scenes.filter((request) => section<{ shotId: string }>(request.prompt, "Shot brief") && request.prompt.includes("middle 60%"));
    expect(ep2.length).toBeGreaterThan(0);
    const firstEp2 = scenes.findIndex((request) => request.prompt.includes("middle 60%"));
    expect(scenes.slice(0, firstEp2).some((request) => request.prompt.includes("Playbook"))).toBe(false);
  });
});
