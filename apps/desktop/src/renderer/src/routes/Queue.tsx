import { useState } from "react";
import {
  Check,
  Clock3,
  X,
  AlertCircle,
  FolderOpen,
  LoaderCircle,
  ArrowRight,
  Clapperboard,
} from "lucide-react";
import { api } from "../lib/api.ts";
import { useApp, activeJobs } from "../lib/store.ts";
import { timeAgo } from "../lib/format.ts";
import { Button, Empty, Tag, report } from "../components/ui.tsx";
export function QueuePage() {
  const jobs = useApp((s) => s.jobs),
    engine = useApp((s) => s.engine),
    go = useApp((s) => s.go);
  const [expanded, setExpanded] = useState<string | null>(null),
    [filter, setFilter] = useState("all");
  const active = activeJobs(jobs),
    list = jobs.filter(
      (j) =>
        filter === "all" ||
        (filter === "active" && ["running", "queued"].includes(j.status)) ||
        (filter === "done" && j.status === "done") ||
        (filter === "error" && j.status === "error"),
    );
  return (
    <div className="page enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">GOOD THINGS ARE IN MOTION</div>
          <h1>Render queue</h1>
          <p>Your studio keeps working while you keep creating.</p>
        </div>
        <Button
          disabled={
            !jobs.some((j) => !["running", "queued"].includes(j.status))
          }
          onClick={() => void api.jobs.clear().catch(report)}
        >
          Clear finished
        </Button>
      </div>
      <div className="queue-stats">
        <div>
          <span>In progress</span>
          <strong>{active.length.toString().padStart(2, "0")}</strong>
          <i className="blue-dot" />
        </div>
        <div>
          <span>Completed this session</span>
          <strong>
            {jobs
              .filter((j) => j.status === "done")
              .length.toString()
              .padStart(2, "0")}
          </strong>
          <Check size={18} />
        </div>
        <div>
          <span>Render engine</span>
          <strong className="engine-stat">
            {engine?.browser === "ready"
              ? "Ready to render"
              : engine?.browser === "downloading"
                ? `Downloading ${Math.round(engine.downloadPercent ?? 0)}%`
                : "Set up on first export"}
          </strong>
          <Clapperboard size={18} />
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["all", "All jobs"],
            ["active", "In progress"],
            ["done", "Completed"],
            ["error", "Needs attention"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filter === v ? "selected" : ""}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="hint">Jobs are kept for this session</span>
      </div>
      {!list.length ? (
        <Empty
          title={
            jobs.length
              ? "Nothing in this view"
              : "The studio is taking a breath"
          }
          detail="Create a series, generate a voiceover, or export an episode. Follow its progress here."
        >
          <Button variant="primary" onClick={() => go({ name: "studio" })}>
            Back to the studio <ArrowRight size={15} />
          </Button>
        </Empty>
      ) : (
        <div className="jobs-list">
          {list.map((j) => (
            <section key={j.id} className={`job-card status-${j.status}`}>
              <div className="job-row">
                <div className={`job-icon ${j.status}`}>
                  {j.status === "running" ? (
                    <LoaderCircle className="spin" size={20} />
                  ) : j.status === "done" ? (
                    <Check size={20} />
                  ) : j.status === "error" ? (
                    <AlertCircle size={20} />
                  ) : j.status === "canceled" ? (
                    <X size={20} />
                  ) : (
                    <Clock3 size={20} />
                  )}
                </div>
                <button
                  className="job-title"
                  onClick={() => setExpanded(expanded === j.id ? null : j.id)}
                >
                  <strong>{j.title}</strong>
                  <span className={j.status === "running" ? "shimmer" : ""}>
                    {j.status === "error" ? j.error : j.stage}
                  </span>
                </button>
                <Tag
                  tone={
                    j.status === "done"
                      ? "green"
                      : j.status === "error"
                        ? "red"
                        : ""
                  }
                >
                  {j.status === "done"
                    ? "Completed"
                    : j.status === "canceled"
                      ? "Cancelled"
                      : j.status}
                </Tag>
                <span className="hint">{timeAgo(j.createdAt)}</span>
                {["running", "queued"].includes(j.status) ? (
                  <Button
                    variant="ghost"
                    onClick={() => void api.jobs.cancel(j.id).catch(report)}
                  >
                    <X size={14} /> Cancel
                  </Button>
                ) : (
                  j.seriesId && (
                    <Button
                      onClick={() =>
                        go(
                          j.number
                            ? {
                                name: "episode",
                                seriesId: j.seriesId!,
                                number: j.number,
                              }
                            : { name: "series", id: j.seriesId! },
                        )
                      }
                    >
                      Open <ArrowRight size={14} />
                    </Button>
                  )
                )}
              </div>
              {j.status === "running" && (
                <div className="job-progress">
                  <span
                    style={{ width: `${Math.max(2, j.progress * 100)}%` }}
                  />
                </div>
              )}
              {j.output && j.kind !== "plan" && (
                <div className="job-output">
                  <Check size={13} />
                  <span>{j.output.split(/[\\/]/).at(-1)}</span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void api.app.showItem(j.output!).catch(report)
                    }
                  >
                    <FolderOpen size={13} /> Show file
                  </Button>
                </div>
              )}
              <button
                className="log-toggle"
                onClick={() => setExpanded(expanded === j.id ? null : j.id)}
              >
                {expanded === j.id ? "Hide details" : "View details"}
                {j.status === "running" &&
                  ` · ${Math.round(j.progress * 100)}%`}
              </button>
              {expanded === j.id && (
                <div className="job-details">
                  {j.logs.map((l, i) => (
                    <p className={l.level} key={i}>
                      <time>{new Date(l.t).toLocaleTimeString()}</time>
                      {l.msg}
                    </p>
                  ))}
                  {!j.logs.length && !j.stream && (
                    <p>Waiting for the job to start…</p>
                  )}
                  {j.stream && (
                    <details open={j.status === "running"}>
                      <summary>AI output</summary>
                      <pre>{j.stream}</pre>
                    </details>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
