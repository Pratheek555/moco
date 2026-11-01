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
    copy: call("app.copy"),
    // A drag has to start synchronously from the dragstart event, so this is a send, not an invoke.
    startDrag: (file: string) => ipcRenderer.send("moco:app.startDrag", file),
  } as MocoApi["app"],
  settings: {
    get: call("settings.get"),
    set: call("settings.set"),
  } as MocoApi["settings"],
  ai: { status: call("ai.status") } as MocoApi["ai"],
  voice: {
    list: call("voice.list"),
    models: call("voice.models"),
    download: call("voice.download"),
    cancelDownload: call("voice.cancelDownload"),
    preview: call("voice.preview"),
  } as MocoApi["voice"],
  kit: { catalog: call("kit.catalog") } as MocoApi["kit"],
  series: {
    list: call("series.list"),
    create: call("series.create"),
    extend: call("series.extend"),
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
  publish: {
    save: call("publish.save"),
    rewrite: call("publish.rewrite"),
    setThumbnail: call("publish.setThumbnail"),
    setDefaults: call("publish.setDefaults"),
    openStudio: call("publish.openStudio"),
  } as MocoApi["publish"],
  on(channel, cb) {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload);
    ipcRenderer.on(`moco:${channel}`, listener);
    return () => ipcRenderer.removeListener(`moco:${channel}`, listener);
  },
};

contextBridge.exposeInMainWorld("moco", api);
