// The character designer: turns a described person (WorldCharacter) into a humanoid built from shapes, with the
// proportions, faces and clothes designed once here instead of improvised by the AI for every story. The result uses
// the standard joint ids, so the built-in moves work, and is plain data like any model the AI writes.
// Units: everything is a fraction of the model's height H, so a child and a giant share one design.
import type { WorldCharacter, WorldModel, WorldPart, WorldSurface } from "@moco/spec";

type Vec = [number, number, number];
type Spec = Partial<WorldPart> & Pick<WorldPart, "id" | "shape" | "size" | "surface">;

const part = (spec: Spec): WorldPart => ({ at: [0, 0, 0], turn: [0, 0, 0], offset: [0, 0, 0], taper: 1, round: 0.15, blinks: false, ...spec, parent: spec.parent ?? undefined });
const surface = (colour: string, extra: Partial<WorldSurface> = {}): WorldSurface => ({ colour, pattern: "plain", repeat: 1, rough: 0.7, metal: 0, glow: 0, opacity: 1, ...extra });

// ---------- colour ----------

function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 255;
    return Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  };
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: string, b: string, amount: number): string {
  const [x, y] = [a, b].map((hex) => Number.parseInt(hex.slice(1), 16));
  return `#${[16, 8, 0].map((shift) => Math.round(((x! >> shift) & 255) * (1 - amount) + ((y! >> shift) & 255) * amount).toString(16).padStart(2, "0")).join("")}`;
}

// ---------- body proportions ----------

interface Body {
  head: Vec; // skull width, height, depth
  hip: number; // hip joint height
  thigh: number;
  shin: number;
  upperArm: number;
  forearm: number;
  shoulder: number; // half the shoulder width
  waist: number; // waist radius
  chest: number; // chest radius
  hips: number; // pelvis radius
  limb: number; // limb thickness
  depth: number; // torso depth over width
}

// Stylised: heads a little big, eyes big, legs a little short. A child is mostly head.
const BUILDS: Record<WorldCharacter["build"], Body> = {
  average: { head: [0.15, 0.185, 0.16], hip: 0.47, thigh: 0.225, shin: 0.215, upperArm: 0.165, forearm: 0.15, shoulder: 0.11, waist: 0.07, chest: 0.088, hips: 0.08, limb: 0.052, depth: 0.7 },
  slim: { head: [0.145, 0.18, 0.155], hip: 0.48, thigh: 0.23, shin: 0.22, upperArm: 0.168, forearm: 0.152, shoulder: 0.1, waist: 0.058, chest: 0.075, hips: 0.07, limb: 0.045, depth: 0.68 },
  broad: { head: [0.148, 0.18, 0.158], hip: 0.47, thigh: 0.225, shin: 0.215, upperArm: 0.165, forearm: 0.152, shoulder: 0.135, waist: 0.08, chest: 0.108, hips: 0.085, limb: 0.064, depth: 0.74 },
  heavy: { head: [0.155, 0.18, 0.165], hip: 0.45, thigh: 0.21, shin: 0.21, upperArm: 0.16, forearm: 0.15, shoulder: 0.125, waist: 0.112, chest: 0.11, hips: 0.11, limb: 0.066, depth: 0.85 },
  child: { head: [0.22, 0.25, 0.22], hip: 0.42, thigh: 0.19, shin: 0.19, upperArm: 0.14, forearm: 0.13, shoulder: 0.1, waist: 0.078, chest: 0.085, hips: 0.082, limb: 0.055, depth: 0.78 },
};

// ---------- the designer ----------

export function designCharacter(model: WorldModel): WorldModel {
  const c = model.character;
  if (!c) return model;
  const H = model.height;
  const b = BUILDS[c.build];
  const m = (fraction: number) => fraction * H;
  const parts: WorldPart[] = [];
  const add = (spec: Spec) => parts.push(part(spec));

  const top = c.top;
  const long = ["robe", "dress", "kurta"].includes(top.kind); // covers the hips and thighs
  const coat = ["coat", "lab_coat", "suit"].includes(top.kind);
  const bareForearms = top.kind === "tshirt" || top.kind === "armour" || top.kind === "dress";
  const surfaces: Record<string, WorldSurface> = {
    skin: surface(c.skin, { rough: 0.62 }),
    skin_dark: surface(shade(c.skin, -0.18), { rough: 0.6 }),
    lip: surface(mix(shade(c.skin, -0.3), "#b0383c", 0.45), { rough: 0.45 }),
    eye_white: surface("#f6f3ee", { rough: 0.25 }),
    iris: surface(c.eyes, { rough: 0.2 }),
    pupil: surface("#0b0908", { rough: 0.15 }),
    shine: surface("#ffffff", { glow: 1.6, rough: 0.1 }),
    hair: surface(c.hair.colour, { rough: 0.55 }),
    brow: surface(shade(c.hair.colour, -0.15), { rough: 0.7 }),
    top: surface(top.colour, { rough: top.kind === "armour" ? 0.35 : 0.82, metal: top.kind === "armour" ? 0.7 : 0 }),
    top2: surface(top.colour2 ?? (coat ? "#f2f0ea" : shade(top.colour, -0.25)), { rough: 0.8 }),
    bottom: surface(c.bottom.colour, { rough: 0.85 }),
    shoe: surface(c.shoes, { rough: 0.4 }),
    hat: surface(c.hat.colour, { rough: c.hat.kind === "crown" || c.hat.kind === "helmet" ? 0.3 : 0.75, metal: c.hat.kind === "crown" || c.hat.kind === "helmet" ? 0.85 : 0 }),
  };

  // Hips: the root, at hip height. The pelvis hangs from it.
  add({ id: "hips", shape: "lathe", size: [1, 1, b.depth], surface: long ? "top" : "bottom", at: [0, m(b.hip), 0], profile: [[0, m(-0.075)], [m(b.hips * 0.92), m(-0.06)], [m(b.hips), m(-0.01)], [m(b.waist * 1.02), m(0.06)], [m(b.waist * 0.6), m(0.1)], [0, m(0.1)]] });

  // Chest: the torso, from the waist to the shoulders, with a real waist and shoulder line.
  const chestAt = m(0.07);
  const shoulderY = m(0.21);
  add({ id: "chest", parent: "hips", shape: "lathe", size: [1, 1, b.depth], surface: "top", at: [0, chestAt, 0], profile: [[0, m(-0.04)], [m(b.waist), m(-0.03)], [m(b.waist * 1.04), m(0.04)], [m(b.chest), m(0.13)], [m(b.shoulder * 0.86), m(0.19)], [m(b.shoulder * 0.5), m(0.225)], [m(0.03), m(0.235)], [0, m(0.235)]] });
  // Shoulders: round caps that hide where the arms meet the body.
  for (const side of [1, -1]) add({ id: `shoulder_${side > 0 ? "L" : "R"}`, parent: "chest", shape: "sphere", size: [m(b.limb * 1.12), m(b.limb * 1.05), m(b.limb * 1.12)], surface: "top", at: [side * m(b.shoulder * 0.9), shoulderY - m(0.018), 0] });

  // Clothes on the torso.
  if (coat) {
    // The shirt and lapels show in a V down the front.
    add({ id: "shirt_front", parent: "chest", shape: "extrude", size: [1, 1, m(0.012)], surface: "top2", at: [0, 0, m(b.chest * b.depth) - m(0.004)], outline: [[m(-0.045), m(0.215)], [m(0.045), m(0.215)], [0, m(0.07)]] });
    add({ id: "collar", parent: "chest", shape: "torus", size: [m(0.085), m(0.018), m(0.075)], surface: top.kind === "suit" ? "top" : "top2", at: [0, m(0.222), m(0.004)], turn: [-12, 0, 0] });
    // The coat goes on past the waist: to mid-thigh, or to the knee for a lab coat.
    const hem = top.kind === "lab_coat" ? m(-0.24) : top.kind === "suit" ? m(-0.1) : m(-0.2);
    add({ id: "coat_skirt", parent: "hips", shape: "lathe", size: [1, 1, b.depth * 1.04], surface: "top", at: [0, 0, 0], profile: [[m(b.waist * 1.05), m(0.07)], [m(b.hips * 1.08), m(-0.02)], [m(b.hips * 1.22), hem * 0.6], [m(b.hips * 1.32), hem], [m(b.hips * 1.2), hem - m(0.005)]] });
    // Buttons down the front.
    for (const [index, y] of [-0.01, 0.035].entries()) add({ id: `button_${index}`, parent: "chest", shape: "sphere", size: [m(0.008), m(0.008), m(0.005)], surface: "brow", at: [m(0.01), m(y), m(b.waist * b.depth * 1.04)] });
  } else if (long) {
    // A robe, dress or kurta flares from the waist to the knee or the ankle.
    const hem = top.kind === "kurta" ? m(-0.27) : m(-0.43);
    add({ id: "skirt", parent: "hips", shape: "lathe", size: [1, 1, b.depth * 1.08], surface: "top", at: [0, 0, 0], profile: [[m(b.waist * 1.02), m(0.08)], [m(b.hips * 1.08), m(-0.02)], [m(b.hips * 1.3), hem * 0.6], [m(b.hips * 1.55), hem], [m(b.hips * 1.4), hem - m(0.006)]] });
    add({ id: "neckline", parent: "chest", shape: "torus", size: [m(0.075), m(0.014), m(0.066)], surface: "top2", at: [0, m(0.222), m(0.003)], turn: [-10, 0, 0] });
  } else {
    add({ id: "neckline", parent: "chest", shape: "torus", size: [m(0.07), m(0.012), m(0.06)], surface: top.kind === "sweater" ? "top" : "top2", at: [0, m(0.224), m(0.003)], turn: [-10, 0, 0] });
    if (top.kind === "shirt") for (const [index, y] of [0.06, 0.12, 0.17].entries()) add({ id: `button_${index}`, parent: "chest", shape: "sphere", size: [m(0.009), m(0.009), m(0.005)], surface: "top2", at: [0, m(y), m(b.chest * b.depth * (y > 0.1 ? 1 : 0.97))] });
  }
  if (top.kind === "armour") add({ id: "breastplate", parent: "chest", shape: "sphere", size: [m(b.chest * 2.05), m(0.17), m(b.chest * b.depth * 2.1)], surface: "top", at: [0, m(0.12), m(0.004)] });

  // Neck and head. The head hinges at the base of the skull.
  add({ id: "neck", parent: "chest", shape: "cylinder", size: [m(0.05), m(0.06), m(0.05)], surface: "skin", at: [0, m(0.235), 0], taper: 0.92 });
  const [hw, hh, hd] = b.head.map(m) as Vec;
  add({ id: "head", parent: "chest", shape: "sphere", size: [hw, hh * 0.98, hd], surface: "skin", at: [0, m(0.25), 0], offset: [0, hh * 0.47, 0] });
  const face = (x: number, y: number, z = 0): Vec => [x * hw, hh * 0.47 + y * hh, z * hd]; // in head units from its middle
  // Jaw and cheeks: a softer, rounder lower face.
  add({ id: "jaw", parent: "head", shape: "sphere", size: [hw * 0.8, hh * 0.56, hd * 0.8], surface: "skin", at: face(0, -0.18, 0.04) });
  for (const side of [1, -1]) add({ id: `ear_${side > 0 ? "L" : "R"}`, parent: "head", shape: "sphere", size: [hw * 0.12, hh * 0.24, hd * 0.2], surface: "skin", at: face(side * 0.49, -0.02, -0.02), turn: [0, side * -15, 0] });

  // Eyes: big, set low, white, iris, pupil and a bright highlight. They blink together.
  for (const side of [1, -1]) {
    const s = side > 0 ? "L" : "R";
    const eye = face(side * 0.21, -0.04, 0.4);
    add({ id: `eye_${s}`, parent: "head", shape: "sphere", size: [hw * 0.27, hh * 0.26, hd * 0.2], surface: "eye_white", at: eye, blinks: true });
    add({ id: `iris_${s}`, parent: `eye_${s}`, shape: "sphere", size: [hw * 0.17, hh * 0.18, hd * 0.06], surface: "iris", at: [side * -hw * 0.01, -hh * 0.005, hd * 0.075], blinks: true });
    add({ id: `pupil_${s}`, parent: `iris_${s}`, shape: "sphere", size: [hw * 0.085, hh * 0.095, hd * 0.03], surface: "pupil", at: [0, 0, hd * 0.022], blinks: true });
    add({ id: `shine_${s}`, parent: `pupil_${s}`, shape: "sphere", size: [hw * 0.04, hh * 0.04, hd * 0.02], surface: "shine", at: [hw * 0.03, hh * 0.035, hd * 0.012], blinks: true });
    // Brows: a soft arc above each eye.
    const arc = (x: number) => [eye[0] + x * hw * 0.13 * side, eye[1] + hh * (0.17 - Math.abs(x) * 0.03) + (x * side < 0 ? 0 : 0), eye[2] + hd * 0.04] as Vec;
    add({ id: `brow_${s}`, parent: "head", shape: "tube", size: [hh * 0.025, 1, 1], surface: "brow", path: [arc(-1), arc(0), arc(1)] });
  }
  // Nose and mouth.
  add({ id: "nose", parent: "head", shape: "sphere", size: [hw * 0.15, hh * 0.13, hd * 0.16], surface: "skin_dark", at: face(0, -0.15, 0.5) });
  const curve = c.smile;
  const mouth = (x: number): Vec => [x * hw * 0.17, hh * 0.47 - hh * 0.3 + (Math.abs(x) ** 2) * curve * hh * 0.06, hd * 0.44 - Math.abs(x) * hd * 0.04];
  add({ id: "mouth", parent: "head", shape: "tube", size: [hh * 0.022, 1, 1], surface: "lip", path: [mouth(-1), mouth(-0.5), mouth(0), mouth(0.5), mouth(1)] });

  addHair(add, c, face, hw, hh, hd);
  addHat(add, c, face, hw, hh, hd);
  addExtras(add, c, face, hw, hh, hd, m, b, surfaces);

  // Arms: they hang from the shoulder, a little away from the body, and bend at the elbow.
  for (const side of [1, -1]) {
    const s = side > 0 ? "L" : "R";
    const sleeve = "top";
    add({ id: `arm_${s}`, parent: "chest", shape: "capsule", size: [m(b.limb), m(b.upperArm + b.limb * 0.6), m(b.limb)], surface: sleeve, at: [side * m(b.shoulder * 0.95), shoulderY - m(0.012), 0], turn: [0, 0, side * 7], offset: [0, -m(b.upperArm) / 2, 0] });
    add({ id: `forearm_${s}`, parent: `arm_${s}`, shape: "capsule", size: [m(b.limb * 0.88), m(b.forearm + b.limb * 0.5), m(b.limb * 0.88)], surface: bareForearms ? "skin" : sleeve, at: [0, -m(b.upperArm), 0], turn: [-6, 0, 0], offset: [0, -m(b.forearm) / 2, 0] });
    if (!bareForearms) add({ id: `cuff_${s}`, parent: `forearm_${s}`, shape: "cylinder", size: [m(b.limb * 0.98), m(0.02), m(b.limb * 0.98)], surface: coat ? "top2" : "top", at: [0, -m(b.forearm) + m(0.01), 0] });
    // A mitten hand with a thumb: reads as a hand at any distance, and never shows broken fingers.
    add({ id: `hand_${s}`, parent: `forearm_${s}`, shape: "sphere", size: [m(0.042), m(0.058), m(0.028)], surface: "skin", at: [0, -m(b.forearm) - m(0.022), 0], turn: [0, side * 12, 0] });
    add({ id: `thumb_${s}`, parent: `hand_${s}`, shape: "capsule", size: [m(0.015), m(0.035), m(0.015)], surface: "skin", at: [side * -m(0.012), m(0.004), m(0.012)], turn: [20, 0, side * 35], offset: [0, -m(0.012), 0] });
  }

  // Legs: tapered, with a knee and a rounded shoe.
  for (const side of [1, -1]) {
    const s = side > 0 ? "L" : "R";
    const legSurface = long && top.kind !== "kurta" ? "top" : c.bottom.kind === "shorts" || c.bottom.kind === "skirt" ? "skin" : "bottom";
    const thighSurface = c.bottom.kind === "skirt" ? "bottom" : legSurface;
    add({ id: `leg_${s}`, parent: "hips", shape: "cylinder", size: [m(b.limb * 1.55), m(b.thigh + 0.03), m(b.limb * 1.6)], surface: c.bottom.kind === "shorts" ? "bottom" : thighSurface, at: [side * m(b.hips * 0.5), -m(0.02), 0], offset: [0, -m(b.thigh) / 2, 0], taper: 1.3 });
    add({ id: `knee_${s}`, parent: `leg_${s}`, shape: "sphere", size: [m(b.limb * 1.2), m(b.limb * 1.2), m(b.limb * 1.25)], surface: c.bottom.kind === "shorts" ? "skin" : legSurface, at: [0, -m(b.thigh), 0] });
    add({ id: `shin_${s}`, parent: `leg_${s}`, shape: "cylinder", size: [m(b.limb * 1.15), m(b.shin + 0.02), m(b.limb * 1.2)], surface: legSurface, at: [0, -m(b.thigh), 0], offset: [0, -m(b.shin) / 2, 0], taper: 1.25 });
    add({ id: `shoe_${s}`, parent: `shin_${s}`, shape: "sphere", size: [m(0.07), m(0.05), m(0.13)], surface: "shoe", at: [0, -m(b.shin) - m(0.005), m(0.025)] });
  }
  if (c.bottom.kind === "skirt" && !long) add({ id: "skirt", parent: "hips", shape: "lathe", size: [1, 1, b.depth * 1.08], surface: "bottom", profile: [[m(b.waist * 1.04), m(0.07)], [m(b.hips * 1.1), m(-0.02)], [m(b.hips * 1.45), m(-0.18)], [m(b.hips * 1.3), m(-0.185)]] });
  if (c.bottom.kind === "dhoti") add({ id: "dhoti", parent: "hips", shape: "lathe", size: [1, 1, b.depth * 1.05], surface: "bottom", profile: [[m(b.waist * 1.04), m(0.07)], [m(b.hips * 1.15), m(-0.02)], [m(b.hips * 1.35), m(-0.16)], [m(b.hips * 1.2), m(-0.17)]] });

  // Anything the AI added by hand (a prop in a hand, a badge) goes on top; its surfaces too.
  return { ...model, rig: "humanoid", surfaces: { ...surfaces, ...model.surfaces }, parts: [...parts, ...model.parts.filter((extra) => !parts.some((own) => own.id === extra.id))] };
}

type Add = (spec: Spec) => void;
type Face = (x: number, y: number, z?: number) => Vec;

// Hair sits on a cap over the top and back of the skull, tilted so the forehead shows. Each style adds its masses.
function addHair(add: Add, c: WorldCharacter, face: Face, hw: number, hh: number, hd: number): void {
  const style = c.hair.style;
  if (style === "bald") return;
  const cap = () => add({ id: "hair_cap", parent: "head", shape: "sphere", size: [hw * 1.045, hh * 0.74, hd * 1.06], surface: "hair", at: face(0, 0.17, -0.06), turn: [-24, 0, 0] });
  if (style === "mohawk") {
    add({ id: "hair_ridge", parent: "head", shape: "extrude", size: [1, 1, hw * 0.16], surface: "hair", at: face(0, 0.2, -0.05), turn: [0, 90, 0], outline: [[-hd * 0.5, 0], [-hd * 0.45, hh * 0.32], [-hd * 0.1, hh * 0.48], [hd * 0.3, hh * 0.42], [hd * 0.45, hh * 0.12], [hd * 0.4, 0]] });
    return;
  }
  if (style === "afro") {
    add({ id: "hair_afro", parent: "head", shape: "sphere", size: [hw * 1.55, hh * 1.2, hd * 1.45], surface: "hair", at: face(0, 0.22, -0.1) });
    return;
  }
  cap();
  // A fringe across the forehead, swept to one side.
  const sweep = style === "side_part" ? 1 : 0.4;
  const fringe = (x: number): Vec => [x * hw * 0.45, hh * 0.47 + hh * (0.3 - (x + sweep) ** 2 * 0.03), hd * 0.42 - Math.abs(x) * hd * 0.06];
  add({ id: "hair_fringe", parent: "head", shape: "tube", size: [hh * 0.05, 1, 1], surface: "hair", path: [fringe(-1), fringe(-0.3), fringe(0.4), fringe(1)] });
  // Sideburns at the temples.
  for (const side of [1, -1]) add({ id: `hair_side_${side > 0 ? "L" : "R"}`, parent: "head", shape: "sphere", size: [hw * 0.16, hh * 0.38, hd * 0.42], surface: "hair", at: face(side * 0.45, 0.08, -0.05) });
  if (style === "side_part") add({ id: "hair_swoop", parent: "head", shape: "sphere", size: [hw * 0.62, hh * 0.22, hd * 0.5], surface: "hair", at: face(0.1, 0.38, 0.14), turn: [-14, 0, -10] });
  if (style === "short") add({ id: "hair_top", parent: "head", shape: "sphere", size: [hw * 0.85, hh * 0.3, hd * 0.75], surface: "hair", at: face(0, 0.4, 0.04), turn: [-8, 0, 0] });
  if (style === "curly") {
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      const ring = index % 2 === 0 ? 0.42 : 0.3;
      add({ id: `hair_curl_${index}`, parent: "head", shape: "sphere", size: [hw * 0.32, hh * 0.27, hd * 0.32], surface: "hair", at: face(Math.sin(angle) * ring, 0.32 + (index % 3) * 0.05, Math.cos(angle) * ring - 0.05) });
    }
  }
  if (style === "spiky") {
    for (let index = 0; index < 9; index += 1) {
      const angle = ((index - 4) / 4) * 60;
      add({ id: `hair_spike_${index}`, parent: "head", shape: "cylinder", size: [hw * 0.2, hh * 0.32, hd * 0.2], surface: "hair", at: face(Math.sin((angle * Math.PI) / 180) * 0.3, 0.42, -0.05 - (index % 2) * 0.12), turn: [-25 - (index % 2) * 20, 0, -angle * 0.8], taper: 0, offset: [0, hh * 0.12, 0] });
    }
  }
  if (style === "bun") add({ id: "hair_bun", parent: "head", shape: "sphere", size: [hw * 0.45, hh * 0.38, hd * 0.42], surface: "hair", at: face(0, 0.45, -0.38) });
  if (style === "ponytail") {
    add({ id: "hair_tie", parent: "head", shape: "sphere", size: [hw * 0.22, hh * 0.18, hd * 0.2], surface: "hair", at: face(0, 0.22, -0.5) });
    add({ id: "hair_tail", parent: "head", shape: "tube", size: [hh * 0.09, 1, 1], surface: "hair", path: [face(0, 0.22, -0.52), face(0, 0.05, -0.68), face(0, -0.25, -0.66), face(0, -0.5, -0.55)] });
  }
  if (style === "long" || style === "bob") {
    const end = style === "long" ? -0.95 : -0.42;
    add({ id: "hair_back", parent: "head", shape: "lathe", size: [1, 1, 0.9], surface: "hair", at: face(0, 0, -0.12), profile: [[0, hh * 0.45], [hw * 0.52, hh * 0.3], [hw * 0.58, 0], [hw * 0.56, hh * end * 0.6], [hw * (style === "long" ? 0.5 : 0.6), hh * end], [0, hh * end]] });
    for (const side of [1, -1]) add({ id: `hair_lock_${side > 0 ? "L" : "R"}`, parent: "head", shape: "tube", size: [hh * 0.1, 1, 1], surface: "hair", path: [face(side * 0.42, 0.25, 0.15), face(side * 0.52, -0.05, 0.12), face(side * 0.5, end * 0.6, 0.02), face(side * 0.46, end, -0.06)] });
  }
}

function addHat(add: Add, c: WorldCharacter, face: Face, hw: number, hh: number, hd: number): void {
  const kind = c.hat.kind;
  if (kind === "none") return;
  if (kind === "cap" || kind === "flat_cap") {
    add({ id: "hat", parent: "head", shape: "sphere", size: [hw * 1.1, hh * (kind === "cap" ? 0.62 : 0.42), hd * 1.12], surface: "hat", at: face(0, 0.28, -0.02), turn: [-8, 0, 0] });
    add({ id: "hat_brim", parent: "head", shape: "cylinder", size: [hw * 0.7, hh * 0.03, hd * 0.55], surface: "hat", at: face(0, 0.24, 0.42), turn: [-8, 0, 0] });
  } else if (kind === "top_hat") {
    add({ id: "hat", parent: "head", shape: "cylinder", size: [hw * 0.8, hh * 0.65, hd * 0.8], surface: "hat", at: face(0, 0.72, -0.02), taper: 1.06 });
    add({ id: "hat_brim", parent: "head", shape: "cylinder", size: [hw * 1.3, hh * 0.03, hd * 1.3], surface: "hat", at: face(0, 0.4, -0.02) });
  } else if (kind === "crown") {
    add({ id: "hat", parent: "head", shape: "cylinder", size: [hw * 0.82, hh * 0.24, hd * 0.82], surface: "hat", at: face(0, 0.5, -0.03), taper: 1.12 });
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      add({ id: `hat_point_${index}`, parent: "hat", shape: "cylinder", size: [hw * 0.12, hh * 0.16, hw * 0.12], surface: "hat", at: [Math.sin(angle) * hw * 0.44, hh * 0.18, Math.cos(angle) * hd * 0.44], taper: 0 });
    }
    add({ id: "hat_jewel", parent: "hat", shape: "sphere", size: [hw * 0.12, hh * 0.1, hd * 0.06], surface: "lip", at: [0, 0, hd * 0.44] });
  } else if (kind === "turban") {
    for (let index = 0; index < 3; index += 1) add({ id: `hat_${index}`, parent: "head", shape: "torus", size: [hw * (1.12 - index * 0.14), hh * 0.18, hd * (1.14 - index * 0.14)], surface: "hat", at: face(0, 0.32 + index * 0.13, -0.03), turn: [-10 + index * 3, 0, 0] });
    add({ id: "hat_top", parent: "head", shape: "sphere", size: [hw * 0.8, hh * 0.45, hd * 0.82], surface: "hat", at: face(0, 0.48, -0.04) });
  } else if (kind === "helmet") {
    add({ id: "hat", parent: "head", shape: "sphere", size: [hw * 1.16, hh * 0.86, hd * 1.18], surface: "hat", at: face(0, 0.2, -0.03), turn: [-14, 0, 0] });
    add({ id: "hat_ridge", parent: "hat", shape: "cylinder", size: [hw * 0.1, hh * 0.1, hd * 0.9], surface: "hat", at: [0, hh * 0.4, 0], turn: [90, 0, 0] });
  } else if (kind === "headband") {
    add({ id: "hat", parent: "head", shape: "torus", size: [hw * 1.06, hh * 0.08, hd * 1.08], surface: "hat", at: face(0, 0.22, -0.02), turn: [-12, 0, 0] });
  } else if (kind === "hood") {
    add({ id: "hat", parent: "head", shape: "sphere", size: [hw * 1.3, hh * 1.18, hd * 1.3], surface: "hat", at: face(0, 0.08, -0.14), turn: [-14, 0, 0] });
  }
}

function addExtras(add: Add, c: WorldCharacter, face: Face, hw: number, hh: number, hd: number, m: (fraction: number) => number, b: Body, surfaces: Record<string, WorldSurface>): void {
  c.extras.forEach((extra, index) => {
    const id = `extra_${index}`;
    if (extra.colour) surfaces[id] = surface(extra.colour, { rough: 0.6, metal: ["necklace", "earrings"].includes(extra.kind) ? 0.9 : 0 });
    const own = extra.colour ? id : extra.kind === "glasses" || extra.kind === "round_glasses" ? "pupil" : "top2";
    const front = m(b.chest * b.depth);
    switch (extra.kind) {
      case "tie":
        add({ id, parent: "chest", shape: "extrude", size: [1, 1, m(0.008)], surface: own, at: [0, 0, front + m(0.002)], outline: [[m(-0.012), m(0.21)], [m(0.012), m(0.21)], [m(0.018), m(0.07)], [0, m(0.05)], [m(-0.018), m(0.07)]] });
        break;
      case "bow_tie":
        add({ id, parent: "chest", shape: "extrude", size: [1, 1, m(0.012)], surface: own, at: [0, m(0.205), front * 0.62], outline: [[m(-0.03), m(0.013)], [m(-0.005), m(0.004)], [m(0.005), m(0.004)], [m(0.03), m(0.013)], [m(0.03), m(-0.013)], [m(0.005), m(-0.004)], [m(-0.005), m(-0.004)], [m(-0.03), m(-0.013)]] });
        break;
      case "scarf":
        add({ id, parent: "chest", shape: "torus", size: [m(0.1), m(0.035), m(0.09)], surface: own, at: [0, m(0.225), m(0.004)], turn: [-10, 0, 0] });
        break;
      case "belt":
        add({ id, parent: "hips", shape: "torus", size: [m(b.waist * 2.1), m(0.02), m(b.waist * 2.1 * b.depth)], surface: extra.colour ? own : "shoe", at: [0, m(0.065), 0] });
        break;
      case "sash":
        add({ id, parent: "chest", shape: "torus", size: [m(b.chest * 2.1), m(0.03), m(b.chest * 2.1 * b.depth)], surface: own, at: [0, m(0.11), 0], turn: [0, 0, 35] });
        break;
      case "necklace":
        add({ id, parent: "chest", shape: "torus", size: [m(0.095), m(0.008), m(0.085)], surface: extra.colour ? own : "hat", at: [0, m(0.205), m(0.012)], turn: [-25, 0, 0] });
        break;
      case "cape":
        add({ id, parent: "chest", shape: "extrude", size: [1, 1, m(0.012)], surface: own, at: [0, 0, -m(b.chest * b.depth) - m(0.01)], turn: [6, 0, 0], outline: [[m(-b.shoulder), m(0.22)], [m(b.shoulder), m(0.22)], [m(b.shoulder * 1.5), m(-0.38)], [m(-b.shoulder * 1.5), m(-0.38)]] });
        break;
      case "glasses":
      case "round_glasses":
        for (const side of [1, -1]) add({ id: `${id}_${side > 0 ? "L" : "R"}`, parent: "head", shape: "torus", size: [hw * 0.3, hh * 0.025, hw * (extra.kind === "round_glasses" ? 0.3 : 0.22)], surface: own, at: face(side * 0.21, -0.04, 0.49), turn: [90, 0, 0] });
        add({ id: `${id}_bridge`, parent: "head", shape: "tube", size: [hh * 0.012, 1, 1], surface: own, path: [face(-0.07, -0.02, 0.5), face(0, 0, 0.52), face(0.07, -0.02, 0.5)] });
        break;
      case "moustache":
        add({ id, parent: "head", shape: "tube", size: [hh * 0.04, 1, 1], surface: extra.colour ? own : "hair", path: [face(-0.2, -0.29, 0.4), face(-0.08, -0.22, 0.47), face(0, -0.235, 0.48), face(0.08, -0.22, 0.47), face(0.2, -0.29, 0.4)] });
        break;
      case "beard":
        add({ id, parent: "head", shape: "sphere", size: [hw * 0.92, hh * 0.5, hd * 0.8], surface: extra.colour ? own : "hair", at: face(0, -0.36, 0.1) });
        break;
      case "stubble":
        add({ id, parent: "head", shape: "sphere", size: [hw * 0.88, hh * 0.46, hd * 0.84], surface: "skin_dark", at: face(0, -0.3, 0.06) });
        break;
      case "earrings":
        for (const side of [1, -1]) add({ id: `${id}_${side > 0 ? "L" : "R"}`, parent: "head", shape: "torus", size: [hw * 0.08, hh * 0.015, hw * 0.08], surface: extra.colour ? own : "hat", at: face(side * 0.5, -0.17, 0), turn: [0, 0, 90] });
        break;
    }
  });
}

// Every model as the renderer sees it: a described character becomes its designed parts. Cached per model object.
const designed = new WeakMap<WorldModel, WorldModel>();
export function expandModel(model: WorldModel): WorldModel {
  if (!model.character) return model;
  const known = designed.get(model);
  if (known) return known;
  const built = designCharacter(model);
  designed.set(model, built);
  return built;
}
