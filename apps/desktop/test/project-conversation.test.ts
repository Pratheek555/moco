import { describe, expect, it } from "vitest";
import type { ConversationEvent } from "@moco/agent/types";
import type { ProjectEvent } from "../src/shared/api.ts";
import { buildTranscript, elapsedTime, transcript } from "../src/renderer/src/conversation.ts";

const record = (id: string, event: ConversationEvent, seconds = 0): ProjectEvent => ({ id, event, at: new Date(Date.UTC(2026, 10, 14, 12, 0, seconds)).toISOString() });
const question = { question: "Which one?", header: "Choice", multiSelect: true, options: [{ label: "One" }, { label: "Two" }] };

describe("project transcript", () => {
  it("merges streaming messages by kind and message id, retaining the first time", () => {
    const events = [record("u", { type: "user", text: "Start", files: [] }), record("a", { type: "text", messageId: "m", text: "Hello" }, 1), record("b", { type: "text", messageId: "m", text: " world" }, 2), record("c", { type: "thinking", messageId: "m", text: "Think" }, 3), record("d", { type: "thinking", messageId: "m", text: " more" }, 4)];
    const blocks = transcript(events);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatchObject({ type: "text", text: "Hello world", at: events[1]!.at });
    expect(blocks[2]).toMatchObject({ type: "work", at: events[3]!.at, steps: [{ type: "thinking", text: "Think more", at: events[3]!.at }] });
    expect(events[1]!.event).toMatchObject({ text: "Hello" });
  });

  it("folds consecutive work, pairs results and merges tool progress without a duplicate row", () => {
    const blocks = transcript([
      record("t", { type: "thinking", messageId: "m", text: "Thinking" }),
      record("c", { type: "tool_call", id: "call", name: "Bash", input: { command: "node render.mjs" } }, 1),
      record("p", { type: "activity", id: "call", description: "Bash · 4s", status: "running", kind: "tool" }, 2),
      record("r", { type: "tool_result", id: "call", content: "Exit 1", isError: true }, 3),
      record("bg", { type: "activity", id: "bg", description: "Making video", status: "running", kind: "background" }, 4),
      record("bg2", { type: "activity", id: "bg", description: "Video made", status: "completed", kind: "background" }, 5),
      record("txt", { type: "text", messageId: "reply", text: "Finished" }, 6),
      record("t2", { type: "thinking", messageId: "m2", text: "Next" }, 7),
    ]);
    expect(blocks.map(b => b.type)).toEqual(["work", "text", "work"]);
    const work = blocks[0];
    expect(work?.type).toBe("work");
    if (work?.type !== "work") return;
    expect(work.steps).toHaveLength(3);
    expect(work.steps[1]).toMatchObject({ type: "tool", completed: true, isError: true, result: "Exit 1", activity: "Bash · 4s" });
    expect(work.steps[2]).toMatchObject({ description: "Video made", status: "completed", at: record("bg", { type: "usage", inputTokens: 0, outputTokens: 0 }, 4).at });
  });

  it("omits file, question and task-list tool noise", () => {
    const names = ["mcp__moco__SendUserFile", "AskUserQuestion", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "moco_AskUserQuestion", "moco_SendUserFile", "update_plan"];
    const events = names.flatMap((name, index) => [record(`c${index}`, { type: "tool_call", id: `tool${index}`, name, input: {} }), record(`p${index}`, { type: "activity", id: `tool${index}`, description: name, status: "running" }), record(`r${index}`, { type: "tool_result", id: `tool${index}`, content: "ok", isError: false })]);
    expect(transcript(events)).toEqual([]);
  });

  it("attaches answers by question id and keeps exact question-text keys across a restart", () => {
    const blocks = transcript([record("q", { type: "question", id: "q1", questions: [question] }), record("a", { type: "answer", id: "q1", answers: { "Which one?": "One, Two, Other" } })]);
    expect(blocks).toMatchObject([{ type: "question", questionId: "q1", questions: [question], answers: { "Which one?": "One, Two, Other" } }]);
    expect(transcript([record("q", { type: "question", id: "q1", questions: [question] })])[0]).toHaveProperty("answers", undefined);
  });

  it("handles results and answers that precede their call or question", () => {
    const blocks = transcript([record("r", { type: "tool_result", id: "t", content: 42, isError: false }), record("a", { type: "answer", id: "q", answers: { "Which one?": "Two" } }), record("c", { type: "tool_call", id: "t", name: "Read", input: {} }), record("q", { type: "question", id: "q", questions: [question] })]);
    expect(blocks[0]).toMatchObject({ steps: [{ result: 42, completed: true }] });
    expect(blocks[1]).toMatchObject({ answers: { "Which one?": "Two" } });
  });

  it("deduplicates persisted record ids without duplicating deltas", () => {
    const a = record("a", { type: "text", messageId: "m", text: "a" });
    expect(transcript([a, a, record("b", { type: "text", messageId: "m", text: "b" })])[0]).toMatchObject({ text: "ab" });
  });

  it("derives turns and a completed duration only after 30 seconds", () => {
    const view = buildTranscript([
      record("u1", { type: "user", text: "Start", files: [] }),
      record("u2", { type: "user", text: "More", files: [] }, 10),
      record("end1", { type: "turn_end", status: "completed" }, 42),
      record("u3", { type: "user", text: "Again", files: [] }, 45),
      record("end2", { type: "turn_end", status: "completed" }, 50),
      record("u4", { type: "user", text: "Continue", files: [] }, 55),
    ]);
    expect(view.turns).toHaveLength(3);
    expect(view.turns[0]).toMatchObject({ id: "u1", status: "completed", endAt: record("x", { type: "turn_end", status: "completed" }, 42).at });
    expect(view.turns[2]?.endAt).toBeUndefined();
    expect(view.blocks.filter(block => block.type === "turn_end")).toMatchObject([{ elapsed: 42_000 }]);
  });

  it("separates work at turn boundaries and does not merge reused message ids", () => {
    const view = buildTranscript([record("a", { type: "thinking", messageId: "same", text: "First" }), record("end", { type: "turn_end", status: "completed" }, 2), record("b", { type: "thinking", messageId: "same", text: "Second" }, 4)]);
    expect(view.blocks).toHaveLength(2);
    expect(view.blocks[0]?.turnId).not.toBe(view.blocks[1]?.turnId);
  });

  it("retains a stopped turn and the latest tasks and delivered paths", () => {
    const model = buildTranscript([record("u", { type: "user", text: "Go", files: [] }), record("f1", { type: "file", path: "video.mp4" }), record("f2", { type: "file", path: "video.mp4", label: "Final" }), record("t1", { type: "tasks", tasks: [{ id: "1", subject: "Make video", status: "pending" }] }), record("t2", { type: "tasks", tasks: [{ id: "1", subject: "Make video", status: "completed" }] }), record("end", { type: "turn_end", status: "interrupted" }, 50)]);
    expect(model.delivered).toEqual(["video.mp4"]);
    expect(model.tasks).toEqual([{ id: "1", subject: "Make video", status: "completed" }]);
    expect(model.blocks.at(-1)?.type).toBe("stopped");
    expect(model.turns[0]?.status).toBe("interrupted");
  });

  it("tolerates unknown events, empty text and malformed old data", () => {
    const events = [null, {}, { id: "1", at: "bad", event: null }, { id: "2", event: { type: "future" } }, { id: "3", event: { type: "text", text: null } }, { id: "4", event: { type: "question", questions: [null, {}, { question: 5 }] } }, { id: "5", event: { type: "tasks", tasks: [null, { subject: "Task" }] } }, { id: "6", event: { type: "user", text: 1, files: [1, "uploads/a"] } }];
    const result = buildTranscript(events as unknown as ProjectEvent[]);
    expect(result.blocks).toMatchObject([{ type: "text", text: "", files: ["uploads/a"] }]);
    expect(result.tasks).toEqual([{ id: "", subject: "Task", status: "" }]);
    expect(elapsedTime("bad", "also bad")).toBe(0);
    expect(elapsedTime("2026-11-14", "2026-11-13")).toBe(0);
  });

  it("keeps hundreds of tool calls in one block without dropping results", () => {
    const events = Array.from({ length: 500 }, (_, n) => [record(`c${n}`, { type: "tool_call", id: String(n), name: "Read", input: { file_path: `file${n}.md` } }), record(`r${n}`, { type: "tool_result", id: String(n), content: "ok", isError: false })]).flat();
    const [work] = transcript(events);
    expect(work?.type).toBe("work");
    if (work?.type === "work") { expect(work.steps).toHaveLength(500); expect(work.steps.every(step => step.type === "tool" && step.completed)).toBe(true); }
  });
});
