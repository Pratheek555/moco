import { createProvider } from "@moco/ai";
import { detectClis } from "@moco/ai";
import { listVoices, synthesize } from "@moco/audio";
import { createEngine, createStore, pad, semanticIssues } from "@moco/engine";
import {
  EpisodeSchema,
  SeriesSchema,
  type Episode,
  type Series,
} from "@moco/spec";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DeepPartial,
  EpisodeBundle,
  Job,
  RenderEngineStatus,
  Settings,
} from "../shared/api.ts";
import {
  handleAssetProtocol,
  registerAssetScheme,
  startFileServer,
} from "./assets.ts";
import { createJobManager } from "./jobs.ts";
import { createPipelines } from "./pipeline.ts";
import { createRenderService } from "./render.ts";
import { loadSettings, saveSettings } from "./settings.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// Isolated workspaces for desktop integration tests and portable launches.
if (process.env.MOCO_USER_DATA)
  app.setPath("userData", path.resolve(process.env.MOCO_USER_DATA));
registerAssetScheme();

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let settings: Settings;
let fileServerUrl = "";

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

    // The engine is stateless apart from its config, so rebuild it when settings change.
    const makeEngine = () =>
      createEngine({
        store: createStore(settings.projectsDir),
        ai: () =>
          createProvider({
            provider: settings.ai.provider,
            model: settings.ai.model,
            anthropicKey: settings.ai.anthropicKey,
            openaiKey: settings.ai.openaiKey,
            effort: settings.ai.effort,
          }),
        brand: () => ({ ...settings.brand }),
        maxRepairs: settings.ai.maxRepairs,
      });
    let engine = makeEngine();

    const roots = () => ({
      projects: settings.projectsDir,
      sfx: path.join(settings.projectsDir, ".cache", "sfx"),
      previews: previewsDir(),
    });
    handleAssetProtocol(roots);
    const server = await startFileServer(roots);
    fileServerUrl = server.url;

    const jobs = createJobManager((list: Job[]) => send("jobs", list));
    const renderer = createRenderService(
      path.join(here, "render-worker.js"),
      (s: RenderEngineStatus) => send("engine", s),
    );
    const pipelines = createPipelines({
      engine: () => engine,
      jobs,
      render: renderer,
      settings: () => settings,
      fileServer: () => fileServerUrl,
      changed: (seriesId, number) => send("library", { seriesId, number }),
    });

    // First launch: seed the demo series so there's something to play.
    if (!(await readdir(settings.projectsDir)).some((d) => !d.startsWith(".")))
      await engine.createDemo().catch(() => undefined);

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
      if (
        patch.projectsDir &&
        patch.projectsDir !== settings.projectsDir &&
        jobs.list().some((j) => j.status === "running" || j.status === "queued")
      )
        throw new Error(
          "Wait for current jobs to finish before switching project folders",
        );
      const before = settings.projectsDir;
      settings = await saveSettings(patch);
      if (settings.projectsDir !== before)
        await mkdir(settings.projectsDir, { recursive: true });
      engine = makeEngine();
      if (settings.projectsDir !== before) send("library", {});
      applyChrome();
      send("settings", settings);
      return settings;
    });

    handle("ai.detect", () => detectClis());
    handle("ai.test", async () => {
      const started = Date.now();
      try {
        const ai = createProvider({
          provider: settings.ai.provider,
          model: settings.ai.model,
          anthropicKey: settings.ai.anthropicKey,
          openaiKey: settings.ai.openaiKey,
          effort: "low",
        });
        const res = await ai.complete({
          system: "You are a connectivity check. Reply with exactly: OK",
          prompt: "Reply with OK.",
          timeoutMs: 180_000,
        });
        return {
          ok: /ok/i.test(res.text),
          reply: res.text.trim().slice(0, 200),
          ms: Date.now() - started,
          model: res.model,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          ms: Date.now() - started,
        };
      }
    });

    handle("voice.list", (provider: Settings["voice"]["provider"]) =>
      listVoices(
        provider,
        provider === "elevenlabs" ? settings.voice.elevenlabsKey : undefined,
      ).catch(() => []),
    );
    handle("voice.preview", async (text: string) => {
      try {
        const v = settings.voice;
        const r = await synthesize(v.provider, {
          text,
          voice: v.voice || undefined,
          rate: v.rate,
          apiKey:
            v.provider === "elevenlabs"
              ? v.elevenlabsKey
              : settings.ai.openaiKey,
        });
        const name = `preview-${Date.now()}${r.ext}`;
        await writeFile(path.join(previewsDir(), name), r.audio);
        return {
          url: `moco-asset://previews/${name}`,
          provider: r.provider,
          fallbackReason: r.fallbackReason,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    handle("series.list", () => engine.store.listSeries());
    handle("series.get", async (id: string) => {
      const series = await engine.store.getSeries(id);
      return { series, summary: await engine.store.summarize(series) };
    });
    handle("series.save", async (series: Series) => {
      if (jobs.isBusy(series.id))
        throw new Error(
          "Wait for jobs on this series to finish before editing it",
        );
      const parsed = SeriesSchema.parse(series);
      await engine.store.saveSeries(parsed);
      send("library", { seriesId: parsed.id });
      return parsed;
    });
    handle("series.remove", async (id: string) => {
      if (jobs.isBusy(id))
        throw new Error("Wait for running jobs on this series to finish");
      await engine.store.deleteSeries(id);
      send("library", {});
    });
    handle("series.demo", async () => {
      const s = await engine.createDemo();
      send("library", { seriesId: s.id });
      return s;
    });

    handle(
      "episode.get",
      async (
        seriesId: string,
        number: number,
      ): Promise<EpisodeBundle | null> => {
        const episode = await engine.store.getEpisode(seriesId, number);
        if (!episode) return null;
        const renders = (await engine.store.renders(seriesId, number)).map(
          (r) => ({
            ...r,
            url: `moco-asset://projects/${encodeURIComponent(seriesId)}/episodes/${pad(number)}/renders/${encodeURIComponent(r.file)}`,
          }),
        );
        return {
          episode,
          renders,
          assetBase: `moco-asset://projects/${encodeURIComponent(seriesId)}/episodes/${pad(number)}/`,
        };
      },
    );
    handle("episode.save", async (seriesId: string, episode: Episode) => {
      if (jobs.isBusy(seriesId, episode.number))
        throw new Error(
          "Wait for this episode’s job to finish before editing it",
        );
      const parsed = EpisodeSchema.safeParse(episode);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("\n"),
        );
      await engine.store.saveEpisode(seriesId, parsed.data);
      send("library", { seriesId, number: parsed.data.number });
      const issues = parsed.data.shots.flatMap((s, i) =>
        semanticIssues(s, `shots[${i}]`),
      );
      return { episode: parsed.data, issues };
    });

    handle("jobs.start", (spec) =>
      pipelines.start(spec as Parameters<typeof pipelines.start>[0]),
    );
    handle("jobs.cancel", (id: string) => jobs.cancel(id));
    handle("jobs.list", () => jobs.list());
    handle("jobs.clear", () => jobs.clear());

    handle("render.status", () => renderer.status());
    handle("render.prepare", () => renderer.prepare());

    handle("assets.sfx", async () => {
      const files = await engine.ensureSfx();
      return Object.fromEntries(
        Object.entries(files).map(([id, f]) => [
          id,
          `moco-asset://sfx/${encodeURIComponent(path.basename(f))}`,
        ]),
      );
    });

    nativeTheme.on("updated", () => {
      applyChrome();
      send("settings", settings);
    });
    applyChrome();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    app.on("before-quit", () => {
      renderer.dispose();
      server.close();
    });
    if (!existsSync(path.join(settings.projectsDir, ".cache")))
      await mkdir(path.join(settings.projectsDir, ".cache"), {
        recursive: true,
      });
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
