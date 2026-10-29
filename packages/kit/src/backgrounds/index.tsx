import type { BgContext, BgLayer } from './common.tsx';
import { cosmos, palace, studio, temple } from './indoor.tsx';
import { forest, kailash, kurukshetra, river, vrindavan } from './outdoor.tsx';

export type { BgContext, BgLayer } from './common.tsx';
export { BLEED, H, SKY, W, tone } from './common.tsx';

export const BACKGROUND_LAYERS: Record<string, (ctx: BgContext) => BgLayer[]> = {
  kurukshetra,
  palace,
  forest,
  river,
  kailash,
  temple,
  cosmos,
  vrindavan,
  studio,
};
