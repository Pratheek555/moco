// How kit entries are declared. The catalog the engine reads is generated from these definitions,
// so the AI is only ever offered actions that a component really draws.
import type { ComponentType } from "react";
import type { CharacterArt } from "./art/load.ts";
import type { IdleProfile } from "./index.ts";
import type { RigState } from "./rig.ts";

export const KIT_VERSION = "0.2.0";

export interface ActionDef {
  name: string;
  minFrames: number;
  params?: Record<string, string[]>;
  shows?: string; // layered art: a layer drawn only while the action runs (faded by its amount), e.g. prop_flute
  hides?: string; // layered art: a layer hidden while it runs, e.g. the flute tucked in the waist
}

// Calm, slow idle motion; characters can tune it.
export const DEFAULT_IDLE: IdleProfile = {
  breathPeriodFrames: 96,
  breathAmount: 0.012,
  blinkMinSeconds: 2,
  blinkMaxSeconds: 5,
  blinkFrames: 4,
  swayDegrees: 1.2,
  swayPeriodFrames: 160,
  secondaryDelayFrames: 4,
};

// Characters are drawn in a 400×800 box with the feet at the bottom centre (200, 800).
export interface CharacterProps {
  rig: RigState;
  variant: string;
}

export interface CharacterDef {
  id: string;
  packs: string[];
  variants: string[];
  actions: ActionDef[];
  expressions: string[];
  defaultScale: number;
  idle: IdleProfile;
  art?: Record<string, CharacterArt>; // angle ("front") → layered art; absent for characters still drawn in React
  Component: ComponentType<CharacterProps>;
}

// Props are drawn in their own box (width × height) with the bottom centre as the anchor.
export interface PropDef {
  id: string;
  attachPoints: string[];
  width: number;
  height: number;
  Component: ComponentType<{ frame: number }>;
}

// Backgrounds are a stack of full-frame layers (1080×1920), 3–5 of them. `depth` 0 = far (moves least), 1 = near.
// A layer is either flat SVG (`Component`) or a baked image per time of day (`image`, placed in IMAGE_LAYER_BOX).
export interface BackgroundLayerDef {
  id: string;
  depth: number;
  Component?: ComponentType<{ frame: number; timeOfDay: string }>;
  image?: Record<string, string>; // time of day → asset path
}

export interface BackgroundDef {
  id: string;
  timeOfDay: string[]; // the first is the default
  layers: BackgroundLayerDef[];
}

export interface FxDef {
  id: string;
  maxDurationFrames: number;
  Component: ComponentType<{ frame: number; durationFrames: number }>; // frame is relative to the fx start
}
