import { beforeEach, expect, it, vi } from "vitest";
import type { AppCommand, MocoAPI, Update } from "../src/shared/api.ts";
const native = vi.hoisted(() => ({
  expose: vi.fn(), invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn(), getPathForFile: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: native.expose },
  ipcRenderer: { invoke: native.invoke, send: native.send, on: native.on, removeListener: native.removeListener },
  webUtils: { getPathForFile: native.getPathForFile },
}));
await import("../src/preload/index.ts");
const api = native.expose.mock.calls[0]![1] as MocoAPI;
beforeEach(() => { vi.clearAllMocks(); native.invoke.mockResolvedValue(undefined); });
it("exposes exactly the frozen API and maps its methods to explicit IPC channels", async () => {
  const calls: [keyof MocoAPI, unknown[], string][] = [
    ["narrationStatus", [], "narration-status"], ["setGeminiKey", ["test-key-123"], "set-gemini-key"],
    ["clearGeminiKey", [], "clear-gemini-key"], ["setGeminiVoice", ["Kore"], "set-gemini-voice"], ["checkGeminiKey", ["test-key-123"], "check-gemini-key"],
    ["info", [], "info"], ["setTheme", ["dark"], "set-theme"], ["setNotifications", [false], "set-notifications"],
    ["openExternal", ["https://example.com"], "open-external"], ["openProjectsFolder", [], "open-projects-folder"], ["copyText", ["text"], "copy-text"],
    ["status", ["codex"], "status"], ["skills", [], "skills"], ["importSkill", ["folder"], "import-skill"], ["deleteSkill", ["skill"], "delete-skill"],
    ["starterSkills", [], "starter-skills"], ["addStarterSkill", ["ink-history"], "add-starter-skill"],
    ["projects", [], "projects"], ["projectStates", [], "project-states"], ["create", ["Project", "skill", "codex", "zonos"], "create"],
    ["setNarrationEngine", ["project", "zonos"], "set-narration-engine"],
    ["project", ["project"], "project"], ["renameProject", ["project", "New name"], "rename-project"], ["deleteProject", ["project", false], "delete-project"],
    ["send", ["project", "Hello", ["uploads/file.txt"]], "send"], ["answer", ["project", "question", { Question: "Answer" }], "answer"],
    ["stop", ["project"], "stop"], ["attach", ["project"], "attach"], ["files", ["project"], "files"],
    ["openFile", ["project", "file.txt", true], "open-file"], ["openWorkspace", ["project"], "open-workspace"],
    ["saveFileAs", ["project", "file.txt"], "save-file-as"], ["readTextFile", ["project", "file.txt"], "read-text-file"],
  ];
  for (const [method, args, channel] of calls) {
    await (api[method] as (...args: unknown[]) => unknown)(...args);
    expect(native.invoke).toHaveBeenLastCalledWith(`moco:${channel}`, ...args);
  }
  expect(Object.keys(api).sort()).toEqual([...calls.map(([method]) => method), "importSkillDropped", "attachDropped", "attachPasted", "dragFile", "onCommand", "onUpdate"].sort());
  expect("invoke" in api).toBe(false);
});
it("resolves real drop paths inside preload and rejects pathless files", async () => {
  const file = new File(["data"], "file.txt");
  native.getPathForFile.mockReturnValue("C:\\files\\file.txt");
  await api.importSkillDropped(file);
  expect(native.invoke).toHaveBeenLastCalledWith("moco:import-skill-dropped", "C:\\files\\file.txt");
  await api.attachDropped("project", [file]);
  expect(native.invoke).toHaveBeenLastCalledWith("moco:attach-dropped", "project", ["C:\\files\\file.txt"]);
  native.invoke.mockClear(); native.getPathForFile.mockReturnValue("");
  await expect(api.importSkillDropped(file)).rejects.toThrow("no path");
  await expect(api.attachDropped("project", [file])).rejects.toThrow("no path");
  await expect(api.attachDropped("project", [])).rejects.toThrow("at least one");
  expect(native.invoke).not.toHaveBeenCalled();
});
it("checks pasted data before IPC and uses send for native drag", async () => {
  const data = new Uint8Array([1, 2]);
  await api.attachPasted("project", "image.png", data);
  expect(native.invoke).toHaveBeenLastCalledWith("moco:attach-pasted", "project", "image.png", data);
  for (const invalid of [new Uint8Array(), new Uint8Array(100 * 1024 * 1024 + 1), [1] as unknown as Uint8Array])
    await expect(api.attachPasted("project", "image.png", invalid)).rejects.toThrow("100 MB");
  api.dragFile("project", "video.mp4");
  expect(native.send).toHaveBeenCalledWith("moco:drag-file", "project", "video.mp4");
});
it("forwards typed commands and updates without exposing events and unsubscribes the exact listener", () => {
  const commands = vi.fn(), updates = vi.fn();
  const offCommand = api.onCommand(commands), offUpdate = api.onUpdate(updates);
  const commandHandler = native.on.mock.calls.find(([channel]) => channel === "moco:command")![1] as (event: unknown, command: AppCommand) => void;
  const updateHandler = native.on.mock.calls.find(([channel]) => channel === "moco:update")![1] as (event: unknown, update: Update) => void;
  const command: AppCommand = { type: "open-project", projectId: "project" }, update: Update = { projectId: "project", state: "waiting" };
  commandHandler({ private: "event" }, command); updateHandler({ private: "event" }, update);
  expect(commands).toHaveBeenCalledWith(command); expect(updates).toHaveBeenCalledWith(update);
  offCommand(); offUpdate();
  expect(native.removeListener).toHaveBeenCalledWith("moco:command", commandHandler);
  expect(native.removeListener).toHaveBeenCalledWith("moco:update", updateHandler);
});
