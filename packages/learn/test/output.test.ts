import { describe, expect, it } from "vitest";
import type { ReferenceCard } from "../src/agents.ts";
import { findLeaks, metricTable, metricText, type SkillDraft } from "../src/merge.ts";
import { pickEvents, tileWidth } from "../src/sheets.ts";
import { renderSkill, renderTemplate, skillSlug } from "../src/skill.ts";
import { clip, measurements, meta, speak } from "./helpers.ts";

const card: ReferenceCard = {
  category: "3d_cartoon", label: "3D cartoon short", summary: "", rules: [], avoid: [],
  contentSpecifics: [
    "the stadium roof", "tornado", "team names Alabama and Mississippi State", "caption text: 'so they slice you', 'Fans Were Kept Safe Inside', 'outside'",
    "title 'A Story Title'", "cyan/blue sky background", "Next a hollow blade",
  ],
};
const m = measurements(clip(90), speak("The storm ripped across the Georgia sky tonight. But thanks to that, Watch All The Fans Were Kept Safe Inside"));

describe("content leaks", () => {
  it("catches the reference's named content, names and lifted lines, but not film-making words", () => {
    const text = "Open on the stadium roof, then a tornado. Push in on Georgia, then Alabama, then Mississippi State. The storm ripped across the frame.";
    const leaks = findLeaks(text, [{ measurements: m, card }]).map((leak) => leak.phrase);
    expect(leaks).toEqual(expect.arrayContaining(["the stadium roof", "tornado", "georgia", "alabama", "mississippi state", "the storm ripped across"]));
  });

  it("does not flag everyday words just because they sat inside a content phrase or a title-cased line", () => {
    const text = "Push the camera inside, watch the state of the stadium, list names, then slice to the face outside. Keep the shot safe. Use a cyan sky; next, show the title.";
    expect(findLeaks(text, [{ measurements: m, card }])).toEqual([]);
  });
});

describe("measurements table", () => {
  it("gives the median and min–max across references, or the spread inside one", () => {
    const rows = metricTable([m]);
    const wpm = rows.find((row) => row.key === "wpm")!;
    expect(wpm.values).toEqual([m.speech.wpm]);
    expect(metricText(rows, ["R1"])).toContain("Speaking rate [wpm]");
    const two = metricText(metricTable([m, measurements(clip(90), speak("Two words."))]), ["R1", "R2"]);
    expect(two.split("\n").find((line) => line.startsWith("Speaking rate [wpm]"))).toMatch(/\| \d+(\.\d+)?–\d+(\.\d+)? \|/);
  });
});

describe("outputs", () => {
  const draft: SkillDraft = {
    name: "Cartoon fact shorts",
    description: "Use when making a 3D cartoon fact short.",
    summary: "Fast, warm, always moving.",
    sections: [{ title: "Camera", intro: "", rules: [{ title: "Creep in every hold", default: "6 %/s push in", range: "3–9 %/s", deviateWhen: "never", why: "keeps it alive" }] }],
    checklist: ["Camera never stops"],
    avoid: ["handheld shake"],
  };

  it("writes a skill with frontmatter and Default / Range / Deviate when for every rule", () => {
    const skill = renderSkill(draft, skillSlug(draft.name), [meta], "2026-11-02");
    expect(skill.startsWith("---\nname: cartoon-fact-shorts\ndescription: \"Use when making a 3D cartoon fact short.\"\n---\n")).toBe(true);
    expect(skill).toContain("- **Default:** 6 %/s push in\n- **Range:** 3–9 %/s\n- **Deviate when:** never");
    expect(skill).toContain("- [ ] Camera never stops");
  });

  it("writes a template the engine can read stage by stage", () => {
    const stages = { series: "s", series_extend: "e", bible: "b", world: "w", script: "sc", shots: "sh", scene: "sn", publish: "p" };
    const template = renderTemplate({ info: {} as never, stages }, "cartoon-fact-shorts", [meta]);
    const headings = template.split(/^# /m).slice(1).map((part) => part.slice(0, part.indexOf("\n")));
    expect(headings).toEqual(["series", "series_extend", "bible", "world", "script", "shots", "scene", "publish"]);
  });
});

describe("sheets", () => {
  it("keeps every sheet within what the model reads at full detail", () => {
    for (const rows of [2, 3, 4, 5]) {
      const width = tileWidth(6, rows, 16 / 9, true);
      expect(((6 * (width + 6) + 6) * (34 + rows * (Math.round((width * 16) / 9) + 46)))).toBeLessThanOrEqual(1_250_000);
    }
  });

  it("looks at more motion in longer shorts, at most two bursts per shot", () => {
    const events = Array.from({ length: 30 }, (_, i) => ({ shot: Math.floor(i / 3), onset: i * 10, peak: i * 10 + 1, end: i * 10 + 2, frames: 3, strength: i }));
    expect(pickEvents(events, 20)).toHaveLength(4);
    const long = pickEvents(events, 60);
    expect(long).toHaveLength(12);
    const perShot = new Map<number, number>();
    for (const index of long) perShot.set(events[index]!.shot, (perShot.get(events[index]!.shot) ?? 0) + 1);
    expect(Math.max(...perShot.values())).toBeLessThanOrEqual(2);
  });
});
