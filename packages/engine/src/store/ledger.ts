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
  sendBacks?: number; // voiceover → script send-backs so far
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
  category: "fallback" | "send_back" | "duration_off_target" | "restore" | "regenerate";
  subject: string;
  detail: string;
}

export interface LedgerData {
  episodeIds: string[]; // from the current series plan, in order; empty before it exists
  artifacts: Record<string, ArtifactRecord>; // key: file path relative to the series folder
  stages: Record<string, StageRecord>; // key: "bible" or "ep-01/script"
  jobs: Record<string, JobRecord>;
  decisions: Decision[];
  usage: { aiCalls: Record<string, number>; costUsdEstimate: number }; // aiCalls key: episode id or "series"
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

  stage(key: string): StageRecord {
    return this.data.stages[key] ?? { status: "pending", updatedAt: new Date(0).toISOString() };
  }

  setStage(key: string, patch: Partial<StageRecord>): StageRecord {
    const next = { ...this.stage(key), ...patch, updatedAt: new Date().toISOString() };
    this.data.stages[key] = next;
    return next;
  }

  decide(category: Decision["category"], subject: string, detail: string): void {
    this.data.decisions.push({ at: new Date().toISOString(), category, subject, detail });
  }
}
