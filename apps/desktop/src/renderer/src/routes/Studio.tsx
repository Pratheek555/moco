import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  FilmIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react";
import type { SeriesSummary } from "@/lib/api.ts";
import { api } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { newSeries, report, useApp } from "@/lib/store.ts";
import { EPISODE_COUNTS, IDEAS, LANGUAGE_OPTIONS, MOD_KEY } from "@/lib/format.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CastArt } from "../components/CastArt.tsx";
import { Page, PageHeader } from "../components/Page.tsx";
import { SeriesCard } from "../components/SeriesCard.tsx";
import { voiceLanguageProblem } from "../../../shared/voice-availability.ts";

// Quick starts under the idea box: a label and the idea it fills in.
const SPARKS = [
  ["The keeper and the serpent", IDEAS[0]!],
  ["A robot on Mars", IDEAS[1]!],
  ["A last-lap F1 duel", IDEAS[5]!],
] as const;

export function Studio() {
  const settings = useApp((s) => s.settings)!,
    library = useApp((s) => s.library),
    idea = useApp((s) => s.composerIdea),
    setIdea = useApp((s) => s.setComposerIdea),
    ai = useApp((s) => s.ai),
    go = useApp((s) => s.go);
  const [episodes, setEpisodes] = useState(settings.defaults.episodes),
    [language, setLanguage] = useState(settings.defaults.language),
    [starting, setStarting] = useState(false);

  const { data: voices } = useAsync(() => api.voice.list(), []);
  const { data: models, error: modelError, reload: reloadModels } = useAsync(() => api.voice.models(), [settings.voice.backend]);
  useEffect(() => {
    if (!models?.some((model) => model.state === "downloading")) return;
    const timer = setTimeout(reloadModels, 1500);
    return () => clearTimeout(timer);
  }, [models]);
  const voiceProblem = (code: string) => settings.voice.backend === "chatterbox" && modelError
    ? "could not check voice models" : voiceLanguageProblem(code, settings.voice, voices, models);
  const selectedVoiceProblem = voiceProblem(language);

  // Check Claude Code once, so a missing setup shows here instead of failing after "Create series".
  useEffect(() => {
    if (!useApp.getState().ai) useApp.getState().checkAi().catch(() => {});
  }, []);

  const submit = async () => {
    if (!idea.trim() || starting) return;
    if (selectedVoiceProblem) { report(`Narration unavailable: ${selectedVoiceProblem}. Check Voice & narration in Settings.`); return; }
    setStarting(true);
    try {
      const id = await api.series.create({ idea: idea.trim(), episodes, language });
      setIdea("");
      go({ name: "series", id });
    } catch (e) {
      report(e);
    } finally {
      setStarting(false);
    }
  };

  // Fills the idea box; if that replaced something the user wrote, offers it back.
  const pickIdea = (text: string) => {
    const previous = idea;
    setIdea(text);
    document.getElementById("idea")?.focus();
    if (previous.trim() && previous !== text)
      useApp.getState().toast("Replaced your idea", "info", {
        action: { label: "Undo", run: () => setIdea(previous) },
      });
  };
  const surprise = () => {
    const others = IDEAS.filter((text) => text !== idea);
    pickIdea(others[Math.floor(Math.random() * others.length)]!);
  };

  return (
    <Page className="gap-10">
      <section className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-8">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight text-balance xl:text-5xl">
            Small idea.
            <br />
            <span className="text-muted-foreground">Epic possibilities.</span>
          </h1>
          <p className="max-w-md text-base text-pretty text-muted-foreground">
            Turn the stories in your head into animated reels. A cast, a world, a little movie. All
            yours.
          </p>
        </div>
        <div className="hero-art hidden h-64 w-80 items-center justify-center lg:flex" aria-hidden="true">
          <div className="hero-orbit h-48 w-64 -rotate-[18deg]" />
          <div className="hero-orbit h-64 w-48 rotate-[50deg] border-dashed" />
          <span className="absolute top-12 right-8 text-xl text-amber-600/60">✦</span>
          <span className="absolute bottom-16 left-8 text-lg text-violet-500/50">✧</span>
          <CastArt className="h-60 w-auto drop-shadow-[0_10px_10px_rgb(113_79_73/0.12)]" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        {ai && !ai.ok && (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Claude Code isn’t ready yet</AlertTitle>
            <AlertDescription>
              <p className="select-text">{ai.reason}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => go({ name: "settings", section: "ai" })}
              >
                Open AI settings
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="idea">What story will you tell?</FieldLabel>
          <InputGroup>
            <InputGroupTextarea
              id="idea"
              maxLength={4000}
              disabled={starting}
              placeholder="A lighthouse keeper and a sea serpent. A robot alone on Mars…"
              className="max-h-72 min-h-28 md:text-base"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void submit();
              }}
            />
            <InputGroupAddon align="block-end" className="border-t">
              <Select value={String(episodes)} onValueChange={(v) => setEpisodes(Number(v))} disabled={starting}>
                <SelectTrigger size="sm" aria-label="Number of episodes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {EPISODE_COUNTS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} {n === 1 ? "episode" : "episodes"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={language} onValueChange={setLanguage} disabled={starting}>
                <SelectTrigger size="sm" aria-label="Story language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {LANGUAGE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} disabled={Boolean(voiceProblem(option.value))}>
                        {option.label}
                        {voiceProblem(option.value) ? ` (${voiceProblem(option.value)})` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <KbdGroup className="ml-auto" aria-hidden="true">
                <Kbd>{MOD_KEY}</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              <InputGroupButton
                variant="default"
                size="sm"
                disabled={!idea.trim() || starting || Boolean(selectedVoiceProblem)}
                onClick={() => void submit()}
              >
                {starting ? <Spinner data-icon="inline-start" aria-hidden /> : <SparklesIcon data-icon="inline-start" />}
                {starting ? "Creating…" : "Create series"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>
            Any story works: Moco builds a cast and world for it. It plans the series, then stops so you can review each step.
          </FieldDescription>
          {selectedVoiceProblem && <FieldDescription>
            Narration unavailable: {selectedVoiceProblem}.
            <Button variant="link" size="sm" onClick={() => go({ name: "settings", section: "voice" })}>Open voice settings</Button>
          </FieldDescription>}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">Need a spark?</span>
          {SPARKS.map(([label, text]) => (
            <Button key={label} variant="outline" size="sm" onClick={() => pickIdea(text)}>
              {label}
            </Button>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Surprise me" onClick={surprise}>
                <WandSparklesIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Surprise me</TooltipContent>
          </Tooltip>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Continue the story</h2>
            <p className="text-sm text-muted-foreground">Your worlds, waiting for the next chapter.</p>
          </div>
          {library.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => go({ name: "library" })}>
              All series
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          )}
        </div>
        {library.length ? (
          <SeriesGrid series={library.slice(0, 3)} />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FilmIcon />
              </EmptyMedia>
              <EmptyTitle>Your next great story lives here</EmptyTitle>
              <EmptyDescription>
                Start with an idea above. Moco writes it with your Claude Code and renders it on this
                computer.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      <div className="flex flex-col gap-6">
        <Separator />
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {["Rendered on your device", "Uses your own Claude plan", "Ready for Reels and Shorts"].map((text) => (
            <li key={text} className="flex items-center gap-2">
              <CheckIcon className="size-4" />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </Page>
  );
}

function SeriesGrid({ series }: { series: SeriesSummary[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
      {series.map((s) => (
        <SeriesCard key={s.id} series={s} />
      ))}
    </div>
  );
}

const FILTERS = [
  { value: "all", label: "All", test: () => true },
  { value: "planned", label: "In progress", test: (s: SeriesSummary) => s.next.kind !== "finished" },
  { value: "rendered", label: "With exports", test: (s: SeriesSummary) => s.finals > 0 },
] as const;

export function LibraryPage() {
  const library = useApp((s) => s.library);
  const [q, setQ] = useState(""),
    [filter, setFilter] = useState<string>("all");
  const query = q.trim().toLowerCase();
  const matching = library.filter((s) => `${s.title} ${s.premise}`.toLowerCase().includes(query));
  return (
    <Page>
      <PageHeader
        title="My series"
        description="Every world you’ve started, and every story still unfolding."
        actions={
          <Button onClick={newSeries}>
            <PlusIcon data-icon="inline-start" />
            New series
          </Button>
        }
      />
      <Tabs value={filter} onValueChange={setFilter} className="gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
                <Badge variant="secondary" className="tabular-nums">
                  {matching.filter(f.test).length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
          <InputGroup className="w-64">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search series"
              placeholder="Find a series…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </InputGroup>
        </div>
        {FILTERS.map((f) => {
          const list = matching.filter(f.test);
          return (
            <TabsContent key={f.value} value={f.value}>
              {list.length ? (
                <SeriesGrid series={list} />
              ) : (
                <LibraryEmpty filter={f.value} query={q.trim()} clear={() => setQ("")} />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </Page>
  );
}

function LibraryEmpty({ filter, query, clear }: { filter: string; query: string; clear(): void }) {
  const library = useApp((s) => s.library);
  const [title, detail] = query
    ? ["No matching stories", `Nothing matches “${query}”. Try another title.`]
    : library.length === 0
      ? ["A blank page is a beginning", "Create your first series in the studio."]
      : filter === "planned"
        ? ["Nothing in progress", "Every series is finished. Start a new one in the studio."]
        : ["No exports yet", "A series shows up here once an episode’s final video is rendered."];
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{query ? <SearchIcon /> : <FilmIcon />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {query ? (
          <Button variant="outline" onClick={clear}>
            Clear search
          </Button>
        ) : (
          <Button variant="outline" onClick={newSeries}>
            <PlusIcon data-icon="inline-start" />
            New series
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}
