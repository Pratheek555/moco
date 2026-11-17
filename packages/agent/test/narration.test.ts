import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectService } from "../../../apps/desktop/src/main/service.ts";
import { WorkspaceStore } from "../src/storage.ts";
import type { AgentProvider, NarrationEngine, ProviderId, SessionOptions } from "../src/types.ts";

let temp: string;
let store: WorkspaceStore;
let service: ProjectService;
const sessions: { provider: ProviderId; options: SessionOptions; sent: string[] }[] = [];

function provider(id: ProviderId): AgentProvider {
  return {
    id, status: async () => ({ ok: true }),
    async start(options) {
      const session = { provider: id, options, sent: [] as string[] };
      sessions.push(session);
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      options.onEvent({ type: "session", sessionId: `${id}-saved`, skills: [options.skill] });
      return {
        done, send: text => { session.sent.push(text); }, answer: () => {},
        interrupt: async () => {}, stop: async () => { finish(); },
      };
    },
  };
}
function newService() { return new ProjectService(store, [provider("codex"), provider("claude-code")], () => {}); }

it.each(["codex", "claude-code"] as const)("renews idle %s env after key/voice changes and clearing, retaining active/background runs and session IDs", async id => {
  const project = await service.call("create", ["Film", (await skill()).id, id]);
  await service.call("send", [project.id, "First", []]);
  const first = sessions[0]!;
  expect(first.options.narration).toBeUndefined();
  service.updateNarration({ key: "test-key-123", voice: "Charon" });
  await service.call("send", [project.id, "Steer", []]);
  expect(sessions).toHaveLength(1); expect(first.options.narration).toBeUndefined();
  first.options.onEvent({ type: "turn_end", status: "completed" });
  await service.call("send", [project.id, "Next", []]);
  const second = sessions[1]!;
  expect(second.options.narration).toEqual({ key: "test-key-123", voice: "Charon" });
  expect(second.options.sessionId).toBe(`${id}-saved`);
  expect(second.sent[0]).toContain("GEMINI_API_KEY");
  second.options.onEvent({ type: "activity", kind: "background", id: "job", status: "running", description: "Working" });
  second.options.onEvent({ type: "turn_end", status: "completed" });
  service.updateNarration({ key: "test-key-456", voice: "Kore" });
  await service.call("send", [project.id, "While background work runs", []]);
  expect(sessions).toHaveLength(2);
  second.options.onEvent({ type: "activity", kind: "background", id: "job", status: "completed", description: "Done" });
  second.options.onEvent({ type: "turn_end", status: "completed" });
  await service.call("send", [project.id, "New voice", []]);
  expect(sessions[2]!.options.narration).toEqual({ key: "test-key-456", voice: "Kore" });
  sessions[2]!.options.onEvent({ type: "turn_end", status: "completed" });
  service.updateNarration(undefined);
  await service.call("send", [project.id, "Cleared", []]);
  expect(sessions[3]!.options.narration).toBeUndefined();
  expect(sessions[3]!.sent[0]).not.toContain("GEMINI_API_KEY");
  const conversation = await readFile(path.join(store.dataDir, "projects", project.id, "conversation.jsonl"), "utf8");
  expect(conversation).not.toContain("test-key");
  expect(await readFile(path.join(store.dataDir, "projects", project.id, "project.json"), "utf8")).not.toContain("test-key");
});

it("persists Gemini selection without overriding explicit local choices", async () => {
  service.updateNarration({ key: "test-key-123", voice: "Charon" });
  const project = await service.call("create", ["Film", (await skill()).id, "codex", "gemini"]);
  expect((await store.project(project.id)).narrationEngine).toBe("gemini");
  await service.call("send", [project.id, "Narrate", []]);
  expect(sessions[0]!.sent[0]).toContain("Gemini (gemini)");
  sessions[0]!.options.onEvent({ type: "turn_end", status: "completed" });
  await service.call("setNarrationEngine", [project.id, "zonos"]);
  await service.call("send", [project.id, "Local", []]);
  expect(sessions[0]!.sent[1]).toContain("Zonos (zonos)");
  expect(sessions[0]!.sent[1]).not.toContain("Gemini");
});
async function skill(name = "ink-history") {
  const source = path.join(temp, "SKILL.md");
  await writeFile(source, `---\nname: ${name}\ndescription: Narration test\n---\nCreate a film.`);
  return store.importSkill(source);
}
beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "moco-narration-"));
  store = new WorkspaceStore(path.join(temp, "data"), path.join(temp, "workspaces"));
  sessions.length = 0;
  service = newService();
});
afterEach(async () => {
  await service.call("shutdown", []);
  await rm(temp, { recursive: true, force: true });
});

it("saves a narration choice at creation and preserves it across reload, rename and session writes", async () => {
  const imported = await skill();
  const project = await service.call("create", ["Zonos film", imported.id, "codex", "zonos"]);
  expect(project.narrationEngine).toBe("zonos");
  await store.renameProject(project.id, "Renamed film");
  await store.record(project.id, { type: "session", sessionId: "resumable", skills: [imported.name] });
  const reopened = new WorkspaceStore(store.dataDir, store.projectsDir);
  expect(await reopened.project(project.id)).toMatchObject({ name: "Renamed film", narrationEngine: "zonos", sessionId: "resumable" });
  expect((await reopened.projects())[0]?.narrationEngine).toBe("zonos");
  await reopened.setNarrationEngine(project.id, "kokoro");
  expect((await store.project(project.id)).narrationEngine).toBe("kokoro");
  await reopened.setNarrationEngine(project.id, null);
  expect(await store.project(project.id)).not.toHaveProperty("narrationEngine");
  const saved = JSON.parse(await readFile(path.join(store.dataDir, "projects", project.id, "project.json"), "utf8"));
  expect(saved).not.toHaveProperty("narrationEngine");
});

it("keeps old projects without an override and rejects invalid or unsupported engine selections", async () => {
  const imported = await skill();
  const project = await store.createProject("Existing film", imported.id);
  expect(await store.project(project.id)).not.toHaveProperty("narrationEngine");
  const invalid = "unknown" as NarrationEngine;
  await expect(store.createProject("Invalid film", imported.id, "codex", invalid)).rejects.toThrow();
  await expect(store.setNarrationEngine(project.id, invalid)).rejects.toThrow();
  await expect(store.setNarrationEngine(project.id, undefined as unknown as null)).rejects.toThrow();
  expect(await store.project(project.id)).not.toHaveProperty("narrationEngine");
  const other = await skill("sample");
  await expect(service.call("create", ["Other skill", other.id, "codex", "zonos"])).rejects.toThrow("ink-history");
  const unrelated = await store.createProject("Other skill", other.id);
  await expect(service.call("setNarrationEngine", [unrelated.id, "zonos"])).rejects.toThrow("ink-history");
  await service.call("send", [unrelated.id, "Keep this message unchanged", []]);
  expect(sessions[0]?.sent).toEqual(["Keep this message unchanged"]);
});

it.each(["codex", "claude-code"] as const)("applies changed narration settings to reused and resumed %s sessions without changing stored user messages", async id => {
  const project = await service.call("create", ["Film", (await skill()).id, id, "zonos"]);
  await service.call("send", [project.id, "Make a narrated film", []]);
  const current = sessions[0]!;
  expect(current.provider).toBe(id);
  expect(current.sent[0]).toContain("Make a narrated film");
  expect(current.sent[0]).toContain("Zonos (zonos)");
  expect(current.sent[0]).toContain("installed skill");
  current.options.onEvent({ type: "turn_end", status: "completed" });

  await service.call("setNarrationEngine", [project.id, "kokoro"]);
  await service.call("send", [project.id, "Try the other narration", []]);
  expect(sessions).toHaveLength(1);
  expect(current.sent[1]).toContain("Kokoro (kokoro)");
  expect(current.sent[1]).not.toContain("--tts zonos");
  current.options.onEvent({ type: "turn_end", status: "completed" });

  await service.call("setNarrationEngine", [project.id, null]);
  await service.call("send", [project.id, "Keep the story voice", []]);
  expect(current.sent[2]).not.toContain("--tts zonos");
  expect(current.sent[2]).not.toContain("--tts kokoro");
  expect(current.sent[2]).toMatch(/story.*voice|voice.*story/i);
  current.options.onEvent({ type: "turn_end", status: "completed" });

  await service.call("setNarrationEngine", [project.id, "zonos"]);
  await service.call("shutdown", []);
  store = new WorkspaceStore(store.dataDir, store.projectsDir);
  service = newService();
  await service.call("send", [project.id, "Continue after restart", []]);
  expect(sessions).toHaveLength(2);
  expect(sessions[1]?.options.sessionId).toBe(`${id}-saved`);
  expect(sessions[1]?.sent[0]).toContain("Zonos (zonos)");
  const userMessages = (await store.conversation(project.id)).flatMap(record => record.event.type === "user" ? [record.event.text] : []);
  expect(userMessages).toEqual(["Make a narrated film", "Try the other narration", "Keep the story voice", "Continue after restart"]);
});

it("rejects narration changes during an active turn, a question or background work", async () => {
  const project = await service.call("create", ["Film", (await skill()).id, "codex", "zonos"]);
  await service.call("send", [project.id, "Start narration", []]);
  await expect(service.call("setNarrationEngine", [project.id, "kokoro"])).rejects.toThrow();
  const current = sessions[0]!;
  current.options.onEvent({ type: "question", id: "q", questions: [{ question: "Which story?", header: "Story", options: [], multiSelect: false }] });
  await expect(service.call("setNarrationEngine", [project.id, null])).rejects.toThrow();
  current.options.onEvent({ type: "activity", id: "render", kind: "background", description: "Rendering", status: "running" });
  current.options.onEvent({ type: "turn_end", status: "completed" });
  await expect(service.call("setNarrationEngine", [project.id, "kokoro"])).rejects.toThrow();
  expect((await store.project(project.id)).narrationEngine).toBe("zonos");
  await service.call("stop", [project.id]);
  expect(await service.call("setNarrationEngine", [project.id, "kokoro"])).toMatchObject({ narrationEngine: "kokoro" });
});
