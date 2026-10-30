// The contract between the Electron main process and the UI.
// The UI never talks to the engine directly: main forwards these calls to the engine host (main/engine-host.ts).
import type { VoiceInfo } from "@moco/audio";
import type { EngineEvent, SeriesStatus } from "@moco/engine";
import type { Catalog } from "@moco/kit";

export type Theme = "light" | "dark" | "system";

export interface Settings {
  onboarded: boolean;
  theme: Theme;
  projectsDir: string;
  voice: {
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
  createdAt: string;
  cast: string[]; // kit character ids from the bible
  finals: number; // episodes with a final render
  next: SeriesStatus["next"];
  running: boolean;
}

// What the episode page shows: rendered videos and each shot's stills, as moco-asset:// URLs.
export interface EpisodeMedia {
  preview?: string;
  final?: string;
  finalPath?: string; // on disk, for "Show in folder"
  stills: Record<string, string[]>; // shot id → still URLs
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
    preview(text: string): Promise<{ url?: string; error?: string }>;
  };
  kit: {
    catalog(): Promise<Catalog>;
  };
  series: {
    list(): Promise<SeriesSummary[]>;
    create(input: { idea: string; language: string; episodes: number }): Promise<string>; // creates and starts planning
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
  on(channel: "engine" | "library" | "settings", cb: (payload: unknown) => void): () => void;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type { Catalog, EngineEvent, SeriesStatus, VoiceInfo };

/** moco-asset:// URL for a file under the projects folder. */
export const assetUrl = (relativeToProjects: string) =>
  `moco-asset://projects/${relativeToProjects.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
