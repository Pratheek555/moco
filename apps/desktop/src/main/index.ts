import { claudeCli } from "@moco/ai";
import { systemAudio, systemVoices } from "@moco/audio";
import type { Engine, EngineEvent, SeriesStatus } from "@moco/engine";
import { createEngineClient, EngineClientError } from "@moco/engine/client";
import { catalog } from "@moco/kit";
import type { SeriesBible, SeriesPlan } from "@moco/spec";
import {
  BrowserWindow,
  MessageChannelMain,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DeepPartial,
  EpisodeMedia,
  Settings,
  SeriesSummary,
} from "../shared/api.ts";
import { assetUrl } from "../shared/api.ts";
import { handleAssetProtocol, registerAssetScheme } from "./assets.ts";
import type { EngineHostConfig } from "./engine-host.ts";
import { loadSettings, saveSettings } from "./settings.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// Isolated workspaces for desktop integration tests and portable launches.
if (process.env.MOCO_USER_DATA)
  app.setPath("userData", path.resolve(process.env.MOCO_USER_DATA));
registerAssetScheme();

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let settings: Settings;

const send = (channel: string, payload: unknown) =>
  win?.webContents.send(`moco:${channel}`, payload);
const previewsDir = () => path.join(app.getPath("userData"), "previews");

function isDark() {
  return (
    settings.theme === "dark" ||
    (settings.theme === "system" && nativeTheme.shouldUseDarkColors)
  );
}

function applyChrome() {
  nativeTheme.themeSource = settings.theme;
  if (!win) return;
  const dark = isDark();
  win.setBackgroundColor(dark ? "#0f0f11" : "#f7f7f8");
  if (process.platform !== "darwin")
    win.setTitleBarOverlay?.({
      color: dark ? "#0f0f11" : "#f7f7f8",
      symbolColor: dark ? "#d4d4d8" : "#3f3f46",
      height: 44,
    });
}

function createWindow() {
  const dark = isDark();
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: "Moco",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(app.getAppPath(), "resources", "icon.png"),
    backgroundColor: dark ? "#0f0f11" : "#f7f7f8",
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : {
          titleBarOverlay: {
            color: dark ? "#0f0f11" : "#f7f7f8",
            symbolColor: dark ? "#d4d4d8" : "#3f3f46",
            height: 44,
          },
        }),
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "file:"))
      e.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(here, "../renderer/index.html"));
  win.on("closed", () => (win = null));
}

// ---------- the engine host ----------

// The engine runs in its own utility process (main/engine-host.ts) and is reached over a MessagePort.
// It is started again when settings it was built with change (projects folder, voice, render tabs).
let host: { process: UtilityProcess; engine: Engine } | null = null;
// Series with a job running, from the engine's job events; editing settings or deleting waits for these.
const running = new Set<string>();

function startEngineHost(): Engine {
  const entry = path.join(app.getAppPath(), "src", "main", "engine-host.ts");
  const child = utilityProcess.fork(entry, [], {
    serviceName: "moco-engine",
    stdio: "pipe",
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[engine] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[engine] ${chunk}`));

  const { port1, port2 } = new MessageChannelMain();
  const config: EngineHostConfig = {
    projectsDir: settings.projectsDir,
    voice: { ...settings.voice },
    concurrency: settings.render.concurrency || null,
  };
  child.postMessage(config, [port1]);
  port2.start();

  const engine = createEngineClient(port2);
  engine.on("*", (event) => onEngineEvent(event));
  // shortcut: calls in flight when the host dies never settle; add a reject-all to the client if crashes show up.
  child.on("exit", (code) => {
    if (host?.process !== child) return; // stopped on purpose
    host = null;
    running.clear();
    send("engine", {
      type: "host.exited",
      seriesId: "",
      at: new Date().toISOString(),
      data: { code },
    });
  });
  host = { process: child, engine };
  return engine;
}

const engine = () => host?.engine ?? startEngineHost();

function stopEngineHost() {
  const old = host;
  host = null;
  old?.process.kill();
}

function onEngineEvent(event: EngineEvent) {
  if (event.type === "job.started") running.add(event.seriesId);
  if (event.type === "job.finished") running.delete(event.seriesId);
  send("engine", event);
  if (event.type.startsWith("stage.") || event.type.startsWith("job."))
    send("library", { seriesId: event.seriesId });
}

// An artifact's { meta, data }, or null when the stage that makes it hasn't run yet.
async function artifact<T>(
  seriesId: string,
  file: string,
): Promise<{ meta: { revision: number; contentHash: string }; data: T } | null> {
  try {
    return (await engine().readArtifact({ seriesId, file })) as {
      meta: { revision: number; contentHash: string };
      data: T;
    };
  } catch (err) {
    if (err instanceof EngineClientError && err.code === "not_found") return null;
    throw err;
  }
}

async function summarize(id: string): Promise<SeriesSummary> {
  const status: SeriesStatus = await engine().status(id);
  const plan = await artifact<SeriesPlan>(id, "artifacts/series_plan.json");
  const bible = await artifact<SeriesBible>(id, "artifacts/bible.json");
  const finals = status.stages.filter(
    (stage) => stage.key.endsWith("/final") && stage.status === "done",
  ).length;
  return {
    id,
    title: plan?.data.title ?? status.series.idea,
    premise: plan?.data.premise ?? "",
    language: status.series.language,
    episodes: status.series.episodes,
    createdAt: status.series.createdAt,
    cast: (bible?.data.cast ?? []).map((member) => member.kitCharacterId),
    finals,
    next: status.next,
    running: status.activeJob !== undefined,
  };
}

// Series and episode ids come from the UI: only plain slugs, so a path can never leave the projects folder.
function safeId(id: string, what: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Error(`invalid ${what}`);
  return id;
}

// A file's moco-asset:// URL with its change time, so a re-render isn't served from cache.
async function versionedUrl(absolute: string): Promise<string> {
  const info = await stat(absolute);
  const relative = path.relative(settings.projectsDir, absolute);
  return `${assetUrl(relative)}?v=${Math.round(info.mtimeMs)}`;
}

async function episodeMedia(
  seriesId: string,
  episodeId: string,
): Promise<EpisodeMedia> {
  const dir = path.join(
    settings.projectsDir,
    safeId(seriesId, "series id"),
    "episodes",
    safeId(episodeId, "episode id"),
  );
  const preview = path.join(dir, "renders", "preview.mp4");
  const final = path.join(dir, "renders", "final.mp4");
  const shotsDir = path.join(dir, "shots");
  const shotIds = existsSync(shotsDir) ? await readdir(shotsDir) : [];

  const stills: Record<string, string[]> = {};
  for (const shotId of shotIds) {
    stills[shotId] = await stillUrls(path.join(shotsDir, shotId, "stills"));
  }
  return {
    preview: existsSync(preview) ? await versionedUrl(preview) : undefined,
    final: existsSync(final) ? await versionedUrl(final) : undefined,
    finalPath: existsSync(final) ? final : undefined,
    stills,
  };
}

async function stillUrls(stillsDir: string): Promise<string[]> {
  if (!existsSync(stillsDir)) return [];
  const names = (await readdir(stillsDir)).filter((name) => name.endsWith(".png")).sort();
  return Promise.all(names.map((name) => versionedUrl(path.join(stillsDir, name))));
}

// ---------- app ----------

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app
  .whenReady()
  .then(async () => {
    settings = await loadSettings();
    await mkdir(settings.projectsDir, { recursive: true });
    await mkdir(previewsDir(), { recursive: true });

    handleAssetProtocol(() => ({
      projects: settings.projectsDir,
      previews: previewsDir(),
    }));

    const handle = <A extends unknown[], R>(
      name: string,
      fn: (...args: A) => Promise<R> | R,
    ) => ipcMain.handle(`moco:${name}`, (_e, ...args) => fn(...(args as A)));

    handle("app.info", () => ({
      version: app.getVersion(),
      userData: app.getPath("userData"),
      projectsDir: settings.projectsDir,
    }));
    handle("app.openPath", async (p: string) => {
      const error = await shell.openPath(p);
      if (error) throw new Error(error);
      return "";
    });
    handle("app.showItem", (p: string) => shell.showItemInFolder(p));
    handle("app.openExternal", (url: string) =>
      /^https?:/.test(url) ? shell.openExternal(url) : undefined,
    );
    handle("app.chooseFolder", async () => {
      const r = await dialog.showOpenDialog(win!, {
        properties: ["openDirectory", "createDirectory"],
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    });

    handle("settings.get", () => settings);
    handle("settings.set", async (patch: DeepPartial<Settings>) => {
      // The engine is built with these, so changing them restarts it, which would cut a running job short.
      const engineInputs = (s: Settings) => JSON.stringify([s.projectsDir, s.voice, s.render]);
      const touchesEngine = patch.projectsDir !== undefined || patch.voice !== undefined || patch.render !== undefined;
      if (touchesEngine && running.size > 0)
        throw new Error("Wait for the running jobs to finish before changing these settings");
      const before = engineInputs(settings);
      settings = await saveSettings(patch);
      if (engineInputs(settings) !== before) {
        await mkdir(settings.projectsDir, { recursive: true });
        stopEngineHost(); // the next call starts a fresh one
        send("library", {});
      }
      applyChrome();
      send("settings", settings);
      return settings;
    });

    handle("ai.status", () => claudeCli().available());

    handle("voice.list", () => systemVoices().catch(() => []));
    handle("voice.preview", async (text: string) => {
      try {
        const dir = path.join(previewsDir(), String(Date.now()));
        const spoken = await systemAudio(settings.voice).tts(
          [{ id: "preview", text: text.slice(0, 400) }],
          { voiceId: settings.voice.voice, backend: "system" },
          settings.defaults.language,
          dir,
        );
        return { url: `moco-asset://previews/${path.basename(dir)}/${path.basename(spoken.file)}` };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    handle("kit.catalog", () => catalog);

    handle("series.list", async () => {
      const infos = await engine().listSeries();
      const summaries = await Promise.all(infos.map((info) => summarize(info.id)));
      return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    handle(
      "series.create",
      async (input: { idea: string; language: string; episodes: number }) => {
        const id = await engine().createSeries(input);
        await engine().runStage({ seriesId: id });
        send("library", { seriesId: id });
        return id;
      },
    );
    handle("series.status", (id: string) => engine().status(id));
    handle("series.artifact", (seriesId: string, file: string) =>
      artifact(seriesId, file),
    );
    handle("series.remove", async (id: string) => {
      if (running.has(id)) throw new Error("Wait for this series’ job to finish");
      await rm(path.join(settings.projectsDir, safeId(id, "series id")), {
        recursive: true,
        force: true,
      });
      stopEngineHost(); // the engine keeps open series in memory; the next call starts a fresh one
      send("library", {});
    });

    handle("stages.run", (seriesId: string, key?: string) =>
      engine().runStage({ seriesId, key }),
    );
    handle("stages.approve", (seriesId: string, key: string, hash: string) =>
      engine().approve({ seriesId, key }, hash),
    );
    handle("stages.reject", (seriesId: string, key: string, feedback: string) =>
      engine().reject({ seriesId, key }, feedback),
    );
    handle("stages.cancel", (jobId: string) => engine().cancel(jobId));

    handle("episode.media", (seriesId: string, episodeId: string) =>
      episodeMedia(seriesId, episodeId),
    );
    handle(
      "episode.regenerateShot",
      (seriesId: string, episodeId: string, shotId: string, feedback?: string) =>
        engine().regenerateShot({ seriesId, episodeId, shotId }, feedback),
    );

    nativeTheme.on("updated", () => {
      applyChrome();
      send("settings", settings);
    });
    applyChrome();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    app.on("before-quit", () => stopEngineHost());
  })
  .catch((err) => {
    dialog.showErrorBox(
      "Moco could not start",
      err instanceof Error ? err.message : String(err),
    );
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
