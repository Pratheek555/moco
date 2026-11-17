import { BrowserWindow, MessageChannelMain, app, dialog, nativeTheme, net, protocol, safeStorage, screen, utilityProcess } from "electron";
import type { BrowserWindowConstructorOptions, MessagePortMain, MessageBoxOptions, UtilityProcess } from "electron";
import { WorkspaceStore, confinedFile, mediaType } from "@moco/agent/storage";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import type { AppCommand, HostReply, Method, ServiceMethods, Update } from "../shared/api.ts";
import { loadSettings, saveNotifications, saveTheme, type Settings } from "./settings.ts";
import { registerBridge } from "./bridge.ts";
import { installContextMenu, installMenu } from "./menus.ts";
import { RunNotifications } from "./run-notifications.ts";
import { loadWindowState, saveWindowState } from "./window-state.ts";
import { GeminiSettings } from "./gemini-settings.ts";

if (process.env.MOCO_USER_DATA) app.setPath("userData", path.resolve(process.env.MOCO_USER_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: "moco-media", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const here = path.dirname(fileURLToPath(import.meta.url));
const appId = "app.moco.desktop";
let win: BrowserWindow | null = null;
let creatingWindow: Promise<void> | undefined;
let child: UtilityProcess | undefined;
let port: MessagePortMain | undefined;
let sequence = 0;
let quitting = false;
let quitRequest: Promise<void> | undefined;
let settings: Settings = { theme: "system", notifications: true };
let narration: GeminiSettings;
let saveBoundsTimer: ReturnType<typeof setTimeout> | undefined;
let windowWrites = Promise.resolve();
let windowMaximized = false;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const projectsDir = () => process.env.MOCO_PROJECTS_DIR ? path.resolve(process.env.MOCO_PROJECTS_DIR) : path.join(app.getPath("documents"), "moco");
const store = () => new WorkspaceStore(app.getPath("userData"), projectsDir());
const iconPath = () => app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(app.getAppPath(), "resources/icon.png");
const runs = new RunNotifications({ window: () => win, enabled: () => settings.notifications && !quitting,
  projectName: async id => (await store().project(id)).name, command: sendCommand,
});
function host() {
  if (child) return;
  const sourceRoot = app.isPackaged ? "runtime/apps/desktop" : ".";
  const processChild = utilityProcess.fork(path.join(app.getAppPath(), sourceRoot, "src/main/agent-host.ts"), [], { serviceName: "moco-agent", stdio: "pipe" });
  child = processChild;
  child.stdout?.on("data", chunk => process.stdout.write(chunk));
  child.stderr?.on("data", chunk => process.stderr.write(chunk));
  const channel = new MessageChannelMain();
  port = channel.port1;
  port.on("message", ({ data }: { data: HostReply | { update: Update } }) => {
    if (child !== processChild) return;
    if ("update" in data) {
      runs.update(data.update);
      win?.webContents.send("moco:update", data.update);
      return;
    }
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) request?.reject(new Error(data.error)); else request?.resolve(data.result);
  });
  port.start();
  child.postMessage({ dataDir: app.getPath("userData"), projectsDir: projectsDir() }, [channel.port2]);
  narrationChanged();
  processChild.on("exit", code => {
    if (child !== processChild) return;
    child = undefined; port?.close(); port = undefined;
    runs.clear();
    for (const request of pending.values()) request.reject(new Error(`Agent process exited (${code}). Reopen the project to resume.`));
    pending.clear();
    if (!quitting) win?.webContents.send("moco:update", { error: "The agent process stopped. Reopen the project and send a message to resume." } satisfies Update);
  });
}
function narrationChanged(): void {
  // Dedicated ephemeral channel: no service dispatch, transcript record, or renderer event.
  port?.postMessage({ narration: narration.credentials() });
}
function call<M extends Method>(method: M, ...args: ServiceMethods[M]["args"]): Promise<ServiceMethods[M]["result"]> {
  if (quitting && method !== "shutdown") return Promise.reject(new Error("Moco is closing."));
  host();
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: value => resolve(value as ServiceMethods[M]["result"]), reject });
    try { port!.postMessage({ id, method, args }); }
    catch (error) { pending.delete(id); reject(error); }
  });
}
function sendCommand(command: AppCommand): void {
  void (async () => {
    if (!win) await createWindow();
    if (!win) return;
    const target = win;
    if (target.isMinimized()) target.restore();
    target.show(); target.focus();
    if (target.webContents.isLoadingMainFrame()) target.webContents.once("did-finish-load", () => {
      if (!target.isDestroyed()) target.webContents.send("moco:command", command);
    });
    else target.webContents.send("moco:command", command);
  })().catch(error => console.error("Could not open Moco:", error));
}
function updateWindowTheme(): void {
  if (!win) return;
  const dark = nativeTheme.shouldUseDarkColors;
  win.setBackgroundColor(dark ? "#0f0f11" : "#f7f7f8");
  if (process.platform === "win32") win.setTitleBarOverlay({ color: dark ? "#18181b" : "#ffffff", symbolColor: dark ? "#fafafa" : "#18181b", height: 48 });
}
function persistWindow(): void {
  if (!win || win.isDestroyed()) return;
  const state = { bounds: win.getNormalBounds(), maximized: windowMaximized };
  windowWrites = windowWrites.catch(() => {}).then(() => saveWindowState(app.getPath("userData"), state));
  void windowWrites.catch(error => console.error("Could not save window position:", error));
}
async function createWindow(): Promise<void> {
  if (win) return;
  if (creatingWindow) return creatingWindow;
  creatingWindow = (async () => {
    const state = await loadWindowState(app.getPath("userData"), screen.getAllDisplays().map(display => display.bounds));
    const dark = nativeTheme.shouldUseDarkColors;
    const chrome: BrowserWindowConstructorOptions = process.platform === "win32"
      ? { titleBarStyle: "hidden", titleBarOverlay: { color: dark ? "#18181b" : "#ffffff", symbolColor: dark ? "#fafafa" : "#18181b", height: 48 } }
      : process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 18 } } : {};
    const window = new BrowserWindow({ width: 1380, height: 900, ...state?.bounds, minWidth: 960, minHeight: 640, show: false,
      title: "Moco", backgroundColor: dark ? "#0f0f11" : "#f7f7f8", icon: iconPath(), autoHideMenuBar: true, ...chrome,
      webPreferences: { preload: path.join(here, "../preload/index.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win = window;
    windowMaximized = state?.maximized ?? false;
    if (process.platform !== "darwin") window.setMenuBarVisibility(false);
    if (state?.maximized) window.maximize();
    window.once("ready-to-show", () => window.show());
    window.on("focus", () => { if (process.platform === "win32") window.flashFrame(false); });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-redirect", event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    installContextMenu(window);
    const scheduleSave = () => {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = setTimeout(persistWindow, 250);
    };
    window.on("resize", scheduleSave); window.on("move", scheduleSave);
    window.on("maximize", () => { windowMaximized = true; scheduleSave(); });
    window.on("unmaximize", () => { windowMaximized = false; scheduleSave(); });
    window.on("close", event => {
      persistWindow();
      if (!quitting && runs.activeCount) { event.preventDefault(); void requestQuit(); }
    });
    window.on("closed", () => { clearTimeout(saveBoundsTimer); if (win === window) win = null; });
    if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else await window.loadFile(path.join(here, "../renderer/index.html"));
  })();
  try { await creatingWindow; } finally { creatingWindow = undefined; }
}
async function requestQuit(): Promise<void> {
  if (quitting || quitRequest) return quitRequest;
  quitRequest = (async () => {
    const count = runs.activeCount;
    if (count) {
      const options: MessageBoxOptions = { type: "question", title: "Quit Moco?", message: `Moco is still working on ${count} project${count === 1 ? "" : "s"}. Quit anyway?`, buttons: ["Keep working", "Quit anyway"], defaultId: 0, cancelId: 0, noLink: true };
      const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      if (result.response !== 1) return;
    }
    quitting = true;
    clearTimeout(saveBoundsTimer); persistWindow();
    // Bound both persistence and session shutdown; a stuck AI must not prevent quitting.
    let finished = false;
    const finish = () => { if (!finished) { finished = true; child?.kill(); app.quit(); } };
    const timeout = setTimeout(finish, 5000);
    try {
      await Promise.allSettled([windowWrites, ...(child ? [call("shutdown")] : [])]);
    } finally { clearTimeout(timeout); finish(); }
  })();
  try { await quitRequest; } catch (error) { console.error("Could not close Moco:", error); }
  finally { quitRequest = undefined; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId(appId);
    settings = await loadSettings(app.getPath("userData")); nativeTheme.themeSource = settings.theme;
    narration = new GeminiSettings(app.getPath("userData"), safeStorage);
    await narration.load();
    nativeTheme.on("updated", updateWindowTheme);
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
    registerBridge({ window: () => win, call, store, projectsDir, settings: () => settings, narration, narrationChanged, iconPath: iconPath(), removed: id => runs.forget(id),
      async setTheme(theme) {
        await saveTheme(app.getPath("userData"), theme);
        settings.theme = theme; nativeTheme.themeSource = theme; updateWindowTheme();
      },
      async setNotifications(enabled) {
        await saveNotifications(app.getPath("userData"), enabled);
        settings.notifications = enabled;
      },
    });
    installMenu(sendCommand, projectsDir);
    await createWindow();
    app.on("activate", () => { if (!win) void createWindow().catch(console.error); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on("second-instance", () => {
    if (!win) void createWindow().catch(console.error);
    else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", event => {
    if (quitting) return;
    event.preventDefault(); void requestQuit();
  });
}
