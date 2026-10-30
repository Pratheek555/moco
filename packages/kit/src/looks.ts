// The kit's scene-wide looks, as data: atmosphere effects, times of day, colour grades and the film finish.
// All drawing uses images baked by src/bake (no live blur, shadows or gradients); the renderer only moves,
// scales and fades them. Paths are under packages/kit/assets.

// Where image background layers sit: the 1080×1920 frame plus room for camera moves (parallax, shake, pull-out).
export const IMAGE_LAYER_BOX = { left: -150, top: -267, width: 1380, height: 2453 };

// How the renderer animates an atmosphere's image. Adding an atmosphere of an existing kind needs no renderer change.
//   particles: many small sprites drifting on seeded paths    drift: a wide band scrolling sideways, seamlessly
//   rays: one full-frame image breathing slowly               glow: a few warm sprites flickering on seeded noise
export type AtmosphereKind = "particles" | "drift" | "rays" | "glow";

export interface AtmosphereDef {
  id: string;
  placement: "back" | "front"; // behind the actors (after the background) or over the whole scene
  kind: AtmosphereKind;
  asset: string;
}

export const atmospheres: AtmosphereDef[] = [
  { id: "dust", placement: "back", kind: "particles", asset: "atmosphere/dust-mote.png" },
  { id: "mist", placement: "back", kind: "drift", asset: "atmosphere/mist.png" },
  { id: "light_rays", placement: "front", kind: "rays", asset: "atmosphere/rays.png" },
  { id: "diya_glow", placement: "front", kind: "glow", asset: "atmosphere/diya-glow.png" },
];

// A tint laid over the whole scene for each time of day (backgrounds also swap their sky). Noon needs none.
export const timesOfDay: Record<string, { tint?: string }> = {
  dawn: { tint: "time-of-day/dawn.png" },
  noon: {},
  dusk: { tint: "time-of-day/dusk.png" },
  night: { tint: "time-of-day/night.png" },
};

// Series colour grades, applied with mix-blend-mode soft-light at `opacity`. "none" draws nothing.
export interface GradeDef {
  id: string;
  asset?: string;
  opacity: number;
}

export const grades: GradeDef[] = [
  { id: "none", opacity: 0 },
  { id: "warm_epic", asset: "grade/warm_epic.png", opacity: 0.55 },
  { id: "cool_mystic", asset: "grade/cool_mystic.png", opacity: 0.5 },
];

// Vignette and film grain; grain cycles through its frames.
export const finish = {
  vignette: { asset: "finish/vignette.png", opacity: 0.85 },
  grain: { assets: ["finish/grain-0.png", "finish/grain-1.png", "finish/grain-2.png"], opacity: 0.55, framesPerImage: 2 },
};
