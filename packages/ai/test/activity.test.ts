import { describe, expect, it } from "vitest";
import { activityReader } from "../src/activity.ts";

describe("public activity stream", () => {
  it("handles fragmented JSONL and filters reasoning, tools, and structured artifacts", () => {
    const updates: string[] = [];
    const reader = activityReader((text) => updates.push(text));
    const lines = [
      { type: "item.completed", item: { type: "reasoning", text: "private reasoning" } },
      { type: "item.completed", item: { type: "mcp_tool_call", arguments: "not public" } },
      { type: "item.completed", item: { type: "agent_message", text: "I’m shaping the episode arc." } },
      { type: "item.completed", item: { type: "agent_message", text: '{"title":"The light"}' } },
      { type: "assistant", message: { content: [{ type: "thinking", text: "private" }, { type: "text", text: "The first draft is ready for checking." }, { type: "tool_use", input: { private: true } }] } },
    ].map((event) => JSON.stringify(event)).join("\n");
    for (let i = 0; i < lines.length; i += 7) reader.write(lines.slice(i, i + 7));
    reader.end();
    expect(updates).toEqual(["I’m shaping the episode arc.", "The first draft is ready for checking."]);
  });

  it("ignores diagnostics, fenced output and faulty UI observers", () => {
    const reader = activityReader(() => { throw new Error("disconnected UI"); });
    expect(() => {
      reader.write('diagnostic\n' + JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Checking the draft." } }) + "\n");
      reader.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '```json\n{}\n```' } }));
      reader.end();
    }).not.toThrow();
  });
});
