// Typed engine events. Every event goes to subscribers (the desktop UI) and to the series' events.jsonl.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type EngineEventType =
  | "stage.started"
  | "stage.awaiting_approval"
  | "stage.approved"
  | "stage.done"
  | "stage.failed"
  | "artifact.saved"
  | "artifact.stale"
  | "artifact.modified_externally"
  | "shot.attempt"
  | "shot.fallback"
  | "script.sent_back"
  | "script.duration_off_target"
  | "job.started"
  | "job.finished"
  | "usage.updated"
  | "usage.rate_limited"
  | "render.progress";

export interface EngineEvent {
  type: EngineEventType;
  seriesId: string;
  at: string;
  data: Record<string, unknown>;
}

export type Unsubscribe = () => void;
type Listener = (event: EngineEvent) => void;

export class EventBus {
  private readonly listeners = new Map<EngineEventType | "*", Set<Listener>>();

  private readonly projectsDir: string;

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
  }

  // Subscribe to one event type, or "*" for all.
  on(type: EngineEventType | "*", listener: Listener): Unsubscribe {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
    return () => set.delete(listener);
  }

  async emit(seriesId: string, type: EngineEventType, data: Record<string, unknown> = {}): Promise<void> {
    const event: EngineEvent = { type, seriesId, at: new Date().toISOString(), data };
    const targets = [...(this.listeners.get(type) ?? []), ...(this.listeners.get("*") ?? [])];
    targets.forEach((listener) => safeCall(listener, event));
    // Append-only log, one JSON object per line, for the UI's activity view and debugging.
    const dir = join(this.projectsDir, seriesId);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "events.jsonl"), JSON.stringify(event) + "\n");
  }
}

// A broken UI listener must not break the pipeline.
function safeCall(listener: Listener, event: EngineEvent): void {
  try {
    listener(event);
  } catch (err) {
    console.error("[moco/engine] event listener threw:", err);
  }
}
