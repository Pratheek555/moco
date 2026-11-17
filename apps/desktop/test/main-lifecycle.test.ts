import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EventEmitter } from "node:events";
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent } from "electron";

interface FakeWindow extends EventEmitter {
  options: BrowserWindowConstructorOptions;
  webContents: EventEmitter & { mainFrame: object; send: ReturnType<typeof vi.fn>; session: { setPermissionRequestHandler: ReturnType<typeof vi.fn>; setPermissionCheckHandler: ReturnType<typeof vi.fn> } };
  close(): void;
  setBackgroundColor: ReturnType<typeof vi.fn>;
  setTitleBarOverlay: ReturnType<typeof vi.fn>;
}
const native = vi.hoisted(() => ({
  windows: [] as FakeWindow[], children: [] as (EventEmitter & { kill: ReturnType<typeof vi.fn> })[], ports: [] as EventEmitter[],
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  requests: [] as { id: number; method: string }[], respond: true, quitCompletions: 0,
  dataDir: "", projectsDir: "", showMessageBox: vi.fn(),
  app: undefined as unknown as EventEmitter & { quit(): void },
  theme: undefined as unknown as EventEmitter & { shouldUseDarkColors: boolean },
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const app = Object.assign(new EventEmitter(), {
    name: "Moco", isPackaged: false,
    setPath: vi.fn(), getPath: (name: string) => name === "userData" ? native.dataDir : native.projectsDir,
    getAppPath: () => path.resolve("apps/desktop"), getVersion: () => "1.0.0",
    requestSingleInstanceLock: () => true, whenReady: async () => {}, setAppUserModelId: vi.fn(),
    quit: vi.fn(() => {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      app.emit("before-quit", event);
      if (!event.prevented) native.quitCompletions++;
    }),
  });
  native.app = app;
  const theme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false, themeSource: "system" });
  native.theme = theme;
  class Window extends EventEmitter {
    options: BrowserWindowConstructorOptions;
    destroyed = false; maximized = false;
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {}, send: vi.fn(), setWindowOpenHandler: vi.fn(), isLoadingMainFrame: () => false,
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
    });
    constructor(options: BrowserWindowConstructorOptions) { super(); this.options = options; native.windows.push(this); }
    show = vi.fn(); focus = vi.fn(); restore = vi.fn(); flashFrame = vi.fn(); setMenuBarVisibility = vi.fn();
    setBackgroundColor = vi.fn(); setTitleBarOverlay = vi.fn();
    isFocused() { return true; } isMinimized() { return false; } isDestroyed() { return this.destroyed; }
    isMaximized() { return this.maximized; } maximize() { this.maximized = true; this.emit("maximize"); }
    getNormalBounds() { return { x: this.options.x ?? 100, y: this.options.y ?? 80, width: this.options.width!, height: this.options.height! }; }
    async loadFile() {} async loadURL() {}
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit("close", event);
      if (!event.prevented) { this.destroyed = true; this.emit("closed"); app.emit("window-all-closed"); }
    }
  }
  class Channel {
    port1 = Object.assign(new EventEmitter(), {
      start: vi.fn(), close: vi.fn(), postMessage: (request: { id: number; method: string }) => {
        if (!("method" in request)) return;
        native.requests.push(request);
        if (native.respond) queueMicrotask(() => this.port1.emit("message", { data: { id: request.id, result: request.method === "status" ? { ok: true } : undefined } }));
      },
    });
    port2 = {};
    constructor() { native.ports.push(this.port1); }
  }
  return {
    safeStorage: { isEncryptionAvailable: () => false },
    app, BrowserWindow: Window, MessageChannelMain: Channel, nativeTheme: theme,
    utilityProcess: { fork: () => {
      const child = Object.assign(new EventEmitter(), { stdout: null, stderr: null, postMessage: vi.fn(), kill: vi.fn(() => { child.emit("exit", 0); }) });
      native.children.push(child); return child;
    } },
    screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }, net: { fetch: vi.fn() },
    dialog: { showMessageBox: native.showMessageBox },
    ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => native.handlers.set(channel, handler), on: vi.fn() },
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() }, Notification: class { static isSupported() { return false; } },
    clipboard: { writeText: vi.fn() }, shell: {}, nativeImage: {},
  };
});
let temp: string;
beforeEach(async () => {
  vi.resetModules(); native.windows.length = 0; native.children.length = 0; native.ports.length = 0; native.requests.length = 0; native.handlers.clear();
  native.respond = true; native.quitCompletions = 0; native.showMessageBox.mockReset().mockResolvedValue({ response: 0 });
  temp = await mkdtemp(path.join(tmpdir(), "moco-main-")); native.dataDir = temp; native.projectsDir = path.join(temp, "projects");
  vi.stubEnv("MOCO_USER_DATA", temp); vi.stubEnv("MOCO_PROJECTS_DIR", native.projectsDir);
});
afterEach(async () => {
  native.app.removeAllListeners(); native.theme.removeAllListeners();
  for (const window of native.windows) window.removeAllListeners();
  vi.unstubAllEnvs(); await rm(temp, { recursive: true, force: true });
});
async function launch() {
  await import("../src/main/index.ts");
  await vi.waitFor(() => expect(native.windows).toHaveLength(1));
  return native.windows[0]!;
}
async function status(window: FakeWindow) {
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame } as unknown as IpcMainInvokeEvent;
  return native.handlers.get("moco:status")!(event, "codex");
}
function update(state: "running" | "waiting" | "idle") { native.ports.at(-1)!.emit("message", { data: { update: { projectId: "project", state } } }); }
it("creates secure themed chrome, restores window state and persists it on a clean quit without prompting", async () => {
  const state = { bounds: { x: 120, y: 60, width: 1200, height: 800 }, maximized: true };
  await writeFile(path.join(temp, "window.json"), JSON.stringify(state));
  const window = await launch();
  expect(window.options).toMatchObject({ ...state.bounds, minWidth: 960, minHeight: 640, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  if (process.platform === "win32") expect(window.options).toMatchObject({ titleBarStyle: "hidden", titleBarOverlay: { height: 48 } });
  native.theme.shouldUseDarkColors = true; native.theme.emit("updated");
  expect(window.setBackgroundColor).toHaveBeenCalledWith("#0f0f11");
  if (process.platform === "win32") expect(window.setTitleBarOverlay).toHaveBeenCalledWith({ color: "#18181b", symbolColor: "#fafafa", height: 48 });
  await status(window); native.app.quit();
  await vi.waitFor(() => expect(native.quitCompletions).toBe(1));
  expect(native.showMessageBox).not.toHaveBeenCalled();
  expect(native.requests.some(request => request.method === "shutdown")).toBe(true);
  expect(JSON.parse(await readFile(path.join(temp, "window.json"), "utf8"))).toEqual(state);
});
it("defaults to Keep working and quits only after the user confirms an active window close", async () => {
  const window = await launch(); await status(window); update("running");
  window.close();
  await vi.waitFor(() => expect(native.showMessageBox).toHaveBeenCalledOnce());
  expect(native.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({ message: "Moco is still working on 1 project. Quit anyway?", buttons: ["Keep working", "Quit anyway"], defaultId: 0, cancelId: 0 }));
  await new Promise(resolve => setImmediate(resolve));
  expect(native.quitCompletions).toBe(0);
  update("waiting"); native.showMessageBox.mockResolvedValue({ response: 1 }); window.close();
  await vi.waitFor(() => expect(native.quitCompletions).toBe(1));
  expect(native.children[0]!.kill).toHaveBeenCalled();
});
it("rejects pending calls after utility exit, clears tracked work and restarts on the next call", async () => {
  const window = await launch(); await status(window); update("running");
  native.respond = false;
  const pending = Promise.resolve(status(window));
  const rejected = expect(pending).rejects.toThrow("Agent process exited");
  native.children[0]!.emit("exit", 9); await rejected;
  // Already queued messages from the dead process cannot restore stale run states.
  native.ports[0]!.emit("message", { data: { update: { projectId: "project", state: "running" } } });
  expect(window.webContents.send).toHaveBeenCalledWith("moco:update", expect.objectContaining({ error: expect.stringContaining("agent process stopped") }));
  native.respond = true; expect(await status(window)).toEqual({ ok: true });
  expect(native.children).toHaveLength(2);
  native.app.quit(); await vi.waitFor(() => expect(native.quitCompletions).toBe(1));
  expect(native.showMessageBox).not.toHaveBeenCalled();
});
it("keeps the five-second fallback when a host cannot shut down", async () => {
  const window = await launch(); await status(window);
  native.respond = false;
  vi.useFakeTimers();
  try {
    native.app.quit();
    await vi.advanceTimersByTimeAsync(5000);
    expect(native.children[0]!.kill).toHaveBeenCalled();
    expect(native.quitCompletions).toBeGreaterThan(0);
  } finally { vi.useRealTimers(); }
  // The fake application does not actually exit: let its outstanding disk write finish.
  await vi.waitFor(async () => expect(JSON.parse(await readFile(path.join(temp, "window.json"), "utf8"))).toMatchObject({ maximized: false }));
});
