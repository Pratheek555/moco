// Stage status transitions: what runs next, gates bound to content hashes, staleness.
import { EngineError } from "../errors.ts";
import type { Ledger, StageStatus } from "../store/ledger.ts";
import { allStageKeys, dependants, requires } from "./stages.ts";

const COMPLETE: StageStatus[] = ["approved", "done"];

export function isComplete(status: StageStatus): boolean {
  return COMPLETE.includes(status);
}

export function canRun(ledger: Ledger, key: string, episodeIds: string[]): boolean {
  return requires(key, episodeIds).every((upstream) => isComplete(ledger.stage(upstream).status));
}

export type Next =
  | { kind: "run"; key: string } // this stage can run now
  | { kind: "waiting"; key: string; status: StageStatus } // awaiting approval or already running
  | { kind: "finished" }; // every stage is complete

// The first stage, in run order, that isn't complete.
export function nextStage(ledger: Ledger, episodeIds: string[]): Next {
  const key = allStageKeys(episodeIds).find((candidate) => !isComplete(ledger.stage(candidate).status));
  if (!key) return { kind: "finished" };
  const status = ledger.stage(key).status;
  if (status === "awaiting_approval" || status === "running") return { kind: "waiting", key, status };
  return { kind: "run", key };
}

// Gate: only the UI calls this, and only with the hash of what the user actually saw.
export function approveGate(ledger: Ledger, key: string, contentHash: string): void {
  const record = ledger.stage(key);
  if (record.status !== "awaiting_approval") {
    throw new EngineError("not_awaiting_approval", `${key} is ${record.status}, not awaiting approval`);
  }
  if (record.artifactHash !== contentHash) {
    throw new EngineError("gate_mismatch", `${key} changed since you viewed it. Reload and review again.`);
  }
  ledger.setStage(key, { status: "approved", feedback: undefined });
}

// Mark every downstream stage that was built from `key`'s output as stale. Returns the keys marked.
export function markDependantsStale(ledger: Ledger, key: string, episodeIds: string[]): string[] {
  const marked: string[] = [];
  for (const dependant of dependants(key, episodeIds)) {
    marked.push(...markStale(ledger, dependant, episodeIds));
  }
  return marked;
}

function markStale(ledger: Ledger, key: string, episodeIds: string[]): string[] {
  const status = ledger.stage(key).status;
  const hasOutput = isComplete(status) || status === "awaiting_approval";
  if (hasOutput) ledger.setStage(key, { status: "stale" });
  const own = hasOutput ? [key] : [];
  return [...own, ...markDependantsStale(ledger, key, episodeIds)];
}
