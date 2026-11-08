import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  ListChecksIcon,
  MessageSquareTextIcon,
  RotateCcwIcon,
} from "lucide-react";
import type { SeriesPlan } from "@moco/spec";
import { api, type SeriesStatus } from "@/lib/api";
import { report, useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StudioAscii } from "./StudioAscii";

import { DirectionQueue, GenerationBrief, GenerationComposer, GenerationHeader, GenerationIdentity, GenerationSidebar } from "./GenerationWorkspace";

type Note = { text: string; at: string };
const notesKey = (id: string) => `moco.series-direction.${id}`;
function readNotes(id: string): Note[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(notesKey(id)) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter(
          (n): n is Note =>
            typeof n?.text === "string" && typeof n?.at === "string",
        )
      : [];
  } catch {
    return [];
  }
}
/** The first approval gate: submitted brief → live public updates → editable plan. */
export function SeriesDevelopment({
  status,
  plan,
}: {
  status: SeriesStatus;
  plan?: SeriesPlan;
}) {
  const id = status.series.id;
  const events = useApp((s) => s.events);
  const [direction, setDirection] = useState("");
  const [notes, setNotes] = useState<Note[]>(() => readNotes(id));
  const [busy, setBusy] = useState<
    "approve" | "revise" | "retry" | "stop" | null
  >(null);
  const [reviewing, setReviewing] = useState(true);
  const [following, setFollowing] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const review = useRef<HTMLElement>(null);
  const episodeRows = useRef(new Map<string, HTMLLIElement>());
  const follow = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const stage = status.stages.find((s) => s.key === "series_plan");
  const job = status.activeJob ?? status.jobs.at(-1);
  const running = Boolean(status.activeJob);
  const ready =
    stage?.status === "awaiting_approval" && Boolean(plan) && !running;
  const failure =
    !running && !ready
      ? (stage?.error?.message ??
        (job?.status === "failed" ? job.error?.message : undefined))
      : undefined;
  const cancelled = !running && !ready && job?.status === "cancelled";
  const updates = useMemo(
    () =>
      events.filter(
        (event) =>
          event.seriesId === id &&
          event.type === "ai.activity" &&
          event.data.key === "series_plan" &&
          (!job?.startedAt || event.at >= job.startedAt),
      ),
    [events, id, job?.startedAt],
  );
  const latest = updates.at(-1);
  const completed = running ? updates.slice(0, -1) : updates;
  const activeText = String(
    latest?.data.message ??
      "Moco is reading your brief and developing the premise, tone, and episode arc.",
  );
  const phase = ready
    ? 3
    : /character|cast|friend|keeper/i.test(activeText)
      ? 1
      : /world|setting|place|village/i.test(activeText)
        ? 2
        : /episode|chapter|arc/i.test(activeText) && updates.length > 1
          ? 3
          : 0;
  const title = failure
    ? "Let’s pick up where we left off."
    : cancelled
      ? "Your draft is safe."
      : ready
        ? "Your series plan is ready."
        : "A world is taking shape.";
  const activeTitle = failure
    ? "This draft needs another try."
    : cancelled
      ? "Development paused."
      : ready
        ? (plan?.title ?? "Your series plan")
        : latest?.data.phase === "retrying"
          ? "Giving the draft another pass."
          : latest?.data.phase === "checked"
            ? "The first draft is coming together."
            : "Developing your story.";

  useEffect(() => {
    try {
      localStorage.setItem(notesKey(id), JSON.stringify(notes));
    } catch {
      /* The note stays in memory if storage is unavailable. */
    }
  }, [id, notes]);

  useLayoutEffect(() => {
    if (follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [updates.length, activeText, ready, failure, notes.length, reviewing]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scrollLatest = () => {
    follow.current = true;
    setFollowing(true);
    // A smooth scroll's old target becomes stale if another message arrives mid-scroll.
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "instant",
    });
  };
  const work = async (
    kind: NonNullable<typeof busy>,
    action: () => Promise<unknown>,
  ) => {
    if (busy) return;
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  };
  const revise = (text: string, clearDraft = true) =>
    work("revise", async () => {
      await api.stages.reject(id, "series_plan", text);
      // The engine records feedback before starting the replacement draft.
      setNotes([]);
      if (clearDraft) setDirection("");
      setReviewing(true);
      follow.current = true;
      setFollowing(true);
      await api.stages.run(id);
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = direction.trim();
    if (!text || busy) return;
    if (ready) void revise([...notes.map((n) => n.text), text].join("\n\n"));
    else {
      setNotes((old) => [...old, { text, at: new Date().toISOString() }]);
      setDirection("");
    }
  };

  return (
    <section
      className="studio-development dark"
      aria-label="Series development"
    >
      <GenerationHeader status={status} plan={plan} />
      <div className="generation-shell" data-sidebar={Boolean(reviewing && ready && plan)}>
      <div className="development-layout generation-layout">
        <div
          ref={scroller}
          className="development-scroll"
          tabIndex={0}
          role="region"
          aria-label="Development conversation"
          onScroll={(event) => {
            const element = event.currentTarget;
            const atBottom =
              element.scrollHeight - element.clientHeight - element.scrollTop <
              48;
            follow.current = atBottom;
            setFollowing(atBottom);
          }}
        >
          <div className="development-messages">
            <GenerationBrief status={status} />
            <GenerationIdentity running={running} label={running ? "Developing your series" : failure ? "Needs attention" : ready ? "Plan ready" : "Draft saved"} />
            <h1>{title}</h1>
            <p className="development-intro">
              {ready
                ? "Take a look. We can change anything before production."
                : failure
                  ? "The draft stopped here. Try again whenever you're ready."
                  : cancelled
                    ? "Take your time. Your idea and notes are right here."
                : "A premise, an episode arc, and a little room for the unexpected. All shaped around your idea."}
            </p>
            <details className="generation-process">
              <summary><ListChecksIcon /><span>Creative process</span><small>{updates.length ? `${updates.length} ${updates.length === 1 ? "update" : "updates"}` : "Starting"}</small><ChevronRightIcon /></summary>
              <div className="development-history" role="log" aria-live="polite" aria-label="Development updates">
              {completed.map((event, index) => (
                <article key={`${event.at}-${index}`}>
                  <MessageSquareTextIcon aria-hidden="true" />
                  <p>{String(event.data.message)}</p>
                </article>
              ))}
              </div>
            </details>
            <div className="generation-note-history">
              {status.decisions
                .filter(
                  (d) =>
                    d.category === "feedback" && d.subject === "series_plan",
                )
                .map((decision, i) => (
                  <article
                    className="development-direction"
                    key={`${decision.at}-${i}`}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                    <div>
                      <span className="development-label">
                        Your direction · applied to this draft
                      </span>
                      <p>{decision.detail}</p>
                    </div>
                  </article>
                ))}
              {notes.map((note) => (
                <article className="development-direction" key={note.at}>
                  <ArrowUpIcon aria-hidden="true" />
                  <div>
                    <span className="development-label">
                      Your direction · queued for the next draft
                    </span>
                    <p>{note.text}</p>
                  </div>
                </article>
              ))}
            </div>
            <article className="development-active" aria-busy={running}>
              <div className="development-active-text">
                <span className="development-phase generation-current-status">
                  {running ? <Spinner aria-hidden="true" /> : ready ? <CheckIcon aria-hidden="true" /> : <span className="generation-status-dot" />}
                  {failure
                    ? "Needs attention"
                    : ready
                      ? "First draft ready"
                      : cancelled
                        ? "Paused"
                        : "Creating the series plan"}
                </span>
                {(!running || latest?.data.phase === "retrying" || latest?.data.phase === "checked") && <h2>{activeTitle}</h2>}
                <p>
                  {failure ??
                    (cancelled
                      ? "Everything written so far is saved. Resume when you’re ready."
                      : ready
                        ? plan?.premise
                        : activeText)}
                  {running && (
                    <span className="development-cursor" aria-hidden="true" />
                  )}
                </p>
                <span className="sr-only" role="status" aria-live="polite">
                  {running
                    ? activeText
                    : ready
                      ? "Series plan ready for review"
                      : (failure ?? "Development paused")}
                </span>
              </div>
              <div className="development-art">
                <StudioAscii phase={phase} animate={running} />
              </div>
            </article>
            {ready && (
              <div className="generation-plan-result">
                <span className="generation-results-label">Made for your story</span>
                <button className="generation-result" aria-label="Review series plan" onClick={() => {
                  follow.current = false;
                  setFollowing(false);
                  setReviewing(true);
                  requestAnimationFrame(() => {
                    review.current?.focus({ preventScroll: true });
                    review.current?.scrollIntoView({ block: "start", behavior: "instant" });
                  });
                }}><span className="generation-result-icon"><FileTextIcon /></span><div><strong>Review series plan</strong><span>{plan?.title} · {plan?.episodes.length} {plan?.episodes.length === 1 ? "episode" : "episodes"}</span></div><span className="generation-result-state">Ready for review</span><ChevronRightIcon /></button>
                <button className="generation-text-action" onClick={() => { setReviewing(false); requestAnimationFrame(() => input.current?.focus()); }}>Have another idea? Keep exploring <ArrowUpIcon /></button>
              </div>
            )}
            {!running && !ready && (
              <div className="development-actions">
                <Button
                  disabled={busy !== null}
                  onClick={() => void work("retry", () => api.stages.run(id))}
                >
                  {busy === "retry" ? <Spinner /> : <RotateCcwIcon />}
                  {failure ? "Try again" : "Resume development"}
                </Button>
              </div>
            )}

          </div>
        </div>
        <div className="development-composer-dock">
          {!following && (
            <Button
              className="development-latest"
              size="sm"
              variant="outline"
              onClick={scrollLatest}
            >
              Latest update
              <ArrowDownIcon />
            </Button>
          )}
          <DirectionQueue notes={notes} canApply={ready} busy={busy !== null} onApply={() => void revise(notes.map(n => n.text).join("\n\n"), false)} onClear={() => setNotes([])} />
          <GenerationComposer status={status} inputRef={input} value={direction} onChange={setDirection} onSubmit={submit}
            label="Add direction to your series" context="Series plan" placeholder={ready ? "What would you like to change?" : "A new thought? Add it to the story…"}
            busy={busy !== null} onStop={() => void work("stop", () => api.stages.cancel(status.activeJob!.id))} sendLabel={ready ? "Revise series plan" : "Add direction"} />
        </div>
      </div>
        {reviewing && ready && plan && (
          <GenerationSidebar label="Review series plan" onClose={() => setReviewing(false)}>
              <section
                ref={review}
                className="development-review"
                role="region"
                aria-label="Review"
                tabIndex={-1}
              >
                <span className="development-label">
                  Series plan · first draft
                </span>
                <h2>{plan.title}</h2>
                <p>{plan.premise}</p>
                {plan.episodes.length > 1 && <nav className="development-episode-nav" aria-label="Jump to episode">
                  <span>{plan.episodes.length} episodes</span>
                  <div>{plan.episodes.map((episode, i) => <button key={episode.id} title={episode.title} aria-label={`Episode ${i + 1}: ${episode.title}`} onClick={() => {
                    follow.current = false;
                    setFollowing(false);
                    const row = episodeRows.current.get(episode.id);
                    row?.focus({ preventScroll: true });
                    row?.scrollIntoView({ block: "start", behavior: "instant" });
                  }}>{String(i + 1).padStart(2, "0")}</button>)}</div>
                </nav>}
                <ol aria-label="The episode board">
                  {plan.episodes.map((episode, i) => (
                    <li key={episode.id} tabIndex={-1} ref={node => { if (node) episodeRows.current.set(episode.id, node); else episodeRows.current.delete(episode.id); }}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <h3>{episode.title}</h3>
                        <p>{episode.synopsis}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="development-actions generation-sidebar-footer">
                  <Button
                    disabled={busy !== null || notes.length > 0}
                    onClick={() =>
                      void work("approve", async () => {
                        await api.stages.approve(
                          id,
                          "series_plan",
                          stage!.artifactHash!,
                        );
                        await api.stages.run(id);
                      })
                    }
                  >
                    {busy === "approve" ? <Spinner /> : <CheckIcon />}Approve
                    series plan
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setReviewing(false); requestAnimationFrame(() => input.current?.focus()); }}
                  >
                    Ask for changes
                  </Button>
                </div>
                {notes.length > 0 && (
                  <p className="development-label">
                    Apply your queued direction before approving this plan.
                  </p>
                )}
              </section>
          </GenerationSidebar>
        )}
      </div>
    </section>
  );
}
