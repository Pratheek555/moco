// What the engine is doing: series with work running, and the latest engine events.
import type { ComponentType } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  ClapperboardIcon,
  FlagIcon,
  HourglassIcon,
  MessageSquareIcon,
  PlayIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react";
import type { EngineEvent } from "@/lib/api.ts";
import { newSeries, runningSeries, stageLabel, useApp } from "@/lib/store.ts";
import { humanize, timeAgo } from "@/lib/format.ts";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Page, PageHeader } from "../components/Page.tsx";

const keyOf = (event: EngineEvent) => String(event.data.key ?? "");
const shotOf = (event: EngineEvent) => humanize(String(event.data.shotId ?? ""));
// A stage name mid-sentence: "the series plan", "Episode 1 script".
const inSentence = (label: string) => (label.startsWith("Series") ? `the ${label.toLowerCase()}` : label);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Events worth a line in the log, how to say them, and whether they need attention. The rest
// (artifact saves, usage) are noise here.
const EVENTS: Record<string, { icon: ComponentType; text(event: EngineEvent): string; problem?: boolean }> = {
  "stage.started": { icon: PlayIcon, text: (e) => `Started ${inSentence(stageLabel(keyOf(e)))}` },
  "stage.done": { icon: CheckIcon, text: (e) => `Finished ${inSentence(stageLabel(keyOf(e)))}` },
  "stage.awaiting_approval": {
    icon: MessageSquareIcon,
    text: (e) => `${capitalize(inSentence(stageLabel(keyOf(e))))} is ready for your review`,
  },
  "stage.approved": { icon: ThumbsUpIcon, text: (e) => `You approved ${inSentence(stageLabel(keyOf(e)))}` },
  "stage.failed": {
    icon: TriangleAlertIcon,
    problem: true,
    text: (e) =>
      `${capitalize(stageLabel(keyOf(e)))} failed: ${(e.data.error as { message?: string })?.message ?? "unknown error"}`,
  },
  "shot.attempt": { icon: RefreshCwIcon, text: (e) => `${shotOf(e)}: attempt ${String(e.data.attempt ?? "")}` },
  "shot.fallback": { icon: ShieldCheckIcon, text: (e) => `${shotOf(e)} used a safe fallback` },
  "script.sent_back": { icon: Undo2Icon, text: () => "The script went back to be fitted to the voiceover" },
  "usage.rate_limited": { icon: HourglassIcon, text: () => "Claude is rate limited, so Moco is waiting" },
  "job.finished": {
    icon: FlagIcon,
    text: (e) =>
      e.data.status === "succeeded"
        ? "Finished working"
        : e.data.status === "cancelled"
          ? "Stopped"
          : "Stopped with a problem",
  },
};

export function QueuePage() {
  const library = useApp((s) => s.library),
    events = useApp((s) => s.events),
    progress = useApp((s) => s.progress),
    go = useApp((s) => s.go);
  const busy = runningSeries(library);
  const log = events.filter((e) => e.type in EVENTS).slice(-60).reverse();
  const titleOf = (seriesId: string) => library.find((s) => s.id === seriesId)?.title ?? seriesId;
  // The step a running series is on: the last stage it started.
  const currentStep = (seriesId: string) => {
    const started = log.find((e) => e.seriesId === seriesId && e.type === "stage.started");
    return started ? `Working on ${inSentence(stageLabel(keyOf(started)))}…` : "Working…";
  };

  return (
    <Page>
      <PageHeader title="Activity" description="What Moco is writing and rendering on this computer." />
      {busy.length === 0 && log.length === 0 ? (
        <Empty className="max-w-3xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClapperboardIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing running</EmptyTitle>
            <EmptyDescription>Start a series in the studio, or continue one from My series.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={newSeries}>
              New series
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {busy.length > 0 && (
            <section className="flex max-w-3xl flex-col gap-3">
              <h2 className="text-sm font-semibold">In progress</h2>
              <ItemGroup className="gap-2">
                {busy.map((s) => {
                  const pct = progress[s.id] !== undefined ? Math.round(progress[s.id]! * 100) : undefined;
                  return (
                    <div role="listitem" key={s.id}>
                      <Item asChild variant="outline">
                        <button onClick={() => go({ name: "series", id: s.id })}>
                          <ItemMedia variant="icon">
                            <Spinner aria-hidden />
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle>{s.title}</ItemTitle>
                            <ItemDescription>
                              {pct !== undefined ? `Rendering · ${pct}%` : currentStep(s.id)}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <ChevronRightIcon className="size-4 text-muted-foreground" />
                          </ItemActions>
                          {pct !== undefined && (
                            <ItemFooter>
                              <Progress value={pct} aria-label={`${s.title} render progress`} className="h-1.5" />
                            </ItemFooter>
                          )}
                        </button>
                      </Item>
                    </div>
                  );
                })}
              </ItemGroup>
            </section>
          )}
          {log.length > 0 && (
            <section className="flex max-w-3xl flex-col gap-3">
              <h2 className="text-sm font-semibold">Recent activity</h2>
              <ItemGroup className="gap-1">
                {log.map((event, i) => {
                  const { icon: Icon, text, problem } = EVENTS[event.type]!;
                  return (
                    <div role="listitem" key={`${event.at}-${i}`}>
                      <Item asChild size="sm">
                        <button onClick={() => go({ name: "series", id: event.seriesId })}>
                          <ItemMedia variant="icon" className={problem ? "text-destructive" : undefined}>
                            <Icon />
                          </ItemMedia>
                          <ItemContent className="min-w-0">
                            <ItemTitle className={problem ? "text-destructive" : undefined}>{text(event)}</ItemTitle>
                            <ItemDescription className="truncate">{titleOf(event.seriesId)}</ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <span className="text-xs text-muted-foreground tabular-nums">{timeAgo(event.at)}</span>
                          </ItemActions>
                        </button>
                      </Item>
                    </div>
                  );
                })}
              </ItemGroup>
            </section>
          )}
        </>
      )}
    </Page>
  );
}
