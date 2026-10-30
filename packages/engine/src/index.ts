// @moco/engine — the backbone. The desktop app calls only this API.
// The engine is the single writer of projects/; the AI is a function it calls with tools disabled;
// approvals come only through approve() from the UI.
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AiBackend } from "@moco/ai";
import { catalog as defaultCatalog, type Catalog } from "@moco/kit";
import { SPEC_VERSION } from "@moco/spec";
import { defaultConfig, type EngineConfig } from "./config.ts";
import { EngineError } from "./errors.ts";
import { EventBus, type EngineEvent, type EngineEventType, type Unsubscribe } from "./events/bus.ts";
import { generateScene, neighbourAvoid, sceneSharedInputs, scenesHash } from "./generator/generate.ts";
import { Semaphore } from "./jobs/semaphore.ts";
import type { SeriesInfo, StageContext } from "./pipeline/context.ts";
import { approveGate, markDependantsStale, nextStage, type Next } from "./pipeline/machine.ts";
import { runStages } from "./pipeline/run.ts";
import { allStageKeys, files, GATED, parseStageKey, stageKey } from "./pipeline/stages.ts";
import type { AudioPort, RenderPort } from "./ports.ts";
import { ArtifactStore } from "./store/artifacts.ts";
import { Ledger, type Decision, type JobRecord, type StageRecord } from "./store/ledger.ts";
import { assertSafeId, exists, readJson, seriesDir, slugify, writeJsonAtomic } from "./store/workspace.ts";
import { meteredAi } from "./usage/meter.ts";

export { EngineError } from "./errors.ts";
export type { EngineErrorCode } from "./errors.ts";
export type { EngineEvent, EngineEventType, Unsubscribe } from "./events/bus.ts";
export type { AudioPort, RenderPort, RenderError, RenderCheck } from "./ports.ts";
export type { EngineConfig, EngineLimits } from "./config.ts";
export { defaultConfig } from "./config.ts";

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
  createSeries(input: { idea: string; language: string; episodes?: number }): Promise<SeriesId>;
  listSeries(): Promise<SeriesInfo[]>;
  runStage(ref: StageRef): Promise<JobId>;
  approve(ref: Required<StageRef>, contentHash: string): Promise<void>;
  reject(ref: Required<StageRef>, feedback: string): Promise<void>;
  status(seriesId: SeriesId): Promise<SeriesStatus>;
  regenerateShot(ref: ShotRef, feedback?: string): Promise<JobId>;
  renderPreview(ref: EpisodeRef): Promise<JobId>;
  renderFinal(ref: EpisodeRef): Promise<JobId>;
  cancel(jobId: JobId): Promise<void>;
  waitForJob(jobId: JobId): Promise<JobRecord>; // resolves when the job ends (any status)
  on(type: EngineEventType | "*", listener: (event: EngineEvent) => void): Unsubscribe;
  history(ref: ArtifactRef): Promise<{ revision: number; current: boolean }[]>;
  restore(ref: ArtifactRef, revision: number): Promise<void>;
  readArtifact(ref: ArtifactRef): Promise<unknown>; // { meta, data } for the UI to show
}

export interface CreateEngineOptions {
  projectsDir: string;
  ai: AiBackend;
  render: RenderPort;
  audio: AudioPort;
  catalog?: Catalog; // defaults to the installed kit catalog
  config?: Partial<EngineConfig>;
}

// One series loaded in memory.
interface OpenSeries {
  info: SeriesInfo;
  dir: string;
  ledger: Ledger;
  store: ArtifactStore;
  activeJob?: { id: JobId; controller: AbortController; done: Promise<void> };
}

export function createEngine(options: CreateEngineOptions): Engine {
  const config: EngineConfig = { ...defaultConfig(options.projectsDir), ...options.config };
  const catalog = options.catalog ?? defaultCatalog;
  const bus = new EventBus(config.projectsDir);
  const aiSlots = new Semaphore(config.limits.aiConcurrency);
  const renderSlots = new Semaphore(1); // rendering is CPU-heavy
  const ttsSlots = new Semaphore(1);
  const open = new Map<SeriesId, OpenSeries>();
  const jobOwners = new Map<JobId, SeriesId>();

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
    await ledger.save();

    const series: OpenSeries = { info, dir, ledger, store };
    open.set(seriesId, series);
    return series;
  }

  // A job or stage left "running" means the app died mid-way. Stages can safely run again.
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
    return {
      seriesId: series.info.id,
      series: series.info,
      dir: series.dir,
      config,
      catalog,
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
  }

  // ---------- jobs ----------

  // Start background work for a series. One job per series at a time keeps the ledger simple and safe.
  async function startJob(seriesId: SeriesId, kind: JobRecord["kind"], target: string, work: (ctx: StageContext, job: JobRecord) => Promise<void>): Promise<JobId> {
    const series = await load(seriesId);
    if (series.activeJob) throw new EngineError("busy", `a job is already running for ${seriesId}`);

    const job: JobRecord = { id: randomUUID(), kind, target, status: "running", stagesRun: [], startedAt: new Date().toISOString() };
    const controller = new AbortController();
    series.ledger.data.jobs[job.id] = job;
    jobOwners.set(job.id, seriesId);
    await series.ledger.save();
    await bus.emit(seriesId, "job.started", { jobId: job.id, kind, target });

    const done = (async () => {
      try {
        const available = await options.ai.available();
        if (!available.ok) throw new EngineError("ai_unavailable", available.reason ?? "AI backend is not available");
        await work(contextFor(series, controller.signal), job);
        job.status = "succeeded";
      } catch (err) {
        const cancelled = controller.signal.aborted;
        job.status = cancelled ? "cancelled" : "failed";
        job.error = err instanceof EngineError ? { code: err.code, message: err.message } : { code: "internal", message: err instanceof Error ? err.message : String(err) };
      } finally {
        job.endedAt = new Date().toISOString();
        series.activeJob = undefined;
        await series.ledger.save();
        await bus.emit(seriesId, "job.finished", { jobId: job.id, status: job.status, error: job.error });
      }
    })();

    series.activeJob = { id: job.id, controller, done };
    return job.id;
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
    const episodeArtifact = /^episodes\/([a-z0-9-]+)\/artifacts\/(script|voiceover|shot_list|preview_report|render_report)\.json$/.exec(file);
    if (episodeArtifact) {
      const stage = { script: "script", voiceover: "voiceover", shot_list: "shot_list", preview_report: "preview", render_report: "final" }[episodeArtifact[2]!]!;
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

  return {
    async createSeries(input) {
      const idea = input.idea.trim();
      const episodes = input.episodes ?? 3;
      if (!idea || idea.length > 4000) throw new EngineError("invalid_id", "the idea must be 1–4000 characters");
      if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(input.language)) throw new EngineError("invalid_id", `"${input.language}" is not a language code like "en" or "hi"`);
      if (!Number.isInteger(episodes) || episodes < 1 || episodes > 30) throw new EngineError("invalid_id", "episodes must be 1–30");

      const id = await uniqueSeriesId(config.projectsDir, slugify(idea.split(/\s+/).slice(0, 6).join(" ")));
      const info: SeriesInfo = { id, idea, language: input.language, episodes, createdAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, specVersion: SPEC_VERSION };
      await writeJsonAtomic(join(seriesDir(config.projectsDir, id), "series.json"), info);
      await load(id);
      return id;
    },

    async listSeries() {
      const names = (await exists(config.projectsDir)) ? await readdir(config.projectsDir) : [];
      const markers = names.map((name) => join(config.projectsDir, name, "series.json"));
      const found = await Promise.all(markers.map(async (path) => ((await exists(path)) ? readJson<SeriesInfo>(path) : undefined)));
      return found.filter((info): info is SeriesInfo => info !== undefined);
    },

    async runStage(ref) {
      return startJob(ref.seriesId, "stage", ref.key ?? "next", async (ctx, job) => {
        job.stagesRun = await runStages(ctx, ref.key);
      });
    },

    async approve(ref, contentHash) {
      const series = await load(ref.seriesId);
      approveGate(series.ledger, ref.key, contentHash);
      await series.ledger.save();
      await bus.emit(ref.seriesId, "stage.approved", { key: ref.key, contentHash });
    },

    async reject(ref, feedback) {
      const series = await load(ref.seriesId);
      const record = series.ledger.stage(ref.key);
      if (record.status !== "awaiting_approval") {
        throw new EngineError("not_awaiting_approval", `${ref.key} is ${record.status}, not awaiting approval`);
      }
      // The feedback is put into the stage's next prompt.
      series.ledger.setStage(ref.key, { status: "pending", feedback: feedback.trim().slice(0, 2000) });
      await series.ledger.save();
    },

    async status(seriesId) {
      const series = await load(seriesId);
      const { ledger } = series;
      const keys = allStageKeys(ledger.data.episodeIds);
      const stages = keys.map((key) => ({ key, gated: GATED.has(parseStageKey(key).stage), ...ledger.stage(key) }));
      const activeJob = series.activeJob ? ledger.data.jobs[series.activeJob.id] : undefined;
      return {
        series: series.info,
        stages,
        next: nextStage(ledger, ledger.data.episodeIds),
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
        ctx.ledger.decide("regenerate", `${ref.episodeId}/${ref.shotId}`, feedback ?? "no feedback");
        await outputChanged(series, scenesKey, await scenesHash(ctx, ref.episodeId));
      });
    },

    async renderPreview(ref) {
      assertSafeId(ref.episodeId, "episode id");
      return this.runStage({ seriesId: ref.seriesId, key: stageKey("preview", ref.episodeId) });
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
      const series = await load(ref.seriesId);
      return series.store.history(ref.file);
    },

    // Restoring the current revision of an externally edited file accepts the edit as a human revision.
    async restore(ref, revision) {
      const series = await load(ref.seriesId);
      if (series.activeJob) throw new EngineError("busy", `a job is running for ${ref.seriesId}`);
      const record = series.ledger.data.artifacts[ref.file];
      if (!record) throw new EngineError("not_found", `artifact ${ref.file} does not exist`);

      const data = await series.store.readRevision(ref.file, revision);
      const kind = record.kind as Parameters<ArtifactStore["save"]>[1];
      const saved = await series.store.save(ref.file, kind, data, { producedBy: "human" });
      if (ref.file === files.seriesPlan) {
        series.ledger.data.episodeIds = (saved.data as { episodes: { id: string }[] }).episodes.map((episode) => episode.id);
      }
      series.ledger.decide("restore", ref.file, `restored revision ${revision} as revision ${saved.meta.revision}`);

      const key = stageOfFile(ref.file);
      const ctx = contextFor(series, new AbortController().signal);
      const hash = key?.endsWith("/scenes") ? await scenesHash(ctx, parseStageKey(key).episodeId!) : saved.meta.contentHash;
      if (key) await outputChanged(series, key, hash);
      else await series.ledger.save();
    },

    async readArtifact(ref) {
      const series = await load(ref.seriesId);
      const record = series.ledger.data.artifacts[ref.file];
      if (!record) throw new EngineError("not_found", `artifact ${ref.file} does not exist`);
      return series.store.read(ref.file, record.kind as Parameters<ArtifactStore["read"]>[1]);
    },
  };
}

// A project made by a newer moco, or an older spec major with no migration, can't be opened safely.
// shortcut: no migrations exist yet; add them in @moco/spec when the spec has its first breaking change.
function assertCompatible(info: SeriesInfo): void {
  const major = (version: string) => Number(version.split(".")[0]);
  if (major(info.specVersion) !== major(SPEC_VERSION)) {
    throw new EngineError("not_found", `${info.id} uses spec ${info.specVersion}; this moco reads ${SPEC_VERSION}. It needs a migration.`);
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
