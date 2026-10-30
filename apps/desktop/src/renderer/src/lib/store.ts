import { create } from "zustand";
import {
  api,
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
  | { name: "kit"; tab?: KitTab }
  | { name: "settings"; section?: string };

export type KitTab = "characters" | "backgrounds" | "props" | "looks";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
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
  toasts: Toast[];
  toast(message: string, kind?: Toast["kind"], action?: Toast["action"]): void;
  dismiss(id: number): void;
  palette: boolean;
  setPalette(open: boolean): void;
  composerIdea: string;
  setComposerIdea(idea: string): void;
  dark: boolean;
}

let toastId = 0;
let navigationGuard: (() => boolean) | null = null;
export const setNavigationGuard = (guard: (() => boolean) | null) => {
  navigationGuard = guard;
};

export const useApp = create<AppState>((set, get) => ({
  route: { name: "studio" },
  history: [],
  go(route) {
    const cur = get().route;
    if (JSON.stringify(cur) === JSON.stringify(route)) return;
    if (navigationGuard && !navigationGuard()) return;
    set({ route, history: [...get().history, cur].slice(-50) });
  },
  back() {
    if (navigationGuard && !navigationGuard()) return;
    const h = [...get().history];
    const prev = h.pop();
    if (prev) set({ route: prev, history: h });
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
  toasts: [],
  toast(message, kind = "info", action) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, kind, action }].slice(-4) });
    setTimeout(() => get().dismiss(id), kind === "error" ? 7000 : 3800);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
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
  if (event.type === "stage.failed") {
    const error = event.data.error as { message?: string } | undefined;
    state.toast(`${title}: ${stageLabel(String(event.data.key))} failed. ${error?.message ?? ""}`.slice(0, 240), "error");
  }
  if (event.type === "job.finished") {
    const rest = { ...useApp.getState().progress };
    delete rest[event.seriesId];
    useApp.setState({ progress: rest });
  }
  if ((event.type as string) === "host.exited")
    state.toast("The engine stopped unexpectedly. It restarts on your next action.", "error");
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
  };
  const [first, second] = key.split("/");
  if (!second) return names[first!] ?? first!;
  const number = Number(first!.replace(/\D/g, ""));
  return `Episode ${number} ${names[second] ?? second}`;
}
