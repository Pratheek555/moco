// The contract between the Electron main process and the UI.
// The UI never talks to the engine directly: main forwards these calls to the engine host (main/engine-host.ts).
import type { VoiceInfo } from "@moco/audio";
import type { DailyUsage, EngineEvent, SeriesStatus } from "@moco/engine";
import type { TemplateInfo } from "@moco/engine/templates";
import type { Catalog } from "@moco/kit";
import type { PublishDefaults, PublishKit } from "@moco/spec";

export type Theme = "light" | "dark" | "system";
export type VoiceModelId = "english" | "multilingual";
export interface VoiceModelStatus {
  id: VoiceModelId;
  name: string;
  size: string;
  state: "not-installed" | "downloading" | "ready" | "error";
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

export interface Settings {
  aiProvider: "claude-cli" | "codex-cli";
  onboarded: boolean;
  theme: Theme;
  projectsDir: string;
  voice: {
    backend?: "chatterbox" | "system";
    reference?: string; // local performance reference WAV
    characterVoices?: { id: string; reference: string }[];
    expressiveness?: number;
    voice: string; // an installed OS voice; "" = the system default
    rate: number; // 1 = normal speed
  };
  defaults: {
    episodes: number;
    language: string;
  };
  render: {
    concurrency: number; // browser tabs per render; 0 = the renderer's default (2)
  };
}

// One card in the library: the series plus what the engine knows about it.
export interface SeriesSummary {
  id: string;
  title: string; // from the approved plan; the idea until there is one
  premise: string;
  language: string;
  episodes: number;
  template?: string; // the template id the series was started from
  createdAt: string;
  cast: string[]; // kit character ids from the bible
  finals: number; // episodes with a final render
  next: SeriesStatus["next"];
  running: boolean;
  usage: SeriesStatus["usage"]; // AI calls, tokens and daily totals, for the usage page
}

// What the episode page shows: rendered videos and each shot's stills, as moco-asset:// URLs.
export interface EpisodeMedia {
  preview?: string;
  final?: string;
  finalPath?: string; // on disk, for "Show in folder"
  thumbnail?: string;
  thumbnailPath?: string; // on disk, for dragging into YouTube
  stills: Record<string, string[]>; // shot id → still URLs
}

// Learning a template from reference videos (@moco/learn), run by main in a background process.
export interface LearnJob {
  id: string;
  name: string;
  sources: string[];
  state: "running" | "done" | "error" | "cancelled";
  step: string; // fetch, measure, sheets, agents, merge, template, done
  log: string[]; // recent progress lines, newest last
  startedAt: string;
  templateId?: string; // set when done
  error?: string;
}

export interface AiStatus {
  ok: boolean;
  reason?: string;
  version?: string;
  authMethod?: string;
}

export interface MocoApi {
  platform: string;
  app: {
    info(): Promise<{ version: string; userData: string; projectsDir: string }>;
    openPath(p: string): Promise<string>;
    showItem(p: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    chooseFolder(): Promise<string | null>;
    copy(text: string): Promise<void>;
    startDrag(file: string): void; // drag a rendered video out of the app, e.g. into YouTube's upload box
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: DeepPartial<Settings>): Promise<Settings>;
  };
  ai: {
    status(): Promise<AiStatus>;
  };
  voice: {
    list(): Promise<VoiceInfo[]>;
    models(): Promise<VoiceModelStatus[]>;
    download(model: VoiceModelId): Promise<void>;
    cancelDownload(): Promise<void>;
    preview(text: string): Promise<{ url?: string; error?: string }>;
  };
  templates: {
    list(): Promise<TemplateInfo[]>; // built-in plus learned
    learn(input: { name: string; sources: string[] }): Promise<string>; // job id; progress arrives on "learn"
    jobs(): Promise<LearnJob[]>;
    cancelLearn(jobId: string): Promise<void>;
    openFolder(id: string): Promise<void>; // a learned template's folder (skill, measurements, sheets)
    remove(id: string): Promise<void>; // learned templates only
  };
  kit: {
    catalog(): Promise<Catalog>;
  };
  series: {
    list(): Promise<SeriesSummary[]>;
    create(input: { idea: string; language: string; episodes: number; template?: string }): Promise<string>; // creates and starts planning
    extend(id: string, input: { episodes: number; note?: string }): Promise<string>; // job id; plans more episodes
    status(id: string): Promise<SeriesStatus>;
    artifact(seriesId: string, file: string): Promise<{ meta: { revision: number; contentHash: string }; data: unknown } | null>;
    remove(id: string): Promise<void>;
  };
  stages: {
    run(seriesId: string, key?: string): Promise<string>; // job id; runs until the next approval gate
    approve(seriesId: string, key: string, contentHash: string): Promise<void>;
    reject(seriesId: string, key: string, feedback: string): Promise<void>;
    cancel(jobId: string): Promise<void>;
  };
  episode: {
    media(seriesId: string, episodeId: string): Promise<EpisodeMedia>;
    regenerateShot(seriesId: string, episodeId: string, shotId: string, feedback?: string): Promise<string>;
  };
  // The YouTube details for an episode, pasted into Studio by the user (no YouTube API yet).
  publish: {
    save(seriesId: string, episodeId: string, kit: PublishKit): Promise<void>;
    rewrite(seriesId: string, episodeId: string, note?: string): Promise<string>; // job id
    setThumbnail(seriesId: string, episodeId: string, choice: { shotId: string; text: string }): Promise<void>;
    setDefaults(seriesId: string, defaults: Partial<PublishDefaults>): Promise<void>;
    openStudio(): Promise<void>;
  };
  on(channel: "engine" | "library" | "settings" | "learn", cb: (payload: unknown) => void): () => void;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type { Catalog, DailyUsage, EngineEvent, PublishDefaults, PublishKit, SeriesStatus, TemplateInfo, VoiceInfo };

/** moco-asset:// URL for a file under the projects folder. */
export const assetUrl = (relativeToProjects: string) =>
  `moco-asset://projects/${relativeToProjects.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
