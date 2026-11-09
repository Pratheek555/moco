import { create } from "zustand";
import { toast as sonner } from "sonner";
import { ILLUSTRATED_EXPLAINER_ID } from "@moco/engine/templates";
import {
  api,
  type AiStatus,
  type EngineEvent,
  type LearnJob,
  type SeriesSummary,
  type SeriesStatus,
  type Settings,
  type TemplateInfo,
} from "./api.ts";

export type Route =
  | { name: "studio" }
  | { name: "library" }
  | { name: "series"; id: string }
  | { name: "episode"; seriesId: string; episodeId: string }
  | { name: "renders" }
  | { name: "usage" }
  | { name: "kit"; tab?: KitTab }
  | { name: "templates"; id?: string }
  | { name: "settings"; section?: string };

export type KitTab = "characters" | "backgrounds" | "props" | "looks";

export interface ToastOptions {
  /** A second, quieter line under the message. */
  description?: string;
  action?: { label: string; run: () => void };
}

/** Unsaved creation choices survive visits to Settings, Library and other pages. */
export interface ComposerOptions {
  templateId: string | null;
  productionMode: string;
  artistShape: string;
  artistSeconds: string;
  audience: string;
  visualDirection: string;
  episodes: number;
  language: string;
}

interface AppState {
  route: Route;
  history: Route[];
  go(route: Route): void;
  back(): void;
  settings: Settings | null;
  updateSettings(patch: Parameters<typeof api.settings.set>[0]): Promise<void>;
  library: SeriesSummary[];
  libraryLoaded: boolean;
  /** Bumped whenever series data changes, so open pages reload. */
  version: number;
  refreshLibrary(): Promise<void>;
  /** Recent engine events, newest last; the activity page shows them. */
  events: EngineEvent[];
  /** Render progress (0..1) per series while a render runs. */
  progress: Record<string, number>;
  toast(message: string, kind?: "info" | "success" | "error", options?: ToastOptions): void;
  palette: boolean;
  setPalette(open: boolean): void;
  composerIdea: string;
  /** The launch format; null explicitly starts from scratch. */
  composerTemplate: string | null;
  setComposerTemplate(id: string | null): void;
  composerOptions: ComposerOptions | null;
  setComposerOptions(options: ComposerOptions | null): void;
  templates: TemplateInfo[];
  refreshTemplates(): Promise<void>;
  /** Templates being learned from videos this session, newest last. */
  learnJobs: LearnJob[];
  setComposerIdea(idea: string): void;
  dark: boolean;
  /** The last Claude Code check this session; null until one has run. */
  ai: AiStatus | null;
  checkAi(): Promise<AiStatus>;
}

// A page with unsaved work can hold navigation: the guard returns true to let it happen, or false
// and keeps `proceed` to finish the same navigation once the user agrees to leave.
type NavigationGuard = (proceed: () => void) => boolean;
let navigationGuard: NavigationGuard | null = null;
export const setNavigationGuard = (guard: NavigationGuard | null) => {
  navigationGuard = guard;
};

export const useApp = create<AppState>((set, get) => ({
  route: { name: "studio" },
  history: [],
  go(route) {
    if (JSON.stringify(get().route) === JSON.stringify(route)) return;
    const commit = () => set({ route, history: [...get().history, get().route].slice(-50) });
    if (navigationGuard && !navigationGuard(commit)) return;
    commit();
  },
  back() {
    const commit = () => {
      const h = [...get().history];
      const prev = h.pop();
      if (prev) set({ route: prev, history: h });
    };
    if (navigationGuard && !navigationGuard(commit)) return;
    commit();
  },
  settings: null,
  async updateSettings(patch) {
    const settings = await api.settings.set(patch);
    set({ settings, ...(settings.aiProvider !== get().settings?.aiProvider ? { ai: null } : {}) });
  },
  library: [],
  libraryLoaded: false,
  version: 0,
  async refreshLibrary() {
    const library = await api.series.list();
    set({ library, libraryLoaded: true, version: get().version + 1 });
  },
  events: [],
  progress: {},
  toast(message, kind = "info", options = {}) {
    const show = kind === "info" ? sonner : sonner[kind];
    show(message, {
      description: options.description,
      // Errors stay up until dismissed or acted on; they usually need a fix.
      duration: kind === "error" ? Infinity : 4000,
      closeButton: kind === "error",
      action: options.action && { label: options.action.label, onClick: options.action.run },
    });
  },
  palette: false,
  setPalette(open) {
    set({ palette: open });
  },
  composerTemplate: ILLUSTRATED_EXPLAINER_ID,
  setComposerTemplate(id) {
    set({ composerTemplate: id });
  },
  composerOptions: null,
  setComposerOptions(options) {
    set({ composerOptions: options });
  },
  templates: [],
  async refreshTemplates() {
    const templates = await api.templates.list();
    set({ templates });
  },
  learnJobs: [],
  composerIdea: "",
  setComposerIdea(idea) {
    set({ composerIdea: idea });
  },
  dark: false,
  ai: null,
  async checkAi() {
    const provider = get().settings?.aiProvider;
    const ai = await api.ai.status();
    if (provider === get().settings?.aiProvider) set({ ai });
    return ai;
  },
}));

const media = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme(settings: Settings | null) {
  const dark =
    settings?.theme === "dark" ||
    (settings?.theme !== "light" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  useApp.setState({ dark });
}
media.addEventListener("change", () => applyTheme(useApp.getState().settings));

// Series whose current job already reported a failed stage, so the job's own
// failure isn't toasted a second time.
const stageFailedInJob = new Set<string>();

// Turns engine events into toasts and progress for the UI.
function onEngineEvent(event: EngineEvent) {
  const state = useApp.getState();
  const title =
    state.library.find((s) => s.id === event.seriesId)?.title ?? "Your series";
  useApp.setState({ events: [...state.events, event].slice(-1000) });

  if (event.type === "render.progress") {
    const progress = Number(event.data.progress ?? 0);
    useApp.setState({ progress: { ...state.progress, [event.seriesId]: progress } });
  }
  if (event.type === "stage.awaiting_approval" &&
      !(state.route.name === "series" && state.route.id === event.seriesId))
    state.toast(`${stageLabel(String(event.data.key))} is ready for review`, "success", {
      description: title.length > 80 ? `${title.slice(0, 77)}...` : title,
      action: { label: "Review", run: () => state.go({ name: "series", id: event.seriesId }) },
    });
  if (event.type === "job.started") stageFailedInJob.delete(event.seriesId);
  if (event.type === "stage.failed") {
    stageFailedInJob.add(event.seriesId);
    const key = String(event.data.key);
    const error = event.data.error as { message?: string } | undefined;
    state.toast(`${capitalize(stageLabel(key))} failed`, "error", {
      description: withSeries(title, error?.message),
      action: { label: "Retry", run: () => retry(event.seriesId, key) },
    });
  }
  if (event.type === "job.finished") {
    const rest = { ...useApp.getState().progress };
    delete rest[event.seriesId];
    useApp.setState({ progress: rest });
    // A job can fail before any stage runs (Claude Code missing, too old or
    // logged out); without this toast nothing on screen says why.
    const error = event.data.error as { code?: string; message?: string } | undefined;
    if (error?.code === "ai_unavailable") useApp.setState({ ai: { ok: false, reason: error.message } });
    if (event.data.status === "failed" && !stageFailedInJob.has(event.seriesId))
      // Claude Code problems affect every series, so they don't name one.
      state.toast(
        error?.code === "ai_unavailable" ? "AI connection isn’t ready" : `${title} couldn’t start`,
        "error",
        {
          description:
            error?.code === "ai_unavailable" ? error.message?.slice(0, 300) : withSeries(undefined, error?.message),
          action: { label: "Retry", run: () => retry(event.seriesId) },
        },
      );
    stageFailedInJob.delete(event.seriesId);
  }
  if ((event.type as string) === "host.exited")
    state.toast("The engine stopped unexpectedly. It restarts on your next action.", "error");
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// "Hanuman’s leap · The AI returned invalid JSON", trimmed to fit a toast.
function withSeries(series: string | undefined, message: string | undefined) {
  return [series, message].filter(Boolean).join(" · ").slice(0, 300) || undefined;
}

function retry(seriesId: string, key?: string) {
  api.stages.run(seriesId, key).catch((e: unknown) =>
    useApp.getState().toast("Couldn’t retry", "error", {
      description: e instanceof Error ? e.message : String(e),
    }),
  );
}

/** Wire main-process events into the store. Call once. */
export async function bootstrap() {
  // Subscribe before loading settings/library: creation can start as soon as the
  // studio mounts, while those first queries are still in flight.
  api.on("engine", (payload) => onEngineEvent(payload as EngineEvent));
  const settings = await api.settings.get();
  applyTheme(settings);
  useApp.setState({ settings });
  const templates = await api.templates.list().catch(() => []);
  useApp.setState({ templates });
  await useApp.getState().refreshLibrary();
  api.on(
    "library",
    () =>
      void useApp
        .getState()
        .refreshLibrary()
        .catch((e) => useApp.getState().toast(String(e.message ?? e), "error")),
  );
  useApp.setState({ learnJobs: await api.templates.jobs().catch(() => []) });
  api.on("learn", (payload) => onLearnJob(payload as LearnJob));
  api.on("settings", (s) => {
    const next = s as Settings;
    const changed = next.aiProvider !== useApp.getState().settings?.aiProvider;
    useApp.setState({ settings: next, ...(changed ? { ai: null } : {}) });
    applyTheme(s as Settings);
  });
}

function onLearnJob(job: LearnJob) {
  const { learnJobs, toast, go, refreshTemplates } = useApp.getState();
  const before = learnJobs.find((candidate) => candidate.id === job.id);
  useApp.setState({ learnJobs: [...learnJobs.filter((candidate) => candidate.id !== job.id), job] });
  if (before?.state === job.state) return;
  if (job.state === "done") {
    void refreshTemplates().catch(report);
    toast(`“${job.name}” is ready`, "success", {
      description: "Learned from your videos. Find it in Templates.",
      action: { label: "Open", run: () => go({ name: "templates", id: job.templateId }) },
    });
  } else if (job.state === "error") {
    toast(`Couldn’t learn “${job.name}”`, "error", { description: job.error });
  }
}

/** Opens the studio with the idea box focused, ready to type. */
export function newSeries() {
  useApp.getState().go({ name: "studio" });
  setTimeout(() => document.getElementById("idea")?.focus(), 50);
}

/** Shows a failed action as an error toast. */
export function report(e: unknown) {
  useApp.getState().toast(e instanceof Error ? e.message : String(e), "error");
}

export const runningSeries = (library: SeriesSummary[]) =>
  library.filter((s) => s.running);

/** Shot repairs and explicit reviews run jobs without reopening a stage. */
export function activeStageKey(status: SeriesStatus): string | undefined {
  const running = status.stages.find(s => s.status === "running");
  if (running) return running.key;
  const job = status.activeJob;
  if (!job || job.target === "next") return undefined;
  return job.kind === "shot" || job.target.endsWith("/review")
    ? `${job.target.split("/")[0]}/scenes` : job.target;
}

// "ep-01/script" → "Episode 1 script"; "bible" → "Series bible".
export function stageLabel(key: string): string {
  const names: Record<string, string> = {
    series_plan: "Series plan",
    bible: "Series bible",
    script: "script",
    voiceover: "voiceover",
    shot_list: "shot list",
    sample: "sample shot",
    scenes: "scenes",
    preview: "preview",
    final: "final render",
    memory_update: "story memory",
    publish: "YouTube details",
  };
  const [first, second] = key.split("/");
  if (!second) return names[first!] ?? first!;
  const number = Number(first!.replace(/\D/g, ""));
  return `Episode ${number} ${names[second] ?? second}`;
}

/** Opens the studio with a template picked, and its first sample idea if the box is empty. */
export function startFromTemplate(template: TemplateInfo) {
  const state = useApp.getState();
  state.setComposerTemplate(template.id);
  if (!state.composerIdea.trim() && template.ideas[0]) state.setComposerIdea(template.ideas[0].idea);
  newSeries();
}
