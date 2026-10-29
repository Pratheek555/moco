import { create } from "zustand";
import {
  api,
  type Job,
  type RenderEngineStatus,
  type SeriesSummary,
  type Settings,
} from "./api.ts";

export type Route =
  | { name: "studio" }
  | { name: "library" }
  | { name: "series"; id: string }
  | { name: "episode"; seriesId: string; number: number; shot?: string }
  | { name: "renders" }
  | { name: "kit"; tab?: KitTab }
  | { name: "settings"; section?: string };

export type KitTab =
  "characters" | "props" | "backgrounds" | "camera" | "effects" | "sound";

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
  jobs: Job[];
  library: SeriesSummary[];
  libraryLoaded: boolean;
  /** Bumped whenever series/episode data changes on disk. */
  version: number;
  refreshLibrary(): Promise<void>;
  engine: RenderEngineStatus | null;
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
  jobs: [],
  library: [],
  libraryLoaded: false,
  version: 0,
  async refreshLibrary() {
    const library = await api.series.list();
    set({ library, libraryLoaded: true, version: get().version + 1 });
  },
  engine: null,
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

/** Wire main-process events into the store. Call once. */
export async function bootstrap() {
  const [settings, jobs, engine] = await Promise.all([
    api.settings.get(),
    api.jobs.list(),
    api.render.status(),
  ]);
  applyTheme(settings);
  useApp.setState({ settings, jobs, engine });
  await useApp.getState().refreshLibrary();
  let prevJobs = jobs;
  api.on("jobs", (payload) => {
    const next = payload as Job[];
    for (const j of next) {
      const before = prevJobs.find((p) => p.id === j.id);
      if (before && before.status !== j.status) {
        if (j.status === "done")
          useApp.getState().toast(`${j.title} — done`, "success");
        if (j.status === "error")
          useApp
            .getState()
            .toast(
              `${j.title} failed: ${j.error ?? ""}`.slice(0, 220),
              "error",
            );
      }
    }
    prevJobs = next;
    useApp.setState({ jobs: next });
  });
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
  api.on("engine", (s) => useApp.setState({ engine: s as RenderEngineStatus }));
}

export const activeJobs = (jobs: Job[]) =>
  jobs.filter((j) => j.status === "running" || j.status === "queued");
export const jobFor = (jobs: Job[], seriesId: string, number?: number) =>
  jobs.find(
    (j) =>
      (j.status === "running" || j.status === "queued") &&
      j.seriesId === seriesId &&
      (number === undefined || j.number === undefined || j.number === number),
  );
