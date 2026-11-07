import { useEffect, useState } from "react";
import { ActivityIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon, MessageSquareIcon } from "lucide-react";
import type { EngineEvent, SeriesStatus } from "@/lib/api";
import { stageLabel, useApp } from "@/lib/store";
import { Spinner } from "@/components/ui/spinner";

function message(e: EngineEvent): string | undefined {
  const key = stageLabel(String(e.data.key ?? ""));
  const shot = String(e.data.shotId ?? "shot");
  switch (e.type) {
    case "ai.activity": return String(e.data.message ?? "");
    case "stage.started": return `Starting ${key.toLowerCase()}.`;
    case "stage.done": return `${key} is complete.`;
    case "stage.approved": return `You approved ${key.toLowerCase()}.`;
    case "stage.awaiting_approval": return `${key} is ready for your review.`;
    case "stage.failed": return `${key} needs attention: ${(e.data.error as { message?: string })?.message ?? "Please try again."}`;
    case "shot.attempt": return `${shot}: checked attempt ${e.data.attempt}.${Number(e.data.errors) > 0 ? " Refining the shot after validation." : " Shot checks passed."}`;
    case "shot.fallback": return `${shot}: using a fallback after validation.`;
    case "usage.rate_limited": return "Waiting for the AI provider's rate limit to clear.";
    case "script.sent_back": return "Adjusting the script to fit the voiceover.";
    case "look.shots": return "Shot visual review updated.";
    case "look.repairs": return "Visual repair results updated.";
    case "canon.grown": return "New characters and places added to the series.";
    default: return undefined;
  }
}

/** Public commentary and actual production milestones, never simulated work. */
export function StudioActivity({ status }: { status: SeriesStatus }) {
  const events = useApp((s) => s.events);
  const [now, setNow] = useState(Date.now());
  const running = Boolean(status.activeJob);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const updates = events.filter((e) => e.seriesId === status.series.id)
    .flatMap((e, i) => {
      const text = message(e);
      return text ? [{ e, text, id: `${e.at}-${i}` }] : [];
    }).slice(-100);
  const seconds = Math.max(0, Math.floor((now - Date.parse(status.activeJob?.startedAt ?? new Date(now).toISOString())) / 1000));
  return <section className="studio-feed" aria-label="Production activity">
    <details className="generation-process">
    <summary><ActivityIcon /><span>Production activity</span><small>{updates.length} {updates.length === 1 ? "update" : "updates"}</small><ChevronRightIcon /></summary>
    <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Production updates">
      {updates.map(({ e, text, id }) => <article key={id} className="studio-feed-message">
        {e.type === "stage.failed" ? <CircleAlertIcon aria-hidden="true" /> : ["stage.done", "stage.approved", "shot.attempt"].includes(e.type) ? <CheckIcon aria-hidden="true" /> : <MessageSquareIcon aria-hidden="true" />}
        <div><p>{text}</p><time dateTime={e.at}>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
      </article>)}
    </div>
    {!updates.length && <p className="generation-empty-log">{running ? "Your first update will appear as Moco starts working." : "Continue production to pick up the conversation."}</p>}
    </details>
    {running && <div className="studio-feed-working" role="status">
      <Spinner aria-hidden="true" /><span>Working on {stageLabel(status.stages.find((s) => s.status === "running")?.key ?? ("key" in status.next ? status.next.key : "the next step")).toLowerCase()}<span className="studio-working-dots" aria-hidden="true">...</span></span>
      <time aria-label="Elapsed run time" aria-live="off">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</time>
    </div>}
    {running && updates.length > 0 && <p className="generation-live-message" role="status" aria-live="polite">{updates.at(-1)!.text}</p>}
  </section>;
}
