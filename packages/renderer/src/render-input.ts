import type { EpisodeSpec, SceneSpec } from "@moco/spec";

// Transport only: canvasUrl never gets persisted in a SceneSpec artifact.
export type RenderScene = SceneSpec & { canvasUrl?: string };
export type RenderEpisode = Omit<EpisodeSpec, "scenes"> & { scenes: RenderScene[] };
