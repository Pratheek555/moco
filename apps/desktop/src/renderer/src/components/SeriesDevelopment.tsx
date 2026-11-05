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
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import type { SeriesPlan } from "@moco/spec";
import { api, type SeriesStatus } from "@/lib/api";
import { languageName } from "@/lib/format";
import { report, useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StudioAscii } from "./StudioAscii";

import { StudioProgress } from "./StudioProduction";
import { Textarea } from "@/components/ui/textarea";

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
function MocoMark() {
  return (
    <span className="development-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="3.5" y="5" width="4.5" height="14" rx="2" />
        <rect x="9.75" y="2" width="4.5" height="20" rx="2" />
        <rect x="16" y="7" width="4.5" height="10" rx="2" />
      </svg>
    </span>
  );
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
  const go = useApp((s) => s.go);
  const events = useApp((s) => s.events);
  const [direction, setDirection] = useState("");
  const [notes, setNotes] = useState<Note[]>(() => readNotes(id));
  const [busy, setBusy] = useState<
    "approve" | "revise" | "retry" | "stop" | null
  >(null);
  const [reviewing, setReviewing] = useState(false);
  const [following, setFollowing] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const review = useRef<HTMLElement>(null);
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
        ? "Your first chapter is ready to explore."
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
  const revise = (text: string) =>
    work("revise", async () => {
      await api.stages.reject(id, "series_plan", text);
      // The engine records feedback before starting the replacement draft.
      setNotes([]);
      setDirection("");
      setReviewing(false);
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
      <div className="development-toolbar">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => go({ name: "library" })}
        >
          <ArrowLeftIcon />
          All series
        </Button>
        <span>
          01 <span>/ Develop</span>
          <span className="development-next">02 / Direct　 03 / Produce</span>
        </span>
      </div>
      <div className="development-layout">
        <StudioProgress status={status} />
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
            <article className="development-idea">
              <span className="development-label">Your idea</span>
              <p>{status.series.idea}</p>
              <div>
                {status.series.episodes}{" "}
                {status.series.episodes === 1 ? "episode" : "episodes"}
                <span>·</span>
                {languageName(status.series.language)}
                <span>·</span>Animated short
              </div>
            </article>
            <div className="development-agent">
              <MocoMark />
              <strong>Moco</strong>
              <span>
                {running
                  ? "Developing your series"
                  : failure
                    ? "Needs attention"
                    : ready
                      ? "Plan ready"
                      : "Draft saved"}
              </span>
              {running && (
                <span className="development-live" aria-hidden="true" />
              )}
            </div>
            <h1>{title}</h1>
            <p className="development-intro">
              {ready
                ? "Take a look. We can change anything before production."
                : "A premise, an episode arc, and a little room for the unexpected. All shaped around your idea."}
            </p>
            <div className="development-history">
              {completed.map((event, index) => (
                <article key={`${event.at}-${index}`}>
                  <CheckIcon aria-hidden="true" />
                  <p>{String(event.data.message)}</p>
                </article>
              ))}
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
                <span className="development-phase">
                  {failure
                    ? "LET’S TRY AGAIN"
                    : ready
                      ? "FIRST DRAFT READY"
                      : cancelled
                        ? "PAUSED"
                        : "DEVELOPING YOUR SERIES"}
                </span>
                <h2>{activeTitle}</h2>
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
              <div className="development-actions">
                <Button
                  onClick={() => {
                    setReviewing(true);
                    requestAnimationFrame(() =>
                      scroller.current?.scrollTo({
                        top: review.current
                          ? review.current.offsetTop -
                            scroller.current.offsetTop
                          : 0,
                        behavior: matchMedia("(prefers-reduced-motion: reduce)")
                          .matches
                          ? "instant"
                          : "smooth",
                      }),
                    );
                  }}
                >
                  Review series plan
                  <ChevronRightIcon />
                </Button>
                <Button variant="ghost" onClick={() => input.current?.focus()}>
                  Keep exploring
                </Button>
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
            {reviewing && ready && plan && (
              <section
                ref={review}
                className="development-review"
                role="region"
                aria-label="Review"
              >
                <span className="development-label">
                  Series plan · first draft
                </span>
                <h2>{plan.title}</h2>
                <p>{plan.premise}</p>
                <ol aria-label="The episode board">
                  {plan.episodes.map((episode, i) => (
                    <li key={episode.id}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <h3>{episode.title}</h3>
                        <p>{episode.synopsis}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="development-actions">
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
                    onClick={() => input.current?.focus()}
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
          {ready && notes.length > 0 && (
            <div className="development-queued">
              <span>
                {notes.length} {notes.length === 1 ? "note" : "notes"} ready for
                the next draft
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  void revise(notes.map((n) => n.text).join("\n\n"))
                }
              >
                Apply notes & revise
                <ArrowUpIcon />
              </Button>
            </div>
          )}
          <form className="development-composer" onSubmit={submit}>
            <Textarea
              ref={input}
              aria-label="Add direction to your series"
              placeholder={
                ready
                  ? "What would you like to change?"
                  : "A new thought? Add it to the story…"
              }
              maxLength={2000}
              rows={2}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div>
              <span>
                {running
                  ? "Add direction at any time · You’ll review the plan before production"
                  : ready
                    ? "Your direction shapes the next draft"
                    : "Your draft is saved. Add a note for the next version."}
              </span>
              <div className="development-composer-buttons">
                {running && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Stop generation"
                    disabled={busy !== null}
                    onClick={() =>
                      void work("stop", () =>
                        api.stages.cancel(status.activeJob!.id),
                      )
                    }
                  >
                    {busy === "stop" ? <Spinner /> : <SquareIcon />}
                  </Button>
                )}
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label={ready ? "Revise series plan" : "Add direction"}
                  disabled={!direction.trim() || busy !== null}
                >
                  {busy === "revise" ? <Spinner /> : <ArrowUpIcon />}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
