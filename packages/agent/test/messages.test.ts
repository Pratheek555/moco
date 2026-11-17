import { afterEach, describe, expect, it } from "vitest";
import { MessageMapper } from "../src/messages.ts";
import { QuestionBroker } from "../src/questions.ts";
import { handOffFile, subscriptionEnvironment } from "../src/claude.ts";
import type { AgentEvent } from "../src/types.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const assistant = (content: unknown[], id = "message") => ({ type: "assistant", uuid: id, message: { id, content } });
const call = (name: string, input: unknown, id = "tool") => assistant([{ type: "tool_use", id, name, input }]);
const result = (content: unknown, id = "tool") => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
const questionInput = { questions: [{ question: "Where are you starting?", header: "Start", options: [{ label: "Ideas", description: "Start fresh" }, { label: "Voiceover" }], multiSelect: false }] };
let temp = "";
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

describe("Claude event mapping", () => {
  it("maps init, streamed thinking/text without duplicating the final message, tools, usage and turn end", () => {
    const mapper = new MessageMapper();
    expect(mapper.map({ type: "system", subtype: "init", session_id: "session", skills: ["skill"] })).toEqual([{ type: "session", sessionId: "session", skills: ["skill"] }]);
    mapper.map({ type: "stream_event", event: { type: "message_start", message: { id: "message" } } });
    expect(mapper.map({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Think" } } })[0]).toMatchObject({ type: "thinking", text: "Think" });
    expect(mapper.map({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } })[0]).toMatchObject({ type: "text", text: "Hello" });
    expect(mapper.map(assistant([{ type: "text", text: "Hello" }, { type: "thinking", thinking: "Think" }]))).toEqual([]);
    expect(mapper.map(call("Bash", { command: "render" }))[0]).toMatchObject({ type: "tool_call", name: "Bash" });
    expect(mapper.map(result("done"))[0]).toEqual({ type: "tool_result", id: "tool", content: "done", isError: false });
    expect(mapper.map({ type: "result", subtype: "success", usage: { input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 }, total_cost_usd: .01 })).toEqual([{ type: "usage", inputTokens: 5, outputTokens: 4, costUsd: .01 }, { type: "turn_end", status: "completed" }]);
  });
  it("maps unstreamed/subagent replies, errors, task lists and background activity", () => {
    const mapper = new MessageMapper();
    expect(mapper.map(assistant([{ type: "text", text: "From subagent" }], "child"))[0]).toMatchObject({ type: "text", messageId: "child" });
    expect(mapper.map(call("TodoWrite", { todos: [{ content: "Render", status: "in_progress" }] })).at(-1)).toEqual({ type: "tasks", tasks: [{ id: "0", subject: "Render", status: "in_progress" }] });
    mapper.map(call("TaskCreate", { subject: "Check video" }, "create"));
    expect(mapper.map(result("Task #1 created successfully: Check video", "create")).at(-1)).toMatchObject({ type: "tasks", tasks: expect.arrayContaining([{ id: "1", subject: "Check video", status: "pending" }]) });
    expect(mapper.map(call("TaskUpdate", { taskId: "1", status: "completed" }, "update")).at(-1)).toMatchObject({ type: "tasks", tasks: expect.arrayContaining([{ id: "1", subject: "Check video", status: "completed" }]) });
    expect(mapper.map({ type: "system", subtype: "task_notification", task_id: "background", summary: "Render finished", status: "completed" })[0]).toMatchObject({ type: "activity", status: "completed" });
    expect(mapper.map({ type: "result", subtype: "error_during_execution", errors: ["failed"] })).toContainEqual({ type: "error", message: "failed" });
  });
  it("round-trips AskUserQuestion through a pending callback with the original input and free-text answers", async () => {
    const events: AgentEvent[] = []; const broker = new QuestionBroker(event => events.push(event));
    const response = broker.ask("question", questionInput, new AbortController().signal);
    expect(events[0]).toMatchObject({ type: "question", id: "question", questions: questionInput.questions });
    expect(() => broker.answer("question", {})).toThrow("Answer each");
    broker.answer("question", { "Where are you starting?": "Other: my own script" });
    expect(await response).toEqual({ behavior: "allow", updatedInput: { ...questionInput, answers: { "Where are you starting?": "Other: my own script" } } });
    expect(events.at(-1)?.type).toBe("answer");
    expect(() => broker.answer("question", {})).toThrow("no longer waiting");
  });
  it("cancels a waiting question when stopped or aborted", async () => {
    const broker = new QuestionBroker(() => {}); const abort = new AbortController();
    const response = broker.ask("q", questionInput, abort.signal); abort.abort();
    expect(await response).toMatchObject({ behavior: "deny" });
    const next = broker.ask("q2", questionInput, new AbortController().signal); broker.cancel();
    expect(await next).toMatchObject({ behavior: "deny" });
  });
  it("preserves task subjects and other pending tasks when updating a resumed session", () => {
    const mapper = new MessageMapper([{ id: "1", subject: "Render", status: "in_progress" }, { id: "2", subject: "Deliver", status: "pending" }]);
    expect(mapper.map(call("TaskUpdate", { taskId: "1", status: "completed" })).at(-1)).toEqual({ type: "tasks", tasks: [{ id: "1", subject: "Render", status: "completed" }, { id: "2", subject: "Deliver", status: "pending" }] });
  });
  it("hands a real workspace file back as a typed event and refuses external or missing files", async () => {
    temp = await mkdtemp(path.join(tmpdir(), "moco-handoff-"));
    await writeFile(path.join(temp, "final.mp4"), "video"); const events: AgentEvent[] = [];
    expect(await handOffFile(temp, path.join(temp, "final.mp4"), "Final", event => events.push(event))).toBe("final.mp4");
    expect(events).toEqual([{ type: "file", path: "final.mp4", label: "Final" }]);
    await expect(handOffFile(temp, "../outside.mp4", undefined, () => {})).rejects.toThrow();
    await expect(handOffFile(temp, "missing.mp4", undefined, () => {})).rejects.toThrow();
  });
  it("removes inherited API credentials and provider overrides, retaining normal shell configuration", () => {
    expect(subscriptionEnvironment({ PATH: "bin", ANTHROPIC_API_KEY: "never-use", ANTHROPIC_BASE_URL: "gateway", CLAUDE_CODE_OAUTH_TOKEN: "token", CLAUDECODE: "1", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_GIT_BASH_PATH: "bash.exe" })).toEqual({ PATH: "bin", CLAUDE_CODE_GIT_BASH_PATH: "bash.exe" });
  });
});
