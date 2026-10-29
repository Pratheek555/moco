// Public surface for the desktop app (Remotion Player) — no registerRoot here.
export { EpisodeComposition, ShotComposition, ErrorCard, resolveSrc } from './Episode.tsx';
export type { Assets, EpisodeProps, ShotProps } from './Episode.tsx';
export { ShotView } from './Shot.tsx';
export { ensureFonts, TEXT_FONT, DISPLAY_FONT } from './fonts.ts';
export { episodeFrames, shotFrames, COMPOSITION } from './metadata.ts';
