// The ledger: one JSON index per series of artifact hashes, stage statuses, jobs, decisions and usage.
// The engine is the single writer, so an in-memory copy plus serialised atomic saves is enough.
// shortcut: JSON file, not SQLite; move to SQLite if projects grow past a few thousand artifacts.
import { join } from "node:path";
import { exists, readJson, writeJsonAtomic } from "./workspace.ts";

export type StageStatus = "pending" | "running" | "awaiting_approval" | "approved" | "done" | "failed" | "stale";

export interface StageRecord {
  status: StageStatus;
  artifactHash?: string; // hash the gate is bound to (or the stage's output hash)
  error?: { code: string; message: string };
  feedback?: string; // from reject() or a send-back; goes into the next prompt, cleared after success
  preserveArtwork?: boolean; // precise edits disable automatic whole-cut repair on export retries
  sendBacks?: number; // voiceover → script send-backs so far
  narrationWordBudget?: number; // artist projects: recalibrated from actual narration, not a fixed WPM guess
  updatedAt: string;
}

export interface ArtifactRecord {
  kind: string;
  revision: number;
  contentHash: string;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  kind: "stage" | "shot";
  target: string; // stage key or "<ep>/shots/<shot>"
  status: JobStatus;
  stagesRun: string[];
  startedAt: string;
  endedAt?: string;
  error?: { code: string; message: string };
}

// Append-only record of things the user must be able to see: fallbacks, send-backs, restores.
export interface Decision {
  at: string;
  category: "fallback" | "send_back" | "duration_off_target" | "restore" | "regenerate" | "edit" | "look" | "feedback" | "learn" | "canon";
  subject: string;
  detail: string;
}

// One day of AI use, for the usage page. Keyed by local date, so "today" matches the user's clock.
export interface DailyUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdEstimate: number;
  rateLimits: number; // calls stopped by the user's plan limit
}

export interface LedgerData {
  episodeIds: string[]; // from the current series plan, in order; empty before it exists
  // Set by extendSeries until the longer plan is approved: series_plan keeps the first `keep` episodes and plans
  // the rest, steered by `note`.
  planExtension?: { keep: number; note?: string };
  artifacts: Record<string, ArtifactRecord>; // key: file path relative to the series folder
  stages: Record<string, StageRecord>; // key: "bible" or "ep-01/script"
  jobs: Record<string, JobRecord>;
  decisions: Decision[];
  usage: {
    aiCalls: Record<string, number>; // key: episode id or "series"
    costUsdEstimate: number;
    // Added after the first release: ledgers from before it have neither, so readers treat them as empty.
    tokens?: { input: number; output: number };
    daily?: Record<string, DailyUsage>; // key: local date, "2026-11-03"
  };
}

export class Ledger {
  private saving: Promise<void> = Promise.resolve();

  private readonly path: string;
  readonly data: LedgerData;

  private constructor(path: string, data: LedgerData) {
    this.path = path;
    this.data = data;
  }

  static async load(dir: string): Promise<Ledger> {
    const path = join(dir, "ledger.json");
    const empty: LedgerData = { episodeIds: [], artifacts: {}, stages: {}, jobs: {}, decisions: [], usage: { aiCalls: {}, costUsdEstimate: 0 } };
    const data = (await exists(path)) ? await readJson<LedgerData>(path) : empty;
    return new Ledger(path, data);
  }

  // Queue a save of the current state. Saves run one after another so the file is never written twice at once.
  save(): Promise<void> {
    const snapshot = structuredClone(this.data);
    this.saving = this.saving.then(() => writeJsonAtomic(this.path, snapshot));
    return this.saving;
  }

  // Readers must not observe a local save between its artifact and ledger writes.
  settled(): Promise<void> { return this.saving; }

  stage(key: string): StageRecord {
    return this.data.stages[key] ?? { status: "pending", updatedAt: new Date(0).toISOString() };
  }

  setStage(key: string, patch: Partial<StageRecord>): StageRecord {
    const next = { ...this.stage(key), ...patch, updatedAt: new Date().toISOString() };
    this.data.stages[key] = next;
    return next;
  }

  // Today's usage row, created on first use.
  today(): DailyUsage {
    const daily = (this.data.usage.daily ??= {});
    return (daily[localDate(new Date())] ??= { calls: 0, inputTokens: 0, outputTokens: 0, costUsdEstimate: 0, rateLimits: 0 });
  }

  decide(category: Decision["category"], subject: string, detail: string): void {
    this.data.decisions.push({ at: new Date().toISOString(), category, subject, detail });
  }
}

export function localDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
