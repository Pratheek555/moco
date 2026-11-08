import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ClapperboardIcon, RotateCcwIcon } from "lucide-react";
import type { SeriesPlan } from "@moco/spec";
import { api, type SeriesStatus } from "@/lib/api";
import { activeStageKey, report, stageLabel, useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { StudioActivity } from "./StudioActivity";
import {
  DirectionQueue, GenerationBrief, GenerationComposer, GenerationHeader,
  GenerationIdentity, GenerationSidebar, useDirectionNotes,
} from "./GenerationWorkspace";
import { StudioDelivery } from "./StudioDelivery";

export { StudioProgress } from "./GenerationWorkspace";

export function StudioProduction({ status, plan, review, children }: {
  status: SeriesStatus;
  plan?: SeriesPlan;
  review: (focus: () => void, hasQueuedDirection: boolean) => ReactNode;
  children: ReactNode;
}) {
  const id = status.series.id;
  const events = useApp(s => s.events);
  const progress = useApp(s => s.progress[id]);
  const [following, setFollowing] = useState(true);
  const follow = useRef(true);
  const board = useRef<HTMLDetailsElement>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [note, setNote] = useState("");
  const [notes, setNotes] = useDirectionNotes(id);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const running = Boolean(status.activeJob);
  const next = status.next;
  const waiting = next.kind === "waiting" && next.status === "awaiting_approval"
    ? status.stages.find(s => s.key === next.key) : undefined;
  const currentKey = activeStageKey(status);
  const failed = status.stages.find(s => s.status === "failed");
  const job = status.jobs.at(-1);
  const error = failed?.error?.message ?? (job?.status === "failed" ? job.error?.message : undefined);
  const finished = next.kind === "finished";
  const nextEpisodeId = "key" in next ? next.key.split("/")[0] : undefined;
  const publishing = status.activeJob?.target.endsWith("/publish");
  const completedEpisode = (!running || publishing) && !waiting && !error ? plan?.episodes.findLast(ep => (ep.id !== nextEpisodeId || status.activeJob?.target === `${ep.id}/publish`) && status.stages.some(s => s.key === `${ep.id}/final` && s.status === "done")) : undefined;
  const nextEpisode = next.kind === "run" && next.key.endsWith("/script") ? plan?.episodes.find(ep => ep.id === nextEpisodeId) : undefined;
  const sidebarKey = waiting?.key ?? completedEpisode?.id;
  const [closedSidebar, setClosedSidebar] = useState<string>();
  // A new gate or finished episode opens its own review, even if the previous one was closed.
  useEffect(() => { setClosedSidebar(undefined); }, [sidebarKey]);
  const sidebarOpen = Boolean(sidebarKey && closedSidebar !== sidebarKey);
  const requestChanges = () => {
    setClosedSidebar(sidebarKey);
    requestAnimationFrame(() => input.current?.focus());
  };
  const context = currentKey ? stageLabel(currentKey) : waiting ? stageLabel(waiting.key) : "Your series";

  useEffect(() => {
    if ((waiting || completedEpisode) && follow.current) scroll.current?.scrollTo({ top: 0 });
  }, [waiting?.key, completedEpisode?.id]);
  useLayoutEffect(() => {
    if (follow.current && running) scroll.current?.querySelector(".studio-feed")?.scrollIntoView({ block: "end" });
  }, [events.length, running, notes.length]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && running) element.querySelector(".studio-feed")?.scrollIntoView({ block: "end" });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [running]);
  const work = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (e) { report(e); } finally { setBusy(false); }
  };
  const revise = (text: string, clearDraft = true) => {
    if (!waiting || running || !text.trim()) return;
    void work(async () => {
      await api.stages.reject(id, waiting.key, text.trim());
      setNotes([]);
      if (clearDraft) setNote("");
      follow.current = true;
      setFollowing(true);
      await api.stages.run(id);
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim() || busy || finished) return;
    if (waiting && !running) revise([...notes.map(n => n.text), note].join("\n\n"));
    else {
      setNotes(old => [...old, { text: note.trim(), at: new Date().toISOString() }]);
      setNote("");
    }
  };
  const openBoard = () => {
    setBoardOpen(true);
    requestAnimationFrame(() => board.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
  };

  return <section className="studio-development studio-production dark" aria-label="Production studio">
    <GenerationHeader status={status} plan={plan} />
    <div className="generation-shell" data-sidebar={sidebarOpen}>
    <div className="development-layout generation-layout">
      <div className="development-scroll" ref={scroll} tabIndex={0} role="region" aria-label="Studio workspace" onScroll={() => {
        const el = scroll.current;
        const feed = el?.querySelector(".studio-feed");
        if (!el || !feed) return;
        const near = feed.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom < 80;
        follow.current = near;
        setFollowing(near);
      }}>
        <div className="development-messages">
          <GenerationBrief status={status} />
          <GenerationIdentity running={running} label={running ? "In the making" : waiting ? "Ready for your review" : completedEpisode ? "Ready to publish" : finished ? "Ready to watch" : error ? "Needs attention" : "Work saved"} />
          {waiting && !running ? <div className="studio-production-state"><h1>{stageLabel(waiting.key)} is ready.</h1><p>Review the work and approve it when you’re happy, or send a note for the next draft.</p><Button variant="outline" onClick={() => setClosedSidebar(undefined)}>Review {stageLabel(waiting.key).toLowerCase()}</Button></div>
          : completedEpisode ? <div className="studio-production-state"><span className="generation-state-label" data-state="complete">Ready to publish</span><h1>{completedEpisode.title}</h1><p>Your video is complete. Preview the final cut and prepare your publishing details.</p><Button onClick={() => setClosedSidebar(undefined)}>Publishing help <ArrowUpIcon /></Button></div>
          : <div className="studio-production-state">
            <span className="generation-state-label" data-state={running ? "working" : finished ? "complete" : error ? "error" : "paused"}>
              <span className="generation-status-dot" data-running={running} />{running ? "Creating your animation" : finished ? "All yours" : error ? "A little help needed" : "Paused, right where you left it"}
            </span>
            <h1>{running ? currentKey ? stageLabel(currentKey) : "Preparing the next step" : finished ? "Your story is ready." : error ? "Let's pick up where we left off." : "Your work is saved."}</h1>
            <p role="status">{running ? "Turning your direction into characters, scenes, and a story that moves. The next milestone is yours to review." : finished ? "From that first little idea to the final frame. Watch your episodes or keep refining the details." : error ?? "Your approved work is safe. Continue whenever inspiration finds you."}</p>
            {running && progress !== undefined && <div className="studio-render-progress"><Progress value={Math.max(0, Math.min(100, progress * 100))} aria-label="Render progress" /><span>{Math.round(progress * 100)}%</span></div>}
            {!running && <div className="flex flex-wrap gap-2 pt-2">
              <Button disabled={busy} onClick={() => finished ? openBoard() : void work(() => api.stages.run(id, failed?.key))}>{busy ? <Spinner /> : <RotateCcwIcon />}{finished ? "Explore episodes" : error ? "Try again" : "Continue production"}</Button>
              {error && failed?.key.endsWith("/scenes") && <Button variant="outline" onClick={() => useApp.getState().go({ name: "episode", seriesId: id, episodeId: failed.key.split("/")[0]! })}>Review saved shots <ArrowUpIcon /></Button>}
            </div>}
          </div>}
          <StudioActivity status={status} />
          <div className="generation-note-history">{notes.map((n, i) => <article className="development-direction" key={`${n.at}-${i}`}><ArrowUpIcon /><div><span className="development-label">Your direction &middot; queued for the next review</span><p>{n.text}</p></div></article>)}</div>
          <details ref={board} className="generation-project-work" open={boardOpen} onToggle={e => setBoardOpen(e.currentTarget.open)}>
            <summary><ClapperboardIcon /><div><strong>Project workspace</strong><span>{plan ? `${plan.episodes.length} ${plan.episodes.length === 1 ? "episode" : "episodes"}` : "Episodes, cast, and your creative decisions"}</span></div><span className="generation-work-status">{finished ? "Ready to explore" : "View your work"}</span><ChevronDownIcon /></summary>
            <div className="studio-inline-board">{children}</div>
          </details>
        </div>
      </div>
      <div className="development-composer-dock">
        {!following && running && <Button className="development-latest" size="sm" variant="outline" onClick={() => { follow.current = true; setFollowing(true); scroll.current?.querySelector(".studio-feed")?.scrollIntoView({ block: "end" }); }}>Latest update <ArrowDownIcon /></Button>}
        <DirectionQueue notes={notes} canApply={Boolean(waiting) && !running} busy={busy} onApply={() => revise(notes.map(n => n.text).join("\n\n"), false)} onClear={() => setNotes([])} />
        <GenerationComposer status={status} inputRef={input} value={note} onChange={setNote} onSubmit={submit} label="Review direction" context={context}
          placeholder={finished ? "Open an episode to refine a shot or export your film." : waiting ? "What would you like to change?" : "A new thought? Leave a note for your next review."}
          busy={busy} disabled={finished} onStop={() => void work(() => api.stages.cancel(status.activeJob!.id))} sendLabel={waiting && !running ? "Send review changes" : "Save production note"} />
      </div>
    </div>
    {sidebarOpen && <GenerationSidebar key={sidebarKey} label={waiting ? "Review & approve" : "Publish your video"} onClose={() => setClosedSidebar(sidebarKey)}>
      {waiting ? review(requestChanges, notes.length > 0) : completedEpisode && <StudioDelivery key={completedEpisode.id} status={status} episode={completedEpisode} nextEpisode={nextEpisode} />}
    </GenerationSidebar>}
    </div>
  </section>;
}
