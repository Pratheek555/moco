import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { WorkspaceStore } from "../../../packages/agent/src/storage.ts";
import type { Project } from "../../../packages/agent/src/types.ts";
import { ProjectService } from "../src/main/service.ts";
import { GeminiSettings } from "../src/main/gemini-settings.ts";
import { registerBridge, type HostCall } from "../src/main/bridge.ts";
import type { Method, ServiceMethods } from "../src/shared/api.ts";

const native = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  events: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  app: { getVersion: () => "1.2.3", getAppPath: vi.fn(), getPath: vi.fn(), isPackaged: false },
  clipboard: { writeText: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn(), trashItem: vi.fn() },
  icon: { resize: vi.fn() },
}));
vi.mock("electron", () => ({
  ...native,
  nativeImage: { createFromPath: () => native.icon },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => native.handlers.set(channel, handler),
    on: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => native.events.set(channel, handler),
  },
}));
let narration: GeminiSettings;
let temp: string, store: WorkspaceStore, service: ProjectService, project: Project, source: string;
let host: ReturnType<typeof vi.fn>;
let event: IpcMainInvokeEvent;
let window: BrowserWindow;
let removed: ReturnType<typeof vi.fn>;
const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => native.handlers.get(`moco:${channel}`)!(event, ...args));
beforeEach(async () => {
  vi.clearAllMocks(); native.handlers.clear(); native.events.clear();
  temp = await mkdtemp(path.join(tmpdir(), "moco-bridge-"));
  store = new WorkspaceStore(path.join(temp, "data"), path.join(temp, "projects"));
  source = path.join(temp, "SKILL.md"); await writeFile(source, "---\nname: sample\ndescription: Test skill\n---\nInstructions.");
  project = await store.createProject("Project", (await store.importSkill(source)).id);
  service = new ProjectService(store, { id: "codex", status: async () => ({ ok: true }), start: async () => { throw new Error("No AI in unit tests"); } }, () => {});
  host = vi.fn((method: Method, ...args: unknown[]) => service.call(method, args as ServiceMethods[Method]["args"]));
  const contents = { mainFrame: {}, startDrag: vi.fn() };
  window = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow;
  event = { sender: contents, senderFrame: contents.mainFrame } as unknown as IpcMainInvokeEvent;
  native.app.getPath.mockReturnValue(path.join(temp, "Downloads"));
  native.app.getAppPath.mockReturnValue(path.join(temp, "repo/apps/desktop"));
  native.shell.openPath.mockResolvedValue(""); native.shell.openExternal.mockResolvedValue(undefined); native.shell.trashItem.mockResolvedValue(undefined);
  native.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  native.dialog.showSaveDialog.mockResolvedValue({ canceled: true }); native.icon.resize.mockReturnValue(native.icon);
  const settings = { theme: "system" as "system" | "dark" | "light", notifications: true };
  removed = vi.fn();
  narration = new GeminiSettings(temp, { isEncryptionAvailable: () => true, encryptString: () => Buffer.from("opaque"), decryptString: () => "test-key-123" });
  registerBridge({ window: () => window, call: host as HostCall, store: () => store, projectsDir: () => store.projectsDir,
    settings: () => settings, narration, narrationChanged: () => {}, setTheme: async theme => { settings.theme = theme; }, setNotifications: async enabled => { settings.notifications = enabled; }, iconPath: "icon.png", removed,
  });
});
afterEach(async () => { await service.call("shutdown", []); await rm(temp, { recursive: true, force: true }); });

it("checks the main-window sender and main frame before every invoke handler", async () => {
  for (const bad of [{ sender: {}, senderFrame: event.senderFrame }, { sender: event.sender, senderFrame: {} }]) {
    for (const handler of native.handlers.values()) await expect(Promise.resolve().then(() => handler(bad))).rejects.toThrow("Untrusted");
  }
  expect(host).not.toHaveBeenCalled();
});
it("returns all app info, applies settings, copies text, and opens only https links", async () => {
  expect(await invoke("info")).toEqual({ version: "1.2.3", projectsDir: store.projectsDir, theme: "system", notifications: true, platform: process.platform });
  await invoke("set-theme", "dark"); await invoke("set-notifications", false);
  expect(await invoke("info")).toMatchObject({ theme: "dark", notifications: false });
  await invoke("copy-text", "Copy this"); expect(native.clipboard.writeText).toHaveBeenCalledWith("Copy this");
  await invoke("open-external", "https://example.com/help"); expect(native.shell.openExternal).toHaveBeenCalledWith("https://example.com/help");
  for (const bad of ["http://example.com", "file:///private", "javascript:alert(1)", "data:text/html,hi", "invalid"])
    await expect(invoke("open-external", bad)).rejects.toThrow("https");
  expect(native.shell.openExternal).toHaveBeenCalledTimes(1);
});
it("rejects invalid IPC arguments before sending anything to the utility process", async () => {
  const bad: [string, ...unknown[]][] = [
    ["set-theme", "blue"], ["set-notifications", 1], ["copy-text", {}], ["status", "other"], ["info", "extra"],
    ["create", " ", project.skill.id], ["create", "x".repeat(121), project.skill.id], ["create", "Name", "bad"], ["create", "Name", project.skill.id, "bad"],
    ["rename-project", project.id, " "], ["delete-project", project.id, "true"], ["send", project.id, "Hello", [42]],
    ["answer", project.id, "q", { answer: false }], ["answer", project.id, "", {}], ["open-file", project.id, "file.txt", "true"],
    ["import-skill", "bad"], ["import-skill-dropped", "relative/SKILL.md"], ["attach-dropped", project.id, []], ["attach-dropped", project.id, ["relative.txt"]],
    ["attach-pasted", project.id, "paste.png", []], ["attach-pasted", project.id, "paste.png", new Uint8Array()], ["attach-pasted", project.id, "paste.png", new Uint8Array(100 * 1024 * 1024 + 1)],
    ["attach-pasted", project.id, {}, new Uint8Array([1])], ["add-starter-skill", "../escape"],
    ...["project", "rename-project", "delete-project", "delete-skill", "send", "answer", "stop", "files", "attach", "attach-dropped", "attach-pasted", "open-file", "open-workspace", "save-file-as", "read-text-file"].map(channel => [channel, "../bad"] as [string, ...unknown[]]),
  ];
  for (const [channel, ...args] of bad) await expect(invoke(channel, ...args), channel).rejects.toThrow();
  expect(host).not.toHaveBeenCalled();
});
it("creates and opens the projects folder and surfaces native open failures", async () => {
  await rm(store.projectsDir, { recursive: true });
  await invoke("open-projects-folder");
  expect(native.shell.openPath).toHaveBeenCalledWith(store.projectsDir);
  native.shell.openPath.mockResolvedValue("Cannot open folder");
  await expect(invoke("open-projects-folder")).rejects.toThrow("Cannot open folder");
});
it("forwards dropped skill folders, files and pasted bytes through the host", async () => {
  const skill = await invoke("import-skill-dropped", source);
  expect(skill).toMatchObject({ name: "sample" });
  const folder = path.join(temp, "folder"); await mkdir(folder); await writeFile(path.join(folder, "SKILL.md"), await readFile(source));
  expect(await invoke("import-skill-dropped", folder)).toMatchObject({ name: "sample" });
  const files = await invoke("attach-dropped", project.id, [source]) as string[];
  expect(await readFile(path.join(project.workspace, files[0]!), "utf8")).toContain("Instructions");
  const pasted = await invoke("attach-pasted", project.id, "paste.png", new Uint8Array([1, 2])) as string[];
  expect(await readFile(path.join(project.workspace, pasted[0]!))).toEqual(Buffer.from([1, 2]));
  expect(host).toHaveBeenCalledWith("attachData", project.id, "paste.png", new Uint8Array([1, 2]));
});
it("calls the native dialog property at invocation time and handles cancellation", async () => {
  expect(await invoke("import-skill", "file")).toBeNull(); expect(await invoke("attach", project.id)).toEqual([]);
  native.dialog.showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [source] }));
  expect(await invoke("import-skill", "file")).toMatchObject({ name: "sample" });
  expect(await invoke("attach", project.id)).toHaveLength(1);
});
it("offers only valid allowlisted starter skills and imports the shipped folder", async () => {
  expect(await invoke("starter-skills")).toEqual([]);
  const starter = path.join(temp, "repo/examples/skills/ink-history"); await mkdir(starter, { recursive: true });
  await writeFile(path.join(starter, "SKILL.md"), "invalid"); expect(await invoke("starter-skills")).toEqual([]);
  await writeFile(path.join(starter, "SKILL.md"), "---\nname: ink-history\ndescription: History videos\n---\nInstructions");
  expect(await invoke("starter-skills")).toEqual([{ name: "ink-history", description: "History videos" }]);
  expect(await invoke("add-starter-skill", "ink-history")).toMatchObject({ name: "ink-history" });
  expect(host).toHaveBeenCalledWith("importSkill", starter);
});
it("validates and persists narration selections through IPC", async () => {
  for (const bad of ["", "bad key", "test\nkey", "x".repeat(257), {}]) await expect(invoke("set-gemini-key", bad)).rejects.toThrow();
  await expect(invoke("set-gemini-voice", "unknown")).rejects.toThrow();
  await expect(invoke("check-gemini-key")).rejects.toThrow("Paste");
  expect(await invoke("narration-status")).toMatchObject({ keySet: false });
  await writeFile(source, "---\nname: ink-history\ndescription: History videos\n---\nInstructions");
  const skill = await store.importSkill(source);
  const created = await invoke("create", "Narrated film", skill.id, "codex", "zonos") as Project;
  expect(created.narrationEngine).toBe("zonos");
  expect(host).toHaveBeenCalledWith("create", "Narrated film", skill.id, "codex", "zonos");
  expect(await invoke("set-narration-engine", created.id, "kokoro")).toMatchObject({ narrationEngine: "kokoro" });
  await invoke("set-narration-engine", created.id, null);
  expect((await store.project(created.id)).narrationEngine).toBeUndefined();
  host.mockClear();
  for (const invalid of [undefined, "unknown", {}, false])
    await expect(invoke("set-narration-engine", created.id, invalid)).rejects.toThrow("Choose");
  await expect(invoke("set-narration-engine", "bad-id", "zonos")).rejects.toThrow("Invalid");
  await expect(invoke("create", "Invalid", skill.id, "codex", "unknown")).rejects.toThrow("Choose");
  expect(host).not.toHaveBeenCalled();
  await expect(invoke("set-narration-engine", created.id, "gemini")).rejects.toThrow("Save a Gemini key");
  const saved = await invoke("set-gemini-key", "test-key-123");
  expect(saved).toMatchObject({ keySet: true }); expect(JSON.stringify(saved)).not.toContain("test-key");
  expect(await invoke("set-gemini-voice", "Kore")).toMatchObject({ voice: "Kore" });
  expect(await invoke("set-narration-engine", created.id, "gemini")).toMatchObject({ narrationEngine: "gemini" });
  expect(await invoke("clear-gemini-key")).toMatchObject({ keySet: false });
});
it("saves a confined file with a Downloads default and previews text", async () => {
  await writeFile(path.join(project.workspace, "notes.txt"), "Save me");
  expect(await invoke("save-file-as", project.id, "notes.txt")).toBe(false);
  expect(native.dialog.showSaveDialog).toHaveBeenCalledWith(window, { title: "Save a copy", defaultPath: path.join(temp, "Downloads/notes.txt") });
  const destination = path.join(temp, "saved.txt"); native.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
  expect(await invoke("save-file-as", project.id, "notes.txt")).toBe(true);
  expect(await readFile(destination, "utf8")).toBe("Save me");
  expect(await invoke("read-text-file", project.id, "notes.txt")).toEqual({ text: "Save me", truncated: false });
  await expect(invoke("save-file-as", project.id, "../../SKILL.md")).rejects.toThrow();
  await expect(invoke("read-text-file", project.id, "../../SKILL.md")).rejects.toThrow();
  await invoke("open-file", project.id, "notes.txt", true); expect(native.shell.showItemInFolder).toHaveBeenCalledWith(path.join(project.workspace, "notes.txt"));
});
describe("project deletion and trash", () => {
  it("deletes metadata without trashing the workspace unless explicitly requested", async () => {
    expect(await invoke("delete-project", project.id, false)).toBeUndefined();
    expect(native.shell.trashItem).not.toHaveBeenCalled(); expect(removed).toHaveBeenCalledWith(project.id);
    expect(await store.projects()).toEqual([]);
    expect(await readFile(path.join(project.workspace, ".agents/skills/sample/SKILL.md"), "utf8")).toContain("Instructions");
  });
  it("stops the project before trashing and only then removes its metadata", async () => {
    native.shell.trashItem.mockImplementation(async () => {
      expect(await store.projects()).toHaveLength(1);
      expect(host).toHaveBeenCalledWith("stop", project.id);
    });
    await invoke("delete-project", project.id, true);
    expect(native.shell.trashItem).toHaveBeenCalledWith(project.workspace);
    expect(await store.projects()).toEqual([]);
  });
  it("keeps a failed trash operation retryable without losing the conversation", async () => {
    await store.record(project.id, { type: "user", text: "Keep this conversation", files: [] });
    native.shell.trashItem.mockRejectedValueOnce(new Error("Folder is locked"));
    await expect(invoke("delete-project", project.id, true)).rejects.toThrow("Folder is locked");
    expect(await store.projects()).toHaveLength(1);
    expect((await store.conversation(project.id))[0]?.event).toMatchObject({ text: "Keep this conversation" });
    expect(removed).not.toHaveBeenCalled();
    await invoke("delete-project", project.id, false);
    expect(await store.projects()).toEqual([]);
  });
  it.each(["root", "outside", "junction"])("leaves an unsafe %s workspace alone without failing", async kind => {
    const outside = path.join(temp, "outside"); await mkdir(outside);
    const link = path.join(store.projectsDir, "link");
    if (kind === "junction") await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    const workspace = kind === "root" ? store.projectsDir : kind === "outside" ? outside : link;
    await writeFile(path.join(store.dataDir, "projects", project.id, "project.json"), JSON.stringify({ ...project, workspace }));
    await invoke("delete-project", project.id, true);
    expect(native.shell.trashItem).not.toHaveBeenCalled(); expect(await store.projects()).toEqual([]);
  });
});
it("starts native drags only for the trusted main frame and a confined file", async () => {
  await writeFile(path.join(project.workspace, "notes.txt"), "Drag me");
  const drag = native.events.get("moco:drag-file")!;
  expect(() => drag({ sender: {}, senderFrame: {} }, project.id, "notes.txt")).not.toThrow();
  drag(event, project.id, "../../SKILL.md");
  drag(event, project.id, "notes.txt");
  await vi.waitFor(() => expect(window.webContents.startDrag).toHaveBeenCalledOnce());
  expect(window.webContents.startDrag).toHaveBeenCalledWith({ file: path.join(project.workspace, "notes.txt"), icon: native.icon });
});
