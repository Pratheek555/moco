import { DEFAULT_FPS, EpisodeSchema, HEIGHT, ShotSchema, WIDTH, episodeTimeline, shotSeconds, toFrames, type EpisodeInput, type ShotInput } from '@moco/spec';

export const COMPOSITION = { width: WIDTH, height: HEIGHT, fps: DEFAULT_FPS } as const;

export function episodeFrames(episode: EpisodeInput) {
  const parsed = EpisodeSchema.safeParse(episode);
  return parsed.success ? episodeTimeline(parsed.data).durationInFrames : 30;
}

export function shotFrames(shot: ShotInput, fps = DEFAULT_FPS) {
  const parsed = ShotSchema.safeParse(shot);
  return parsed.success ? Math.max(1, toFrames(shotSeconds(parsed.data), fps)) : 30;
}
