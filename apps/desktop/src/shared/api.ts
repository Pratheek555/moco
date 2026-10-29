// The contract between the Electron main process and the UI.
import type { CliStatus, ProviderId } from "@moco/ai";
import type { TtsProvider, VoiceInfo } from "@moco/audio";
import type {
  EpisodeSummary,
  PlanInput,
  RenderRecord,
  SeriesSummary,
} from "@moco/engine";
import type { Episode, Series, SfxId } from "@moco/spec";

export type Theme = "light" | "dark" | "system";

export interface Settings {
  onboarded: boolean;
  theme: Theme;
  projectsDir: string;
  ai: {
    provider: ProviderId;
    model: string;
    anthropicKey: string;
    openaiKey: string;
    effort: "low" | "medium" | "high";
    maxRepairs: number;
  };
  voice: {
    provider: TtsProvider;
    voice: string;
    rate: number;
    elevenlabsKey: string;
  };
  defaults: {
    episodes: number;
    seconds: number;
    language: string;
    style: string;
  };
  brand: {
    handle: string;
    watermark: boolean;
    progressBar: boolean;
    accent: string;
  };
  render: {
    quality: "draft" | "standard" | "high";
    concurrency: number;
    remotionLicenseKey: string;
  };
}

export type JobKind =
  "plan" | "write" | "write-all" | "revise" | "voice" | "render" | "make";
export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

export type JobSpec =
  | { kind: "plan"; input: PlanInput; thenWrite?: boolean }
  | { kind: "write"; seriesId: string; number: number }
  | { kind: "write-all"; seriesId: string }
  | {
      kind: "revise";
      seriesId: string;
      number: number;
      shotId: string;
      instruction: string;
    }
  | { kind: "voice"; seriesId: string; number: number }
  | { kind: "render"; seriesId: string; number: number }
  | { kind: "make"; seriesId: string; number: number };

export interface JobLog {
  t: number;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  seriesId?: string;
  number?: number;
  status: JobStatus;
  progress: number;
  stage: string;
  logs: JobLog[];
  /** Tail of the AI's streamed text. */
  stream: string;
  error?: string;
  output?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface EpisodeBundle {
  episode: Episode;
  renders: RenderRecord[];
  /** URL prefix for this episode's relative asset paths. */
  assetBase: string;
}

export interface RenderEngineStatus {
  bundle: boolean;
  browser: "unknown" | "missing" | "downloading" | "ready";
  downloadPercent?: number;
  bundlePath: string;
}

export interface MocoApi {
  platform: string;
  app: {
    info(): Promise<{ version: string; userData: string; projectsDir: string }>;
    openPath(p: string): Promise<string>;
    showItem(p: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    chooseFolder(): Promise<string | null>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: DeepPartial<Settings>): Promise<Settings>;
  };
  ai: {
    detect(): Promise<{ claude: CliStatus; codex: CliStatus }>;
    test(): Promise<{
      ok: boolean;
      reply?: string;
      error?: string;
      ms: number;
      model?: string;
    }>;
  };
  voice: {
    list(provider: TtsProvider): Promise<VoiceInfo[]>;
    preview(
      text: string,
    ): Promise<{
      url?: string;
      error?: string;
      provider?: string;
      fallbackReason?: string;
    }>;
  };
  series: {
    list(): Promise<SeriesSummary[]>;
    get(id: string): Promise<{ series: Series; summary: SeriesSummary }>;
    save(series: Series): Promise<Series>;
    remove(id: string): Promise<void>;
    demo(): Promise<Series>;
  };
  episode: {
    get(seriesId: string, number: number): Promise<EpisodeBundle | null>;
    save(
      seriesId: string,
      episode: Episode,
    ): Promise<{ episode: Episode; issues: string[] }>;
  };
  jobs: {
    start(spec: JobSpec): Promise<Job>;
    cancel(id: string): Promise<void>;
    list(): Promise<Job[]>;
    clear(): Promise<void>;
  };
  render: {
    status(): Promise<RenderEngineStatus>;
    prepare(): Promise<RenderEngineStatus>;
  };
  assets: {
    sfx(): Promise<Partial<Record<SfxId, string>>>;
  };
  on(
    channel: "jobs" | "library" | "settings" | "engine",
    cb: (payload: unknown) => void,
  ): () => void;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type {
  CliStatus,
  EpisodeSummary,
  PlanInput,
  RenderRecord,
  SeriesSummary,
  VoiceInfo,
};

/** moco-asset:// URL for a file under the projects folder. */
export const assetUrl = (relativeToProjects: string) =>
  `moco-asset://projects/${relativeToProjects.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
