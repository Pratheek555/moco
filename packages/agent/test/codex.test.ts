import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexEnvironment, codexProvider } from "../src/codex.ts";
import { CodexMessageMapper } from "../src/codex-messages.ts";
import { CodexConnection } from "../src/codex-rpc.ts";
import type { AgentEvent, AgentSession } from "../src/types.ts";

const fixture = fileURLToPath(new URL("./fixtures/codex-server.mjs", import.meta.url));
let temp: string;
let events: AgentEvent[];
let session: AgentSession | undefined;
const provider = codexProvider({ executable: fixture });
beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "moco-codex-")); events = [];
  vi.stubEnv("MOCO_TEST_CODEX_LOG", path.join(temp, "rpc.jsonl"));
});
afterEach(async () => { await session?.stop(); session = undefined; vi.unstubAllEnvs(); await rm(temp, { recursive: true, force: true }); });
const start = async (sessionId?: string) => session = await provider.start({ cwd: temp, skill: "sample", sessionId, onEvent: event => events.push(event) });
const messages = async () => (await readFile(path.join(temp, "rpc.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const ended = async (count = 1) => vi.waitFor(() => expect(events.filter(event => event.type === "turn_end")).toHaveLength(count));

describe("Codex app-server sessions", () => {
  it("checks ChatGPT authentication and rejects missing or API-key login without starting a thread", async () => {
    expect(await provider.status()).toEqual({ ok: true, version: "codex-fixture/1.0" });
    for (const type of ["none", "apiKey"]) {
      vi.stubEnv("MOCO_TEST_CODEX_AUTH", type);
      expect(await provider.status()).toMatchObject({ ok: false, issue: "signed-out", reason: expect.stringContaining("codex login") });
      await expect(start()).rejects.toThrow("ChatGPT subscription");
    }
    expect((await messages()).some(message => message.method === "thread/start")).toBe(false);
  });
  it("reports a broken installation as unavailable", async () => {
    expect(await codexProvider({ executable: path.join(temp, "missing-codex.exe") }).status()).toMatchObject({ ok: false, issue: "unavailable" });
  });
  it("initializes, invokes the pinned skill, streams multiple turns and resumes the saved thread", async () => {
    await start();
    session!.send("first"); await ended();
    session!.send("second"); await ended(2);
    expect(events.flatMap(event => event.type === "text" ? [event.text] : []).join("")).toBe("Hello firstHello second");
    expect(events[0]).toEqual({ type: "session", sessionId: "codex-thread", skills: ["sample"] });
    await session!.stop(); await start("codex-thread");
    session!.send("third"); await ended(3);
    const calls = await messages();
    expect(calls[0]).toMatchObject({ method: "initialize", params: { clientInfo: { name: "moco" }, capabilities: { experimentalApi: true } } });
    expect(calls.find(call => call.method === "thread/start")).toMatchObject({ params: { cwd: temp, approvalPolicy: "never", sandbox: "danger-full-access", dynamicTools: expect.arrayContaining([expect.objectContaining({ name: "moco_SendUserFile" }), expect.objectContaining({ name: "moco_AskUserQuestion" })]) } });
    expect(calls.find(call => call.method === "thread/resume")).toMatchObject({ params: { threadId: "codex-thread", excludeTurns: true } });
    expect(calls.filter(call => call.method === "turn/start").at(-1).params.input).toContainEqual({ type: "skill", name: "sample", path: path.join(temp, ".agents/skills/sample/SKILL.md") });
  });
  it("routes multi-select and free-text questions back to a pending dynamic tool", async () => {
    await start(); session!.send("question");
    await vi.waitFor(() => expect(events.some(event => event.type === "question")).toBe(true));
    const question = events.find(event => event.type === "question")!;
    if (question.type !== "question") throw new Error("Missing question");
    expect(question.questions[0]?.multiSelect).toBe(true);
    expect(() => session!.answer(question.id, {})).toThrow("Answer each");
    session!.answer(question.id, { "Choose the style?": "Drawn, 3D, hand painted" });
    await ended();
    expect(events).toContainEqual({ type: "answer", id: question.id, answers: { "Choose the style?": "Drawn, 3D, hand painted" } });
    const replies = (await messages()).filter(message => message.id?.startsWith?.("server-") && message.result);
    expect(JSON.parse(replies[0].result.contentItems[0].text)).toEqual({ "Choose the style?": "Drawn, 3D, hand painted" });
  });
  it("maps native question IDs to the app's question text and preserves commas in free text", async () => {
    await start(); session!.send("native question");
    await vi.waitFor(() => expect(events.some(event => event.type === "question")).toBe(true));
    const question = events.find(event => event.type === "question")!;
    if (question.type !== "question") throw new Error("Missing question");
    session!.answer(question.id, { "Where are you starting?": "A story, with music" }); await ended();
    expect((await messages()).find(message => message.result?.answers)?.result).toEqual({ answers: { starting_point: { answers: ["A story, with music"] } } });
  });
  it("delivers workspace files and reports traversal and missing files to Codex", async () => {
    await writeFile(path.join(temp, "preview.png"), "image");
    await start(); session!.send("deliver preview.png"); await ended();
    expect(events).toContainEqual({ type: "file", path: "preview.png", label: "Preview" });
    session!.send("deliver ../outside.png"); await ended(2);
    session!.send("deliver missing.png"); await ended(3);
    expect(events.filter(event => event.type === "file")).toHaveLength(1);
    expect((await messages()).filter(message => message.result?.success === false)).toHaveLength(2);
  });
  it("steers active work and starts a new turn if the previous one finishes during steering", async () => {
    await start(); session!.send("hold");
    await vi.waitFor(async () => expect((await messages()).some(message => message.method === "turn/start")).toBe(true));
    session!.send("finish during steer"); await ended(2);
    expect((await messages()).filter(message => message.method === "turn/start")).toHaveLength(2);
    expect(events.some(event => event.type === "error")).toBe(false);
  });
  it("stops pending questions, closes the child and rejects further sends", async () => {
    await start(); session!.send("question");
    await vi.waitFor(() => expect(events.some(event => event.type === "question")).toBe(true));
    await session!.stop(); await session!.done;
    expect(() => session!.send("later")).toThrow("stopped");
    expect(events.some(event => event.type === "error")).toBe(false);
    expect((await messages()).some(message => message.method === "turn/interrupt")).toBe(true);
  });
  it("reports an unexpected subprocess exit and does not silently replace a missing thread", async () => {
    await expect(start("missing")).rejects.toThrow("Thread not found");
    expect((await messages()).some(message => message.method === "thread/start")).toBe(false);
    await start(); session!.send("crash"); await session!.done;
    expect(events).toContainEqual({ type: "turn_end", status: "error" });
    expect(events.some(event => event.type === "error" && event.message.includes("exited"))).toBe(true);
  });
  it("bounds unanswered RPC requests and cleans up pending calls on exit", async () => {
    const connection = new CodexConnection(fixture, codexEnvironment());
    try {
      await connection.initialize();
      await expect(connection.request("initialized", {}, 20)).rejects.toThrow("timed out");
    } finally { await connection.close(); }
  });
  it("removes inherited API keys and endpoint overrides while keeping Codex home and shell settings", () => {
    expect(codexEnvironment({ PATH: "bin", CODEX_HOME: "profile", OPENAI_API_KEY: "never", OPENAI_BASE_URL: "gateway", CODEX_API_KEY: "never", CODEX_ACCESS_TOKEN: "never", CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "other" })).toEqual({ PATH: "bin", CODEX_HOME: "profile" });
  });
});

describe("Codex event mapping", () => {
  it("does not duplicate streamed replies or reasoning and separates item IDs across turns", () => {
    const mapper = new CodexMessageMapper();
    expect(mapper.map("item/agentMessage/delta", { turnId: "a", itemId: "0", delta: "Hello" })).toEqual([{ type: "text", messageId: "a:0", text: "Hello" }]);
    expect(mapper.map("item/completed", { turnId: "a", item: { type: "agentMessage", id: "0", text: "Hello" } })).toEqual([]);
    expect(mapper.map("item/completed", { turnId: "b", item: { type: "agentMessage", id: "0", text: "Next" } })).toEqual([{ type: "text", messageId: "b:0", text: "Next" }]);
    mapper.map("item/reasoning/summaryTextDelta", { turnId: "a", itemId: "1", delta: "Thinking" });
    expect(mapper.map("item/completed", { turnId: "a", item: { type: "reasoning", id: "1", summary: ["Thinking"] } })).toEqual([]);
  });
  it("maps shell results, failed MCP calls, tasks, usage and terminal errors without treating retries as failures", () => {
    const mapper = new CodexMessageMapper();
    const item = { type: "commandExecution", id: "cmd", command: "render", cwd: "workspace", status: "completed", aggregatedOutput: "done", exitCode: 0 };
    expect(mapper.map("item/started", { turnId: "a", item })[0]).toMatchObject({ type: "tool_call", name: "Shell" });
    expect(mapper.map("item/completed", { turnId: "a", item })).toEqual([{ type: "tool_result", id: "a:cmd", content: "done", isError: false }]);
    expect(mapper.map("item/completed", { turnId: "a", item: { type: "mcpToolCall", id: "mcp", server: "moco", tool: "test", status: "failed", error: { message: "Failed" } } }).at(-1)).toMatchObject({ type: "tool_result", isError: true });
    expect(mapper.map("turn/plan/updated", { plan: [{ step: "Render", status: "inProgress" }] })).toEqual([{ type: "tasks", tasks: [{ id: "0", subject: "Render", status: "in_progress" }] }]);
    expect(mapper.map("thread/tokenUsage/updated", { tokenUsage: { last: { inputTokens: 12, outputTokens: 5 } } })).toEqual([{ type: "usage", inputTokens: 12, outputTokens: 5 }]);
    expect(mapper.map("error", { turnId: "a", willRetry: true, error: { message: "Reconnecting" } })).toEqual([]);
    expect(mapper.map("turn/completed", { turn: { id: "a", status: "failed", error: { message: "Limit reached" } } })).toEqual([{ type: "error", message: "Limit reached" }, { type: "turn_end", status: "error" }]);
    expect(mapper.map("turn/completed", { turn: { id: "b", status: "interrupted" } })).toEqual([{ type: "turn_end", status: "interrupted" }]);
  });
});
