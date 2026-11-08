import { aiBackend, createCodexAccountManager } from "@moco/ai";
import { systemVoices } from "@moco/audio";
import { narrationAudio } from "./narration.ts";
import { createVoiceModelManager, voiceRuntimePaths } from "./voice-models.ts";
import type { Engine, EngineEvent, SeriesStatus } from "@moco/engine";
import { createEngineClient, EngineClientError } from "@moco/engine/client";
import { TEMPLATES } from "@moco/engine/templates";
import { learnedTemplates } from "@moco/engine/templates/registry";
import { catalog } from "@moco/kit";
import type { PublishDefaults, PublishKit, SeriesBible, SeriesPlan, ThumbnailChoice } from "@moco/spec";
import {
  BrowserWindow,
  MessageChannelMain,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
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
  LearnJob,
  Settings,
  SeriesSummary,
} from "../shared/api.ts";
import { assetUrl } from "../shared/api.ts";
import { handleAssetProtocol, registerAssetScheme } from "./assets.ts";
import type { EngineHostConfig } from "./engine-host.ts";
import type { LearnHostInput, LearnHostMessage } from "./learn-host.ts";
import { loadSettings, saveSettings } from "./settings.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// Isolated workspaces for desktop integration tests and portable launches.
if (process.env.MOCO_USER_DATA)
  app.setPath("userData", path.resolve(process.env.MOCO_USER_DATA));
registerAssetScheme();
const voiceRuntime = voiceRuntimePaths(app.getPath("userData"), app.isPackaged
  ? path.join(process.resourcesPath, "voice-worker")
  : path.resolve(app.getAppPath(), "../../packages/audio/python"));
const voiceModels = createVoiceModelManager(voiceRuntime);

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let settings: Settings;

const send = (channel: string, payload: unknown) =>
  win?.webContents.send(`moco:${channel}`, payload);
const previewsDir = () => path.join(app.getPath("userData"), "previews");
// Styles learned from reference videos; each folder is also a template (see @moco/engine/templates/registry).
const stylesDir = () => path.join(app.getPath("userData"), "styles");

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

const iconPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(app.getAppPath(), "resources", "icon.png");

// YouTube's upload page; it opens the Studio upload dialog for whichever account is signed in.
const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";

function createWindow() {
  const dark = isDark();
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: "Moco",
    icon: iconPath(),
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
const codexAccount = createCodexAccountManager();
let pendingJobStarts = 0;
const jobStarts = new Set(["series.create", "series.extend", "stages.run", "episode.regenerateShot", "publish.rewrite", "publish.setThumbnail", "templates.learn", "templates.createSample"]);

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
    aiProvider: settings.aiProvider,
    projectsDir: settings.projectsDir,
    stylesDir: stylesDir(),
    voice: { ...settings.voice },
    voiceRuntime,
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

// ---------- learning templates from reference videos ----------

// Each run is its own utility process (main/learn-host.ts); jobs are kept for this session so the page can show them.
const learnJobs = new Map<string, { view: LearnJob; process: UtilityProcess }>();

function startLearning(input: { name: string; sources: string[]; referenceImages?: string[] }): string {
  const name = input.name.trim();
  const sources = input.sources.map((source) => source.trim()).filter(Boolean);
  if (!name) throw new Error("Give the template a name");
  if (sources.length === 0 || sources.length > 10) throw new Error("Add 1–10 video links");
  for (const source of sources) if (!/^https?:\/\//i.test(source) && !existsSync(source)) throw new Error(`Not a link or a file: ${source}`);
  if ([...learnJobs.values()].some((job) => job.view.state === "running")) throw new Error("A template is already being learned; wait for it to finish");

  const id = `learn-${Date.now().toString(36)}`;
  const child = utilityProcess.fork(path.join(app.getAppPath(), "src", "main", "learn-host.ts"), [], { serviceName: "moco-learn", stdio: "pipe" });
  const view: LearnJob = { id, name, sources, referenceImages: input.referenceImages, state: "running", step: "fetch", log: [], startedAt: new Date().toISOString() };
  learnJobs.set(id, { view, process: child });
  const note = (line: string) => {
    view.log = [...view.log, line].slice(-200);
    send("learn", view);
  };
  child.stdout?.on("data", (chunk) => process.stdout.write(`[learn] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[learn] ${chunk}`));
  child.on("message", (message: LearnHostMessage) => {
    if (message.type === "event") {
      view.step = message.step;
      note(message.message);
    } else if (message.type === "done") {
      Object.assign(view, { state: "done", step: "done", templateId: message.templateId });
      note(`Done: ${message.calls} agent calls, about $${message.costUsd.toFixed(2)} of plan usage${message.leaks ? `; ${message.leaks} phrase(s) may still echo the videos` : ""}`);
    } else {
      Object.assign(view, { state: "error", error: message.message });
      send("learn", view);
    }
  });
  child.on("exit", (code) => {
    if (view.state !== "running") return;
    Object.assign(view, { state: "error", error: `The learning process stopped (code ${code})` });
    send("learn", view);
  });
  const config: LearnHostInput = { name, sources, referenceImages: input.referenceImages, stylesDir: stylesDir(), aiProvider: settings.aiProvider };
  child.postMessage(config);
  send("learn", view);
  return id;
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
    template: status.series.template,
    createdAt: status.series.createdAt,
    cast: (bible?.data.cast ?? []).map((member) => member.kitCharacterId),
    finals,
    next: status.next,
    running: status.activeJob !== undefined,
    usage: status.usage,
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
  const thumbnail = path.join(dir, "renders", "thumbnail.jpg");
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
    thumbnail: existsSync(thumbnail) ? await versionedUrl(thumbnail) : undefined,
    thumbnailPath: existsSync(thumbnail) ? thumbnail : undefined,
    stills,
    savedShots: shotIds.filter(shotId => existsSync(path.join(shotsDir, shotId, "spec.json"))),
  };
}

async function stillUrls(stillsDir: string): Promise<string[]> {
  if (!existsSync(stillsDir)) return [];
  const names = (await readdir(stillsDir)).filter((name) => name.endsWith(".png")).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
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
    ) => ipcMain.handle(`moco:${name}`, async (_e, ...args) => {
      if (!jobStarts.has(name)) return fn(...(args as A));
      if (codexAccount.busy) throw new Error("Finish or cancel Codex sign-in before starting a job");
      pendingJobStarts++;
      try { return await fn(...(args as A)); }
      finally { pendingJobStarts--; }
    });

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

    handle("app.copy", (text: string) => clipboard.writeText(String(text)));
    // Only rendered videos inside the projects folder can be dragged out.
    ipcMain.on("moco:app.startDrag", (e, file: unknown) => {
      if (typeof file !== "string" || !/\.(mp4|jpg)$/.test(file)) return;
      const relative = path.relative(settings.projectsDir, path.resolve(file));
      if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(file)) return;
      // An image drags as a small copy of itself; a video as the app icon.
      const icon = nativeImage.createFromPath(file.endsWith(".jpg") ? file : iconPath()).resize({ width: 48 });
      e.sender.startDrag({ file, icon });
    });

    handle("settings.get", () => settings);
    handle("settings.set", async (patch: DeepPartial<Settings>) => {
      // The engine is built with these, so changing them restarts it, which would cut a running job short.
      const engineInputs = (s: Settings) => JSON.stringify([s.projectsDir, s.voice, s.render, s.aiProvider]);
      if (patch.aiProvider !== undefined && !["claude-cli", "codex-cli"].includes(patch.aiProvider)) throw new Error("Unknown AI provider");
      const touchesEngine = patch.aiProvider !== undefined || patch.projectsDir !== undefined || patch.voice !== undefined || patch.render !== undefined;
      if (touchesEngine && (running.size > 0 || pendingJobStarts > 0 || codexAccount.busy))
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

    handle("ai.status", () => codexAccount.busy
      ? { ok: false, reason: "Codex account sign-in is in progress. Finish or cancel sign-in before generating." }
      : aiBackend(settings.aiProvider).available());
    handle("ai.accountStatus", () => codexAccount.status());
    handle("ai.switchAccount", () => {
      if (settings.aiProvider !== "codex-cli") throw new Error("Select and save Codex before switching its account");
      if (running.size || pendingJobStarts || [...learnJobs.values()].some(job => job.view.state === "running"))
        throw new Error("Wait for generation and template learning to finish before switching accounts");
      const status = codexAccount.start();
      stopEngineHost();
      return status;
    });
    handle("ai.cancelSignIn", () => codexAccount.cancel());

    handle("voice.list", () => systemVoices().catch(() => []));
    handle("voice.models", () => voiceModels.list());
    handle("voice.download", (model) => {
      if (model !== "english" && model !== "multilingual") throw new Error("Unknown voice model");
      voiceModels.download(model);
    });
    handle("voice.cancelDownload", () => voiceModels.cancel());
    handle("voice.preview", async (text: string) => {
      try {
        const dir = path.join(previewsDir(), String(Date.now()));
        const spoken = await narrationAudio(settings.voice, voiceRuntime).tts(
          [{ id: "preview", text: text.slice(0, 400), delivery: { emotion: "resolute", intensity: 0.6, pauseAfterMs: 300 } }],
          { voiceId: settings.voice.voice, backend: settings.voice.backend ?? "system" },
          settings.defaults.language,
          dir,
        );
        return { url: `moco-asset://previews/${path.basename(dir)}/${path.basename(spoken.file)}` };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    handle("kit.catalog", () => catalog);
    handle("templates.list", () => [...TEMPLATES, ...learnedTemplates(stylesDir())]);
    handle("templates.chooseVideos", async () => {
      const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "Reference videos", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] }] });
      return result.canceled ? [] : result.filePaths;
    });
    handle("templates.createSample", async (input: import("@moco/engine").StyleSampleInput) => {
      const id = await engine().createStyleSample(input);
      await engine().runStage({ seriesId: id });
      send("library", { seriesId: id });
      return id;
    });
    handle("templates.samples", (templateId: string) => engine().styleSamples(templateId));
    handle("templates.sampleReview", (seriesId: string) => engine().styleSampleReview(seriesId));
    handle("templates.approveSample", (seriesId: string, hash: string) => engine().approveStyleSample(seriesId, hash));
    handle("templates.importPrompt", async (input: import("@moco/engine/templates/import").PromptTemplateInput) => {
      const { importPromptTemplate } = await import("@moco/engine/templates/import");
      return importPromptTemplate(stylesDir(), input);
    });
    handle("templates.learn", (input: { name: string; sources: string[]; referenceImages?: string[] }) => startLearning(input));
    handle("templates.jobs", () => [...learnJobs.values()].map((job) => job.view));
    handle("templates.cancelLearn", (jobId: string) => {
      const job = learnJobs.get(jobId);
      if (!job || job.view.state !== "running") return;
      job.view.state = "cancelled";
      job.process.kill();
      send("learn", job.view);
    });
    handle("templates.openFolder", async (id: string) => {
      const template = learnedTemplates(stylesDir()).find((candidate) => candidate.id === id);
      if (template?.learned) await shell.openPath(template.learned.dir);
    });
    handle("templates.remove", async (id: string) => {
      if ((await engine().listSeries()).some(series => series.template === id || series.styleSample?.templateId === id)) throw new Error("This template is used by an existing series or sample. Keep it so its saved work remains accessible.");
      const template = learnedTemplates(stylesDir()).find((candidate) => candidate.id === id);
      if (!template?.learned) throw new Error("Only learned templates can be removed");
      if (path.dirname(template.learned.dir) !== stylesDir()) throw new Error("That template is outside the styles folder");
      await rm(template.learned.dir, { recursive: true, force: true });
    });

    handle("series.list", async () => {
      const infos = await engine().listSeries();
      // One unreadable project must not hide the rest of the workspace.
      const results = await Promise.allSettled(infos.map((info) => summarize(info.id)));
      const summaries = results.flatMap((result, i) => {
        if (result.status === "fulfilled") return [result.value];
        console.warn(`[moco] skipping series ${infos[i]!.id}:`, result.reason);
        return [];
      });
      return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    handle(
      "series.create",
      async (input: Parameters<ReturnType<typeof engine>["createSeries"]>[0]) => {
        const id = await engine().createSeries(input);
        await engine().runStage({ seriesId: id });
        send("library", { seriesId: id });
        return id;
      },
    );
    handle("series.extend", (id: string, input: { episodes: number; note?: string }) =>
      engine().extendSeries(id, input),
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

    handle("publish.save", (seriesId: string, episodeId: string, kit: PublishKit) =>
      engine().savePublish({ seriesId, episodeId }, kit),
    );
    handle("publish.rewrite", (seriesId: string, episodeId: string, note?: string) =>
      engine().rewritePublish({ seriesId, episodeId }, note),
    );
    handle(
      "publish.setThumbnail",
      (seriesId: string, episodeId: string, choice: ThumbnailChoice) =>
        engine().setThumbnail({ seriesId, episodeId }, choice),
    );
    handle("publish.setDefaults", (seriesId: string, defaults: Partial<PublishDefaults>) =>
      engine().setPublishDefaults(seriesId, defaults),
    );
    handle("publish.openStudio", () => shell.openExternal(YOUTUBE_UPLOAD_URL));

    nativeTheme.on("updated", () => {
      applyChrome();
      send("settings", settings);
    });
    applyChrome();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    app.on("before-quit", () => { void codexAccount.cancel(); voiceModels.cancel(); stopEngineHost(); });
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
