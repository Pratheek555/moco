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
  ai: { status: call("ai.status") } as MocoApi["ai"],
  voice: {
    list: call("voice.list"),
    preview: call("voice.preview"),
  } as MocoApi["voice"],
  kit: { catalog: call("kit.catalog") } as MocoApi["kit"],
  series: {
    list: call("series.list"),
    create: call("series.create"),
    status: call("series.status"),
    artifact: call("series.artifact"),
    remove: call("series.remove"),
  } as MocoApi["series"],
  stages: {
    run: call("stages.run"),
    approve: call("stages.approve"),
    reject: call("stages.reject"),
    cancel: call("stages.cancel"),
  } as MocoApi["stages"],
  episode: {
    media: call("episode.media"),
    regenerateShot: call("episode.regenerateShot"),
  } as MocoApi["episode"],
  on(channel, cb) {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload);
    ipcRenderer.on(`moco:${channel}`, listener);
    return () => ipcRenderer.removeListener(`moco:${channel}`, listener);
  },
};

contextBridge.exposeInMainWorld("moco", api);
