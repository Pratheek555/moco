import { contextBridge, ipcRenderer } from "electron";
import type { MocoAPI, Update } from "../shared/api.ts";
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`moco:${channel}`, ...args);
const api: MocoAPI = {
  setTheme: theme => invoke("set-theme", theme),
  info: () => invoke("info"), status: provider => invoke("status", provider), skills: () => invoke("skills"),
  importSkill: kind => invoke("import-skill", kind), projects: () => invoke("projects"),
  create: (name, skill, provider) => invoke("create", name, skill, provider), project: id => invoke("project", id),
  send: (id, text, files) => invoke("send", id, text, files),
  answer: (id, question, answers) => invoke("answer", id, question, answers),
  stop: id => invoke("stop", id), attach: id => invoke("attach", id), files: id => invoke("files", id),
  openFile: (id, relative, reveal) => invoke("open-file", id, relative, reveal),
  openWorkspace: id => invoke("open-workspace", id),
  onUpdate(listener) {
    const handler = (_: Electron.IpcRendererEvent, update: Update) => listener(update);
    ipcRenderer.on("moco:update", handler);
    return () => { ipcRenderer.removeListener("moco:update", handler); };
  },
};
contextBridge.exposeInMainWorld("moco", api);
