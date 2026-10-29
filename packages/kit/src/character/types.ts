import type { Expression, Pose } from '@moco/spec';

export type HairStyle = 'wavy-long' | 'long-open' | 'braid' | 'bun-top' | 'jata' | 'shikha' | 'short' | 'child-curls' | 'bald';
export type CrownStyle = 'mukut' | 'kirita' | 'sun-kirita' | 'dark-kirita' | 'band' | 'tiara' | 'helmet' | 'none';
export type TilakStyle = 'vaishnava' | 'tripundra' | 'red-line' | 'bindi' | 'none';
export type Earrings = 'kundal' | 'jhumka' | 'hoop' | 'rudraksha' | 'none';
export type Necklace = 'gold' | 'pearl' | 'rudraksha' | 'vaijayanti' | 'none';
export type TopKind = 'bare' | 'armor' | 'blouse' | 'robe';
export type LowerKind = 'dhoti' | 'saree' | 'robe' | 'tiger-skin';
export type BeardStyle = 'long' | 'short' | 'mustache' | 'none';
export type HeadKind = 'human' | 'vanara';

export interface CharacterDef {
  id: string;
  body: 'male' | 'female';
  /** Width multiplier for shoulders/waist. */
  build: number;
  /** Overall height multiplier (1 = adult). */
  height: number;
  /** Head size multiplier (children have bigger heads). */
  headScale: number;
  skin: string;
  lips: string;
  iris: string;
  head: HeadKind;
  hair: { style: HairStyle; color: string };
  beard: { style: BeardStyle; color: string };
  crown: CrownStyle;
  crownGem: string;
  peacockFeather: boolean;
  tilak: TilakStyle;
  thirdEye: boolean;
  earrings: Earrings;
  necklace: Necklace;
  sacredThread: boolean;
  snake: boolean;
  top: { kind: TopKind; color: string; accent: string };
  scarf?: { color: string; accent: string };
  lower: { kind: LowerKind; color: string; border: string };
  sash: string;
  tail: boolean;
  quiver: boolean;
  /** Props held by default, by hand. */
  holdRight?: string;
  holdLeft?: string;
  /** Glow colour when the character is divine (used by `aura` defaults). */
  aura?: string;
}

export type HandShape = 'relaxed' | 'open' | 'fist' | 'point' | 'pray' | 'hold';
export type LegsMode = 'stand' | 'wide' | 'sit' | 'walk';

/** Continuous pose parameters so poses can be blended frame by frame. */
export interface PoseVector {
  /** Hand target relative to its shoulder: x = outward, y = down. */
  handR: [number, number];
  handL: [number, number];
  /** Elbow side in [-1, 1] (right-arm convention; the left arm mirrors). */
  bendR: number;
  bendL: number;
  /** Extra hand rotation (deg) on top of the forearm direction. */
  twistR: number;
  twistL: number;
  /** 0 = hand follows the forearm, 1 = `twist` is an absolute angle (deg, 90 = fingers down). */
  aimR: number;
  aimL: number;
  shapeR: HandShape;
  shapeL: HandShape;
  headTilt: number;
  headDrop: number;
  lean: number;
  crouch: number;
  shoulderDrop: number;
  legs: LegsMode;
}

export interface ExpressionVector {
  /** 1 = normal, <1 narrowed, >1 wide. */
  eyeOpen: number;
  /** 1 = happy closed (^ ^) or serene (◡ ◡). */
  eyeClosed: number;
  /** Positive = happy squint arcs. */
  eyeSmile: number;
  browY: number;
  /** Positive = inner ends up (sad/worried); negative = angry. */
  browTilt: number;
  /** Mouth curve: + smile, - frown. */
  mouthCurve: number;
  mouthWidth: number;
  /** Resting openness (surprise/joy). */
  mouthOpen: number;
  teeth: boolean;
  blush: number;
}

export interface RigState {
  pose: PoseVector;
  expression: ExpressionVector;
  /** 0 open … 1 closed. */
  blink: number;
  /** Speech: 0 closed … 1 wide. */
  talk: number;
  /** Speech roundness 0..1. */
  round: number;
  /** Pupil offset in [-1, 1]. */
  look: { x: number; y: number };
  /** Seconds, for breathing, hair and cloth sway. */
  time: number;
  /** Walk cycle phase in radians. */
  walk: number;
  /** Extra head nod in px (positive = down). */
  nod: number;
}

export type { Expression, Pose };
