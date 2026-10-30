// Recipes for the kit's baked images: skies, time-of-day tints, atmosphere sprites, grades, vignette and grain.
// Soft things (glows, haze, rays, gradients) are computed here once, so nothing is blurred or graded live
// while rendering. `pnpm --filter @moco/kit bake` writes them to packages/kit/assets/; a test checks they're current.
// Images are baked at a fraction of the frame size: everything here is soft, so scaling up costs no detail.
import { IMAGE_LAYER_BOX } from "../looks.ts";
import { seededRandom } from "../rig.ts";
import type { Image, Pixel } from "./png.ts";

type Rgb = [number, number, number];


// ---------- small helpers ----------

function hex(color: string): Rgb {
  const value = Number.parseInt(color.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Soft round falloff: 1 at the centre, ~0 at `radius`.
function glow(dx: number, dy: number, radius: number): number {
  return Math.exp(-3 * ((dx * dx + dy * dy) / (radius * radius)));
}

// Half a level of seeded noise, so smooth gradients don't band when scaled up.
function dither(x: number, y: number): number {
  return (seededRandom("dither", x + y * 4096) - 0.5) / 255;
}

// Smooth value noise that repeats every `period` cells along x (so mist can scroll forever without a seam).
function valueNoise(x: number, y: number, period: number, seed: string): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fx = smoothstep(0, 1, x - cellX);
  const fy = smoothstep(0, 1, y - cellY);
  const at = (cx: number, cy: number) => seededRandom(seed, (((cx % period) + period) % period) + cy * 1000);
  const top = at(cellX, cellY) + (at(cellX + 1, cellY) - at(cellX, cellY)) * fx;
  const bottom = at(cellX, cellY + 1) + (at(cellX + 1, cellY + 1) - at(cellX, cellY + 1)) * fx;
  return top + (bottom - top) * fy;
}

// Four octaves of value noise, 0..1.
function fbm(x: number, y: number, period: number, seed: string): number {
  const octaves = [1, 2, 4, 8];
  const total = octaves.reduce((sum, scale) => sum + valueNoise(x * scale, y * scale, period * scale, `${seed}${scale}`) / scale, 0);
  return total / octaves.reduce((sum, scale) => sum + 1 / scale, 0);
}

function rgba(color: Rgb, alpha: number, x: number, y: number): Pixel {
  const d = dither(x, y);
  return [color[0] + d, color[1] + d, color[2] + d, alpha];
}

// ---------- skies (background image layer, IMAGE_LAYER_BOX) ----------

interface SkyRecipe {
  top: string;
  middle: string; // at screen y 700
  horizon: string; // at screen y 1050 and below
  body: { x: number; y: number; radius: number; color: string }; // sun or moon, screen pixels
  halo: { radius: number; strength: number; color: string };
  stars?: boolean;
}

export const SKIES: Record<string, SkyRecipe> = {
  dawn: { top: "#1f2d5c", middle: "#b8607a", horizon: "#f5a25d", body: { x: 760, y: 930, radius: 95, color: "#ffe1a0" }, halo: { radius: 560, strength: 0.6, color: "#ffc070" } },
  noon: { top: "#2f7fd0", middle: "#7fb6e6", horizon: "#cfe6f7", body: { x: 760, y: 330, radius: 80, color: "#fffbe6" }, halo: { radius: 420, strength: 0.45, color: "#fff6d5" } },
  dusk: { top: "#2a1f4e", middle: "#a3436b", horizon: "#ff8a4c", body: { x: 300, y: 960, radius: 110, color: "#ffb070" }, halo: { radius: 640, strength: 0.65, color: "#ff7a3a" } },
  night: { top: "#050816", middle: "#0d1430", horizon: "#1b2547", body: { x: 780, y: 360, radius: 60, color: "#eef2ff" }, halo: { radius: 320, strength: 0.35, color: "#9fb3ff" }, stars: true },
};

function sky(recipe: SkyRecipe): Image {
  const width = 360;
  const height = 640;
  return {
    width,
    height,
    channels: 4,
    pixel: (x, y) => {
      // This pixel's position on screen.
      const sx = IMAGE_LAYER_BOX.left + ((x + 0.5) / width) * IMAGE_LAYER_BOX.width;
      const sy = IMAGE_LAYER_BOX.top + ((y + 0.5) / height) * IMAGE_LAYER_BOX.height;
      const upper = mix(hex(recipe.top), hex(recipe.middle), smoothstep(0, 700, sy));
      const base = mix(upper, hex(recipe.horizon), smoothstep(700, 1050, sy));
      const dx = sx - recipe.body.x;
      const dy = sy - recipe.body.y;
      const halo = mix(base, hex(recipe.halo.color), recipe.halo.strength * glow(dx, dy, recipe.halo.radius));
      const disc = 1 - smoothstep(recipe.body.radius - 8, recipe.body.radius + 8, Math.hypot(dx, dy));
      const star = recipe.stars && sy < 1000 && seededRandom("stars", x + y * 4096) > 0.996 ? 0.8 : 0;
      return rgba(mix(mix(halo, hex(recipe.body.color), disc), [1, 1, 1], star), 1, x, y);
    },
  };
}

// ---------- time-of-day tints (full frame, over everything) ----------

interface TintRecipe {
  top: string;
  bottom: string;
  alpha: number;
  light?: { x: number; y: number; radius: number; alpha: number }; // added (or, if negative, removed) around the light
}

export const TINTS: Record<string, TintRecipe> = {
  dawn: { top: "#c46a8a", bottom: "#ff9a6b", alpha: 0.1, light: { x: 760, y: 930, radius: 900, alpha: 0.1 } },
  dusk: { top: "#7b3fa0", bottom: "#ff7a3a", alpha: 0.14, light: { x: 300, y: 960, radius: 900, alpha: 0.12 } },
  night: { top: "#0b1533", bottom: "#0b1533", alpha: 0.5, light: { x: 780, y: 360, radius: 700, alpha: -0.12 } },
};

function tint(recipe: TintRecipe): Image {
  return frameImage(4, (sx, sy, x, y) => {
    const color = mix(hex(recipe.top), hex(recipe.bottom), smoothstep(0, 1920, sy));
    const light = recipe.light ? recipe.light.alpha * glow(sx - recipe.light.x, sy - recipe.light.y, recipe.light.radius) : 0;
    return rgba(color, recipe.alpha + light, x, y);
  });
}

// ---------- finish: vignette, grain, grades ----------

const vignette = frameImage(2, (sx, sy) => {
  const dx = (sx - 540) / 540;
  const dy = (sy - 960) / 960;
  return [0, 0.8 * smoothstep(0.55, 1.35, Math.hypot(dx, dy))];
});

// Light and dark specks of film grain, with quantised strength so the PNG stays small.
function grain(index: number): Image {
  const width = 540;
  const height = 960;
  return {
    width,
    height,
    channels: 2,
    pixel: (x, y) => {
      const n = seededRandom(`grain${index}`, x + y * width) + seededRandom(`grain${index}b`, x + y * width) - 1; // -1..1, peaked at 0
      return [n > 0 ? 1 : 0, (Math.round(Math.abs(n) * 7) / 7) * 0.22];
    },
  };
}

// Grades are applied with mix-blend-mode soft-light: mid-grey is neutral, warmer/cooler colours shift the image.
export const GRADE_COLORS: Record<string, { top: string; bottom: string }> = {
  warm_epic: { top: "#f2a65a", bottom: "#a8642e" },
  cool_mystic: { top: "#5b8fc2", bottom: "#2f4f72" },
};

function grade(colors: { top: string; bottom: string }): Image {
  return frameImage(4, (_sx, sy, x, y) => rgba(mix(hex(colors.top), hex(colors.bottom), smoothstep(0, 1920, sy)), 1, x, y));
}

// ---------- atmosphere sprites ----------

const dustMote = sprite(64, (r) => [...hex("#e8cfa6"), 0.6 * Math.exp(-4 * r * r)]);

const diyaGlow = sprite(128, (r) => {
  const alpha = Math.min(1, 0.85 * Math.exp(-9 * r * r) + 0.35 * Math.exp(-2.5 * r * r));
  return [...mix(hex("#ffe29a"), hex("#ff8c2a"), smoothstep(0, 0.7, r)), alpha];
});

// A soft band of mist that tiles horizontally.
const mist: Image = {
  width: 540,
  height: 270,
  channels: 4,
  pixel: (x, y) => {
    const u = x / 540;
    const v = y / 270;
    const density = smoothstep(0.25, 0.85, fbm(u * 3, v * 1.2, 3, "mist")); // stretched wide: banks, not clouds
    const band = smoothstep(0, 0.35, v) * (1 - smoothstep(0.65, 1, v));
    return rgba(hex("#ece6da"), 0.55 * density * band, x, y);
  },
};

// Shafts of light falling from the top right.
const rays = frameImage(4, (sx, sy, x, y) => {
  const dx = sx - 900;
  const dy = sy + 120;
  const shafts = valueNoise(Math.atan2(dy, dx) * 9, 0.5, 1000, "rays") ** 2; // a few broad, soft shafts
  const falloff = 1 - smoothstep(300, 2000, Math.hypot(dx, dy));
  return rgba(hex("#fff0c8"), 0.38 * shafts * falloff, x, y);
});

// ---------- image shapes ----------

// A full-frame image at quarter size (270×480), with the pixel's on-screen position passed in.
function frameImage(channels: 2 | 4, pixel: (sx: number, sy: number, x: number, y: number) => Pixel): Image {
  const width = 270;
  const height = 480;
  return { width, height, channels, pixel: (x, y) => pixel(((x + 0.5) / width) * 1080, ((y + 0.5) / height) * 1920, x, y) };
}

// A square sprite; `pixel` gets the distance from the centre (0 = centre, 1 = edge).
function sprite(size: number, pixel: (r: number) => Pixel): Image {
  return { width: size, height: size, channels: 4, pixel: (x, y) => pixel(Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2)) };
}

// ---------- every baked asset, by path under packages/kit/assets ----------

export function bakedAssets(): Record<string, Image> {
  const assets: Record<string, Image> = {
    "finish/vignette.png": vignette,
    "atmosphere/dust-mote.png": dustMote,
    "atmosphere/diya-glow.png": diyaGlow,
    "atmosphere/mist.png": mist,
    "atmosphere/rays.png": rays,
  };
  for (const [name, recipe] of Object.entries(SKIES)) assets[`kurukshetra/sky-${name}.png`] = sky(recipe);
  for (const [name, recipe] of Object.entries(TINTS)) assets[`time-of-day/${name}.png`] = tint(recipe);
  for (const [name, colors] of Object.entries(GRADE_COLORS)) assets[`grade/${name}.png`] = grade(colors);
  for (const index of [0, 1, 2]) assets[`finish/grain-${index}.png`] = grain(index);
  return assets;
}
