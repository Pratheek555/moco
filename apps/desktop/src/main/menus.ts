import { Menu, app, shell } from "electron";
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from "electron";
import { mkdir } from "node:fs/promises";
import type { AppCommand } from "../shared/api.ts";

export function installMenu(command: (command: AppCommand) => void, projectsDir: () => string): void {
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin") template.push({ label: app.name, submenu: [
    { role: "about" }, { type: "separator" },
    { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => command({ type: "settings" }) },
    { type: "separator" }, { role: "services" }, { type: "separator" },
    { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" },
  ] });
  template.push({ label: "File", submenu: [
    { label: "New Project", accelerator: "CmdOrCtrl+N", click: () => command({ type: "new-project" }) },
    ...(process.platform === "darwin" ? [] : [{ label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => command({ type: "settings" }) } satisfies MenuItemConstructorOptions]),
    { label: "Open Projects Folder", click: () => {
      void mkdir(projectsDir(), { recursive: true }).then(() => shell.openPath(projectsDir())).catch(error => console.error("Could not open projects folder:", error));
    } },
    { type: "separator" }, { role: process.platform === "darwin" ? "close" : "quit" },
  ] }, { label: "Edit", submenu: [
    { role: "undo" }, { role: "redo" }, { type: "separator" },
    { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
  ] }, { label: "View", submenu: [
    ...(!app.isPackaged ? [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }] as MenuItemConstructorOptions[] : []),
    { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
  ] }, { role: "windowMenu" });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function contextMenuItems(win: BrowserWindow, params: ContextMenuParams): MenuItemConstructorOptions[] {
  if (!params.isEditable) return params.selectionText ? [{ role: "copy" }] : [];
  const suggestions: MenuItemConstructorOptions[] = params.dictionarySuggestions.map(word => ({ label: word, click: () => win.webContents.replaceMisspelling(word) }));
  if (params.misspelledWord) {
    if (!suggestions.length) suggestions.push({ label: "No spelling suggestions", enabled: false });
    suggestions.push({ label: "Add to dictionary", click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
    suggestions.push({ type: "separator" });
  }
  return [...suggestions,
    { role: "cut", enabled: params.editFlags.canCut }, { role: "copy", enabled: params.editFlags.canCopy },
    { role: "paste", enabled: params.editFlags.canPaste }, { role: "selectAll", enabled: params.editFlags.canSelectAll },
  ];
}
export function installContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_event, params) => {
    const items = contextMenuItems(win, params);
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}
