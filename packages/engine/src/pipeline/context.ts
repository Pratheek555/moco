// Everything a stage needs to run, bundled once per job.
import type { Catalog } from "@moco/kit";
import type { World, ArtistProduction } from "@moco/spec";
import type { EngineConfig } from "../config.ts";
import type { EventBus } from "../events/bus.ts";
import type { Semaphore } from "../jobs/semaphore.ts";
import type { AudioPort, RenderPort } from "../ports.ts";
import type { ArtifactStore } from "../store/artifacts.ts";
import type { Ledger } from "../store/ledger.ts";
import type { MeteredAi } from "../usage/meter.ts";

// Contents of projects/<series>/series.json — what the user asked for.
export interface SeriesInfo {
  id: string;
  idea: string;
  language: string;
  episodes: number;
  template?: string; // a template id from templates/index.ts; its guidance joins every stage's prompt
  production?: ArtistProduction;
  styleSample?: import("../templates/samples.ts").StyleSampleInfo;
  createdAt: string;
  engineVersion: string;
  specVersion: string;
}

export interface StageContext {
  seriesId: string;
  series: SeriesInfo;
  dir: string; // absolute series folder
  config: EngineConfig;
  catalog: Catalog; // the kit, or the series' own world made into a catalog
  world?: World; // set for a story the kit can't play
  useWorld: (world: World) => void; // switches this series to its world, for this job and later ones
  store: ArtifactStore;
  ledger: Ledger;
  bus: EventBus;
  ai: MeteredAi;
  render: RenderPort;
  audio: AudioPort;
  renderSlots: Semaphore;
  ttsSlots: Semaphore;
  signal: AbortSignal;
  episodeIds: () => string[]; // from the current series plan; empty before it exists
}
