import type { Expression, Pose } from '@moco/spec';
import { lerp } from '../util.ts';
import type { ExpressionVector, PoseVector } from './types.ts';

const base: PoseVector = {
  handR: [22, 286],
  handL: [22, 286],
  bendR: -0.6,
  bendL: -0.6,
  twistR: 0,
  twistL: 0,
  aimR: 0,
  aimL: 0,
  shapeR: 'relaxed',
  shapeL: 'relaxed',
  headTilt: 0,
  headDrop: 0,
  lean: 0,
  crouch: 0,
  shoulderDrop: 0,
  legs: 'stand',
};

const p = (o: Partial<PoseVector>): PoseVector => ({ ...base, ...o });

// Hand targets are relative to each shoulder: x outward from the body, y down.
// Upper arm 158 + forearm 148, so |target| must stay under ~305.
export const POSE_VECTORS: Record<Pose, PoseVector> = {
  stand: p({}),
  'raise-hand': p({ handR: [78, -250], bendR: 0.8, shapeR: 'open', headTilt: -3 }),
  bless: p({ handR: [74, -8], bendR: 1, shapeR: 'open', headTilt: 3 }),
  point: p({ handR: [292, -46], bendR: 0.25, shapeR: 'point', lean: -2 }),
  namaste: p({ handR: [-80, 86], handL: [-80, 86], bendR: -1, bendL: -1, shapeR: 'pray', shapeL: 'pray', twistR: -90, twistL: -90, aimR: 1, aimL: 1, headTilt: 4, headDrop: 4 }),
  'arms-open': p({ handR: [222, -150], handL: [222, -150], bendR: 0.6, bendL: 0.6, shapeR: 'open', shapeL: 'open', headTilt: -4 }),
  think: p({ handR: [-74, -6], bendR: -1, shapeR: 'fist', handL: [-128, 150], bendL: -1, shapeL: 'relaxed', headTilt: 7 }),
  sad: p({ handR: [8, 292], handL: [8, 292], bendR: -0.3, bendL: -0.3, headTilt: 9, headDrop: 16, lean: 3, shoulderDrop: 10 }),
  fight: p({ handR: [36, -286], bendR: 0.55, shapeR: 'hold', twistR: -90, aimR: 1, handL: [178, 70], bendL: 0.5, shapeL: 'fist', legs: 'wide', lean: -2 }),
  'draw-bow': p({ handL: [300, -18], bendL: 0.15, shapeL: 'hold', twistL: -90, aimL: 1, handR: [-52, -74], bendR: 1, shapeR: 'fist', legs: 'wide', headTilt: -2 }),
  flute: p({ handR: [112, -128], bendR: 1, shapeR: 'hold', twistR: -2, aimR: 1, handL: [-160, -112], bendL: -1, shapeL: 'hold', twistL: -178, aimL: 1, headTilt: 9 }),
  reins: p({ handR: [-40, 152], handL: [-40, 152], bendR: -1, bendL: -1, shapeR: 'fist', shapeL: 'fist', lean: -3 }),
  'arms-crossed': p({ handR: [-150, 112], handL: [-146, 96], bendR: -1, bendL: -1, shapeR: 'fist', shapeL: 'fist', headTilt: -2 }),
  confident: p({ handR: [6, 206], handL: [6, 206], bendR: -1, bendL: -1, shapeR: 'fist', shapeL: 'fist', headTilt: -3, legs: 'wide' }),
  meditate: p({ handR: [100, 262], handL: [100, 262], bendR: -0.8, bendL: -0.8, shapeR: 'open', shapeL: 'open', twistR: 0, twistL: 0, crouch: 430, legs: 'sit' }),
  walk: p({ legs: 'walk' }),
};

const e = (o: Partial<ExpressionVector>): ExpressionVector => ({
  eyeOpen: 1,
  eyeClosed: 0,
  eyeSmile: 0,
  browY: 0,
  browTilt: 0,
  mouthCurve: 0.2,
  mouthWidth: 1,
  mouthOpen: 0,
  teeth: false,
  blush: 0.2,
  ...o,
});

export const EXPRESSION_VECTORS: Record<Expression, ExpressionVector> = {
  neutral: e({}),
  smile: e({ eyeOpen: 0.95, eyeSmile: 0.25, mouthCurve: 0.85, mouthWidth: 1.1, blush: 0.35 }),
  joy: e({ eyeOpen: 0.9, eyeSmile: 0.75, browY: -3, mouthCurve: 1, mouthWidth: 1.2, mouthOpen: 0.55, teeth: true, blush: 0.45 }),
  sad: e({ eyeOpen: 0.82, browTilt: 0.9, browY: 2, mouthCurve: -0.75, mouthWidth: 0.9, blush: 0.1 }),
  angry: e({ eyeOpen: 0.78, browTilt: -1, browY: 5, mouthCurve: -0.55, mouthWidth: 1, mouthOpen: 0.12, teeth: true, blush: 0.05 }),
  surprised: e({ eyeOpen: 1.28, browY: -10, mouthCurve: 0, mouthWidth: 0.7, mouthOpen: 0.62 }),
  serene: e({ eyeClosed: 1, mouthCurve: 0.6, blush: 0.3 }),
  worried: e({ eyeOpen: 1.05, browTilt: 0.8, browY: -2, mouthCurve: -0.35, mouthWidth: 0.9 }),
  determined: e({ eyeOpen: 0.84, browTilt: -0.45, browY: 2, mouthCurve: -0.1, mouthWidth: 0.95 }),
};

const mixPair = (a: [number, number], b: [number, number], t: number): [number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

export function blendPose(a: PoseVector, b: PoseVector, t: number): PoseVector {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    handR: mixPair(a.handR, b.handR, t),
    handL: mixPair(a.handL, b.handL, t),
    bendR: lerp(a.bendR, b.bendR, t),
    bendL: lerp(a.bendL, b.bendL, t),
    twistR: lerp(a.twistR, b.twistR, t),
    twistL: lerp(a.twistL, b.twistL, t),
    aimR: lerp(a.aimR, b.aimR, t),
    aimL: lerp(a.aimL, b.aimL, t),
    shapeR: t < 0.5 ? a.shapeR : b.shapeR,
    shapeL: t < 0.5 ? a.shapeL : b.shapeL,
    headTilt: lerp(a.headTilt, b.headTilt, t),
    headDrop: lerp(a.headDrop, b.headDrop, t),
    lean: lerp(a.lean, b.lean, t),
    crouch: lerp(a.crouch, b.crouch, t),
    shoulderDrop: lerp(a.shoulderDrop, b.shoulderDrop, t),
    legs: t < 0.5 ? a.legs : b.legs,
  };
}

export function blendExpression(a: ExpressionVector, b: ExpressionVector, t: number): ExpressionVector {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    eyeOpen: lerp(a.eyeOpen, b.eyeOpen, t),
    eyeClosed: lerp(a.eyeClosed, b.eyeClosed, t),
    eyeSmile: lerp(a.eyeSmile, b.eyeSmile, t),
    browY: lerp(a.browY, b.browY, t),
    browTilt: lerp(a.browTilt, b.browTilt, t),
    mouthCurve: lerp(a.mouthCurve, b.mouthCurve, t),
    mouthWidth: lerp(a.mouthWidth, b.mouthWidth, t),
    mouthOpen: lerp(a.mouthOpen, b.mouthOpen, t),
    teeth: t < 0.5 ? a.teeth : b.teeth,
    blush: lerp(a.blush, b.blush, t),
  };
}

