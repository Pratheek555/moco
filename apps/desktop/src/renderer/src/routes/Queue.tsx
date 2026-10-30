// What the engine is doing: series with work running, and the latest engine events.
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { runningSeries, stageLabel, useApp } from "../lib/store.ts";
import { timeAgo } from "../lib/format.ts";
import { Empty, Tag } from "../components/ui.tsx";
import type { EngineEvent } from "../lib/api.ts";

// Events worth a line in the log; the rest (artifact saves, usage) are noise here.
const SHOWN = new Set([
  "stage.started",
  "stage.done",
  "stage.awaiting_approval",
  "stage.approved",
  "stage.failed",
  "shot.attempt",
  "shot.fallback",
  "script.sent_back",
  "usage.rate_limited",
  "job.finished",
]);

function describe(event: EngineEvent): string {
  const key = String(event.data.key ?? "");
  switch (event.type) {
    case "stage.started":
      return `Started ${stageLabel(key)}`;
    case "stage.done":
      return `Finished ${stageLabel(key)}`;
    case "stage.awaiting_approval":
      return `${stageLabel(key)} is ready for your review`;
    case "stage.approved":
      return `You approved ${stageLabel(key)}`;
    case "stage.failed":
      return `${stageLabel(key)} failed: ${(event.data.error as { message?: string })?.message ?? ""}`;
    case "shot.attempt":
      return `Shot ${String(event.data.shotId ?? "")}: attempt ${String(event.data.attempt ?? "")}`;
    case "shot.fallback":
      return `Shot ${String(event.data.shotId ?? "")} used a safe fallback`;
    case "script.sent_back":
      return "The script went back to be fitted to the voiceover";
    case "usage.rate_limited":
      return "Claude is rate limited; waiting";
    case "job.finished":
      return `Job ${String(event.data.status ?? "")}`;
    default:
      return event.type;
  }
}

export function QueuePage() {
  const library = useApp((s) => s.library),
    events = useApp((s) => s.events),
    progress = useApp((s) => s.progress),
    go = useApp((s) => s.go);
  const busy = runningSeries(library);
  const log = events.filter((e) => SHOWN.has(e.type)).slice(-60).reverse();
  return (
    <div className="page enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MADE ON THIS COMPUTER</div>
          <h1>Activity</h1>
          <p>What Moco is writing and rendering right now.</p>
        </div>
      </div>
      {busy.length === 0 && log.length === 0 ? (
        <Empty title="Nothing running" detail="Start a series in the studio, or continue one from My series." />
      ) : (
        <div className="jobs-list">
          {busy.map((s) => (
            <button key={s.id} className="job-row" onClick={() => go({ name: "series", id: s.id })}>
              <LoaderCircle size={16} className="spin" />
              <div className="job-title">
                <strong>{s.title}</strong>
                <span>{progress[s.id] !== undefined ? `Rendering ${Math.round(progress[s.id]! * 100)}%` : "Working…"}</span>
              </div>
              <ArrowUpRight size={15} />
            </button>
          ))}
          {log.map((event, i) => (
            <div key={`${event.at}-${i}`} className="job-row">
              <Tag tone={event.type === "stage.failed" ? "red" : ""}>
                {library.find((s) => s.id === event.seriesId)?.title ?? event.seriesId}
              </Tag>
              <div className="job-title">
                <span>{describe(event)}</span>
              </div>
              <span className="hint">{timeAgo(event.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
