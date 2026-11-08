import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  Clock3Icon,
  ChevronDownIcon,
  MicIcon,
  FilmIcon,
  LayoutTemplateIcon,
  XIcon,
  PlusIcon,
  SearchIcon,
  WandSparklesIcon,
  PauseIcon,
  PlayIcon,
  CheckIcon,
} from "lucide-react";
import type { SeriesSummary, TemplateInfo } from "@/lib/api.ts";
import { api } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { newSeries, report, useApp } from "@/lib/store.ts";
import { EPISODE_COUNTS, IDEAS, LANGUAGE_OPTIONS, MOD_KEY } from "@/lib/format.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AsciiOcean } from "../components/AsciiOcean";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import "../studio-landing.css";
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
    dark = useApp((s) => s.dark),
    library = useApp((s) => s.library),
    idea = useApp((s) => s.composerIdea),
    setIdea = useApp((s) => s.setComposerIdea),
    ai = useApp((s) => s.ai),
    go = useApp((s) => s.go),
    templates = useApp((s) => s.templates),
    templateId = useApp((s) => s.composerTemplate),
    setTemplateId = useApp((s) => s.setComposerTemplate);
  const template = templates.find((t) => t.id === templateId);
  const ideaInput = useRef<HTMLTextAreaElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [details, setDetails] = useState<TemplateInfo | null>(null);
  const [productionMode, setProductionMode] = useState("standard");
  const [artistShape, setArtistShape] = useState("landscape");
  const [artistSeconds, setArtistSeconds] = useState("");
  const [episodes, setEpisodes] = useState(() => template?.defaults.episodes ?? settings.defaults.episodes),
    [language, setLanguage] = useState(settings.defaults.language),
    [starting, setStarting] = useState(false);

  useLayoutEffect(() => {
    const input = ideaInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }, [idea]);

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

  // Changing the look must not replace the episode count the user chose.
  const chooseTemplate = (next: TemplateInfo | undefined) => {
    setTemplateId(next?.id ?? null);
    setProductionMode("standard");
  };

  return (
    <section className="studio-landing" aria-label="Create a story">
      <AsciiOcean paused={motionPaused} dark={dark} />
      <div className="landing-halo" aria-hidden="true" />
      <header className="landing-header">
        <button className="landing-history" onClick={() => setHistoryOpen(true)}><Clock3Icon /> History <ChevronDownIcon /></button>
      </header>
      <div className="landing-center">
        <h1>What story will you tell?</h1>
        <form className="landing-prompt" aria-busy={starting} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <textarea ref={ideaInput} id="idea" aria-label="What story will you tell?" placeholder="A small idea. A whole new world." maxLength={32000} disabled={starting} value={idea} onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void submit(); }
          }} />
          <div className="landing-prompt-tools">
            <button type="button" aria-label="Story options" title="Story options and templates" disabled={starting} onClick={() => setOptionsOpen(true)}><PlusIcon /></button>
            <button type="button" aria-label="Voice settings" title="Voice and narration settings" onClick={() => go({ name: "settings", section: "voice" })}><MicIcon /></button>
            <div className="landing-modes">
              <button type="button" disabled={starting} onClick={() => setOptionsOpen(true)} aria-label="Animation style" title={template?.name ?? "Animation style"}><span>{template?.name ?? (productionMode === "artist" ? "ILLUSTRATE" : "ANIMATE")}</span><ChevronDownIcon /></button>
              <button type="button" disabled={starting} onClick={() => setOptionsOpen(true)} aria-label="Choose episode count">{episodes} {episodes === 1 ? "EPISODE" : "EPISODES"}</button>
            </div>
            <button className="landing-submit" type="submit" aria-label="Create series" title="Create series (Ctrl+Enter)" disabled={!idea.trim() || starting || Boolean(selectedVoiceProblem)}>{starting ? <Spinner /> : <ArrowUpRightIcon />}</button>
          </div>
        </form>
        <div className="landing-messages" aria-live="polite">
          {ai && !ai.ok && <button className="landing-notice" onClick={() => go({ name: "settings", section: "ai" })}>Connect your AI to start creating <ArrowRightIcon /></button>}
          {selectedVoiceProblem && <button className="landing-notice" onClick={() => go({ name: "settings", section: "voice" })}>Narration unavailable: {selectedVoiceProblem}. Open voice settings.</button>}
        </div>
      </div>
      <footer className="landing-footer">
        <span>A little imagination goes a long way.</span>
        <div><span className="landing-shortcut">{MOD_KEY} <span aria-hidden="true">↵</span> to create</span><button aria-label={motionPaused ? "Resume ocean animation" : "Pause ocean animation"} title={motionPaused ? "Resume motion" : "Pause motion"} aria-pressed={motionPaused} onClick={() => setMotionPaused(!motionPaused)}>{motionPaused ? <PlayIcon /> : <PauseIcon />}</button></div>
      </footer>
      <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
        <DialogContent
          className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl"
          onCloseAutoFocus={event => { event.preventDefault(); document.getElementById("idea")?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>Shape your story</DialogTitle>
            <DialogDescription>A few choices to make this world your own.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="min-h-0 overflow-y-auto px-1 py-1">
            <FieldSet>
              <FieldLegend variant="label">Look &amp; feel</FieldLegend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="story-approach">Visual approach</FieldLabel>
                  <Select
                    value={template?.production ? "template" : productionMode}
                    onValueChange={value => {
                      if (value === "template") return;
                      setProductionMode(value);
                      if (template?.production || value === "artist") setTemplateId(null);
                    }}
                    disabled={starting}
                  >
                    <SelectTrigger id="story-approach" className="w-full min-w-0" aria-label="Visual approach">
                      <SelectValue className="min-w-0 truncate" />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      {template?.production && <SelectItem value="template">Prompt template &middot; 2D canvas</SelectItem>}
                      <SelectItem value="standard">Animation &amp; 3D</SelectItem>
                      <SelectItem value="artist">Custom illustration &middot; experimental</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="story-template">Template <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
                  <Select value={template?.id ?? "none"} onValueChange={value => chooseTemplate(templates.find(t => t.id === value))} disabled={starting || !templates.length}>
                    <SelectTrigger id="story-template" className="w-full min-w-0" aria-label="Template">
                      <LayoutTemplateIcon /><SelectValue className="min-w-0 truncate" />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectGroup>
                        <SelectItem value="none">Start from scratch</SelectItem>
                        {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <FieldDescription>
                {template?.production ? "Your template brings its own artwork and animation direction." : productionMode === "artist" ? "Original artwork and movement, shaped around your brief." : "Bring your world to life with ready-made styles and 3D scenes."}
              </FieldDescription>
              {template && (
                <Item variant="outline" size="sm">
                  <ItemMedia><TemplateCover template={template} className="h-10 w-14 rounded-sm" /></ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{template.name}</ItemTitle>
                    <ItemDescription>{template.tagline}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="ghost" size="sm" onClick={() => setDetails(template)}>Details</Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Remove template" onClick={() => chooseTemplate(undefined)}><XIcon /></Button>
                  </ItemActions>
                </Item>
              )}
              {template?.production && (
                <FieldDescription>{template.production.format.width} &times; {template.production.format.height} &middot; {template.production.format.fps} fps &middot; {template.production.targetSeconds ? `${template.production.targetSeconds}s` : "Length from your prompt"}</FieldDescription>
              )}
              {productionMode === "artist" && (
                <FieldGroup className="rounded-lg border bg-muted/30 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="story-shape">Video shape</FieldLabel>
                      <Select value={artistShape} onValueChange={setArtistShape} disabled={starting}>
                        <SelectTrigger id="story-shape" className="w-full" aria-label="Video shape"><SelectValue /></SelectTrigger>
                        <SelectContent position="popper" align="start">
                          <SelectItem value="landscape">Landscape &middot; 16:9</SelectItem>
                          <SelectItem value="portrait">Portrait &middot; 9:16</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>1080p &middot; 60 fps</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="artist-seconds">Length in seconds (optional)</FieldLabel>
                      <Input
                        id="artist-seconds" type="number" step="any" value={artistSeconds}
                        onChange={event => setArtistSeconds(event.target.value)} disabled={starting}
                        placeholder="From your prompt" aria-describedby="story-duration-help"
                        aria-invalid={Boolean(artistSeconds.trim() && (!Number.isFinite(Number(artistSeconds)) || Number(artistSeconds) <= 0))}
                      />
                      <FieldDescription id="story-duration-help">Leave blank to follow your prompt.</FieldDescription>
                    </Field>
                  </div>
                </FieldGroup>
              )}
            </FieldSet>
            <Separator />
            <FieldSet>
              <FieldLegend variant="label">Format &amp; narration</FieldLegend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="story-episodes">Episodes</FieldLabel>
                  <Select value={String(episodes)} onValueChange={value => setEpisodes(Number(value))} disabled={starting}>
                    <SelectTrigger id="story-episodes" className="w-full" aria-label="Number of episodes"><SelectValue /></SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectGroup>{EPISODE_COUNTS.map(n => <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "episode" : "episodes"}</SelectItem>)}</SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="story-language">Story language</FieldLabel>
                  <Select value={language} onValueChange={setLanguage} disabled={starting}>
                    <SelectTrigger id="story-language" className="w-full min-w-0" aria-label="Story language"><SelectValue className="min-w-0 truncate" /></SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectGroup>{LANGUAGE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value} disabled={Boolean(voiceProblem(option.value))}>{option.label}{voiceProblem(option.value) ? ` (${voiceProblem(option.value)})` : ""}</SelectItem>)}</SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {selectedVoiceProblem && (
                <FieldDescription>
                  Narration unavailable: {selectedVoiceProblem}.
                  <Button variant="link" size="sm" onClick={() => go({ name: "settings", section: "voice" })}>Open voice settings <ArrowUpRightIcon /></Button>
                </FieldDescription>
              )}
            </FieldSet>
            <Separator />
            <FieldSet>
              <FieldLegend variant="label">Start with a spark</FieldLegend>
              <div className="flex flex-wrap gap-2">
                {sparks.map(([label, text]) => (
                  <Button key={label} variant={idea === text ? "secondary" : "outline"} size="sm" aria-pressed={idea === text} onClick={() => pickIdea(text)}>
                    {idea === text && <CheckIcon />}{label}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={surprise}><WandSparklesIcon />Surprise me</Button>
              </div>
              <FieldDescription role="status">
                {(template ? template.ideas.map(i => i.idea) : IDEAS).includes(idea) ? "An idea is ready in your prompt. Make it your own." : "Borrow an idea, then take it somewhere only you can."}
              </FieldDescription>
            </FieldSet>
          </FieldGroup>
          <DialogFooter className="border-t pt-4 sm:items-center sm:justify-between">
            <FieldDescription className="text-xs">You review the plan before production.</FieldDescription>
            <DialogClose asChild><Button>Done <ArrowRightIcon /></Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Your stories</DialogTitle><DialogDescription>Pick up where your imagination left off.</DialogDescription></DialogHeader>
          {library.length ? <div className="flex flex-col gap-2">{library.slice(0, 8).map((series) => <button key={series.id} className="rounded-lg border p-3 text-left text-sm" onClick={() => go({ name: "series", id: series.id })}>{series.title.length > 100 ? `${series.title.slice(0, 97)}...` : series.title}</button>)}</div> : <p className="text-sm text-muted-foreground">Your first story starts with an idea.</p>}
          <Button variant="outline" onClick={() => go({ name: "library" })}>All series <ArrowRightIcon /></Button>
        </DialogContent>
      </Dialog>
      <TemplateSheet template={details} onOpenChange={(open) => !open && setDetails(null)} />
    </section>
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
