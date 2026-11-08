import { useEffect, useState } from "react";
import type { ShotList } from "@moco/spec";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/async";
import { ActivityIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon, MessageSquareIcon } from "lucide-react";
import type { EngineEvent, SeriesStatus } from "@/lib/api";
import { activeStageKey, stageLabel, useApp } from "@/lib/store";
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
    case "shot.started": return `Creating ${shot}${e.data.intent ? `: ${e.data.intent}` : "."}`;
    case "shot.done": return `${shot}: ${e.data.fallback ? "saved with a fallback; needs review" : e.data.reused ? "saved shot reused" : "animation saved"}.`;
    case "episode.completed": return `Episode ${Number(String(e.data.episodeId).slice(3))} is ready to publish.`;
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
  // Only show work from the current job; completed shots drop out of the live line.
  const currentKey = activeStageKey(status);
  const live = updates.filter(({ e }) => (!status.activeJob || e.at >= status.activeJob.startedAt));
  const completedShots = new Set<string>();
  for (const { e } of live) {
    if (e.type === "shot.started") completedShots.delete(String(e.data.shotId));
    if (e.type === "shot.done") completedShots.add(String(e.data.shotId));
  }
  const latest = live.filter(({ e }) => ["ai.activity", "shot.started", "stage.started", "render.progress", "usage.rate_limited"].includes(e.type)
    && (!currentKey || !e.data.key || e.data.key === currentKey)
    && (!e.data.shotId || !completedShots.has(String(e.data.shotId)))).at(-1);
  const seconds = Math.max(0, Math.floor((now - Date.parse(status.activeJob?.startedAt ?? new Date(now).toISOString())) / 1000));
  return <section className="studio-feed" aria-label="Production activity">
    <details className="generation-process">
    <summary><ActivityIcon /><span>Production activity</span><small>{updates.length} {updates.length === 1 ? "update" : "updates"}</small><ChevronRightIcon /></summary>
    <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Production updates">
      {updates.map(({ e, text, id }) => <article key={id} className="studio-feed-message">
        {e.type === "stage.failed" || e.type === "shot.fallback" ? <CircleAlertIcon aria-hidden="true" /> : ["stage.done", "stage.approved", "shot.done"].includes(e.type) ? <CheckIcon aria-hidden="true" /> : <MessageSquareIcon aria-hidden="true" />}
        <div><p>{text}</p><time dateTime={e.at}>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
      </article>)}
    </div>
    {!updates.length && <p className="generation-empty-log">{running ? "Your first update will appear as Moco starts working." : "Continue production to pick up the conversation."}</p>}
    </details>
    <StudioShots status={status} />
    {running && <div className="studio-feed-working" role="status" aria-live="polite">
      <Spinner aria-hidden="true" /><div><span>{stageLabel(currentKey ?? ("key" in status.next ? status.next.key : "the next step"))}</span>
      <p className="generation-live-message">{latest?.text ?? "Preparing the next production step."}</p></div>
      <time aria-label="Elapsed run time" aria-live="off">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</time>
    </div>}
  </section>;
}

/** Saved stills appear as each shot arrives; a successful attempt alone isn't completion. */
function StudioShots({ status }: { status: SeriesStatus }) {
  const events = useApp(s => s.events);
  const stage = status.stages.find(s => s.status === "running") ?? status.stages.find(s => s.status === "awaiting_approval");
  const key = activeStageKey(status) ?? stage?.key;
  const episodeId = key?.includes("/") ? key.split("/")[0] : undefined;
  const shotEvents = events.filter(e => e.seriesId === status.series.id && e.data.episodeId === episodeId && ["shot.started", "shot.done"].includes(e.type));
  const milestone = shotEvents.at(-1);
  const listHash = status.stages.find(s => s.key === `${episodeId}/shot_list`)?.artifactHash;
  const { data, error } = useAsync(async () => {
    if (!episodeId || !listHash) return null;
    const [artifact, media] = await Promise.all([
      api.series.artifact(status.series.id, `episodes/${episodeId}/artifacts/shot_list.json`),
      api.episode.media(status.series.id, episodeId),
    ]);
    return { episodeId, shots: (artifact?.data as ShotList | undefined)?.shots ?? [], media };
  }, [status.series.id, episodeId, listHash, milestone]);
  if (error || !data || data.episodeId !== episodeId || !data.shots.length) return null;
  const states = new Map(shotEvents.map(e => [String(e.data.shotId), e]));
  const isWorking = (shotId: string) => {
    const event = states.get(shotId);
    return Boolean(status.activeJob && event?.type === "shot.started" && event.at >= status.activeJob.startedAt);
  };
  const isSaved = (shotId: string) => !isWorking(shotId) && (states.get(shotId)?.type === "shot.done" || Boolean(data.media.savedShots?.includes(shotId)));
  const done = data.shots.filter(shot => isSaved(shot.id)).length;
  return <section className="generation-shots" aria-label="Shot progress">
    <div className="generation-shots-heading"><h2>Your shots</h2><span>{done} / {data.shots.length} saved</span></div>
    <ol>{data.shots.map((shot, i) => {
      const event = states.get(shot.id);
      const working = isWorking(shot.id);
      const saved = isSaved(shot.id);
      const still = data.media.stills[shot.id]?.[0];
      return <li key={shot.id} data-state={working ? "working" : saved ? "done" : "pending"}>
        {still && <img src={still} alt={`Shot ${i + 1}: ${shot.intent}`} />}
        <div><span>Shot {String(i + 1).padStart(2, "0")}</span>{working ? <Spinner aria-label="Creating shot" /> : saved ? <CheckIcon aria-label="Shot saved" /> : null}</div>
        <p>{shot.intent}</p><small>{working ? "Creating animation" : event?.data.fallback ? "Fallback · needs review" : saved ? event?.data.reused ? "Reused" : "Saved" : still ? "Preview available" : "Waiting"}</small>
      </li>;
    })}</ol>
    <p>Saved shots may receive another pass during visual review.</p>
  </section>;
}
