import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  FilmIcon,
  LayoutTemplateIcon,
  XIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react";
import type { SeriesSummary, TemplateInfo } from "@/lib/api.ts";
import { api } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { cn } from "@/lib/utils";
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
import { TemplateCover, TemplateSheet } from "../components/Templates.tsx";
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
    go = useApp((s) => s.go),
    templates = useApp((s) => s.templates),
    templateId = useApp((s) => s.composerTemplate),
    setTemplateId = useApp((s) => s.setComposerTemplate);
  const template = templates.find((t) => t.id === templateId);
  const [details, setDetails] = useState<TemplateInfo | null>(null);
  const [productionMode, setProductionMode] = useState("standard");
  const [artistShape, setArtistShape] = useState("landscape");
  const [artistSeconds, setArtistSeconds] = useState("");
  const [episodes, setEpisodes] = useState(() => template?.defaults.episodes ?? settings.defaults.episodes),
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

  // Check the selected AI once, so a missing setup shows here instead of failing after "Create series".
  useEffect(() => {
    if (!useApp.getState().ai) useApp.getState().checkAi().catch(() => {});
  }, []);

  const submit = async () => {
    if (!idea.trim() || starting) return;
    if (productionMode === "artist" && artistSeconds.trim() && (!Number.isFinite(Number(artistSeconds)) || Number(artistSeconds) <= 0)) {
      report("Enter a positive duration in seconds, or leave it blank to use your prompt."); return;
    }
    if (selectedVoiceProblem) { report(`Narration unavailable: ${selectedVoiceProblem}. Check Voice & narration in Settings.`); return; }
    setStarting(true);
    try {
      const id = await api.series.create({ idea: idea.trim(), episodes, language,
        ...(productionMode === "artist" ? { production: { mode: "artist" as const, format: { width: artistShape === "landscape" ? 1920 : 1080, height: artistShape === "landscape" ? 1080 : 1920, fps: 60 }, ...(artistSeconds.trim() ? { targetSeconds: Number(artistSeconds) } : {}) } } : template ? { template: template.id } : {}),
      });
      setIdea("");
      setTemplateId(null);
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
  // With a template, the sparks and "Surprise me" draw from ideas that suit it.
  const sparks: readonly (readonly [string, string])[] = template ? template.ideas.map((i) => [i.label, i.idea] as const) : SPARKS;
  const surprise = () => {
    const pool = template ? template.ideas.map((i) => i.idea) : IDEAS;
    const others = pool.filter((text) => text !== idea);
    if (others.length) pickIdea(others[Math.floor(Math.random() * others.length)]!);
  };

  // Picking a template sets its usual episode count; the user can still change it.
  const chooseTemplate = (next: TemplateInfo | undefined) => {
    setTemplateId(next?.id ?? null);
    setProductionMode("standard");
    setEpisodes(next ? next.defaults.episodes : settings.defaults.episodes);
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
            <AlertTitle>AI connection isn’t ready yet</AlertTitle>
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
              maxLength={32000}
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
              {templates.length > 0 && (
                <Select
                  value={template?.id ?? "none"}
                  onValueChange={(v) => chooseTemplate(templates.find((t) => t.id === v))}
                  disabled={starting}
                >
                  <SelectTrigger size="sm" aria-label="Template">
                    <LayoutTemplateIcon />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No template</SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
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
          <div className="flex flex-wrap items-center gap-2">
            <Select value={template?.production ? "template" : productionMode} onValueChange={(value) => { if(value === "template") return; setProductionMode(value); if (template?.production || value === "artist") setTemplateId(null); }} disabled={starting}>
              <SelectTrigger size="sm" aria-label="Visual approach"><SelectValue /></SelectTrigger>
              <SelectContent>
                {template?.production && <SelectItem value="template">Prompt template · 2D canvas</SelectItem>}
                <SelectItem value="standard">Existing styles and 3D</SelectItem>
                <SelectItem value="artist">Custom illustration · experimental</SelectItem>
              </SelectContent>
            </Select>
            {template?.production && <p className="text-xs text-muted-foreground">{template.production.format.width} × {template.production.format.height} · {template.production.format.fps} fps · {template.production.targetSeconds ? `${template.production.targetSeconds}s` : "Length from your prompt"} · local narration</p>}
            {productionMode === "artist" && <>
              <Select value={artistShape} onValueChange={setArtistShape} disabled={starting}>
                <SelectTrigger size="sm" aria-label="Video shape"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="landscape">Landscape · 1080p · 60 fps</SelectItem><SelectItem value="portrait">Portrait · 1080p · 60 fps</SelectItem></SelectContent>
              </Select>
              <Field className="w-56">
                <FieldLabel htmlFor="artist-seconds">Length in seconds (optional)</FieldLabel>
                <InputGroup>
                  <InputGroupInput id="artist-seconds" type="number" step="any" value={artistSeconds} onChange={event => setArtistSeconds(event.target.value)} disabled={starting} placeholder="Use length from prompt" />
                </InputGroup>
                <FieldDescription>Leave blank to use your prompt. An entered length overrides the prompt.</FieldDescription>
              </Field>
              <p className="text-xs text-muted-foreground">Your selected AI creates artwork and movement from your brief, then checks rendered previews.</p>
            </>}
          </div>
          {template ? (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-2 pr-3">
              <TemplateCover template={template} className="h-12 w-16 shrink-0 overflow-hidden rounded-md border" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">Using “{template.name}”</span>
                <span className="truncate text-xs text-muted-foreground">{template.tagline}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDetails(template)}>
                Details
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Remove template" onClick={() => chooseTemplate(undefined)}>
                <XIcon />
              </Button>
            </div>
          ) : (
            <FieldDescription>
              Any story works: Moco builds a cast and world for it. It plans the series, then stops so you can review each step.
            </FieldDescription>
          )}
          {selectedVoiceProblem && <FieldDescription>
            Narration unavailable: {selectedVoiceProblem}.
            <Button variant="link" size="sm" onClick={() => go({ name: "settings", section: "voice" })}>Open voice settings</Button>
          </FieldDescription>}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">Need a spark?</span>
          {sparks.map(([label, text]) => (
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

      {templates.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Start from a template</h2>
              <p className="text-sm text-muted-foreground">A proven style for the story, the world and the cut. Just bring the idea.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => go({ name: "templates" })}>
              All templates
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            {templates.slice(0, 3).map((t) => {
              const active = t.id === template?.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  disabled={starting}
                  onClick={() => chooseTemplate(active ? undefined : t)}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border bg-card p-2 pr-3 text-left transition-shadow outline-none hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active && "ring-2 ring-primary",
                  )}
                >
                  <TemplateCover template={t} className="h-16 w-20 shrink-0 overflow-hidden rounded-lg border" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{t.name}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{t.tagline}</span>
                  </span>
                  {active && <CheckIcon className="size-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <TemplateSheet template={details} onOpenChange={(open) => !open && setDetails(null)} />

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
                Start with an idea above. Moco writes it with your selected AI connection and renders it on this
                computer.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      <div className="flex flex-col gap-6">
        <Separator />
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {["Rendered on your device", "Uses your own AI plan", "Ready for Reels and Shorts"].map((text) => (
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
