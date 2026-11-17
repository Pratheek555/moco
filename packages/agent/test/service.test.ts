import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectService } from "../../../apps/desktop/src/main/service.ts";
import { WorkspaceStore } from "../src/storage.ts";
import { QuestionBroker } from "../src/questions.ts";
import type { AgentProvider, AgentSession, SessionOptions } from "../src/types.ts";

let temp: string;
let store: WorkspaceStore;
let service: ProjectService;
let options: SessionOptions;
let sent: string[];
let stopped: number;
let finish: () => void;
const input = { questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A" }, { label: "B" }], multiSelect: true }] };
let questions: QuestionBroker;
const provider: AgentProvider = {
  id: "claude-code", status: async () => ({ ok: true }),
  async start(config) {
    options = config;
    questions = new QuestionBroker(config.onEvent);
    const done = new Promise<void>(resolve => { finish = resolve; });
    config.onEvent({ type: "session", sessionId: "saved-session", skills: [config.skill] });
    const session: AgentSession = {
      done, send: text => { sent.push(text); }, answer: (id, answers) => questions.answer(id, answers),
      interrupt: async () => {}, stop: async () => { stopped++; questions.cancel(); finish(); },
    };
    return session;
  },
};
beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "moco-service-"));
  store = new WorkspaceStore(path.join(temp, "data"), path.join(temp, "workspaces"));
  sent = []; stopped = 0; service = new ProjectService(store, provider, () => {});
});
afterEach(async () => { await service.call("shutdown", []); await rm(temp, { recursive: true, force: true }); });
async function project() {
  const source = path.join(temp, "SKILL.md"); await writeFile(source, "---\nname: sample\ndescription: A skill\n---\nAsk first.");
  return store.createProject("Project", (await store.importSkill(source)).id, "claude-code");
}

it("keeps a multi-turn session, sends upload paths, answers a question and resumes after restart", async () => {
  const p = await project();
  const source = path.join(temp, "voice.wav"); await writeFile(source, "audio");
  const files = await service.call("attach", [p.id, [source]]);
  await service.call("send", [p.id, "Start", files]);
  expect(sent[0]).toContain(path.join(p.workspace, files[0]!));
  expect(options.cwd).toBe(p.workspace); expect(options.skill).toBe("sample");
  const response = questions.ask("q", input, new AbortController().signal);
  expect((await service.call("project", [p.id])).state).toBe("waiting");
  await service.call("answer", [p.id, "q", { "Which one?": "A, B" }]);
  expect(await response).toMatchObject({ behavior: "allow", updatedInput: { answers: { "Which one?": "A, B" } } });
  options.onEvent({ type: "text", messageId: "reply", text: "Here is the preview" });
  options.onEvent({ type: "file", path: "outbox/preview.jpg" });
  options.onEvent({ type: "turn_end", status: "completed" });
  await service.call("send", [p.id, "Change the colour", []]);
  expect(options.sessionId).toBeUndefined(); expect(sent).toHaveLength(2);
  await service.call("stop", [p.id]); expect(stopped).toBe(1);
  service = new ProjectService(new WorkspaceStore(store.dataDir, store.projectsDir), provider, () => {});
  const reopened = await service.call("project", [p.id]);
  expect(reopened.events.some(e => e.event.type === "file")).toBe(true);
  expect(reopened.events.some(e => e.event.type === "answer")).toBe(true);
  await service.call("send", [p.id, "Continue", []]); expect(options.sessionId).toBe("saved-session");
});
it("answers an orphaned question after restart through the resumed user stream", async () => {
  const p = await project();
  await store.record(p.id, { type: "session", sessionId: "old", skills: ["sample"] });
  await store.record(p.id, { type: "question", id: "orphan", questions: input.questions });
  await service.call("answer", [p.id, "orphan", { "Which one?": "Something else" }]);
  expect(options.sessionId).toBe("old"); expect(sent[0]).toBe("Which one?: Something else");
  expect((await service.call("project", [p.id])).events.filter(e => e.event.type === "answer")).toHaveLength(1);
});
it("persists stream records before shutdown completes", async () => {
  const p = await project(); await service.call("send", [p.id, "Start", []]);
  for (let i = 0; i < 30; i++) options.onEvent({ type: "text", messageId: "m", text: String(i) });
  await service.call("shutdown", []);
  const text = await readFile(path.join(store.dataDir, "projects", p.id, "conversation.jsonl"), "utf8");
  expect(text.trim().split("\n").filter(line => JSON.parse(line).event.type === "text")).toHaveLength(30);
});

it("keeps Stop available while a render runs after the foreground turn ends", async () => {
  const p = await project(); await service.call("send", [p.id, "Start", []]);
  options.onEvent({ type: "activity", id: "render", kind: "background", description: "Rendering", status: "running" });
  options.onEvent({ type: "turn_end", status: "completed" });
  expect((await service.call("project", [p.id])).state).toBe("running");
  options.onEvent({ type: "activity", id: "render", kind: "background", description: "Finished", status: "completed" });
  expect((await service.call("project", [p.id])).state).toBe("idle");
});

it("routes status, project creation and resumed sessions to the project's own provider", async () => {
  const codex: AgentProvider = { ...provider, id: "codex", status: vi.fn(async () => ({ ok: false, reason: "Sign in to Codex" })), start: vi.fn(provider.start) };
  const claude: AgentProvider = { ...provider, start: vi.fn(provider.start) };
  service = new ProjectService(store, [claude, codex], () => {});
  expect(await service.call("status", [])).toEqual({ ok: false, reason: "Sign in to Codex" });
  const p = await project();
  const c = await service.call("create", ["Codex project", p.skill.id]);
  await store.record(c.id, { type: "session", sessionId: "codex-saved", skills: [c.skill.name] });
  await service.call("send", [c.id, "Continue with Codex", []]);
  expect(codex.start).toHaveBeenCalledOnce(); expect(claude.start).not.toHaveBeenCalled();
  expect(options.sessionId).toBe("codex-saved");
  await service.call("stop", [c.id]);
  await service.call("send", [p.id, "Continue with Claude", []]);
  expect(claude.start).toHaveBeenCalledOnce();
});

it("rejects unavailable provider IDs at the service boundary", async () => {
  await expect(service.call("status", ["codex"])).rejects.toThrow("available AI provider");
  await expect(service.call("create", ["Invalid", "skill", "unknown" as "codex"])).rejects.toThrow("available AI provider");
});

it("exposes only non-idle project states, including waiting, background work and errors", async () => {
  const p = await project();
  expect(await service.call("states", [])).toEqual({});
  await service.call("send", [p.id, "Start", []]);
  expect(await service.call("states", [])).toEqual({ [p.id]: "running" });
  options.onEvent({ type: "question", id: "waiting", questions: input.questions });
  expect(await service.call("states", [])).toEqual({ [p.id]: "waiting" });
  options.onEvent({ type: "error", message: "Try again" });
  expect(await service.call("states", [])).toEqual({ [p.id]: "error" });
  await service.call("stop", [p.id]);
  expect(await service.call("states", [])).toEqual({});
});

it("routes rename, pasted bytes and library removal through storage", async () => {
  const p = await project();
  expect(await service.call("rename", [p.id, "Renamed"])).toMatchObject({ name: "Renamed", workspace: p.workspace });
  const [file] = await service.call("attachData", [p.id, "paste.png", new Uint8Array([1, 2, 3])]);
  expect(await readFile(path.join(p.workspace, file!))).toEqual(Buffer.from([1, 2, 3]));
  await service.call("removeSkill", [p.skill.id]);
  expect(await service.call("skills", [])).toEqual([]);
  expect((await service.call("project", [p.id])).project.skill).toEqual(p.skill);
});

it("stops a waiting session before deletion, writes no interruption, and ignores late callbacks", async () => {
  const p = await project();
  await service.call("send", [p.id, "Start", []]);
  const response = questions.ask("delete-question", input, new AbortController().signal);
  const record = vi.spyOn(store, "record");
  const staleEvent = options.onEvent;
  expect(await service.call("remove", [p.id])).toMatchObject({ id: p.id, workspace: p.workspace });
  expect(await response).toMatchObject({ behavior: "deny" });
  expect(stopped).toBe(1);
  expect(record.mock.calls.some(([, event]) => event.type === "turn_end")).toBe(false);
  staleEvent({ type: "text", messageId: "late", text: "Do not recreate me" });
  staleEvent({ type: "error", message: "Late stop failure" });
  expect(await service.call("states", [])).toEqual({});
  expect(await service.call("projects", [])).toEqual([]);
  await expect(readFile(path.join(store.dataDir, "projects", p.id, "project.json"))).rejects.toThrow();
  expect(await readFile(path.join(p.workspace, ".claude/skills/sample/SKILL.md"), "utf8")).toContain("Ask first");
});

it("deletes safely while provider startup is still in flight", async () => {
  const p = await project();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow: AgentProvider = { ...provider, start: vi.fn(async config => { await gate; return provider.start(config); }) };
  service = new ProjectService(store, slow, () => {});
  const send = service.call("send", [p.id, "Do not send after delete", []]);
  await vi.waitFor(() => expect(slow.start).toHaveBeenCalledOnce());
  const remove = service.call("remove", [p.id]);
  await expect(service.call("rename", [p.id, "Too late"])).rejects.toThrow("being deleted");
  release();
  await send; await remove;
  expect(sent).toEqual([]); expect(stopped).toBe(1);
  expect(await service.call("states", [])).toEqual({});
  await expect(store.conversation(p.id)).rejects.toThrow();
});

it("rejects an unsent message stopped during startup so the composer keeps its draft", async () => {
  const p = await project();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow: AgentProvider = { ...provider, start: vi.fn(async config => { await gate; return provider.start(config); }) };
  service = new ProjectService(store, slow, () => {});
  const send = service.call("send", [p.id, "Keep my draft", []]);
  const rejected = expect(send).rejects.toThrow("Your draft is kept");
  await vi.waitFor(() => expect(slow.start).toHaveBeenCalledOnce());
  const stop = service.call("stop", [p.id]);
  release();
  await rejected; await stop;
  expect(sent).toEqual([]);
  expect((await store.conversation(p.id)).some(record => record.event.type === "user")).toBe(false);
  expect(await service.call("states", [])).toEqual({});
});
