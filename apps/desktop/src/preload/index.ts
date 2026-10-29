import { contextBridge, ipcRenderer } from "electron";
import type { MocoApi } from "../shared/api.ts";

const call =
  (name: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`moco:${name}`, ...args);

const api: MocoApi = {
  platform: process.platform,
  app: {
    info: call("app.info"),
    openPath: call("app.openPath"),
    showItem: call("app.showItem"),
    openExternal: call("app.openExternal"),
    chooseFolder: call("app.chooseFolder"),
  } as MocoApi["app"],
  settings: {
    get: call("settings.get"),
    set: call("settings.set"),
  } as MocoApi["settings"],
  ai: { detect: call("ai.detect"), test: call("ai.test") } as MocoApi["ai"],
  voice: {
    list: call("voice.list"),
    preview: call("voice.preview"),
  } as MocoApi["voice"],
  series: {
    list: call("series.list"),
    get: call("series.get"),
    save: call("series.save"),
    remove: call("series.remove"),
    demo: call("series.demo"),
  } as MocoApi["series"],
  episode: {
    get: call("episode.get"),
    save: call("episode.save"),
  } as MocoApi["episode"],
  jobs: {
    start: call("jobs.start"),
    cancel: call("jobs.cancel"),
    list: call("jobs.list"),
    clear: call("jobs.clear"),
  } as MocoApi["jobs"],
  render: {
    status: call("render.status"),
    prepare: call("render.prepare"),
  } as MocoApi["render"],
  assets: { sfx: call("assets.sfx") } as MocoApi["assets"],
  on(channel, cb) {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload);
    ipcRenderer.on(`moco:${channel}`, listener);
    return () => ipcRenderer.removeListener(`moco:${channel}`, listener);
  },
};

contextBridge.exposeInMainWorld("moco", api);
