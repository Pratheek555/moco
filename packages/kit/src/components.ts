// @moco/kit/components — the React side of the kit, for the renderer only (the engine reads the catalog instead).
import { arjuna } from "./characters/arjuna.tsx";
import { krishna } from "./characters/krishna.tsx";
import { kurukshetra } from "./backgrounds/kurukshetra.tsx";
import type { BackgroundDef, CharacterDef, FxDef, PropDef } from "./define.ts";
import { dust } from "./fx/dust.tsx";
import { atmospheres, grades } from "./looks.ts";
import { chariot } from "./props/chariot.tsx";

export * from "./define.ts";
export * from "./rig.ts";
export * from "./looks.ts";

// Every installed kit entry. Packs (Ramayana, Shiva, …) add entries here.
export const registry = {
  characters: [krishna, arjuna] as CharacterDef[],
  props: [chariot] as PropDef[],
  backgrounds: [kurukshetra] as BackgroundDef[],
  fx: [dust] as FxDef[],
  atmospheres,
  grades,
};

export type Registry = typeof registry;
