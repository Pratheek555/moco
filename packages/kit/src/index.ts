// @moco/kit — for now only the machine-readable catalog the engine reads.
// catalog.json is generated from the component registry (write-catalog.ts); a test keeps them in sync.
import catalogJson from "./catalog.json" with { type: "json" };

export interface CatalogAction {
  name: string;
  minFrames: number;
  params?: Record<string, string[]>; // param name → allowed values
}

// Always-on idle motion for a character (frames at 30 fps).
export interface IdleProfile {
  breathPeriodFrames: number; // one breath, in and out
  breathAmount: number; // torso scale change at the top of a breath (0.012 = 1.2%)
  blinkMinSeconds: number; // blinks come at seeded times per castId, this far apart
  blinkMaxSeconds: number;
  blinkFrames: number; // how long the eyes are shut
  swayDegrees: number; // head sway, peak
  swayPeriodFrames: number;
  secondaryDelayFrames: number; // cloth, hair and jewellery follow the body this many frames late
}

export interface CatalogCharacter {
  id: string;
  packs: string[];
  variants: string[];
  actions: CatalogAction[];
  expressions: string[];
  visemes: string[]; // mouth shapes the speak action can use; empty = no lip sync
  layers: string[]; // named art layers (see docs/kit-asset-spec.md); empty = not layered yet
  angles: string[]; // drawn view angles, "front" first
  idle: IdleProfile;
  anchors: { defaultScale: number };
}

export interface Catalog {
  kitVersion: string;
  characters: CatalogCharacter[];
  props: { id: string; attachPoints: string[] }[];
  backgrounds: { id: string; layers: { id: string; depth: number }[]; timeOfDay: string[] }[]; // depth 0 = far, 1 = near
  fx: { id: string; maxDurationFrames: number }[];
  atmosphere: { id: string; placement: "back" | "front" }[];
  grades: string[]; // series colour grades; "none" = no grade
}

export const catalog: Catalog = catalogJson as Catalog; // placement is a plain string in JSON
