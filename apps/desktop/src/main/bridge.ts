import { app, clipboard, dialog, ipcMain, nativeImage, shell } from "electron";
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { MAX_UPLOAD_BYTES, WorkspaceStore, confinedFile, parseSkill } from "@moco/agent/storage";
import type { AppInfo, Method, NarrationEngine, Platform, ProviderId, ServiceMethods, StarterSkill, Theme } from "../shared/api.ts";
import type { Settings } from "./settings.ts";
import { copyWorkspaceFile, readTextFile, trashableWorkspace } from "./workspace-actions.ts";
import type { GeminiSettings } from "./gemini-settings.ts";
import { validateGeminiKey, validateGeminiVoice } from "./gemini-settings.ts";
import { checkGeminiKey } from "./gemini-check.ts";

export type HostCall = <M extends Method>(method: M, ...args: ServiceMethods[M]["args"]) => Promise<ServiceMethods[M]["result"]>;
interface BridgeOptions {
  window(): BrowserWindow | null;
  call: HostCall;
  store(): WorkspaceStore;
  projectsDir(): string;
  settings(): Settings;
  setTheme(theme: Theme): Promise<void>;
  setNotifications(enabled: boolean): Promise<void>;
  iconPath: string;
  removed?(id: string): void;
  narration: GeminiSettings;
  narrationChanged(): void;
}
export const STARTER_SKILLS = ["ink-history"] as const;
const startersDir = () => app.isPackaged ? path.join(process.resourcesPath, "skills") : path.resolve(app.getAppPath(), "../../examples/skills");
function text(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0")) throw new Error("Expected text.");
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9-]{36}$/.test(result)) throw new Error("Invalid project or skill id.");
  return result;
}
function name(value: unknown): string {
  const result = text(value).trim();
  if (!result || result.length > 120) throw new Error("Give the project a name of 1–120 characters.");
  return result;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected true or false.");
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Expected a list of files.");
  return Array.from(value, text);
}
function source(value: unknown): string {
  const result = text(value);
  if (!path.isAbsolute(result)) throw new Error("Choose a file or folder on your computer.");
  return result;
}
function relative(value: unknown): string {
  const result = text(value);
  if (!result || result.includes(":") || path.isAbsolute(result) || /^[\\/]/.test(result)) throw new Error("Use a project-relative file path.");
  return result;
}
function providerId(value: unknown): ProviderId {
  if (value === undefined) return "codex";
  if (value !== "claude-code" && value !== "codex") throw new Error("Choose Claude Code or Codex.");
  return value;
}
function narrationEngine(value: unknown): NarrationEngine | undefined {
  if (value === undefined) return undefined;
  if (value !== "kokoro" && value !== "zonos" && value !== "gemini") throw new Error("Choose Kokoro, Zonos, Gemini or the story default.");
  return value;
}
export function httpsUrl(value: unknown): string {
  try {
    const url = new URL(text(value));
    if (url.protocol === "https:") return url.href;
  } catch { /* Report one clear error for invalid and unsafe links. */ }
  throw new Error("Only https links can be opened in your browser.");
}
export function registerBridge(options: BridgeOptions): void {
  const { call, store, projectsDir } = options;
  function trusted(event: IpcMainEvent | IpcMainInvokeEvent) {
    const win = options.window();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("Untrusted IPC sender.");
  }
  function handle(channel: string, count: number, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
    ipcMain.handle(`moco:${channel}`, (event, ...args: unknown[]) => {
      trusted(event);
      if (args.length > count) throw new Error("Unexpected request arguments.");
      return listener(event, ...args);
    });
  }
  async function openProjectsFolder() {
    await mkdir(projectsDir(), { recursive: true });
    const error = await shell.openPath(projectsDir());
    if (error) throw new Error(error);
  }
  handle("info", 0, (): AppInfo => ({ version: app.getVersion(), projectsDir: projectsDir(), ...options.settings(), platform: process.platform as Platform }));
  handle("set-theme", 1, (_, value) => {
    if (value !== "light" && value !== "dark" && value !== "system") throw new Error("Invalid theme.");
    return options.setTheme(value);
  });
  handle("set-notifications", 1, (_, value) => options.setNotifications(boolean(value)));
  handle("narration-status", 0, () => options.narration.status());
  async function narrationChange(work: Promise<unknown>) {
    await work; options.narrationChanged(); return options.narration.status();
  }
  handle("set-gemini-key", 1, (_, value) => narrationChange(options.narration.setKey(validateGeminiKey(value))));
  handle("clear-gemini-key", 0, () => narrationChange(options.narration.clear()));
  handle("set-gemini-voice", 1, (_, value) => narrationChange(options.narration.setVoice(validateGeminiVoice(value))));
  handle("check-gemini-key", 1, (_, value) => {
    const key = value === undefined ? options.narration.credentials()?.key : validateGeminiKey(value);
    if (!key) throw new Error("Paste a Gemini key first.");
    return checkGeminiKey(key);
  });
  handle("open-external", 1, (_, value) => shell.openExternal(httpsUrl(value)));
  handle("open-projects-folder", 0, openProjectsFolder);
  handle("copy-text", 1, (_, value) => { clipboard.writeText(text(value)); });
  handle("status", 1, (_, value) => call("status", providerId(value)));
  handle("skills", 0, () => call("skills"));
  handle("delete-skill", 1, (_, value) => call("removeSkill", id(value)));
  handle("projects", 0, () => call("projects"));
  handle("project-states", 0, () => call("states"));
  function availableEngine(value: unknown) {
    const engine = narrationEngine(value);
    if (engine === "gemini" && !options.narration.status().keySet) throw new Error("Save a Gemini key in Settings → Narration first.");
    return engine;
  }
  handle("create", 4, (_, value, skill, provider, engine) => call("create", name(value), id(skill), providerId(provider), availableEngine(engine)));
  handle("set-narration-engine", 2, (_, value, engine) => {
    const projectId = id(value);
    if (engine === undefined) throw new Error("Choose Kokoro, Zonos, Gemini or the story default.");
    return call("setNarrationEngine", projectId, engine === null ? null : availableEngine(engine)!);
  });
  handle("project", 1, (_, value) => call("project", id(value)));
  handle("rename-project", 2, (_, value, nextName) => call("rename", id(value), name(nextName)));
  handle("delete-project", 2, async (_, value, removeFiles) => {
    const projectId = id(value);
    const trash = boolean(removeFiles);
    const project = await store().project(projectId);
    if (trash) {
      const folder = await trashableWorkspace(projectsDir(), project.workspace);
      if (folder) {
        await call("stop", projectId);
        await shell.trashItem(folder);
      }
    }
    await call("remove", projectId);
    options.removed?.(projectId);
  });
  handle("send", 3, (_, value, message, files) => call("send", id(value), text(message), strings(files).map(relative)));
  handle("answer", 3, (_, value, question, answers) => {
    const projectId = id(value), questionId = text(question);
    if (!questionId || !answers || typeof answers !== "object" || Array.isArray(answers)
      || Object.values(answers).some(answer => typeof answer !== "string")) throw new Error("Invalid question answers.");
    return call("answer", projectId, questionId, answers as Record<string, string>);
  });
  handle("stop", 1, (_, value) => call("stop", id(value)));
  handle("files", 1, (_, value) => call("files", id(value)));
  handle("import-skill", 1, async (_, kind) => {
    if (kind !== "file" && kind !== "folder") throw new Error("Choose a skill file or folder.");
    const result = await dialog.showOpenDialog(options.window()!, { title: "Import a skill", properties: [kind === "folder" ? "openDirectory" : "openFile"], ...(kind === "file" ? { filters: [{ name: "Skill Markdown", extensions: ["md"] }] } : {}) });
    return result.canceled || !result.filePaths.length ? null : call("importSkill", source(result.filePaths[0]));
  });
  handle("import-skill-dropped", 1, (_, value) => call("importSkill", source(value)));
  handle("starter-skills", 0, async (): Promise<StarterSkill[]> => {
    const skills = await Promise.all(STARTER_SKILLS.map(async skill => {
      try {
        const parsed = parseSkill(await readFile(path.join(startersDir(), skill, "SKILL.md"), "utf8"));
        return parsed.name === skill ? parsed : null;
      } catch { return null; }
    }));
    return skills.filter((skill): skill is StarterSkill => skill !== null);
  });
  handle("add-starter-skill", 1, (_, value) => {
    const skill = text(value);
    if (!STARTER_SKILLS.some(allowed => allowed === skill)) throw new Error("Choose an available starter skill.");
    return call("importSkill", path.join(startersDir(), skill));
  });
  handle("attach", 1, async (_, value) => {
    const projectId = id(value);
    await store().project(projectId);
    const result = await dialog.showOpenDialog(options.window()!, { title: "Attach files", properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : call("attach", projectId, result.filePaths.map(source));
  });
  handle("attach-dropped", 2, (_, value, files) => {
    const projectId = id(value), sources = strings(files).map(source);
    if (!sources.length) throw new Error("Drop at least one file to attach.");
    return call("attach", projectId, sources);
  });
  handle("attach-pasted", 3, (_, value, fileName, data) => {
    const projectId = id(value), pastedName = text(fileName);
    if (!pastedName.trim()) throw new Error("Expected a file name.");
    if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > MAX_UPLOAD_BYTES) throw new Error("Paste a file between 1 byte and 100 MB.");
    return call("attachData", projectId, pastedName, data);
  });
  handle("open-file", 3, async (_, value, filePath, reveal) => {
    const projectId = id(value), fileRelative = relative(filePath), show = boolean(reveal);
    const project = await store().project(projectId);
    const file = await confinedFile(project.workspace, fileRelative);
    if (show) shell.showItemInFolder(file);
    else { const error = await shell.openPath(file); if (error) throw new Error(error); }
  });
  handle("open-workspace", 1, async (_, value) => {
    const project = await store().project(id(value));
    const error = await shell.openPath(project.workspace);
    if (error) throw new Error(error);
  });
  handle("save-file-as", 2, async (_, value, filePath) => {
    const projectId = id(value), fileRelative = relative(filePath);
    const project = await store().project(projectId);
    const file = await confinedFile(project.workspace, fileRelative);
    const result = await dialog.showSaveDialog(options.window()!, { title: "Save a copy", defaultPath: path.join(app.getPath("downloads"), path.basename(file)) });
    if (result.canceled || !result.filePath) return false;
    // Recheck confinement after the native dialog, while the AI may be changing files.
    await copyWorkspaceFile(project.workspace, fileRelative, result.filePath);
    return true;
  });
  handle("read-text-file", 2, async (_, value, filePath) => {
    const projectId = id(value), fileRelative = relative(filePath);
    return readTextFile((await store().project(projectId)).workspace, fileRelative);
  });
  ipcMain.on("moco:drag-file", (event, ...args: unknown[]) => {
    void (async () => {
      trusted(event);
      if (args.length !== 2) return;
      const projectId = id(args[0]), fileRelative = relative(args[1]);
      const project = await store().project(projectId);
      const file = await confinedFile(project.workspace, fileRelative);
      trusted(event);
      const icon = nativeImage.createFromPath(options.iconPath).resize({ width: 32, height: 32 });
      event.sender.startDrag({ file, icon });
    })().catch(() => { /* Native drag is fire-and-forget; invalid requests are ignored. */ });
  });
}
