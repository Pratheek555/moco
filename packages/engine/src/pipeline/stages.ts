// The stage graph: what runs, in which order, which stages wait for the user, and where outputs live.
//
// series:  series_plan (gate) → bible (gate)
// episode: script (gate) → voiceover → shot_list → [sample (gate)] → scenes → preview (gate) → final
//                                                                                            → memory_update
// `sample` exists only for the first episode: one shot is generated and approved before the rest
// ("sample before batch"), so a wrong look is caught after one shot, not a whole episode.
// Episodes run in order: episode N's script waits for episode N-1's memory_update,
// so continuity from N-1 is in N's prompts.

export type SeriesStage = "series_plan" | "bible";
export type EpisodeStage = "script" | "voiceover" | "shot_list" | "sample" | "scenes" | "preview" | "final" | "memory_update";
export type StageName = SeriesStage | EpisodeStage;

export const SERIES_STAGES: SeriesStage[] = ["series_plan", "bible"];
export const EPISODE_STAGES: EpisodeStage[] = ["script", "voiceover", "shot_list", "sample", "scenes", "preview", "final", "memory_update"];

// Stages that stop and wait for approve() from the UI.
export const GATED = new Set<StageName>(["series_plan", "bible", "script", "sample", "preview"]);

// A parsed stage key: "bible" → { stage: "bible" }, "ep-01/script" → { episodeId: "ep-01", stage: "script" }.
export interface StageKey {
  stage: StageName;
  episodeId?: string;
}

export function stageKey(stage: StageName, episodeId?: string): string {
  return episodeId ? `${episodeId}/${stage}` : stage;
}

export function parseStageKey(key: string): StageKey {
  const [first, second] = key.split("/");
  return second ? { episodeId: first, stage: second as StageName } : { stage: first as StageName };
}

// Every stage key in run order, given the episode ids from the series plan.
export function allStageKeys(episodeIds: string[]): string[] {
  return [...SERIES_STAGES, ...episodeIds.flatMap(episodeStageKeys)];
}

function episodeStageKeys(episodeId: string, index: number): string[] {
  const stages = index === 0 ? EPISODE_STAGES : EPISODE_STAGES.filter((stage) => stage !== "sample");
  return stages.map((stage) => stageKey(stage, episodeId));
}

function isFirstEpisode(episodeId: string, episodeIds: string[]): boolean {
  return episodeIds[0] === episodeId;
}

// Stages that must be complete (approved/done) before `key` can run.
export function requires(key: string, episodeIds: string[]): string[] {
  const { stage, episodeId } = parseStageKey(key);
  const ep = episodeId ?? "";
  switch (stage) {
    case "series_plan":
      return [];
    case "bible":
      return ["series_plan"];
    case "script": {
      // Previous episode must be fully remembered first.
      const index = episodeIds.indexOf(ep);
      const previous = index > 0 ? episodeIds[index - 1] : undefined;
      return previous ? ["bible", stageKey("memory_update", previous)] : ["bible"];
    }
    case "voiceover":
      return [stageKey("script", ep)];
    case "shot_list":
      return [stageKey("voiceover", ep)];
    case "sample":
      return [stageKey("shot_list", ep)];
    case "scenes":
      return [stageKey(isFirstEpisode(ep, episodeIds) ? "sample" : "shot_list", ep)];
    case "preview":
      return [stageKey("scenes", ep)];
    case "final":
    case "memory_update":
      return [stageKey("preview", ep)];
  }
}

// Stages built from `key`'s output, which go stale when it changes.
// Deliberately no memory_update → next script edge: re-remembering an episode
// shouldn't throw away every later episode.
export function dependants(key: string, episodeIds: string[]): string[] {
  const { stage, episodeId } = parseStageKey(key);
  const ep = episodeId ?? "";
  switch (stage) {
    case "series_plan":
      return ["bible"];
    case "bible":
      return episodeIds.map((id) => stageKey("script", id));
    case "script":
      return [stageKey("voiceover", ep)];
    case "voiceover":
      return [stageKey("shot_list", ep)];
    case "shot_list":
      return [stageKey(isFirstEpisode(ep, episodeIds) ? "sample" : "scenes", ep)];
    case "sample":
      return [stageKey("scenes", ep)];
    case "scenes":
      return [stageKey("preview", ep)];
    case "preview":
      return [stageKey("final", ep), stageKey("memory_update", ep)];
    case "final":
    case "memory_update":
      return [];
  }
}

// Where each artifact lives, relative to the series folder.
export const files = {
  seriesPlan: "artifacts/series_plan.json",
  bible: "artifacts/bible.json",
  memory: "artifacts/memory.json",
  script: (ep: string) => `episodes/${ep}/artifacts/script.json`,
  voiceover: (ep: string) => `episodes/${ep}/artifacts/voiceover.json`,
  shotList: (ep: string) => `episodes/${ep}/artifacts/shot_list.json`,
  previewReport: (ep: string) => `episodes/${ep}/artifacts/preview_report.json`,
  renderReport: (ep: string) => `episodes/${ep}/artifacts/render_report.json`,
  shotDir: (ep: string, shot: string) => `episodes/${ep}/shots/${shot}`,
  shotSpec: (ep: string, shot: string) => `episodes/${ep}/shots/${shot}/spec.json`,
  audioDir: (ep: string) => `episodes/${ep}/audio`,
  rendersDir: (ep: string) => `episodes/${ep}/renders`,
  renderCache: (key: string) => `cache/renders/${key}.mp4`,
};
