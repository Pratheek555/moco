// @moco/kit/components — the React side of the kit, for the renderer only (the engine reads the catalog instead).
import { arjuna } from "./characters/arjuna.tsx";
import { krishna } from "./characters/krishna.tsx";
import { racerBlue, racerRed } from "./characters/racer.tsx";
import { kurukshetra } from "./backgrounds/kurukshetra.tsx";
import type { BackgroundDef, CharacterDef, FxDef, PropDef } from "./define.ts";
import { dust } from "./fx/dust.tsx";
import { atmospheres, grades } from "./looks.ts";
import { chariot } from "./props/chariot.tsx";
import { raceCircuit } from "./stages/race-circuit/index.tsx";

export * from "./define.ts";
export * from "./rig.ts";
export * from "./looks.ts";
export { worldStage } from "./stages/world/World.tsx";

// Every installed kit entry. Packs (Ramayana, Shiva, …) add entries here.
export const registry = {
  characters: [krishna, arjuna, racerRed, racerBlue] as CharacterDef[],
  props: [chariot] as PropDef[],
  backgrounds: [kurukshetra, raceCircuit] as BackgroundDef[],
  fx: [dust] as FxDef[],
  atmospheres,
  grades,
};

export type Registry = typeof registry;
