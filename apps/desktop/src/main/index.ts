import { BrowserWindow, MessageChannelMain, app, dialog, ipcMain, nativeTheme, net, protocol, shell, utilityProcess } from "electron";
import type { IpcMainInvokeEvent, UtilityProcess, MessagePortMain } from "electron";
import { WorkspaceStore, confinedFile, mediaType } from "@moco/agent/storage";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import type { HostReply, Method, ProviderId, ServiceMethods, Update } from "../shared/api.ts";
import { loadTheme, saveTheme, type Theme } from "./settings.ts";

if (process.env.MOCO_USER_DATA) app.setPath("userData", path.resolve(process.env.MOCO_USER_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: "moco-media", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const here = path.dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | null = null;
let child: UtilityProcess | undefined;
let port: MessagePortMain | undefined;
let sequence = 0;
let quitting = false;
let theme: Theme = "system";
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const projectsDir = () => process.env.MOCO_PROJECTS_DIR ? path.resolve(process.env.MOCO_PROJECTS_DIR) : path.join(app.getPath("documents"), "moco");
const store = () => new WorkspaceStore(app.getPath("userData"), projectsDir());
function host() {
  if (child) return;
  const sourceRoot = app.isPackaged ? "runtime/apps/desktop" : ".";
  child = utilityProcess.fork(path.join(app.getAppPath(), sourceRoot, "src/main/agent-host.ts"), [], { serviceName: "moco-agent", stdio: "pipe" });
  child.stdout?.on("data", chunk => process.stdout.write(chunk));
  child.stderr?.on("data", chunk => process.stderr.write(chunk));
  const channel = new MessageChannelMain();
  port = channel.port1;
  port.on("message", ({ data }: { data: HostReply | { update: Update } }) => {
    if ("update" in data) { win?.webContents.send("moco:update", data.update); return; }
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) request?.reject(new Error(data.error)); else request?.resolve(data.result);
  });
  port.start();
  child.postMessage({ dataDir: app.getPath("userData"), projectsDir: projectsDir() }, [channel.port2]);
  child.on("exit", code => {
    child = undefined; port?.close(); port = undefined;
    for (const request of pending.values()) request.reject(new Error(`Agent process exited (${code}). Reopen the project to resume.`));
    pending.clear();
    if (!quitting) win?.webContents.send("moco:update", { error: "The agent process stopped. Reopen the project and send a message to resume." } satisfies Update);
  });
}
function call<M extends Method>(method: M, ...args: ServiceMethods[M]["args"]): Promise<ServiceMethods[M]["result"]> {
  host();
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: value => resolve(value as ServiceMethods[M]["result"]), reject });
    port!.postMessage({ id, method, args });
  });
}
function trusted(event: IpcMainInvokeEvent) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("Untrusted IPC sender.");
}
function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(`moco:${channel}`, (event, ...args: unknown[]) => { trusted(event); return listener(event, ...args); });
}
function text(value: unknown): string { if (typeof value !== "string") throw new Error("Expected text."); return value; }
function providerId(value: unknown): ProviderId {
  if (value === undefined) return "codex";
  if (value !== "claude-code" && value !== "codex") throw new Error("Choose Claude Code or Codex.");
  return value;
}
function bridge() {
  handle("info", () => ({ version: app.getVersion(), projectsDir: projectsDir(), theme }));
  handle("set-theme", async (_, value: unknown) => {
    if (value !== "light" && value !== "dark" && value !== "system") throw new Error("Invalid theme.");
    await saveTheme(app.getPath("userData"), value);
    theme = value; nativeTheme.themeSource = theme;
  });
  handle("status", (_, provider: unknown) => call("status", providerId(provider)));
  handle("skills", () => call("skills"));
  handle("projects", () => call("projects"));
  handle("create", (_, name: unknown, skill: unknown, provider: unknown) => call("create", text(name), text(skill), providerId(provider)));
  handle("project", (_, id: unknown) => call("project", text(id)));
  handle("send", (_, id: unknown, message: unknown, files: unknown) => {
    if (!Array.isArray(files) || files.some(file => typeof file !== "string")) throw new Error("Invalid attachments.");
    return call("send", text(id), text(message), files);
  });
  handle("answer", (_, id: unknown, question: unknown, answers: unknown) => {
    if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.values(answers).some(v => typeof v !== "string")) throw new Error("Invalid question answers.");
    return call("answer", text(id), text(question), answers as Record<string, string>);
  });
  handle("stop", (_, id: unknown) => call("stop", text(id)));
  handle("files", (_, id: unknown) => call("files", text(id)));
  handle("import-skill", async (_, kind: unknown) => {
    if (kind !== "file" && kind !== "folder") throw new Error("Choose a skill file or folder.");
    const result = await dialog.showOpenDialog(win!, { title: "Import a skill", properties: [kind === "folder" ? "openDirectory" : "openFile"], ...(kind === "file" ? { filters: [{ name: "Skill Markdown", extensions: ["md"] }] } : {}) });
    return result.canceled ? null : call("importSkill", result.filePaths[0]!);
  });
  handle("attach", async (_, id: unknown) => {
    const projectId = text(id);
    await store().project(projectId);
    const result = await dialog.showOpenDialog(win!, { title: "Attach files", properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : call("attach", projectId, result.filePaths);
  });
  handle("open-file", async (_, id: unknown, relative: unknown, reveal: unknown) => {
    const project = await store().project(text(id));
    const file = await confinedFile(project.workspace, text(relative));
    if (reveal === true) shell.showItemInFolder(file);
    else { const error = await shell.openPath(file); if (error) throw new Error(error); }
  });
  handle("open-workspace", async (_, id: unknown) => {
    const project = await store().project(text(id));
    const error = await shell.openPath(project.workspace);
    if (error) throw new Error(error);
  });
}

function createWindow() {
  win = new BrowserWindow({ width: 1380, height: 900, minWidth: 900, minHeight: 650, show: false, title: "Moco", backgroundColor: "#f7f7f8",
    icon: app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(app.getAppPath(), "resources/icon.png"),
    webPreferences: { preload: path.join(here, "../preload/index.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(here, "../renderer/index.html"));
  win.on("closed", () => { win = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async () => {
    theme = await loadTheme(app.getPath("userData")); nativeTheme.themeSource = theme;
    protocol.handle("moco-media", async request => {
      const origin = request.headers.get("origin");
      const allowedOrigin = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : "null";
      const cors = new Headers();
      if (origin === allowedOrigin) cors.set("Access-Control-Allow-Origin", allowedOrigin);
      const failure = (status: number) => new Response(null, { status, headers: cors });
      try {
        const url = new URL(request.url);
        if (url.hostname !== "project" || request.method !== "GET" || (origin && origin !== allowedOrigin)) return failure(403);
        const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
        const project = await store().project(segments.shift() ?? "");
        const relative = segments.join("/");
        const mime = mediaType(relative);
        if (!mime) return failure(415);
        const file = await confinedFile(project.workspace, relative);
        const headers = new Headers();
        const range = request.headers.get("range");
        if (range) headers.set("range", range);
        const response = await net.fetch(pathToFileURL(file).href, { headers });
        const safeHeaders = new Headers(response.headers);
        cors.forEach((value, name) => safeHeaders.set(name, value));
        safeHeaders.set("Content-Type", mime); safeHeaders.set("X-Content-Type-Options", "nosniff");
        safeHeaders.set("Cache-Control", "no-store");
        return new Response(response.body, { status: response.status, headers: safeHeaders });
      } catch { return failure(404); }
    });
    bridge(); createWindow();
    app.on("activate", () => { if (!win) createWindow(); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on("second-instance", () => { win?.show(); win?.focus(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", event => {
    if (quitting || !child) return;
    event.preventDefault(); quitting = true;
    const timeout = setTimeout(() => { child?.kill(); app.quit(); }, 5000);
    void call("shutdown").catch(() => {}).finally(() => { clearTimeout(timeout); child?.kill(); app.quit(); });
  });
}
