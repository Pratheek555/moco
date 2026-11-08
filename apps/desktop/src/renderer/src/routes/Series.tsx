// A series: what the engine is doing now, the step waiting for your review, and the episode board.
// The engine stops at each gate (plan, bible, script, sample shot, preview); nothing moves on until you approve.
import { useState } from "react";
import {
  CheckCheckIcon,
  CheckIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  CanonAddition,
  EpisodeScript,
  Playbook,
  SeriesBible,
  SeriesPlan,
  ShowBible,
} from "@moco/spec";
import { api, type SeriesStatus } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { report, stageLabel, useApp } from "@/lib/store.ts";
import { EPISODE_COUNTS, humanize, pad2 } from "@/lib/format.ts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { CastAvatar } from "../components/CastArt.tsx";
import { PageError, PageLoading } from "../components/Page.tsx";
import { SeriesDevelopment } from "../components/SeriesDevelopment.tsx";

import { StudioProduction } from "../components/StudioProduction";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Stage = SeriesStatus["stages"][number];

const PLAN = "artifacts/series_plan.json";
const MAX_EPISODES = 99; // episode ids run "ep-01" … "ep-99"
const BIBLE = "artifacts/bible.json";
const SHOW = "artifacts/show.json"; // the series' own rules, approved with the bible
const PLAYBOOK = "artifacts/playbook.json"; // what the series learned from its own shots

// Which artifact a gate asks you to review. Sample and preview are reviewed as pictures, not JSON.
function reviewFile(key: string): string | undefined {
  const [first, second] = key.split("/");
  if (first === "series_plan") return PLAN;
  if (first === "bible") return BIBLE;
  if (second === "script") return `episodes/${first}/artifacts/script.json`;
  return undefined;
}

const episodeOf = (key: string) =>
  key.includes("/") ? key.split("/")[0] : undefined;

// A stage name mid-sentence: "the series plan", "Episode 1 script".
const inSentence = (label: string) =>
  label.startsWith("Series") ? `the ${label.toLowerCase()}` : label;

export function SeriesPage({ id }: { id: string }) {
  const version = useApp((s) => s.version),
    go = useApp((s) => s.go);
  const { data, error } = useAsync(async () => {
    const [status, plan, bible, show, playbook] = await Promise.all([
      api.series.status(id),
      api.series.artifact(id, PLAN),
      api.series.artifact(id, BIBLE),
      api.series.artifact(id, SHOW),
      api.series.artifact(id, PLAYBOOK),
    ]);
    // Characters later episodes added to the canon, each with the episode it joined in.
    const episodes = (plan?.data as SeriesPlan | undefined)?.episodes ?? [];
    const additions = (
      await Promise.all(
        episodes.map((ep) =>
          api.series
            .artifact(id, `artifacts/canon/${ep.id}.json`)
            .catch(() => null),
        ),
      )
    ).flatMap((artifact) => (artifact ? [artifact.data as CanonAddition] : []));
    return {
      status,
      plan: plan?.data as SeriesPlan | undefined,
      bible: bible?.data as SeriesBible | undefined,
      show: show?.data as ShowBible | undefined,
      playbook: playbook?.data as Playbook | undefined,
      additions,
    };
  }, [id, version]);
  if (error)
    return (
      <PageError
        title="Couldn’t open this series"
        detail={error}
        action={{
          label: "Back to my series",
          run: () => go({ name: "library" }),
        }}
      />
    );
  if (!data) return <PageLoading label="Opening series…" />;
  const { status, plan, bible, show, playbook, additions } = data;
  const joined = additions.flatMap((addition) =>
    addition.world.cast.map((member) => ({
      id: member.id,
      kitCharacterId: member.model,
      description: member.description,
      episodeId: addition.episodeId,
    })),
  );
  const lessons =
    playbook?.lessons.filter((lesson) => lesson.status === "active") ?? [];
  const running = status.activeJob !== undefined;
  const stage = (key: string) => status.stages.find((s) => s.key === key);
  const waiting =
    status.next.kind === "waiting" && status.next.status === "awaiting_approval"
      ? stage(status.next.key)
      : undefined;
  const aiCalls = Object.values(status.usage.aiCalls).reduce(
    (a, b) => a + b,
    0,
  );

  // All gates share the same bounded studio layout, from the first brief to delivery.
  if (stage("series_plan")?.status !== "approved" && !bible)
    return <SeriesDevelopment status={status} plan={plan} />;

  return (
    <StudioProduction
      status={status}
      plan={plan}
      review={(focus, hasQueuedDirection) =>
        waiting ? (
          <Review
            key={waiting.key}
            seriesId={id}
            stage={waiting}
            plan={plan}
            bible={bible}
            show={show}
            status={status}
            onRequestChanges={focus}
            hasQueuedDirection={hasQueuedDirection}
          />
        ) : null
      }
    >
      <div className="studio-board grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              The episode board
            </h2>
            <p className="text-sm text-muted-foreground">
              One story, one chapter at a time.
            </p>
          </div>
          {plan ? (
            <>
              <ItemGroup aria-label="Episodes" className="gap-2">
                {plan.episodes.map((ep, index) => (
                  <div role="listitem" key={ep.id}>
                    <Item asChild variant="outline">
                      <button
                        onClick={() =>
                          go({
                            name: "episode",
                            seriesId: id,
                            episodeId: ep.id,
                          })
                        }
                      >
                        <ItemMedia className="w-7 text-base font-medium text-muted-foreground tabular-nums">
                          {pad2(index + 1)}
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{ep.title}</ItemTitle>
                          <ItemDescription>{ep.synopsis}</ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <EpisodeState status={status} episodeId={ep.id} />
                          <ChevronRightIcon className="size-4 text-muted-foreground" />
                        </ItemActions>
                      </button>
                    </Item>
                  </div>
                ))}
              </ItemGroup>
              {stage("series_plan")?.status === "approved" &&
                plan.episodes.length < MAX_EPISODES && (
                  <AddEpisodes
                    seriesId={id}
                    have={plan.episodes.length}
                    running={running}
                  />
                )}
            </>
          ) : running ? (
            <EpisodeSkeleton count={status.series.episodes} />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No episodes yet</EmptyTitle>
                <EmptyDescription>
                  Episodes appear once the series plan is written.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Cast</h2>
            {bible ? (
              <ItemGroup className="gap-4">
                {[...bible.cast, ...joined].map((c) => (
                  <Item key={c.id} role="listitem" size="sm" className="p-0">
                    <ItemMedia>
                      <CastAvatar character={c.kitCharacterId} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {humanize(c.id)}
                        {"episodeId" in c && (
                          <Badge variant="outline">
                            Joined in episode{" "}
                            {Number(String(c.episodeId).slice(3))}
                          </Badge>
                        )}
                      </ItemTitle>
                      <ItemDescription className="line-clamp-3">
                        {c.description}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            ) : running ? (
              <CastSkeleton />
            ) : (
              <p className="text-sm text-muted-foreground">
                The cast is chosen with the series bible.
              </p>
            )}
          </section>
          {lessons.length > 0 && (
            <>
              <Separator />
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">
                  What this series learned
                </h2>
                <ul className="flex flex-col gap-2.5 text-sm select-text">
                  {lessons.map((lesson) => (
                    <li key={lesson.id} className="flex flex-col gap-0.5">
                      <span className="text-pretty">{lesson.rule}</span>
                      <span className="text-xs text-muted-foreground">
                        From episode {Number(lesson.since.slice(3))} ·{" "}
                        {lesson.source === "user" ? "your note" : "the critic"}
                        {lesson.held + lesson.broken > 0 &&
                          ` · held ${lesson.held} of ${lesson.held + lesson.broken}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
          {status.decisions.length > 0 && (
            <>
              <Separator />
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">
                  What the engine decided
                </h2>
                <ul className="flex flex-col gap-2.5 text-sm select-text">
                  {status.decisions.slice(-6).map((d, i) => (
                    <li key={i} className="flex flex-col gap-0.5">
                      <span className="font-medium">{d.subject}</span>
                      <span className="text-pretty text-muted-foreground">
                        {d.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
          <Separator />
          <section className="flex flex-col items-start gap-3">
            {aiCalls > 0 && (
              <p className="text-sm text-muted-foreground tabular-nums">
                {aiCalls} {aiCalls === 1 ? "AI call" : "AI calls"} so far
              </p>
            )}
            <DeleteSeries
              seriesId={id}
              title={plan?.title ?? status.series.idea}
              running={running}
            />
          </section>
        </aside>
      </div>
    </StudioProduction>
  );
}

function DeleteSeries({
  seriesId,
  title,
  running,
}: {
  seriesId: string;
  title: string;
  running: boolean;
}) {
  const go = useApp((s) => s.go);
  const [open, setOpen] = useState(false),
    [deleting, setDeleting] = useState(false);
  const remove = async () => {
    setDeleting(true);
    try {
      await api.series.remove(seriesId);
      setOpen(false);
      go({ name: "library" });
      useApp.getState().toast("Series deleted");
    } catch (e) {
      report(e);
    } finally {
      setDeleting(false);
    }
  };
  return (
    <>
      <AlertDialog
        open={open}
        onOpenChange={(next) => !deleting && setOpen(next)}
      >
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            disabled={running}
          >
            <Trash2Icon data-icon="inline-start" />
            Delete series
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this series?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes “{title}”, with its episodes, audio and
              exported videos, from your project folder. You can’t undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              Keep series
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault(); // stay open until the files are gone
                void remove();
              }}
            >
              {deleting && <Spinner data-icon="inline-start" aria-hidden />}
              Delete series
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {running && (
        <p className="text-xs text-muted-foreground">
          Stop the current work to delete this series.
        </p>
      )}
    </>
  );
}

// Plan the next episodes after the approved ones. The longer plan comes back for review like the first one.
function AddEpisodes({
  seriesId,
  have,
  running,
}: {
  seriesId: string;
  have: number;
  running: boolean;
}) {
  const counts = EPISODE_COUNTS.filter((n) => have + n <= MAX_EPISODES);
  const [open, setOpen] = useState(false),
    [count, setCount] = useState(counts.includes(5) ? 5 : counts.at(-1)!),
    [note, setNote] = useState(""),
    [adding, setAdding] = useState(false);
  const add = async () => {
    setAdding(true);
    try {
      await api.series.extend(seriesId, {
        episodes: count,
        note: note.trim() || undefined,
      });
      setOpen(false);
      setNote("");
    } catch (e) {
      report(e);
    } finally {
      setAdding(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !adding && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" className="self-start" disabled={running}>
          <PlusIcon data-icon="inline-start" />
          Add episodes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add episodes</DialogTitle>
          <DialogDescription>
            Moco plans the next episodes after episode {have}, carrying on from
            what the story has established. The episodes you have stay as they
            are.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="add-count">How many</FieldLabel>
          <Select
            value={String(count)}
            onValueChange={(v) => setCount(Number(v))}
            disabled={adding}
          >
            <SelectTrigger id="add-count" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {counts.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} {n === 1 ? "episode" : "episodes"}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="add-note">
            Where should the story go? (optional)
          </FieldLabel>
          <Textarea
            id="add-note"
            rows={3}
            disabled={adding}
            placeholder="e.g. “Cover the dice game and end on Draupadi’s vow.”"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <FieldDescription>
            Leave it empty to continue the story in order.
          </FieldDescription>
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={adding}>
              Cancel
            </Button>
          </DialogClose>
          <Button disabled={adding} onClick={() => void add()}>
            {adding && <Spinner data-icon="inline-start" aria-hidden />}
            Plan {count} more
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Placeholder rows shaped like the episode board while the plan is written.
function EpisodeSkeleton({ count }: { count: number }) {
  return (
    <ItemGroup
      aria-busy="true"
      aria-label="Writing the series plan"
      className="gap-2"
    >
      {Array.from({ length: Math.min(Math.max(count, 1), 6) }, (_, i) => (
        <Item key={i} role="listitem" variant="outline">
          <ItemMedia className="w-7 text-base font-medium text-muted-foreground tabular-nums">
            {pad2(i + 1)}
          </ItemMedia>
          <ItemContent className="gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-3/5" />
          </ItemContent>
          <ItemActions>
            <Skeleton className="h-5 w-16 rounded-full" />
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}

// Placeholder cast rows while the series bible picks characters.
function CastSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Choosing the cast"
      className="flex flex-col gap-4"
    >
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Where an episode is, as one badge: what needs you stands out, what's done is quiet.
function EpisodeState({
  status,
  episodeId,
}: {
  status: SeriesStatus;
  episodeId: string;
}) {
  const stages = status.stages.filter((s) => episodeOf(s.key) === episodeId);
  const has = (test: (s: Stage) => boolean) => stages.some(test);
  if (has((s) => s.key.endsWith("/publish") && s.status === "done"))
    return (
      <Badge variant="outline">
        <CheckCheckIcon />
        Ready to post
      </Badge>
    );
  if (has((s) => s.key.endsWith("/final") && s.status === "done"))
    return (
      <Badge variant="outline">
        <CheckIcon />
        Rendered
      </Badge>
    );
  if (has((s) => s.status === "running"))
    return (
      <Badge variant="secondary">
        <Spinner aria-hidden />
        Working
      </Badge>
    );
  if (has((s) => s.status === "awaiting_approval"))
    return <Badge>Needs review</Badge>;
  if (has((s) => s.status === "failed"))
    return <Badge variant="destructive">Needs attention</Badge>;
  if (has((s) => s.status === "done"))
    return <Badge variant="secondary">In progress</Badge>;
  return <Badge variant="outline">Not started</Badge>;
}

// The show bible as the user approves it: what the show is, its look and rules, and who is in it.
function ShowRules({ show }: { show: ShowBible }) {
  const limitations =
    show.requirements?.filter((r) => r.support !== "available") ?? [];
  return (
    <div className="studio-bible select-text">
      <div className="studio-logline">
        <span className="development-phase">THE WORLD OF YOUR SERIES</span>
        <h2>{show.logline}</h2>
        <p>{show.tone}</p>
      </div>
      <Tabs defaultValue="look">
        <TabsList variant="line" className="flex-wrap h-auto">
          <TabsTrigger value="look">Look & tone</TabsTrigger>
          <TabsTrigger value="cast">Cast ({show.cast.length})</TabsTrigger>
          <TabsTrigger value="rules">Story rules</TabsTrigger>
          <TabsTrigger value="limits">
            Production notes ({limitations.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="look">
          <h3 className="studio-section-title">The color story</h3>
          <div className="studio-palette">
            {show.look.palette.map((c) => (
              <div key={c.token}>
                <span style={{ background: c.hex }} />
                <strong>{humanize(c.token)}</strong>
                <small>{c.hex}</small>
                <p>{c.use}</p>
              </div>
            ))}
          </div>
          <h3 className="studio-section-title">What a great shot looks like</h3>
          <ol className="studio-rule-list">
            {show.rubric.map((r, i) => (
              <li key={r}>
                <span>{pad2(i + 1)}</span>
                <p>{r}</p>
              </li>
            ))}
          </ol>
        </TabsContent>
        <TabsContent value="cast">
          <div className="studio-cast-grid">
            {show.cast.map((c) => (
              <article key={c.id}>
                <span className="development-phase">{c.role}</span>
                <h3>{c.name}</h3>
                <p>{c.appearance}</p>
                <Separator />
                <p>
                  <strong>Voice</strong> / {c.voice}
                </p>
                <small>{c.voiceId ?? "Configured narrator"}</small>
              </article>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="rules">
          <h3 className="studio-section-title">The rules of this world</h3>
          <ol className="studio-rule-list">
            {show.rules.map((r, i) => (
              <li key={r}>
                <span>{pad2(i + 1)}</span>
                <p>{r}</p>
              </li>
            ))}
          </ol>
        </TabsContent>
        <TabsContent value="limits">
          <h3 className="studio-section-title">Before we produce</h3>
          <p className="text-sm text-muted-foreground mb-5">
            Review these adaptations before approving the series bible.
          </p>
          {limitations.length ? (
            limitations.map((r) => (
              <article className="studio-limitation" key={r.id}>
                <Badge variant="outline">{humanize(r.support)}</Badge>
                <h4>{r.text}</h4>
                <p>{r.reason}</p>
              </article>
            ))
          ) : (
            <p>No production limitations were reported.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// The step waiting for you: what it made, and approve or ask for changes.
function Review({
  seriesId,
  stage,
  plan,
  bible,
  show,
  status,
  onRequestChanges,
  hasQueuedDirection = false,
}: {
  seriesId: string;
  stage: Stage;
  plan?: SeriesPlan;
  bible?: SeriesBible;
  show?: ShowBible;
  status: SeriesStatus;
  onRequestChanges?: () => void;
  hasQueuedDirection?: boolean;
}) {
  const [feedback, setFeedback] = useState<string | null>(null),
    [busy, setBusy] = useState<"approve" | "redo" | null>(null);
  const file = reviewFile(stage.key);
  const episodeId = episodeOf(stage.key);
  const repeat = episodeId ? status.repeatEpisodes?.[episodeId] : undefined;
  const combinedOutline = repeat?.outlinePending ? plan?.episodes.find(episode => episode.id === episodeId) : undefined;
  const { data: script, error: scriptError } = useAsync(
    async () =>
      file?.endsWith("script.json")
        ? ((await api.series.artifact(seriesId, file))?.data as EpisodeScript)
        : undefined,
    [seriesId, file, stage.artifactHash],
  );
  const { data: media, error: mediaError } = useAsync(
    async () =>
      episodeId ? api.episode.media(seriesId, episodeId) : undefined,
    [seriesId, episodeId, stage.artifactHash],
  );

  const act = async (
    kind: "approve" | "redo",
    work: () => Promise<unknown>,
  ) => {
    setBusy(kind);
    try {
      await work();
    } catch (e) {
      report(e);
    } finally {
      setBusy(null);
    }
  };
  // Approving moves straight on to the next steps, up to the next review.
  const approve = () =>
    act("approve", async () => {
      await api.stages.approve(seriesId, stage.key, stage.artifactHash!);
      await api.stages.run(seriesId);
    });
  const requestChanges = () =>
    act("redo", async () => {
      await api.stages.reject(seriesId, stage.key, feedback ?? "");
      await api.stages.run(seriesId); // not stage.key: a note on the preview restarts from the scenes
      setFeedback(null);
    });

  const stills = Object.values(media?.stills ?? {}).flat();
  const unavailable = stage.key.endsWith("/script")
    ? !script
    : stage.key.endsWith("/sample")
      ? !stills.length
      : stage.key.endsWith("/preview")
        ? !media?.preview
        : stage.key === "bible"
          ? !show && !bible
          : !plan;
  const loadError = scriptError || mediaError;
  return (
    <Card
      role="region"
      aria-labelledby="review-title"
      className="studio-review"
    >
      <CardHeader>
        <CardTitle id="review-title">
          {combinedOutline ? "Review outline and script" : `Review ${inSentence(stageLabel(stage.key))}`}
        </CardTitle>
        <CardDescription>
          {combinedOutline ? "Approve this episode outline and script together, or send a note for changes. Your characters, voices and visual rules carry forward." : "Review the draft below. Approve to continue, or send a note for changes."}
        </CardDescription>
        <CardAction>
          <Badge>Waiting for you</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            Could not load this review: {loadError}
          </p>
        )}
        {unavailable && !loadError && (
          <p role="status" className="text-sm text-muted-foreground">
            Waiting for the review artifact. Approval is available once it can
            be displayed.
          </p>
        )}
        {stage.key === "series_plan" && plan && (
          <ol className="flex flex-col gap-3 select-text">
            {plan.episodes.map((ep, i) => (
              <li key={ep.id} className="flex gap-3 text-sm">
                <span className="w-6 shrink-0 font-medium text-muted-foreground tabular-nums">
                  {pad2(i + 1)}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{ep.title}</span>
                  <span className="text-pretty text-muted-foreground">
                    {ep.synopsis}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
        {stage.key === "bible" && show && <ShowRules show={show} />}
        {stage.key === "bible" && bible && !show && (
          <div className="flex flex-col gap-4">
            <ItemGroup className="gap-4">
              {bible.cast.map((c) => (
                <Item key={c.id} role="listitem" size="sm" className="p-0">
                  <ItemMedia>
                    <CastAvatar character={c.kitCharacterId} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {humanize(c.id)}
                      <span className="font-normal text-muted-foreground">
                        {humanize(c.kitCharacterId)}
                        {c.variant ? `, ${c.variant}` : ""}
                      </span>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none select-text">
                      {c.description}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-medium">Look</span>
              <Badge variant="outline">{bible.style.mood}</Badge>
              <Badge variant="outline">
                Grade: {humanize(bible.style.grade).toLowerCase()}
              </Badge>
              <Badge variant="outline">
                Captions: {humanize(bible.style.captionStyle).toLowerCase()}
              </Badge>
            </div>
          </div>
        )}
        {combinedOutline && <section aria-label="Episode outline" className="rounded-lg border p-3 text-sm"><h3 className="font-semibold">{combinedOutline.title}</h3><p className="mt-1">{combinedOutline.synopsis}</p></section>}
        {script && (
          <ol className="flex flex-col gap-3 select-text">
            {script.lines.map((line) => (
              <li key={line.id} className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {humanize(line.beat)}
                  {line.speaker !== "narrator" &&
                    ` · ${humanize(line.speaker)}`}
                </span>
                <p className="text-sm leading-relaxed text-pretty">
                  {line.text}
                </p>
                <span className="text-xs text-muted-foreground">
                  {line.text.trim().split(/\s+/).length} words
                  {script.shotPlan?.find((shot) => shot.lineId === line.id) &&
                    ` · ~${script.shotPlan.find((shot) => shot.lineId === line.id)!.seconds}s`}
                </span>
                {script.shotPlan
                  ?.filter((shot) => shot.lineId === line.id)
                  .map((shot) => (
                    <p
                      key={shot.lineId}
                      className="text-xs text-muted-foreground"
                    >
                      {shot.picture}
                    </p>
                  ))}
              </li>
            ))}
          </ol>
        )}
        {stage.key.endsWith("/sample") && (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {media
              ? stills.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt="Sample shot still"
                    className="max-h-80 max-w-full shrink-0 rounded-lg border object-contain"
                  />
                ))
              : [0, 1, 2].map((i) => (
                  <Skeleton
                    key={i}
                    className="aspect-[9/16] h-72 shrink-0 rounded-lg"
                  />
                ))}
          </div>
        )}
        {stage.key.endsWith("/preview") &&
          (media?.preview ? (
            <video
              src={media.preview}
              controls
              className="w-full max-h-[52dvh] rounded-lg bg-black"
            />
          ) : (
            <Skeleton className="aspect-[9/16] h-[32rem] rounded-lg" />
          ))}
        {feedback !== null && (
          <Field>
            <FieldLabel htmlFor="review-note">What should change?</FieldLabel>
            <Textarea
              id="review-note"
              autoFocus
              rows={3}
              placeholder="e.g. “Make the hero calmer, end on the reveal.”"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </Field>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t">
        {hasQueuedDirection && <span className="generation-approval-hint">Apply or clear your queued notes before approving.</span>}
        {feedback === null ? (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              onRequestChanges ? onRequestChanges() : setFeedback("")
            }
          >
            <MessageSquareIcon data-icon="inline-start" />
            Ask for changes
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setFeedback(null)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null || !feedback.trim()}
              onClick={() => void requestChanges()}
            >
              {busy === "redo" && (
                <Spinner data-icon="inline-start" aria-hidden />
              )}
              Redo with my note
            </Button>
          </>
        )}
        <Button
          disabled={busy !== null || unavailable || Boolean(loadError) || hasQueuedDirection}
          onClick={() => void approve()}
        >
          {busy === "approve" ? (
            <Spinner data-icon="inline-start" aria-hidden />
          ) : (
            <CheckIcon data-icon="inline-start" />
          )}
          {combinedOutline ? "Approve outline and script" : "Approve"}
        </Button>
      </CardFooter>
    </Card>
  );
}
