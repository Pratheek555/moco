import { describe, expect, it } from "vitest";
import type { Question } from "@moco/agent/types";
import { chooseOption, questionAnswers } from "../src/renderer/src/features/project/question-answers.ts";
import { draftKey, parseDraft } from "../src/renderer/src/features/project/storage.ts";

describe("project question answers", () => {
  const multi: Question = { question: "Where are you starting?", header: "Starting point", multiSelect: true, options: [{ label: "Voiceover ready" }, { label: "Need ideas" }] };
  it("keys answers by exact question text and joins multi-select and Other", () => {
    expect(questionAnswers([multi], { [multi.question]: ["Voiceover ready", "Need ideas"] }, { [multi.question]: "  Custom answer  " })).toEqual({ "Where are you starting?": "Voiceover ready, Need ideas, Custom answer" });
  });
  it("supports Other as the entire answer", () => {
    expect(questionAnswers([{ ...multi, multiSelect: false }], {}, { [multi.question]: "My answer" })).toEqual({ [multi.question]: "My answer" });
    expect(questionAnswers([multi], {}, {})).toEqual({ [multi.question]: "" });
  });
  it("toggles multi-select and replaces a single selection", () => {
    expect(chooseOption(multi, ["Voiceover ready"], "Need ideas")).toEqual(["Voiceover ready", "Need ideas"]);
    expect(chooseOption(multi, ["Voiceover ready", "Need ideas"], "Need ideas")).toEqual(["Voiceover ready"]);
    expect(chooseOption({ ...multi, multiSelect: false }, ["Voiceover ready"], "Need ideas")).toEqual(["Need ideas"]);
  });
});

describe("project drafts", () => {
  it("uses independent keys for projects", () => { expect(draftKey("one")).not.toBe(draftKey("two")); });
  it("restores written text and only uploaded attachment paths", () => {
    expect(parseDraft(JSON.stringify({ text: "My\ndraft", attachments: ["uploads/a.png", "uploads/a.png", "out/file.png", null, 1, "uploads/b.wav"] }))).toEqual({ text: "My\ndraft", attachments: ["uploads/a.png", "uploads/b.wav"] });
  });
  it("tolerates unavailable or malformed saved data", () => {
    for (const value of [null, "", "{bad", "null", "7", "[]", '{"text":5,"attachments":{}}']) expect(parseDraft(value)).toEqual({ text: "", attachments: [] });
  });
});
