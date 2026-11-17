import { describe, expect, it } from "vitest";
import type { ToolStep, WorkStep } from "../src/renderer/src/conversation.ts";
import { describeTool, isPresentationTool, liveStepTitle, summarizeWork } from "../src/renderer/src/features/project/describe-tool.ts";
import { formatDetail } from "../src/renderer/src/features/project/details.ts";

const tool = (name: string, input: unknown = {}): ToolStep => ({ type: "tool", id: name, toolId: name, at: "", name, input, completed: true, isError: false });

describe("project tool descriptions", () => {
  it.each([
    ["Read", { file_path: "C:\\project\\SKILL.md" }, "read", "Read SKILL.md"],
    ["Write", { file_path: "/tmp/out/story.mjs" }, "edit", "Edited story.mjs"],
    ["Edit", { file_path: "out/story.mjs" }, "edit", "Edited story.mjs"],
    ["MultiEdit", { file_path: "out/story.mjs" }, "edit", "Edited story.mjs"],
    ["NotebookEdit", { notebook_path: "out/notebook.ipynb" }, "edit", "Edited notebook.ipynb"],
    ["Bash", { command: "node\n render.mjs" }, "terminal", "Ran node render.mjs"],
    ["Shell", { command: "ffmpeg -i a.mp4 b.mp4", cwd: "/tmp" }, "terminal", "Ran ffmpeg -i a.mp4 b.mp4"],
    ["Glob", { pattern: "*.png" }, "search", "Searched files for *.png"],
    ["Grep", { pattern: "Rome" }, "search", "Searched files for Rome"],
    ["WebSearch", { query: "Ancient Rome" }, "web", "Searched the web for Ancient Rome"],
    ["Web search", { type: "search", query: "Ancient Rome" }, "web", "Searched the web for Ancient Rome"],
    ["WebFetch", { url: "https://example.com" }, "web", "Read a web page"],
    ["Task", { description: "Make an illustration" }, "activity", "Make an illustration"],
    ["Skill", { skill: "ink-history" }, "skill", "Used ink-history"],
    ["moco_SendUserFile", { path: "out/final.mp4" }, "read", "Shared final.mp4"],
    ["mcp__server__custom_tool", {}, "tool", "custom tool (server)"],
    ["some_tool-name", {}, "tool", "some tool name"],
  ])("describes %s", (name, input, icon, title) => {
    expect(describeTool(name as string, input)).toMatchObject({ icon, title });
  });
  it("describes Codex's file-change array and web actions", () => {
    expect(describeTool("File changes", [{ path: "/out/a.ts" }])).toMatchObject({ icon: "edit", title: "Edited a.ts" });
    expect(describeTool("File changes", [{ path: "/out/a.ts" }, { path: "C:\\out\\b.ts" }])).toMatchObject({ title: "Edited 2 files", detail: "a.ts, b.ts" });
    expect(describeTool("Web search", { type: "openPage", url: "https://example.com" })).toMatchObject({ title: "Opened a web page" });
  });
  it("handles malformed input and caps commands to one line", () => {
    for (const input of [null, 7, undefined, [], { file_path: [] }, { command: {} }]) expect(() => describeTool("Shell", input)).not.toThrow();
    const title = describeTool("Bash", { command: `node\n${"x".repeat(1000)}` }).title;
    expect(title).not.toContain("\n"); expect(title.length).toBeLessThan(110); expect(title.endsWith("…")).toBe(true);
    expect(describeTool("", null).title).toBe("Tool");
  });
  it("hides only tools with a dedicated presentation", () => {
    for (const name of ["AskUserQuestion", "mcp__moco__AskUserQuestion", "moco_SendUserFile", "TodoWrite", "TaskList", "update_plan"]) expect(isPresentationTool(name)).toBe(true);
    for (const name of ["Task", "TaskOutput", "Read", "mcp__server__other"]) expect(isPresentationTool(name)).toBe(false);
  });
  it("summarizes by kind in fixed order with no more than four parts", () => {
    const steps: WorkStep[] = [tool("WebSearch"), tool("Edit", { file_path: "out/story.mjs" }), tool("Shell"), tool("Read"), tool("Read"), tool("Bash"), tool("Read")];
    expect(summarizeWork(steps)).toBe("Read 3 files · Ran 2 commands · Edited story.mjs · Searched the web");
    expect(summarizeWork([...steps.reverse(), tool("Grep"), { type: "thinking", id: "t", at: "", text: "Thought" }]).split(" · ")).toHaveLength(4);
    expect(summarizeWork([tool("File changes", [{ path: "a" }, { path: "b" }])])).toBe("Edited 2 files");
  });
  it("uses a current-step label at the live edge", () => {
    expect(liveStepTitle(tool("Shell"))).toBe("Running a command…");
    expect(liveStepTitle(undefined)).toBe("Working…");
  });
});

describe("bounded project tool details", () => {
  it("keeps normal strings and JSON readable", () => {
    expect(formatDetail("<script>alert(1)</script>")).toEqual({ text: "<script>alert(1)</script>", shortened: false });
    expect(formatDetail({ output: "ok" }).text).toBe('{\n  "output": "ok"\n}');
  });
  it("caps large strings and large arrays", () => {
    expect(formatDetail("x".repeat(30_000))).toEqual({ text: "x".repeat(20_000), shortened: true });
    const result = formatDetail(Array.from({ length: 10_000 }, () => "x"));
    expect(result.text.length).toBeLessThanOrEqual(20_000); expect(result.shortened).toBe(true);
  });
  it("does not throw for cycles, bigint, undefined, or hostile getters", () => {
    const cyclic: Record<string, unknown> = { n: 3n }; cyclic.self = cyclic;
    expect(formatDetail(cyclic).text).toContain("[Circular]");
    expect(formatDetail(undefined).text).toBe("");
    const hostile = { get value(): string { throw new Error("No"); } };
    expect(formatDetail(hostile).text).toBe("Details could not be displayed.");
  });
});
