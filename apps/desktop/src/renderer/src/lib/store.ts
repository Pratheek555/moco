import { create } from "zustand";
import { toast as sonner } from "sonner";
import {
  api,
  type AiStatus,
  type EngineEvent,
  type SeriesSummary,
  type Settings,
} from "./api.ts";

export type Route =
  | { name: "studio" }
  | { name: "library" }
  | { name: "series"; id: string }
  | { name: "episode"; seriesId: string; episodeId: string }
  | { name: "renders" }
  | { name: "usage" }
  | { name: "kit"; tab?: KitTab }
  | { name: "settings"; section?: string };

export type KitTab = "characters" | "backgrounds" | "props" | "looks";

export interface ToastOptions {
  /** A second, quieter line under the message. */
  description?: string;
  action?: { label: string; run: () => void };
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
    set({ settings });
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
  composerIdea: "",
  setComposerIdea(idea) {
    set({ composerIdea: idea });
  },
  dark: false,
  ai: null,
  async checkAi() {
    const ai = await api.ai.status();
    set({ ai });
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
  useApp.setState({ events: [...state.events, event].slice(-200) });

  if (event.type === "render.progress") {
    const progress = Number(event.data.progress ?? 0);
    useApp.setState({ progress: { ...state.progress, [event.seriesId]: progress } });
  }
  if (event.type === "stage.awaiting_approval")
    state.toast(`${title}: ${stageLabel(String(event.data.key))} is ready for review`, "success");
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
        error?.code === "ai_unavailable" ? "Claude Code isn’t ready" : `${title} couldn’t start`,
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
  const settings = await api.settings.get();
  applyTheme(settings);
  useApp.setState({ settings });
  await useApp.getState().refreshLibrary();
  api.on("engine", (payload) => onEngineEvent(payload as EngineEvent));
  api.on(
    "library",
    () =>
      void useApp
        .getState()
        .refreshLibrary()
        .catch((e) => useApp.getState().toast(String(e.message ?? e), "error")),
  );
  api.on("settings", (s) => {
    useApp.setState({ settings: s as Settings });
    applyTheme(s as Settings);
  });
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
