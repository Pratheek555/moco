import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppCommand, MocoAPI, Update } from "../shared/api.ts";
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`moco:${channel}`, ...args);
function filePath(file: File): string {
  const path = webUtils.getPathForFile(file);
  if (!path) throw new Error("This file has no path on your computer. Paste image data or choose a file instead.");
  return path;
}
const api: MocoAPI = {
  setTheme: theme => invoke("set-theme", theme),
  setNotifications: enabled => invoke("set-notifications", enabled),
  narrationStatus: () => invoke("narration-status"),
  setGeminiKey: key => invoke("set-gemini-key", key),
  clearGeminiKey: () => invoke("clear-gemini-key"),
  setGeminiVoice: voice => invoke("set-gemini-voice", voice),
  checkGeminiKey: key => invoke("check-gemini-key", key),
  openExternal: url => invoke("open-external", url),
  openProjectsFolder: () => invoke("open-projects-folder"),
  copyText: text => invoke("copy-text", text),
  info: () => invoke("info"), status: provider => invoke("status", provider), skills: () => invoke("skills"),
  importSkill: kind => invoke("import-skill", kind),
  importSkillDropped: async file => invoke("import-skill-dropped", filePath(file)),
  deleteSkill: id => invoke("delete-skill", id),
  starterSkills: () => invoke("starter-skills"), addStarterSkill: name => invoke("add-starter-skill", name),
  projects: () => invoke("projects"), projectStates: () => invoke("project-states"),
  create: (name, skill, provider, narrationEngine) => invoke("create", name, skill, provider, narrationEngine), project: id => invoke("project", id),
  setNarrationEngine: (id, engine) => invoke("set-narration-engine", id, engine),
  renameProject: (id, name) => invoke("rename-project", id, name),
  deleteProject: (id, removeFiles) => invoke("delete-project", id, removeFiles),
  send: (id, text, files) => invoke("send", id, text, files),
  answer: (id, question, answers) => invoke("answer", id, question, answers),
  stop: id => invoke("stop", id), attach: id => invoke("attach", id), files: id => invoke("files", id),
  attachDropped: async (id, files) => {
    if (!Array.isArray(files) || !files.length) throw new Error("Drop at least one file to attach.");
    return invoke("attach-dropped", id, files.map(filePath));
  },
  attachPasted: async (id, name, data) => {
    if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > 100 * 1024 * 1024) throw new Error("Paste a file between 1 byte and 100 MB.");
    return invoke("attach-pasted", id, name, data);
  },
  openFile: (id, relative, reveal) => invoke("open-file", id, relative, reveal),
  openWorkspace: id => invoke("open-workspace", id),
  saveFileAs: (id, relative) => invoke("save-file-as", id, relative),
  readTextFile: (id, relative) => invoke("read-text-file", id, relative),
  dragFile: (id, relative) => { ipcRenderer.send("moco:drag-file", id, relative); },
  onCommand(listener) {
    if (typeof listener !== "function") throw new Error("Expected a command listener.");
    const handler = (_: Electron.IpcRendererEvent, command: AppCommand) => listener(command);
    ipcRenderer.on("moco:command", handler);
    return () => { ipcRenderer.removeListener("moco:command", handler); };
  },
  onUpdate(listener) {
    if (typeof listener !== "function") throw new Error("Expected an update listener.");
    const handler = (_: Electron.IpcRendererEvent, update: Update) => listener(update);
    ipcRenderer.on("moco:update", handler);
    return () => { ipcRenderer.removeListener("moco:update", handler); };
  },
};
contextBridge.exposeInMainWorld("moco", api);
