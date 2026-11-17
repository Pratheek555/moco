import { beforeEach, expect, it, vi } from "vitest";
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from "electron";
import { RunNotifications } from "../src/main/run-notifications.ts";
import { contextMenuItems, installMenu } from "../src/main/menus.ts";
const native = vi.hoisted(() => ({ notices: [] as { title: string; show: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; emit(event: string): boolean }[], supported: true,
  app: { name: "Moco", isPackaged: false }, buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn(),
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: native.app, shell: { openPath: vi.fn() },
    Menu: { buildFromTemplate: native.buildFromTemplate, setApplicationMenu: native.setApplicationMenu },
    Notification: class extends EventEmitter {
      title: string;
      static isSupported() { return native.supported; }
      show = vi.fn(); close = vi.fn(() => { this.emit("close"); });
      constructor(options: { title: string }) { super(); this.title = options.title; native.notices.push(this); }
    },
  };
});
let focused: boolean, enabled: boolean, minimized: boolean;
let command: ReturnType<typeof vi.fn>, flash: ReturnType<typeof vi.fn>, name: ReturnType<typeof vi.fn>;
let runs: RunNotifications;
beforeEach(() => {
  vi.clearAllMocks(); native.notices.length = 0; native.supported = true; native.app.isPackaged = false;
  focused = false; enabled = true; minimized = false; command = vi.fn(); flash = vi.fn(); name = vi.fn(async () => "Rome");
  const win = { isFocused: () => focused, isMinimized: () => minimized, flashFrame: flash } as unknown as BrowserWindow;
  runs = new RunNotifications({ window: () => win, enabled: () => enabled, command, projectName: name });
});
const flush = () => new Promise(resolve => setImmediate(resolve));
it("tracks active projects, notifies transitions once and sends the open-project command on click", async () => {
  runs.update({ projectId: "project", state: "running" }); expect(runs.activeCount).toBe(1);
  runs.update({ projectId: "project", state: "waiting" }); await flush();
  expect(native.notices.map(note => note.title)).toEqual(["Rome needs your answer"]);
  native.notices[0]!.emit("click"); expect(command).toHaveBeenCalledWith({ type: "open-project", projectId: "project" });
  if (process.platform === "win32") expect(flash).toHaveBeenCalledWith(true);
  runs.update({ projectId: "project", state: "waiting" }); await flush(); expect(native.notices).toHaveLength(1);
  runs.update({ projectId: "project", state: "running" }); runs.update({ projectId: "project", state: "idle" }); await flush();
  runs.update({ projectId: "project", state: "error" }); await flush();
  expect(native.notices.map(note => note.title)).toEqual(["Rome needs your answer", "Rome is ready", "Rome stopped with an error"]);
  expect(runs.activeCount).toBe(0);
});
it("does not notify in the foreground, when disabled, or for stale transitions", async () => {
  focused = true;
  runs.update({ projectId: "a", state: "running" }); runs.update({ projectId: "a", state: "idle" });
  focused = false; enabled = false;
  runs.update({ projectId: "b", state: "running" }); runs.update({ projectId: "b", state: "waiting" });
  enabled = true;
  runs.update({ projectId: "c", state: "running" }); runs.update({ projectId: "c", state: "waiting" }); runs.update({ projectId: "c", state: "running" });
  await flush(); expect(native.notices).toEqual([]);
  minimized = true; focused = true;
  runs.update({ projectId: "c", state: "error" }); await flush(); expect(native.notices[0]!.title).toBe("Rome stopped with an error");
});
it("clears tracked states and old notifications after a host exit or project removal", async () => {
  runs.update({ projectId: "a", state: "running" }); runs.update({ projectId: "a", state: "waiting" }); await flush();
  runs.forget("a"); expect(runs.activeCount).toBe(0); expect(native.notices[0]!.close).toHaveBeenCalledOnce();
  runs.update({ projectId: "b", state: "running" }); runs.update({ projectId: "b", state: "waiting" }); await flush();
  runs.clear(); expect(runs.activeCount).toBe(0); expect(native.notices[1]!.close).toHaveBeenCalledOnce();
});
it("cancels in-flight ready notifications on host exit and project removal", async () => {
  for (const cancel of [() => runs.clear(), () => runs.forget("project")]) {
    runs.update({ projectId: "project", state: "running" }); runs.update({ projectId: "project", state: "idle" });
    cancel(); await flush();
  }
  expect(native.notices).toEqual([]);
});
it("builds real edit roles and spelling suggestions only where a context menu is useful", () => {
  const replace = vi.fn(), add = vi.fn();
  const win = { webContents: { replaceMisspelling: replace, session: { addWordToSpellCheckerDictionary: add } } } as unknown as BrowserWindow;
  const params = { isEditable: false, selectionText: "", dictionarySuggestions: [], editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } as unknown as ContextMenuParams;
  expect(contextMenuItems(win, params)).toEqual([]);
  expect(contextMenuItems(win, { ...params, selectionText: "Selected" })).toEqual([{ role: "copy" }]);
  const items = contextMenuItems(win, { ...params, isEditable: true, misspelledWord: "teh", dictionarySuggestions: ["the"] });
  expect(items.map(item => item.role).filter(Boolean)).toEqual(["cut", "copy", "paste", "selectAll"]);
  (items[0]!.click as () => void)(); expect(replace).toHaveBeenCalledWith("the");
  (items[1]!.click as () => void)(); expect(add).toHaveBeenCalledWith("teh");
});
it("keeps menu accelerators and native roles, and omits reload/devtools when packaged", () => {
  const commands = vi.fn(); installMenu(commands, () => "projects");
  const template = native.buildFromTemplate.mock.calls[0]![0] as MenuItemConstructorOptions[];
  const items = template.flatMap(item => Array.isArray(item.submenu) ? item.submenu : []);
  const create = items.find(item => item.accelerator === "CmdOrCtrl+N")!;
  (create.click as () => void)(); expect(commands).toHaveBeenCalledWith({ type: "new-project" });
  const settings = items.find(item => item.accelerator === "CmdOrCtrl+,")!;
  (settings.click as () => void)(); expect(commands).toHaveBeenCalledWith({ type: "settings" });
  expect(items.map(item => item.role)).toEqual(expect.arrayContaining(["undo", "redo", "cut", "copy", "paste", "selectAll", "zoomIn", "zoomOut", "resetZoom", "togglefullscreen", "reload", "toggleDevTools"]));
  native.app.isPackaged = true; installMenu(commands, () => "projects");
  const packaged = native.buildFromTemplate.mock.calls[1]![0] as MenuItemConstructorOptions[];
  expect(packaged.flatMap(item => Array.isArray(item.submenu) ? item.submenu.map(child => child.role) : [])).not.toEqual(expect.arrayContaining(["reload", "toggleDevTools"]));
});
