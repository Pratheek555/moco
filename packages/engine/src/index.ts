// @moco/engine — the backbone. The desktop app calls only this API.
// The engine is the single writer of projects/; the AI is a function it calls with tools disabled;
// approvals come only through approve() from the UI.
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AiBackend } from "@moco/ai";
import { catalog as defaultCatalog, type Catalog } from "@moco/kit";
import { ArtistProduction, checkYoutube, PublishDefaults, PublishKit, SPEC_VERSION, ThumbnailChoice, type World } from "@moco/spec";
import { defaultConfig, type EngineConfig } from "./config.ts";
import { EngineError } from "./errors.ts";
import { EventBus, type EngineEvent, type EngineEventType, type Unsubscribe } from "./events/bus.ts";
import { generateScene, neighbourAvoid, sceneSharedInputs, scenesHash } from "./generator/generate.ts";
import { reviewArtistEpisode } from "./review/artist.ts";
import { Semaphore } from "./jobs/semaphore.ts";
import type { SeriesInfo, StageContext } from "./pipeline/context.ts";
import { approveGate, markDependantsStale, nextStage, type Next } from "./pipeline/machine.ts";
import { runStages } from "./pipeline/run.ts";
import { renderThumbnail } from "./planner/publish.ts";
import { worldCatalog } from "./planner/world.ts";
import { readAdditions, worldWithAdditions } from "./canon/merge.ts";
import { MAX_EPISODES } from "./planner/series.ts";
import { allStageKeys, files, GATED, parseStageKey, stageKey } from "./pipeline/stages.ts";
import type { AudioPort, RenderPort } from "./ports.ts";
import { ArtifactStore } from "./store/artifacts.ts";
import { Ledger, type Decision, type JobRecord, type StageRecord } from "./store/ledger.ts";
import { assertSafeId, exists, readJson, seriesDir, slugify, writeJsonAtomic } from "./store/workspace.ts";
import { meteredAi } from "./usage/meter.ts";
import { lookupTemplate, setStylesDir } from "./templates/registry.ts";
import { StyleSampleInput, snapshotStyle, sampleBrief, styleSampleReview, retainApprovedSample, type StyleSampleReview } from "./templates/samples.ts";
import { characterLibraryFile, listCharacters, saveCharacter, readCharacterRig, type CharacterSummary } from "./artist/characters.ts";
import { snapshotShotWorkspace } from "./artist/workspace.ts";
import * as labelEdits from "./editing/labels.ts";
import { renderFreshness } from "./pipeline/render.ts";
export type { LabelEditorState, LabelEditPreview } from "./editing/labels.ts";

export { EngineError } from "./errors.ts";
export type { EngineErrorCode } from "./errors.ts";
export type { EngineEvent, EngineEventType, Unsubscribe } from "./events/bus.ts";
export type { AudioPort, RenderPort, RenderError, RenderCheck } from "./ports.ts";
export type { EngineConfig, EngineLimits } from "./config.ts";
export type { DailyUsage } from "./store/ledger.ts";
export { defaultConfig } from "./config.ts";
export type { CharacterSummary } from "./artist/characters.ts";
export { TEMPLATES, findTemplate, type TemplateInfo } from "./templates/index.ts";
export { allTemplates, learnedTemplates } from "./templates/registry.ts";
export type { StyleSampleInput, StyleSampleInfo, StyleSampleReview } from "./templates/samples.ts";

export const ENGINE_VERSION = "0.1.0";

export type SeriesId = string;
export type JobId = string;

// A stage of a series: "bible", or an episode stage like "ep-01/script". Omit `key` to mean "whatever is next".
export interface StageRef {
  seriesId: SeriesId;
  key?: string;
}
export interface EpisodeRef {
  seriesId: SeriesId;
  episodeId: string;
}
export interface ShotRef extends EpisodeRef {
  shotId: string;
}
// An artifact file, relative to the series folder, e.g. "episodes/ep-01/artifacts/script.json".
export interface ArtifactRef {
  seriesId: SeriesId;
  file: string;
}

export interface StageStatusView extends StageRecord {
  key: string;
  gated: boolean;
}

export interface SeriesStatus {
  series: SeriesInfo;
  stages: StageStatusView[];
  next: Next;
  activeJob?: JobRecord;
  jobs: JobRecord[];
  decisions: Decision[];
  usage: Ledger["data"]["usage"];
}

export interface Engine {
  createStyleSample(input: StyleSampleInput): Promise<SeriesId>;
  styleSamples(templateId: string): Promise<SeriesStatus[]>;
  styleSampleReview(seriesId: string): Promise<StyleSampleReview>;
  approveStyleSample(seriesId: string, contentHash: string): Promise<void>;
  createSeries(input: { idea: string; language: string; episodes?: number; template?: string; production?: ArtistProduction }): Promise<SeriesId>;
  // Plan `episodes` more after the approved ones, steered by an optional note. The longer plan waits for approval.
  extendSeries(seriesId: SeriesId, input: { episodes: number; note?: string }): Promise<JobId>;
  listSeries(): Promise<SeriesInfo[]>;
  runStage(ref: StageRef): Promise<JobId>;
  approve(ref: Required<StageRef>, contentHash: string): Promise<void>;
  reject(ref: Required<StageRef>, feedback: string): Promise<void>;
  status(seriesId: SeriesId): Promise<SeriesStatus>;
  regenerateShot(ref: ShotRef, feedback?: string): Promise<JobId>;
  listCharacters(seriesId: SeriesId): Promise<CharacterSummary[]>;
  saveCharacter(ref: ShotRef, choice: { castId: string; sceneHash: string }): Promise<{ castId: string; version: string }>;
  applyCharacter(ref: ShotRef, choice: { castId: string; version: string; sceneHash: string }): Promise<JobId>;
  reviewEpisode(ref: EpisodeRef, options?: { repair?: boolean }): Promise<JobId>;
  labelEditor(ref: ShotRef): Promise<labelEdits.LabelEditorState>;
  previewLabelEdit(ref: ShotRef, input: { sceneHash: string; labelId: string; text: string }): Promise<labelEdits.LabelEditPreview>;
  applyLabelEdit(ref: ShotRef, id: string): Promise<void>;
  undoLabelEdit(ref: ShotRef, id: string): Promise<void>;
  renderFreshness(ref: EpisodeRef): Promise<{ preview: boolean; final: boolean }>;
  renderPreview(ref: EpisodeRef): Promise<JobId>;
  renderFinal(ref: EpisodeRef): Promise<JobId>;
  cancel(jobId: JobId): Promise<void>;
  waitForJob(jobId: JobId): Promise<JobRecord>; // resolves when the job ends (any status)
  on(type: EngineEventType | "*", listener: (event: EngineEvent) => void): Unsubscribe;
  history(ref: ArtifactRef): Promise<{ revision: number; current: boolean }[]>;
  restore(ref: ArtifactRef, revision: number): Promise<void>;
  readArtifact(ref: ArtifactRef): Promise<unknown>; // { meta, data } for the UI to show
  // Publishing: the user's edits to an episode's kit, the series defaults, and rewriting one kit.
  savePublish(ref: EpisodeRef, kit: PublishKit): Promise<void>;
  setPublishDefaults(seriesId: SeriesId, defaults: Partial<PublishDefaults>): Promise<void>;
  rewritePublish(ref: EpisodeRef, feedback?: string): Promise<JobId>;
  // Re-render the episode's thumbnail from another shot or with another headline (empty text = none).
  setThumbnail(ref: EpisodeRef, choice: ThumbnailChoice): Promise<void>;
}

export interface CreateEngineOptions {
  projectsDir: string;
  ai: AiBackend;
  render: RenderPort;
  audio: AudioPort;
  catalog?: Catalog; // defaults to the installed kit catalog
  config?: Partial<EngineConfig>;
  stylesDir?: string; // styles learned from reference videos (@moco/learn); each one is also a template
}

// One series loaded in memory.
interface OpenSeries {
  info: SeriesInfo;
  dir: string;
  ledger: Ledger;
  store: ArtifactStore;
  world?: World; // the series' generated world, if the kit couldn't play its story
  activeJob?: { id: JobId; controller: AbortController; done: Promise<void> };
  editing?: boolean;
}

export function createEngine(options: CreateEngineOptions): Engine {
  const config: EngineConfig = { ...defaultConfig(options.projectsDir), ...options.config };
  const catalog = options.catalog ?? defaultCatalog;
  setStylesDir(options.stylesDir);
  const bus = new EventBus(config.projectsDir);
  const aiSlots = new Semaphore(config.limits.aiConcurrency);
  const renderSlots = new Semaphore(1); // rendering is CPU-heavy
  const ttsSlots = new Semaphore(1);
  const open = new Map<SeriesId, OpenSeries>();
  const jobOwners = new Map<JobId, SeriesId>();
  const mutations = new Set<SeriesId>();
  async function mutate<T>(seriesId: string, work: () => Promise<T>): Promise<T> {
    if (mutations.has(seriesId)) throw new EngineError("busy", "A change or approval is being saved for this project");
    mutations.add(seriesId);
    try { return await work(); } finally { mutations.delete(seriesId); }
  }

  async function ensureSampleEditable(series: OpenSeries) {
    if (!series.info.styleSample) return;
    const folder = lookupTemplate(series.info.template)?.learned?.dir;
    if (folder && await exists(join(folder, "approval.json"))) throw new EngineError("stage_blocked", "This sample revision is approved. Generate a new revision to make changes.");
  }

  // ---------- series loading ----------

  async function load(seriesId: SeriesId): Promise<OpenSeries> {
    const cached = open.get(seriesId);
    if (cached) return cached;

    const dir = seriesDir(config.projectsDir, seriesId);
    if (!(await exists(join(dir, "series.json")))) throw new EngineError("not_found", `series ${seriesId} not found`);
    const info = await readJson<SeriesInfo>(join(dir, "series.json"));
    assertCompatible(info);
    const ledger = await Ledger.load(dir);
    const store = new ArtifactStore(dir, ledger, (file) => void bus.emit(seriesId, "artifact.modified_externally", { file }));
    recoverAfterCrash(ledger);
    // The durable approval marker is written before the ledger gate. Complete
    // that gate after a crash between the two atomic writes.
    const sampleFolder = info.styleSample && lookupTemplate(info.template)?.learned?.dir;
    if (sampleFolder && await exists(join(sampleFolder, "approval.json"))) {
      const approval = await readJson<{ previewHash?: string }>(join(sampleFolder, "approval.json"));
      const key = `${ledger.data.episodeIds[0]}/preview`;
      if (approval.previewHash && ledger.stage(key).status === "awaiting_approval" && ledger.stage(key).artifactHash === approval.previewHash) ledger.setStage(key, { status: "approved", feedback: undefined });
    }
    await ledger.save();

    // A generated world is its approved build plus what later episodes added to it (canon/merge.ts).
    const base = store.has(files.world) ? (await store.read(files.world, "World")).data : undefined;
    const world = base && worldWithAdditions(base, await readAdditions(dir, store));
    const series: OpenSeries = { info, dir, ledger, store, world };
    open.set(seriesId, series);
    return series;
  }

  // A job or stage left "running" means the app died mid-way. Stages can safely run again.
  // The desktop can also view a series being advanced by a CLI engine. Read a fresh, read-only
  // snapshot rather than treating its new artifacts as edits against our old cached ledger.
  // In particular, viewing must not recover (and overwrite) another process's running job.
  async function readSeries(seriesId: SeriesId): Promise<OpenSeries> {
    const cached = open.get(seriesId);
    if (cached?.activeJob || cached?.editing) return cached;
    await cached?.ledger.settled();
    if (cached?.activeJob || cached?.editing) return cached;
    const dir = seriesDir(config.projectsDir, seriesId);
    if (!(await exists(join(dir, "series.json")))) throw new EngineError("not_found", `series ${seriesId} not found`);
    const info = await readJson<SeriesInfo>(join(dir, "series.json"));
    assertCompatible(info);
    const ledger = await Ledger.load(dir);
    const store = new ArtifactStore(dir, ledger, (file) => void bus.emit(seriesId, "artifact.modified_externally", { file }));
    return { info, dir, ledger, store };
  }

  function recoverAfterCrash(ledger: Ledger): void {
    const interrupted = { code: "interrupted", message: "Stopped because the app closed. Run it again." };
    for (const job of Object.values(ledger.data.jobs)) {
      if (job.status === "running" || job.status === "queued") {
        Object.assign(job, { status: "failed", endedAt: new Date().toISOString(), error: interrupted });
      }
    }
    for (const [key, stage] of Object.entries(ledger.data.stages)) {
      if (stage.status === "running") ledger.setStage(key, { status: "pending" });
    }
  }

  function contextFor(series: OpenSeries, signal: AbortSignal): StageContext {
    const ctx: StageContext = {
      seriesId: series.info.id,
      series: series.info,
      dir: series.dir,
      // Artist duration comes from the user's field or the approved show plan,
      // never the legacy short-reel defaults.
      config: series.info.production ? { ...config, targetSeconds: series.info.production.targetSeconds
        ? { min: series.info.production.targetSeconds, max: series.info.production.targetSeconds }
        : { min: 0, max: Number.MAX_SAFE_INTEGER },
        ...(series.info.styleSample && { shotSecondsBounds: { min: Math.min(config.shotSecondsBounds.min, (series.info.production.targetSeconds ?? 12) / 4), max: Math.max(config.shotSecondsBounds.max, series.info.production.targetSeconds ?? 12) } }) } : config,
      catalog: series.world ? worldCatalog(catalog, series.world) : catalog,
      world: series.world,
      useWorld: (world) => {
        series.world = world;
        ctx.world = world;
        ctx.catalog = worldCatalog(catalog, world);
      },
      store: series.store,
      ledger: series.ledger,
      bus,
      ai: meteredAi(options.ai, aiSlots, series.ledger, bus, series.info.id, config),
      render: options.render,
      audio: options.audio,
      renderSlots,
      ttsSlots,
      signal,
      episodeIds: () => series.ledger.data.episodeIds,
    };
    return ctx;
  }

  // ---------- jobs ----------

  // Start background work for a series. One job per series at a time keeps the ledger simple and safe.
  async function startJob(seriesId: SeriesId, kind: JobRecord["kind"], target: string, work: (ctx: StageContext, job: JobRecord) => Promise<void>, requiresAi = true): Promise<JobId> {
    return mutate(seriesId, async () => {
      const series = await load(seriesId);
      await ensureSampleEditable(series);
      if (series.activeJob || series.editing) throw new EngineError("busy", `a job is already running for ${seriesId}`);

      const job: JobRecord = { id: randomUUID(), kind, target, status: "running", stagesRun: [], startedAt: new Date().toISOString() };
      const controller = new AbortController();
      series.ledger.data.jobs[job.id] = job;
      jobOwners.set(job.id, seriesId);
      await series.ledger.save();
      await bus.emit(seriesId, "job.started", { jobId: job.id, kind, target });

      const done = (async () => {
        try {
          if (requiresAi) {
            const available = await options.ai.available();
            if (!available.ok) throw new EngineError("ai_unavailable", available.reason ?? "AI backend is not available");
          }
          await work(contextFor(series, controller.signal), job);
          job.status = "succeeded";
        } catch (err) {
          const cancelled = controller.signal.aborted;
          job.status = cancelled ? "cancelled" : "failed";
          job.error = err instanceof EngineError ? { code: err.code, message: err.message } : { code: "internal", message: err instanceof Error ? err.message : String(err) };
        } finally {
          job.endedAt = new Date().toISOString();
          await series.ledger.save();
          // Keep the job owned until its final ledger write settles. A fast failed
          // sample run must not let a restart race this write on Windows.
          series.activeJob = undefined;
          await bus.emit(seriesId, "job.finished", { jobId: job.id, status: job.status, error: job.error });
        }
      })();

      series.activeJob = { id: job.id, controller, done };
      return job.id;
    });
  }

  async function seriesOfJob(jobId: JobId): Promise<OpenSeries> {
    const seriesId = jobOwners.get(jobId);
    if (!seriesId) throw new EngineError("not_found", `job ${jobId} not found`);
    return load(seriesId);
  }

  // ---------- staleness after a direct artifact change (restore, single-shot regenerate) ----------

  // The stage that owns an artifact file, if any.
  function stageOfFile(file: string): string | undefined {
    const series = { "artifacts/series_plan.json": "series_plan", "artifacts/bible.json": "bible" }[file];
    if (series) return series;
    const episodeArtifact = /^episodes\/([a-z0-9-]+)\/artifacts\/(script|voiceover|shot_list|preview_report|render_report|publish)\.json$/.exec(file);
    if (episodeArtifact) {
      const stage = { script: "script", voiceover: "voiceover", shot_list: "shot_list", preview_report: "preview", render_report: "final", publish: "publish" }[episodeArtifact[2]!]!;
      return `${episodeArtifact[1]}/${stage}`;
    }
    const shotSpec = /^episodes\/([a-z0-9-]+)\/shots\/[a-z0-9-]+\/spec\.json$/.exec(file);
    return shotSpec ? `${shotSpec[1]}/scenes` : undefined;
  }

  // A stage's output changed outside a normal run: rebind its hash, re-open its gate, stale its dependants.
  async function outputChanged(series: OpenSeries, key: string, hash: string): Promise<void> {
    const gated = GATED.has(parseStageKey(key).stage);
    series.ledger.setStage(key, { status: gated ? "awaiting_approval" : "done", artifactHash: hash });
    const stale = markDependantsStale(series.ledger, key, series.ledger.data.episodeIds);
    await series.ledger.save();
    if (gated) await bus.emit(series.info.id, "stage.awaiting_approval", { key, contentHash: hash });
    if (stale.length > 0) await bus.emit(series.info.id, "artifact.stale", { because: key, stages: stale });
  }

  // ---------- public API ----------

  async function withLabelEdit<T>(ref: ShotRef, action: (ctx: StageContext) => Promise<T>, changed = false): Promise<T> {
    labelEdits.validateLabelRef(ref);
    return mutate(ref.seriesId, async () => {
      const series = await load(ref.seriesId);
      await ensureSampleEditable(series);
      if (series.activeJob || series.editing) throw new EngineError("busy", "Wait for the current job or edit to finish");
      series.editing = true;
      const ctx = contextFor(series, new AbortController().signal);
      const before = ctx.store.hashOf(files.shotSpec(ref.episodeId, ref.shotId));
      try { return await action(ctx); }
      finally {
        try {
          // Invalidate even if a later pointer/log write failed after saving a spec.
          if (changed && before !== ctx.store.hashOf(files.shotSpec(ref.episodeId, ref.shotId))) {
            ctx.ledger.setStage(stageKey("scenes", ref.episodeId), { preserveArtwork: true });
            await outputChanged(series, stageKey("scenes", ref.episodeId), await scenesHash(ctx, ref.episodeId));
            await bus.emit(ref.seriesId, "artifact.saved", { episodeId: ref.episodeId, shotId: ref.shotId });
          }
        } finally { series.editing = false; }
      }
    });
  }

  return {
    async createStyleSample(value) {
      const input = StyleSampleInput.parse(value);
      if (!options.stylesDir) throw new EngineError("validation_failed", "Configure the learned styles folder first");
      const template = lookupTemplate(input.templateId);
      if (!template) throw new EngineError("invalid_id", "Unknown template");
      if (!options.ai.supportsArtist || !options.ai.seesImages) throw new EngineError("validation_failed", "Style samples require artist tools and visual review on the selected AI backend. No other provider was selected.");
      const snapshot = await snapshotStyle(options.stylesDir, template, input);
      const id = await this.createSeries({ idea: sampleBrief(input), language: input.language, episodes: 1, template: snapshot.revisionId });
      const series = await load(id);
      series.info.styleSample = { templateId: input.templateId, revisionId: snapshot.revisionId, topic: input.topic, choices: input.choices };
      await writeJsonAtomic(join(series.dir, "series.json"), series.info);
      return id;
    },

    async styleSamples(templateId) {
      const infos = (await this.listSeries()).filter(info => info.styleSample?.templateId === templateId);
      return Promise.all(infos.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(info => this.status(info.id)));
    },

    async styleSampleReview(seriesId) {
      const series = await load(seriesId);
      const template = lookupTemplate(series.info.template);
      if (!series.info.styleSample || !template) throw new EngineError("invalid_id", "This project is not a style sample");
      return styleSampleReview(contextFor(series, new AbortController().signal), template);
    },

    async approveStyleSample(seriesId, contentHash) {
      return mutate(seriesId, async () => {
        const series = await load(seriesId);
        await ensureSampleEditable(series);
        if (series.activeJob) throw new EngineError("busy", "Wait for the sample job to finish");
        const template = lookupTemplate(series.info.template);
        if (!series.info.styleSample || !template) throw new EngineError("invalid_id", "This project is not a style sample");
        const approval = await retainApprovedSample(contextFor(series, new AbortController().signal), template, contentHash);
        const key = `${series.ledger.data.episodeIds[0]}/preview`;
        await writeJsonAtomic(join(template.learned!.dir, "approval.json"), { ...approval, previewHash: series.ledger.stage(key).artifactHash });
        approveGate(series.ledger, key, series.ledger.stage(key).artifactHash!);
        await series.ledger.save();
        await bus.emit(seriesId, "stage.approved", { key, contentHash });
      });
    },

    async createSeries(input) {
      const idea = input.idea.trim();
      const template = lookupTemplate(input.template);
      const episodes = input.episodes ?? template?.defaults.episodes ?? 3;
      if (!idea || idea.length > 32000) throw new EngineError("invalid_id", "the idea must be 1–32000 characters");
      if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(input.language)) throw new EngineError("invalid_id", `"${input.language}" is not a language code like "en" or "hi"`);
      if (!Number.isInteger(episodes) || episodes < 1 || episodes > 30) throw new EngineError("invalid_id", "episodes must be 1–30");
      if (input.template !== undefined && !template) throw new EngineError("invalid_id", `unknown template "${input.template}"`);
      const settings = input.production ?? template?.production;
      const production = settings ? ArtistProduction.parse(settings) : undefined;
      if (production && !options.ai.supportsArtist) throw new EngineError("validation_failed", "This AI backend does not support the artist workspace. Choose a supported backend before creating the project.");
      if (production && template && !template.production) throw new EngineError("validation_failed", "This template requires the kit/world pipeline. Choose a prompt template for custom illustration.");

      const id = await uniqueSeriesId(config.projectsDir, slugify(idea.split(/\s+/).slice(0, 6).join(" ")));
      const info: SeriesInfo = {
        id,
        idea,
        language: input.language,
        episodes,
        ...(input.template && { template: input.template }),
        ...(production && { production }),
        createdAt: new Date().toISOString(),
        engineVersion: ENGINE_VERSION,
        specVersion: SPEC_VERSION,
      };
      await writeJsonAtomic(join(seriesDir(config.projectsDir, id), "series.json"), info);
      await load(id);
      return id;
    },

    async extendSeries(seriesId, input) {
      const series = await load(seriesId);
      if (series.info.styleSample) throw new EngineError("stage_blocked", "A style sample contains one short episode. Start a series separately.");
      if (series.activeJob || series.editing) throw new EngineError("busy", `a job is already running for ${seriesId}`);
      const { ledger } = series;
      if (ledger.data.planExtension || ledger.stage("series_plan").status !== "approved") {
        throw new EngineError("stage_blocked", "approve the series plan before adding episodes");
      }
      const keep = ledger.data.episodeIds.length;
      if (!Number.isInteger(input.episodes) || input.episodes < 1 || keep + input.episodes > MAX_EPISODES) {
        throw new EngineError("invalid_id", `a series can have at most ${MAX_EPISODES} episodes; this one has ${keep}`);
      }
      const note = input.note?.trim().slice(0, 2000);
      series.info = { ...series.info, episodes: keep + input.episodes };
      await writeJsonAtomic(join(series.dir, "series.json"), series.info);
      ledger.data.planExtension = { keep, ...(note && { note }) };
      ledger.setStage("series_plan", { status: "pending", feedback: undefined });
      await ledger.save();
      return startJob(seriesId, "stage", "series_plan", async (ctx, job) => {
        job.stagesRun = await runStages(ctx, "series_plan", { once: true });
      });
    },

    async listSeries() {
      const names = (await exists(config.projectsDir)) ? await readdir(config.projectsDir) : [];
      const markers = names.map((name) => join(config.projectsDir, name, "series.json"));
      const found = await Promise.all(markers.map(async (path) => ((await exists(path)) ? readJson<SeriesInfo>(path) : undefined)));
      // Projects from an older or newer moco can't be opened, so they aren't listed.
      return found.filter((info): info is SeriesInfo => info !== undefined && isCompatible(info));
    },

    async runStage(ref) {
      const series = await load(ref.seriesId);
      if (series.info.styleSample && ref.key && ["final", "publish", "memory_update"].includes(parseStageKey(ref.key).stage)) throw new EngineError("stage_blocked", "Style samples stop at approved preview");
      return startJob(ref.seriesId, "stage", ref.key ?? "next", async (ctx, job) => {
        job.stagesRun = await runStages(ctx, ref.key);
      });
    },

    async approve(ref, contentHash) {
      return mutate(ref.seriesId, async () => {
        const series = await load(ref.seriesId);
        await ensureSampleEditable(series);
        if (series.info.styleSample && ref.key.endsWith("/preview")) throw new EngineError("stage_blocked", "Approve the style sample with its full evidence hash through approveStyleSample");
        approveGate(series.ledger, ref.key, contentHash);
        if (ref.key === "series_plan") series.ledger.data.planExtension = undefined;
        await series.ledger.save();
        await bus.emit(ref.seriesId, "stage.approved", { key: ref.key, contentHash });
      });
    },

    async reject(ref, feedback) {
      return mutate(ref.seriesId, async () => {
        const series = await load(ref.seriesId);
        await ensureSampleEditable(series);
        const record = series.ledger.stage(ref.key);
        if (record.status !== "awaiting_approval") {
          throw new EngineError("not_awaiting_approval", `${ref.key} is ${record.status}, not awaiting approval`);
        }
        // The feedback is put into the stage's next prompt. A preview has no prompt, so its note goes to the shots.
        const note = feedback.trim().slice(0, 2000);
        const { stage, episodeId } = parseStageKey(ref.key);
        series.ledger.setStage(ref.key, { status: "pending" });
        series.ledger.setStage(stage === "preview" ? stageKey("scenes", episodeId) : ref.key, { status: "pending", feedback: note });
        if (note) series.ledger.decide("feedback", ref.key, note); // kept for the episode retro (learn/playbook.ts)
        await series.ledger.save();
      });
    },

    async status(seriesId) {
      const series = await readSeries(seriesId);
      const { ledger } = series;
      const keys = allStageKeys(ledger.data.episodeIds);
      const stages = keys.map((key) => ({ key, gated: GATED.has(parseStageKey(key).stage), ...ledger.stage(key) }));
      const activeJob = series.activeJob ? ledger.data.jobs[series.activeJob.id] : undefined;
      return {
        series: series.info,
        stages,
        next: series.info.styleSample && ledger.stage(`${ledger.data.episodeIds[0]}/preview`).status === "approved" ? { kind: "finished" as const } : nextStage(ledger, ledger.data.episodeIds),
        activeJob,
        jobs: Object.values(ledger.data.jobs),
        decisions: ledger.data.decisions,
        usage: ledger.data.usage,
      };
    },

    async regenerateShot(ref, feedback) {
      assertSafeId(ref.episodeId, "episode id");
      assertSafeId(ref.shotId, "shot id");
      const scenesKey = stageKey("scenes", ref.episodeId);
      return startJob(ref.seriesId, "shot", `${ref.episodeId}/shots/${ref.shotId}`, async (ctx) => {
        const series = await load(ref.seriesId);
        // Every shot must already have a spec from the current shot list; otherwise run the scenes stage.
        if (ctx.ledger.stage(scenesKey).status !== "done") throw new EngineError("stage_blocked", `run ${scenesKey} before regenerating single shots`);
        const shotList = (await ctx.store.read(files.shotList(ref.episodeId), "ShotList")).data;
        const shot = shotList.shots.find((candidate) => candidate.id === ref.shotId);
        if (!shot) throw new EngineError("not_found", `shot ${ref.shotId} not found in ${ref.episodeId}`);

        const shared = await sceneSharedInputs(ctx, ref.episodeId);
        const avoid = await neighbourAvoid(ctx, ref.episodeId, shotList.shots, shot.id);
        await generateScene(ctx, { ...shared, shot, feedback, force: true, avoid });
        // A changed shot invalidates continuity evidence for the cut. Review without silently repairing other shots.
        if (ctx.series.production) await reviewArtistEpisode(ctx, ref.episodeId, shotList.shots, shared, { maxRounds: 0 });
        ctx.ledger.decide("regenerate", `${ref.episodeId}/${ref.shotId}`, feedback ?? "no feedback");
        await outputChanged(series, scenesKey, await scenesHash(ctx, ref.episodeId));
      });
    },

    async listCharacters(seriesId) {
      return listCharacters(await readSeries(seriesId));
    },

    async saveCharacter(ref, choice) {
      assertSafeId(ref.episodeId, "episode id");
      assertSafeId(ref.shotId, "shot id");
      return mutate(ref.seriesId, async () => {
        const series = await load(ref.seriesId);
        await ensureSampleEditable(series);
        if (series.activeJob) throw new EngineError("busy", "Wait for the current job before approving a character");
        if (!series.info.production) throw new EngineError("validation_failed", "Reusable characters require a Canvas production");
        const result = await saveCharacter(series, ref.episodeId, ref.shotId, choice.castId, choice.sceneHash);
        series.ledger.decide("edit", `character/${result.castId}`, `approved reusable version ${result.version} from ${ref.episodeId}/${ref.shotId}`);
        await series.ledger.save();
        await bus.emit(ref.seriesId, "artifact.saved", { file: characterLibraryFile, ...result });
        return result;
      });
    },

    async applyCharacter(ref, choice) {
      assertSafeId(ref.episodeId, "episode id");
      assertSafeId(ref.shotId, "shot id");
      assertSafeId(choice.castId, "character id");
      return startJob(ref.seriesId, "shot", `${ref.episodeId}/shots/${ref.shotId}/character`, async ctx => {
        if (!ctx.series.production) throw new EngineError("validation_failed", "Reusable characters require a Canvas production");
        const scenesKey = stageKey("scenes", ref.episodeId);
        if (ctx.ledger.stage(scenesKey).status !== "done") throw new EngineError("stage_blocked", "Finish generating the episode before changing a shot's character version");
        const shotList = (await ctx.store.read(files.shotList(ref.episodeId), "ShotList")).data;
        const shot = shotList.shots.find(s => s.id === ref.shotId);
        if (!shot?.characters.includes(choice.castId)) throw new EngineError("validation_failed", "This character is not in the selected shot");
        await readCharacterRig(ctx, choice.castId, choice.version);
        const before = await ctx.store.read(files.shotSpec(ref.episodeId, ref.shotId), "SceneSpec");
        if (before.meta.contentHash !== choice.sceneHash) throw new EngineError("gate_mismatch", "The shot changed. Reload before applying a character version.");
        const restoreWorkspace = await snapshotShotWorkspace(ctx, ref.episodeId, ref.shotId);
        const shared = await sceneSharedInputs(ctx, ref.episodeId);
        const series = await load(ref.seriesId);
        // Reopen preview approval before authoring. Even an interrupted review
        // cannot leave a previously approved preview eligible for final export.
        await outputChanged(series, scenesKey, await scenesHash(ctx, ref.episodeId));
        try {
          await generateScene(ctx, { ...shared, shot, force: true,
            characterRigs: { ...before.data.canvas?.characterRigs, [choice.castId]: choice.version }, requireCharacterRigs: true,
            feedback: `Use the explicitly selected approved character versions in brief.characterRigs. Set scene.json characterRigs to that mapping, remove superseded shared rig files from sourceFiles, and adapt only this shot's drawing to those functions. Preserve the narration, cuts, character identity and original action requirements. Bespoke motion remains allowed.`,
          });
          await reviewArtistEpisode(ctx, ref.episodeId, shotList.shots, shared, { maxRounds: 0 });
          const quality = (await ctx.store.read(files.critique(ref.episodeId), "Critique")).data.quality;
          if (quality?.status !== "passed") throw new EngineError("validation_failed", "The changed cut did not pass review. The previous shot has been retained; inspect the saved quality report.");
          ctx.ledger.decide("edit", `${ref.episodeId}/${ref.shotId}`, `applied character ${choice.castId} version ${choice.version}`);
        } catch (error) {
          await ctx.store.save(files.shotSpec(ref.episodeId, ref.shotId), "SceneSpec", before.data, { producedBy: before.meta.producedBy, backend: before.meta.backend, inputs: before.meta.inputs });
          await restoreWorkspace();
          throw error;
        } finally {
          await outputChanged(series, scenesKey, await scenesHash(ctx, ref.episodeId));
        }
      });
    },

    async labelEditor(ref) {
      labelEdits.validateLabelRef(ref);
      return labelEdits.labelEditor(contextFor(await readSeries(ref.seriesId), new AbortController().signal), ref);
    },
    async previewLabelEdit(ref, input) {
      return withLabelEdit(ref, ctx => labelEdits.previewLabelEdit(ctx, ref, input));
    },
    async applyLabelEdit(ref, id) {
      return withLabelEdit(ref, ctx => labelEdits.applyLabelEdit(ctx, ref, id), true);
    },
    async undoLabelEdit(ref, id) {
      return withLabelEdit(ref, ctx => labelEdits.undoLabelEdit(ctx, ref, id), true);
    },
    async renderFreshness(ref) {
      assertSafeId(ref.episodeId, "episode id");
      const series = await readSeries(ref.seriesId);
      return renderFreshness(contextFor(series, new AbortController().signal), ref.episodeId);
    },

    async reviewEpisode(ref, options) {
      assertSafeId(ref.episodeId,"episode id");
      return startJob(ref.seriesId,"stage",`${ref.episodeId}/review`,async ctx=>{
        if(!ctx.series.production) throw new EngineError("validation_failed","Visual review requires a canvas production");
        if(!ctx.store.has(files.shotList(ref.episodeId)) || !ctx.store.has(files.voiceover(ref.episodeId))) throw new EngineError("stage_blocked","Generate narration and the shot list before reviewing");
        const list=(await ctx.store.read(files.shotList(ref.episodeId),"ShotList")).data;
        for(const shot of list.shots) {
          if(!ctx.store.has(files.shotSpec(ref.episodeId,shot.id))) throw new EngineError("stage_blocked","Finish generating every shot before reviewing");
          const saved=await ctx.store.read(files.shotSpec(ref.episodeId,shot.id),"SceneSpec");
          for(const file of [files.shotList(ref.episodeId),files.voiceover(ref.episodeId)]) {
            const required=ctx.store.inputRef(file);
            if(!saved.meta.inputs.some(input=>input.kind===required.kind && input.contentHash===required.contentHash)) throw new EngineError("stage_blocked","Scenes are stale against the narration or shot list; regenerate them first");
          }
        }
        const before = await scenesHash(ctx, ref.episodeId);
        await reviewArtistEpisode(ctx,ref.episodeId,list.shots,await sceneSharedInputs(ctx,ref.episodeId), options?.repair === false ? { maxRounds: 0 } : {});
        const quality=(await ctx.store.read(files.critique(ref.episodeId),"Critique")).data.quality;
        if(quality?.status!=="passed")throw new EngineError("validation_failed",`Visual review needs attention: ${quality?.unresolved.join("; ")??"No complete review"}`);
        ctx.ledger.setStage(stageKey("scenes",ref.episodeId),{feedback:undefined});
        const after = await scenesHash(ctx, ref.episodeId);
        if (after !== before) await outputChanged(await load(ref.seriesId),stageKey("scenes",ref.episodeId),after);
        else await ctx.ledger.save();
      });
    },

    async renderPreview(ref) {
      assertSafeId(ref.episodeId, "episode id");
      return startJob(ref.seriesId, "stage", stageKey("preview", ref.episodeId), async (ctx, job) => {
        job.stagesRun = await runStages(ctx, stageKey("preview", ref.episodeId), { once: true });
      }, false);
    },

    async renderFinal(ref) {
      assertSafeId(ref.episodeId, "episode id");
      return this.runStage({ seriesId: ref.seriesId, key: stageKey("final", ref.episodeId) });
    },

    async cancel(jobId) {
      const series = await seriesOfJob(jobId);
      if (series.activeJob?.id === jobId) series.activeJob.controller.abort();
    },

    async waitForJob(jobId) {
      const series = await seriesOfJob(jobId);
      if (series.activeJob?.id === jobId) await series.activeJob.done;
      return series.ledger.data.jobs[jobId]!;
    },

    on(type, listener) {
      return bus.on(type, listener);
    },

    async history(ref) {
      const series = await readSeries(ref.seriesId);
      return series.store.history(ref.file);
    },

    // Restoring the current revision of an externally edited file accepts the edit as a human revision.
    async restore(ref, revision) {
      return mutate(ref.seriesId, async () => {
        const series = await load(ref.seriesId);
        await ensureSampleEditable(series);
        if (series.activeJob || series.editing) throw new EngineError("busy", `a job is running for ${ref.seriesId}`);
        if (ref.file === characterLibraryFile) throw new EngineError("stage_blocked", "Character approval history is append-only; save a reviewed character to change the default version instead");
        if (/^artifacts\/characters\/[^/]+\/[a-f0-9]{64}\.json$/.test(ref.file)) throw new EngineError("stage_blocked", "Approved character versions are immutable; save an improved character as a new version instead");
        const record = series.ledger.data.artifacts[ref.file];
        if (!record) throw new EngineError("not_found", `artifact ${ref.file} does not exist`);

        const data = await series.store.readRevision(ref.file, revision);
        const kind = record.kind as Parameters<ArtifactStore["save"]>[1];
        const saved = await series.store.save(ref.file, kind, data, { producedBy: "human" });
        if (ref.file === files.seriesPlan) {
          series.ledger.data.episodeIds = (saved.data as { episodes: { id: string }[] }).episodes.map((episode) => episode.id);
          // An older plan may be shorter or longer than the last request; a redo of it should keep its length.
          series.ledger.data.planExtension = undefined;
          series.info = { ...series.info, episodes: series.ledger.data.episodeIds.length };
          await writeJsonAtomic(join(series.dir, "series.json"), series.info);
        }
        series.ledger.decide("restore", ref.file, `restored revision ${revision} as revision ${saved.meta.revision}`);

        const key = stageOfFile(ref.file);
        const ctx = contextFor(series, new AbortController().signal);
        const hash = key?.endsWith("/scenes") ? await scenesHash(ctx, parseStageKey(key).episodeId!) : saved.meta.contentHash;
        if (key) await outputChanged(series, key, hash);
        else await series.ledger.save();
      });
    },

    async readArtifact(ref) {
      const series = await readSeries(ref.seriesId);
      const record = series.ledger.data.artifacts[ref.file];
      if (!record) throw new EngineError("not_found", `artifact ${ref.file} does not exist`);
      return series.store.read(ref.file, record.kind as Parameters<ArtifactStore["read"]>[1]);
    },

    async savePublish(ref, kit) {
      assertSafeId(ref.episodeId, "episode id");
      const series = await load(ref.seriesId);
      if (series.info.styleSample) throw new EngineError("stage_blocked", "Style samples do not enter publishing");
      if (series.activeJob || series.editing) throw new EngineError("busy", `a job is running for ${ref.seriesId}`);
      const key = stageKey("publish", ref.episodeId);
      if (!series.store.has(files.publish(ref.episodeId))) throw new EngineError("stage_blocked", `${key} hasn't run yet`);
      const parsed = PublishKit.safeParse(kit);
      if (!parsed.success) throw new EngineError("validation_failed", `the publish kit is invalid: ${parsed.error.message}`);
      // Studio would refuse these, so they aren't saved.
      const problems = checkYoutube(parsed.data.youtube);
      if (problems.length > 0) throw new EngineError("validation_failed", problems.map((problem) => problem.problem).join(" "));
      // The thumbnail changes only through setThumbnail, which renders it; keep the one on disk.
      const { thumbnail } = (await series.store.read(files.publish(ref.episodeId), "PublishKit")).data;
      const kitToSave: PublishKit = { youtube: parsed.data.youtube, ...(thumbnail && { thumbnail }) };
      const saved = await series.store.save(files.publish(ref.episodeId), "PublishKit", kitToSave, { producedBy: "human" });
      if (!saved.changed) return;
      series.ledger.decide("edit", key, `edited by you (revision ${saved.meta.revision})`);
      await outputChanged(series, key, saved.meta.contentHash);
    },

    async setThumbnail(ref, choice) {
      const parsed = ThumbnailChoice.safeParse(choice);
      if (!parsed.success) throw new EngineError("validation_failed", parsed.error.issues.map(issue => issue.message).join("; "));
      choice = parsed.data;
      assertSafeId(ref.episodeId, "episode id");
      assertSafeId(choice.shotId, "shot id");
      const series = await load(ref.seriesId);
      if (series.info.styleSample) throw new EngineError("stage_blocked", "Style samples do not enter publishing");
      if (series.activeJob || series.editing) throw new EngineError("busy", `a job is running for ${ref.seriesId}`);
      const key = stageKey("publish", ref.episodeId);
      if (!series.store.has(files.publish(ref.episodeId))) throw new EngineError("stage_blocked", `${key} hasn't run yet`);
      if (!series.store.has(files.shotSpec(ref.episodeId, choice.shotId))) throw new EngineError("not_found", `shot ${choice.shotId} has no scene yet`);
      const kit = (await series.store.read(files.publish(ref.episodeId), "PublishKit")).data;
      const thumbnail = await renderThumbnail(contextFor(series, new AbortController().signal), ref.episodeId, choice);
      const saved = await series.store.save(files.publish(ref.episodeId), "PublishKit", { ...kit, thumbnail }, { producedBy: "human" });
      if (!saved.changed) return;
      series.ledger.decide("edit", key, `thumbnail changed by you (revision ${saved.meta.revision})`);
      await outputChanged(series, key, saved.meta.contentHash);
    },

    // Kits already written keep their text; rewritePublish applies new defaults to one.
    async setPublishDefaults(seriesId, defaults) {
      const series = await load(seriesId);
      if (series.info.styleSample) throw new EngineError("stage_blocked", "Style samples do not enter publishing");
      const current = series.store.has(files.publishDefaults) ? (await series.store.read(files.publishDefaults, "PublishDefaults")).data : {};
      const parsed = PublishDefaults.safeParse({ ...current, ...defaults });
      if (!parsed.success) throw new EngineError("validation_failed", `publish defaults are invalid: ${parsed.error.message}`);
      await series.store.save(files.publishDefaults, "PublishDefaults", parsed.data, { producedBy: "human" });
    },

    async rewritePublish(ref, feedback) {
      assertSafeId(ref.episodeId, "episode id");
      const key = stageKey("publish", ref.episodeId);
      const series = await load(ref.seriesId);
      if (series.info.styleSample) throw new EngineError("stage_blocked", "Style samples do not enter publishing");
      if (series.activeJob || series.editing) throw new EngineError("busy", `a job is already running for ${ref.seriesId}`);
      const note = feedback?.trim().slice(0, 2000);
      series.ledger.setStage(key, { feedback: note || undefined });
      await series.ledger.save();
      return startJob(ref.seriesId, "stage", key, async (ctx, job) => {
        job.stagesRun = await runStages(ctx, key, { once: true });
      });
    },
  };
}

// A project made by a newer moco, or an older spec major with no migration, can't be opened safely.
// shortcut: no migrations exist yet; add them in @moco/spec when the spec has its first breaking change.
// Projects from before specVersion existed have none and count as incompatible.
function isCompatible(info: SeriesInfo): boolean {
  const major = (version: unknown) => (typeof version === "string" ? Number(version.split(".")[0]) : Number.NaN);
  return major(info.specVersion) === major(SPEC_VERSION);
}

function assertCompatible(info: SeriesInfo): void {
  if (!isCompatible(info)) {
    const made = typeof info.specVersion === "string" ? `uses spec ${info.specVersion}` : "was made by an older moco";
    throw new EngineError("not_found", `${info.id} ${made}; this moco reads ${SPEC_VERSION}. It needs a migration.`);
  }
}

// "krishna-arjuna" → "krishna-arjuna-2" if the first is taken.
async function uniqueSeriesId(projectsDir: string, base: string): Promise<string> {
  const candidates = [base, ...Array.from({ length: 98 }, (_, i) => `${base}-${i + 2}`)];
  for (const candidate of candidates) {
    if (!(await exists(join(projectsDir, candidate)))) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}
