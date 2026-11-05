import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  FolderOpenIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import type { SeriesPlan } from "@moco/spec";
import { api, type SeriesStatus } from "@/lib/api";
import { report, stageLabel, useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { StudioAscii } from "./StudioAscii";

const phases = ["Plan", "World", "Script", "Visuals", "Preview", "Deliver"];
function phaseFor(key: string) {
  if (key === "series_plan") return 0;
  if (key === "bible") return 1;
  const step = key.split("/")[1];
  return step === "script"
    ? 2
    : ["voiceover", "shot_list", "sample", "scenes"].includes(step ?? "")
      ? 3
      : step === "preview"
        ? 4
        : 5;
}
export function StudioProgress({ status }: { status: SeriesStatus }) {
  const active =
    status.stages.find((s) => s.status === "running") ??
    status.stages.find((s) => s.status === "awaiting_approval");
  const key =
    active?.key ?? ("key" in status.next ? status.next.key : "series_plan");
  const finished = status.next.kind === "finished";
  const current = finished ? 6 : phaseFor(key);
  const episode = key.includes("/")
    ? Number(key.split("/")[0]!.replace("ep-", ""))
    : undefined;
  return (
    <nav className="studio-stage-rail" aria-label="Production progress">
      <ol>
        {phases.map((label, i) => (
          <li
            key={label}
            data-state={
              i < current ? "done" : i === current ? "current" : "pending"
            }
            aria-current={i === current ? "step" : undefined}
          >
            <span className="studio-stage-number">
              {i < current ? <CheckIcon /> : String(i + 1).padStart(2, "0")}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <span className="studio-stage-caption">
        {finished
          ? "Series complete"
          : episode
            ? `Episode ${episode} / ${active?.status === "awaiting_approval" ? "Your review" : "In production"}`
            : active?.status === "awaiting_approval"
              ? "Your review"
              : "Developing your series"}
      </span>
    </nav>
  );
}

export function StudioProduction({
  status,
  plan,
  review,
  children,
}: {
  status: SeriesStatus;
  plan?: SeriesPlan;
  review: (focus: () => void) => ReactNode;
  children: ReactNode;
}) {
  const id = status.series.id;
  const go = useApp((s) => s.go);
  const events = useApp((s) => s.events);
  const progress = useApp((s) => s.progress[id]);
  const [tab, setTab] = useState("workspace");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const running = Boolean(status.activeJob);
  const next = status.next;
  const waiting =
    next.kind === "waiting" && next.status === "awaiting_approval"
      ? status.stages.find((s) => s.key === next.key)
      : undefined;
  const current = status.stages.find((s) => s.status === "running");
  const failed = status.stages.find((s) => s.status === "failed");
  const job = status.jobs.at(-1);
  const error =
    failed?.error?.message ??
    (job?.status === "failed" ? job.error?.message : undefined);
  const finished = status.next.kind === "finished";
  const updates = events.filter(
    (e) =>
      e.seriesId === id &&
      e.type === "ai.activity" &&
      (!status.activeJob?.startedAt || e.at >= status.activeJob.startedAt),
  );
  const latest = updates.at(-1);
  useEffect(() => {
    setTab("workspace");
    scroll.current?.scrollTo({ top: 0 });
    setNote("");
  }, [waiting?.key]);
  const work = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="studio-development studio-production dark"
      aria-label="Production studio"
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
        <span className="truncate">{plan?.title ?? "Your series"}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void api.app
              .openPath(`${useApp.getState().settings!.projectsDir}/${id}`)
              .catch(report)
          }
        >
          <FolderOpenIcon />
          Project files
        </Button>
      </div>
      <div className="development-layout">
        <StudioProgress status={status} />
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="studio-workspace-tabs"
        >
          <TabsList variant="line">
            <TabsTrigger value="workspace">
              Studio {waiting && <span className="studio-review-dot" />}
            </TabsTrigger>
            <TabsTrigger value="episodes">Episodes & series</TabsTrigger>
          </TabsList>
          <div
            ref={scroll}
            className="development-scroll"
            tabIndex={0}
            role="region"
            aria-label="Studio workspace"
          >
            <TabsContent value="workspace">
              {waiting && !running ? (
                review(() => input.current?.focus())
              ) : (
                <div className="studio-production-state">
                  <div className="development-art">
                    <StudioAscii
                      phase={
                        finished ? 3 : current ? phaseFor(current.key) % 4 : 1
                      }
                      animate={running}
                    />
                  </div>
                  <Badge variant="outline">
                    {running
                      ? "IN PRODUCTION"
                      : finished
                        ? "READY TO WATCH"
                        : error
                          ? "NEEDS ATTENTION"
                          : "PAUSED"}
                  </Badge>
                  <h1>
                    {running
                      ? current
                        ? stageLabel(current.key)
                        : "Preparing the next step"
                      : finished
                        ? "Your story is ready."
                        : error
                          ? "Let's pick up where we left off."
                          : "Your work is saved."}
                  </h1>
                  <p role="status">
                    {running
                      ? String(
                          latest?.data.message ??
                            "Moco is bringing your approved direction to life. The next review will appear here.",
                        )
                      : finished
                        ? "Watch your episodes, refine a shot, or prepare your final export."
                        : (error ??
                          "Continue whenever you're ready. Your approved work is saved.")}
                  </p>
                  {running && progress !== undefined && (
                    <div className="studio-render-progress">
                      <Progress
                        value={Math.max(0, Math.min(100, progress * 100))}
                        aria-label="Render progress"
                      />
                      <span>{Math.round(progress * 100)}%</span>
                    </div>
                  )}
                  {!running && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        finished
                          ? setTab("episodes")
                          : void work(() => api.stages.run(id, failed?.key))
                      }
                    >
                      {busy ? <Spinner /> : <RotateCcwIcon />}
                      {finished
                        ? "Explore episodes"
                        : error
                          ? "Try again"
                          : "Continue production"}
                    </Button>
                  )}
                  {running && (
                    <div className="studio-activity">
                      {updates.slice(-4, -1).map((e, i) => (
                        <p key={i}>
                          <CheckIcon />
                          {String(e.data.message)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
            <TabsContent value="episodes">{children}</TabsContent>
          </div>
        </Tabs>
        <div className="development-composer-dock">
          <form
            className="development-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!waiting || !note.trim() || running) return;
              void work(async () => {
                await api.stages.reject(id, waiting.key, note.trim());
                setNote("");
                await api.stages.run(id);
              });
            }}
          >
            <Textarea
              ref={input}
              aria-label="Review direction"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!waiting || running || busy}
              placeholder={
                waiting
                  ? "What would you like to change?"
                  : finished
                    ? "Open an episode to refine a shot or export your film."
                    : "Your next review will appear here."
              }
              rows={2}
              maxLength={4000}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div>
              <span>
                {waiting
                  ? `Your direction for ${stageLabel(waiting.key).toLowerCase()}`
                  : running
                    ? "Creating your series / You approve each creative milestone"
                    : "Everything stays in your studio"}{" "}
              </span>
              <div className="development-composer-buttons">
                {running && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Stop generation"
                    disabled={busy}
                    onClick={() =>
                      void work(() => api.stages.cancel(status.activeJob!.id))
                    }
                  >
                    <SquareIcon />
                  </Button>
                )}
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Send review changes"
                  disabled={!waiting || running || !note.trim() || busy}
                >
                  {busy ? <Spinner /> : <ArrowUpIcon />}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
