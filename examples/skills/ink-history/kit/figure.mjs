// figure.mjs — the cast: white bean-headed characters built from a few inked, cel-shaded forms.
//
// A character is a DESIGN (who they are: build, clothes, hair, hat, facial hair) plus a POSE (what they
// do in this shot: where they stand, how they lean, where the hands go, and the face they pull).
// Designs are plain objects you write per story; poses are written per shot and per beat. The library
// gives you a vocabulary of eyes, brows, mouths and hands, but a face is rarely repeated: change at
// least one of eyes / brows / mouth / head tilt every time the camera or the thought changes.
//
// What makes the figures read as this style (keep these when you extend it):
//   - the head is a plain white circle, large (about 30% of a standing figure), with NO nose and NO ears
//   - the features are small, bold and bunched near the middle of the face, leaving a blank chin
//   - identity comes from silhouette: hat, hair, facial hair, clothes; never from skin or eye colour
//   - the body is a soft bean: narrow shoulders, low wide belly, short thick legs, rubber-hose arms
//
// Head space: inside hair / hat / face hooks the origin is the head centre and the head radius is 1.
import {
  S, TAU, clamp, lerp, rad, cel, stroke, solid, brush, paint, blob, curve, poly, circle, oval, tube, sample,
  shadeOf, lw, sc, localLight, withStyle, REG, toFrame, label, Path2D,
} from './ink.mjs';
import { PathOp } from '@napi-rs/canvas';

const MOUTH_DARK = '#5a2530', TONGUE = '#ee8f80', TEETH = '#ffffff';
const union = (a, ...rest) => { let p = new Path2D(a); for (const q of rest) p = p.op(q, PathOp.Union); return p; };

// ------------------------------------------------------------------ eyes
// Each entry draws ONE eye. e = {x, y, s, side, w, tilt, look}
//   s: size multiplier; side: -1 for the eye on screen-left, +1 for screen-right; w: stroke weight.
// Add your own the same way: a function of (c, e) built from solid(), brush(), cel() and stroke().
const starPath = (x, y, r, n = 5, inner = 0.46) => poly(Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / n, q = i % 2 ? r * inner : r; return [x + Math.cos(a) * q, y + Math.sin(a) * q]; }));
const lidded = (e, rx, ry, tilt = 0) => { const p = new Path2D(); p.ellipse(e.x, e.y, rx * e.s, ry * e.s, rad(tilt) * e.side, 0, Math.PI); p.closePath(); return p; };
const arcEye = (c, e, span, y0, y1) => brush(c, [[e.x - span * e.s, e.y + y0 * e.s], [e.x, e.y + y1 * e.s], [e.x + span * e.s, e.y + y0 * e.s]], [e.w * 0.6, e.w, e.w * 0.6]);
export const EYES = {
  dot: (c, e) => solid(c, oval(e.x, e.y, 0.115 * e.s, 0.085 * e.s)),
  bean: (c, e) => solid(c, oval(e.x, e.y, 0.155 * e.s, 0.072 * e.s, rad(e.tilt ?? 0) * e.side)),
  tall: (c, e) => solid(c, oval(e.x, e.y, 0.075 * e.s, 0.13 * e.s)),
  big: (c, e) => solid(c, oval(e.x, e.y, 0.13 * e.s, 0.16 * e.s)),
  shut: (c, e) => arcEye(c, e, 0.21, -0.05, 0.085),          // closed and hanging: smug, serene, asleep
  happy: (c, e) => arcEye(c, e, 0.2, 0.07, -0.09),           // closed and arched: laughing, beaming
  line: (c, e) => brush(c, [[e.x - 0.18 * e.s, e.y], [e.x + 0.18 * e.s, e.y]], [e.w * 0.8, e.w, e.w * 0.7]),
  // > <  strain, pain, effort
  squeeze: (c, e) => brush(c, [[e.x + 0.17 * e.s * e.side, e.y - 0.12 * e.s], [e.x - 0.13 * e.s * e.side, e.y, 1], [e.x + 0.17 * e.s * e.side, e.y + 0.12 * e.s]], [e.w * 0.6, e.w, e.w * 0.6]),
  // white eyeball with a pupil: shock, fear, a hard stare. look: [-1..1, -1..1] moves the pupil
  wide: (c, e) => { cel(c, oval(e.x, e.y, 0.19 * e.s, 0.22 * e.s), { fill: '#ffffff', flat: true, line: e.w * 0.7 }); const l = e.look ?? [0, 0]; solid(c, oval(e.x + l[0] * 0.09 * e.s, e.y + l[1] * 0.1 * e.s, 0.055 * e.s, 0.062 * e.s)); },
  // a heavy lid cutting the top of the eye: bored, unimpressed. With tilt it becomes a glare.
  half: (c, e) => { const t = e.tilt ?? 0; solid(c, lidded(e, 0.135, 0.105, t)); const a = rad(t) * e.side, dx = Math.cos(a) * 0.19 * e.s, dy = Math.sin(a) * 0.19 * e.s; brush(c, [[e.x - dx, e.y - dy], [e.x + dx, e.y + dy]], [e.w, e.w]); },
  glare: (c, e) => EYES.half(c, { ...e, tilt: e.tilt ?? 22 }),
  star: (c, e) => cel(c, starPath(e.x, e.y, 0.27 * e.s), { fill: '#ffd62e', flat: true, line: e.w * 0.75 }),
  heart: (c, e) => cel(c, blob([[e.x, e.y + 0.2 * e.s, 1], [e.x - 0.2 * e.s, e.y - 0.02 * e.s], [e.x - 0.12 * e.s, e.y - 0.18 * e.s], [e.x, e.y - 0.08 * e.s, 1], [e.x + 0.12 * e.s, e.y - 0.18 * e.s], [e.x + 0.2 * e.s, e.y - 0.02 * e.s]]), { fill: '#e8324a', flat: true, line: e.w * 0.7 }),
  cross: (c, e) => { const d = 0.12 * e.s; brush(c, [[e.x - d, e.y - d], [e.x + d, e.y + d]], [e.w * 0.6, e.w, e.w * 0.6]); brush(c, [[e.x + d, e.y - d], [e.x - d, e.y + d]], [e.w * 0.6, e.w, e.w * 0.6]); },
  spiral: (c, e) => stroke(c, curve(Array.from({ length: 14 }, (_, i) => { const a = i * 0.9, r = 0.016 * i * e.s; return [e.x + Math.cos(a) * r, e.y + Math.sin(a) * r]; })), e.w * 0.6),
  // big glossy pleading eye
  shiny: (c, e) => { solid(c, oval(e.x, e.y, 0.16 * e.s, 0.2 * e.s)); if (S.mode === 'full') { paint(c, circle(e.x - 0.05 * e.s, e.y - 0.07 * e.s, 0.065 * e.s), '#fff'); paint(c, circle(e.x + 0.06 * e.s, e.y + 0.07 * e.s, 0.032 * e.s), '#fff'); } },
};
const CLOSED = ['shut', 'happy', 'line', 'squeeze', 'cross', 'star', 'heart', 'spiral'];
function lashes(c, e, n) {            // flicks at the outer corner: the vain, the dainty, the theatrical
  const ox = e.x + e.side * 0.2 * e.s, oy = e.y - 0.03 * e.s;
  for (let i = 0; i < n; i++) { const a = rad(18 + i * 30); brush(c, [[ox - e.side * 0.03, oy], [ox + e.side * Math.cos(a) * 0.13 * e.s, oy + Math.sin(a) * 0.13 * e.s]], [e.w * 0.7, e.w * 0.2]); }
}
// Brows: a name, or {tilt (deg, + lowers the inner end = anger), lift, curve, len, w}.
const BROWS = { flat: { tilt: 0 }, angry: { tilt: 24, lift: -0.05 }, stern: { tilt: 13, lift: -0.02 }, sad: { tilt: -22, lift: 0.02 }, worried: { tilt: -14, curve: 0.04, lift: 0.04 }, up: { tilt: -4, lift: 0.13, curve: 0.06 }, soft: { tilt: -6, curve: 0.03 } };
function brow(c, e, spec) {
  const b = typeof spec === 'string' ? BROWS[spec] : spec; if (!b) return;
  const hl = 0.2 * (b.len ?? 1) * e.s, cy = e.y - (0.25 + (b.lift ?? 0)) * e.s, t = Math.sin(rad(b.tilt ?? 0)) * hl, w = e.w * (b.w ?? 1);
  brush(c, [[e.x - e.side * hl, cy + t], [e.x, cy - (b.curve ?? 0)], [e.x + e.side * hl, cy - t]], [w, w, w * 0.4]);
}

// ------------------------------------------------------------------ mouths
// m = {x, y, w (half width), o (openness 0..1), turn, lw}. A mouth is one bold stroke or one dark shape.
const arc3 = (c, m, y0, y1, y2) => brush(c, [[m.x - m.w, m.y + y0], [m.x, m.y + y1], [m.x + m.w, m.y + y2]], [m.lw * 0.65, m.lw, m.lw * 0.65]);
function openMouth(c, m, o = {}) {
  const w = m.w * (o.wide ?? 1) * (0.8 + 0.3 * m.o), h = o.h ?? (0.1 + 0.5 * m.o), sk = m.turn * 0.07, top = o.top ?? 0.02;
  const p = blob([[m.x - w, m.y - top, 1], [m.x, m.y + top], [m.x + w, m.y - top, 1], [m.x + w * 0.82 + sk, m.y + h * 0.72], [m.x + sk, m.y + h], [m.x - w * 0.82 + sk, m.y + h * 0.72]]);
  cel(c, p, { fill: o.fill ?? MOUTH_DARK, flat: true, line: m.lw * 0.8, inner: cc => {
    if (o.tongue !== false) paint(cc, oval(m.x + sk, m.y + h * 1.02, w * 0.7, h * 0.44), TONGUE);
    if (o.teeth) paint(cc, poly([[m.x - w, m.y - 0.06], [m.x + w, m.y - 0.06], [m.x + w, m.y + h * 0.2 + top], [m.x - w, m.y + h * 0.2 + top]]), TEETH);
  } });
}
export const MOUTHS = {
  none: () => {},
  smile: (c, m) => arc3(c, m, -0.04, 0.1, -0.04),
  beam: (c, m) => arc3(c, { ...m, w: m.w * 1.5 }, -0.1, 0.14, -0.1),
  frown: (c, m) => arc3(c, m, 0.07, -0.07, 0.07),
  flat: (c, m) => arc3(c, m, 0, 0, 0),
  smirk: (c, m) => arc3(c, m, 0.04, 0.06, -0.11),
  wavy: (c, m) => brush(c, [[m.x - m.w, m.y], [m.x - m.w * 0.5, m.y - 0.055], [m.x, m.y + 0.03], [m.x + m.w * 0.5, m.y - 0.055], [m.x + m.w, m.y + 0.01]], [m.lw * 0.65, m.lw, m.lw, m.lw * 0.65]),
  // cheeks blown out, lips pressed: holding in a laugh, sulking, holding breath
  puff: (c, m) => { MOUTHS.wavy(c, { ...m, w: m.w * 1.2 }); for (const s of [-1, 1]) brush(c, [[m.x + s * m.w * 1.3, m.y - 0.09], [m.x + s * m.w * 1.6, m.y], [m.x + s * m.w * 1.3, m.y + 0.09]], [m.lw * 0.45, m.lw * 0.85, m.lw * 0.45]); },
  cat: (c, m) => brush(c, [[m.x - m.w, m.y - 0.04], [m.x - m.w * 0.5, m.y + 0.07], [m.x, m.y - 0.03, 1], [m.x + m.w * 0.5, m.y + 0.07], [m.x + m.w, m.y - 0.04]], [m.lw * 0.65, m.lw, m.lw, m.lw * 0.65]),
  o: (c, m) => cel(c, oval(m.x, m.y + 0.04, m.w * 0.45, m.w * 0.58), { fill: MOUTH_DARK, flat: true, line: m.lw * 0.8 }),
  gasp: (c, m) => cel(c, oval(m.x, m.y + 0.12, m.w * 0.7, m.w * 1.1), { fill: MOUTH_DARK, flat: true, line: m.lw * 0.8, inner: cc => paint(cc, oval(m.x, m.y + 0.12 + m.w, m.w * 0.55, m.w * 0.5), TONGUE) }),
  open: (c, m) => openMouth(c, m),
  shout: (c, m) => openMouth(c, { ...m, o: Math.max(m.o, 0.75) }, { wide: 1.15, teeth: true }),
  laugh: (c, m) => openMouth(c, { ...m, o: Math.max(m.o, 0.55) }, { wide: 1.4, top: -0.04 }),
  // teeth showing, jaw set: rage, strain, a forced smile
  teeth: (c, m) => { const h = 0.1 + 0.1 * m.o, w = m.w * 1.25; cel(c, blob([[m.x - w, m.y - h * 0.6], [m.x, m.y - h * 0.4], [m.x + w, m.y - h * 0.6], [m.x + w * 0.9, m.y + h], [m.x, m.y + h * 1.25], [m.x - w * 0.9, m.y + h]]), { fill: TEETH, flat: true, line: m.lw * 0.8, lineInner: true, inner: cc => { for (let i = -2; i <= 2; i++) stroke(cc, poly([[m.x + i * w * 0.36, m.y - h], [m.x + i * w * 0.36, m.y + h * 1.4]], false), m.lw * 0.45); stroke(cc, poly([[m.x - w, m.y + h * 0.25], [m.x + w, m.y + h * 0.25]], false), m.lw * 0.45); } }); },
  pout: (c, m) => { arc3(c, { ...m, w: m.w * 0.5 }, 0.05, -0.04, 0.05); brush(c, [[m.x - m.w * 0.25, m.y + 0.11], [m.x + m.w * 0.25, m.y + 0.11]], [m.lw * 0.4, m.lw * 0.7, m.lw * 0.4]); },
  tongue: (c, m) => { arc3(c, m, 0, 0.02, 0); cel(c, blob([[m.x - m.w * 0.3, m.y + 0.01, 1], [m.x + m.w * 0.3, m.y + 0.01, 1], [m.x + m.w * 0.32, m.y + 0.15], [m.x, m.y + 0.23], [m.x - m.w * 0.32, m.y + 0.15]]), { fill: TONGUE, flat: true, line: m.lw * 0.6 }); },
  lips: (c, m) => cel(c, blob([[m.x - m.w * 0.6, m.y, 1], [m.x - m.w * 0.28, m.y - 0.055], [m.x, m.y - 0.025], [m.x + m.w * 0.28, m.y - 0.055], [m.x + m.w * 0.6, m.y, 1], [m.x, m.y + 0.075]]), { fill: '#d42a3c', flat: true, line: m.lw * 0.5 }),
};

// ------------------------------------------------------------------ hands
// Drawn in a frame whose +x runs along the forearm, origin at the wrist, unit = head radius.
// th = the side the thumb is on in that frame. Three fingers and a thumb, fat and round.
const FIST = [[-0.06, -0.27], [0.32, -0.36], [0.64, -0.26], [0.72, 0.03], [0.6, 0.3], [0.26, 0.36], [-0.06, 0.27]];
const KNUCKLES = [[[0.52, -0.13], [0.7, -0.1]], [[0.54, 0.06], [0.71, 0.08]]];
const HANDS = {
  mitt: th => ({ parts: [blob([[-0.06, -0.25], [0.3, -0.32], [0.6, -0.26], [0.78, 0], [0.6, 0.27], [0.3, 0.32], [-0.06, 0.25]]), blob([[0.08, th * 0.2], [0.2, th * 0.46], [0.42, th * 0.5], [0.5, th * 0.3], [0.3, th * 0.1]])], lines: [[[0.5, -0.09], [0.74, -0.07]], [[0.5, 0.1], [0.74, 0.09]]] }),
  open: th => ({ parts: [circle(0.3, 0, 0.3), ...[-34, -4, 26].map(a => tube([[0.3, -th * 0.04], [0.3 + Math.cos(rad(a * -th)) * 0.72, -th * 0.04 + Math.sin(rad(a * -th)) * 0.72]], 0.25, 0.2)), tube([[0.22, th * 0.12], [0.36, th * 0.56]], 0.24, 0.19)], lines: [] }),
  fist: th => ({ parts: [blob(FIST)], lines: KNUCKLES, thumb: tube([[0.16, th * 0.3], [0.5, th * 0.2]], 0.22, 0.18) }),
  point: th => ({ parts: [blob([[-0.06, -0.27], [0.32, -0.36], [0.6, -0.26], [0.66, 0.03], [0.56, 0.3], [0.26, 0.36], [-0.06, 0.27]]), tube([[0.42, -th * 0.13], [1.14, -th * 0.15]], 0.21, 0.18)], lines: [[[0.5, 0.04], [0.65, 0.06]]], thumb: tube([[0.16, th * 0.3], [0.48, th * 0.2]], 0.22, 0.18) }),
  flat: th => ({ parts: [blob([[-0.06, -0.2], [0.4, -0.26], [0.88, -0.2], [1.06, -0.02], [0.88, 0.16], [0.4, 0.22], [-0.06, 0.2]]), tube([[0.22, th * 0.12], [0.42, th * 0.5]], 0.22, 0.18)], lines: [[[0.72, -0.07], [1.0, -0.06]], [[0.72, 0.05], [1.0, 0.04]]] }),
  thumb: th => ({ parts: [blob(FIST), tube([[0.3, th * 0.2], [0.36, th * 0.74]], 0.24, 0.2)], lines: KNUCKLES }),
};
HANDS.grip = HANDS.fist;
function drawHand(c, at, ang, shape, th, R, color, w) {
  const def = (HANDS[shape] ?? HANDS.mitt)(th);
  c.save(); c.translate(at[0], at[1]); c.rotate(ang); c.scale(R * 0.86, R * 0.86);
  cel(c, def.parts.length > 1 ? union(...def.parts) : def.parts[0], { fill: color, depth: 0.12, shrink: 0.9, line: w });
  for (const l of def.lines) stroke(c, curve(l), w * 0.55);
  if (def.thumb) cel(c, def.thumb, { fill: color, depth: 0.1, line: w * 0.8 });
  c.restore();
}

// ------------------------------------------------------------------ geometry
function ik(s, t, a1, a2, side, flipBend) {     // two-bone reach; the elbow prefers to point outward, then down
  let dx = t[0] - s[0], dy = t[1] - s[1], d = Math.hypot(dx, dy) || 1e-6;
  const max = (a1 + a2) * 0.985;
  if (d > max) { t = [s[0] + dx / d * max, s[1] + dy / d * max]; dx = t[0] - s[0]; dy = t[1] - s[1]; d = max; }
  const a = (a1 * a1 - a2 * a2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a1 * a1 - a * a));
  const mx = s[0] + dx / d * a, my = s[1] + dy / d * a;
  const e1 = [mx - dy / d * h, my + dx / d * h], e2 = [mx + dy / d * h, my - dx / d * h];
  const score = e => side * (e[0] - s[0]) + 0.35 * (e[1] - s[1]);
  let pick = score(e1) >= score(e2) ? e1 : e2; if (flipBend) pick = pick === e1 ? e2 : e1;
  return { elbow: pick, hand: t };
}
// Proportions in head radii. The default is the plain bean. Override per design, for example
// a thin clerk {shoulder:.7, belly:.85, hip:.8}, a broad general {shoulder:1.25, belly:1.5}, a child {torso:2.4, leg:.9}.
export const BUILD = { shoulder: 0.88, belly: 1.26, hip: 1.18, torso: 3.6, leg: 1.25, arm: 2.9, limb: 0.45, legW: 0.8, neck: 0.7 };
const profile = b => [[0, b.shoulder * 0.5], [0.07, b.shoulder * 0.9], [0.2, b.shoulder], [0.5, lerp(b.shoulder, b.belly, 0.62)], [0.78, b.belly], [0.92, b.hip], [1, b.hip * 0.82]];
const crossLine = (pts, i, hw) => { const a = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)], p = pts[i]; let nx = -(q[1] - a[1]), ny = q[0] - a[0]; const m = Math.hypot(nx, ny) || 1; return [[p[0] + nx / m * hw, p[1] + ny / m * hw], [p[0] - nx / m * hw, p[1] - ny / m * hw]]; };

// ------------------------------------------------------------------ figure
// figure(c, design, pose) draws one character and returns anchors in scene coordinates:
//   { head:[x,y], R, handL, handR, shoulderL, shoulderR, feet, neck, lw }
//
// design: { name, skin, build:{…}, eyeGap, mouthOpen,
//           top:{color, hem (0..1, >=1 covers the whole torso), sleeve:'short'|'long'|'none', trim, cuff, skirt, skirtColor},
//           bottom:{color, shoes}, glove, outfit(B),
//           hairBack(c,h), under(c,h), face(c,h), hairFront(c,h), hat(c,h) }
// pose:   { x, y, anchor:'feet'|'head', h | R, flip, lean, bend, sway, pop:[sx,sy], shadow, id,
//           head:{tilt, turn, nod, dx, dy}, eyes, brows, mouth, talk, blink, lashes, eyeGap, extra(c,h),
//           armL / armR:{to:[dx,dy] (from the shoulder, in head radii) | at:[x,y] (scene), hand, rot, bend,
//                        thumb, front, over, hold(c, info)},
//           legs:{stance, L:{to:[dx,dy]}, R:{…}} }
// eyes / brows may be one spec for both eyes or {L:…, R:…}; a spec is a name or {shape, size, tilt, look, dx, dy, lashes}.
// mouth is a name or {shape, w, open, dx, dy}; `talk` (0..1) opens the mouth with the voice.
export function figure(c, design, pose = {}) {
  const b = { ...BUILD, ...(design.build ?? {}) };
  const R = pose.R ?? (pose.h ?? 600) / (b.leg + b.torso + b.neck + 1);
  const frameR = R * sc(c) / S.dpx;                                                   // head radius as it lands on screen
  const W0 = pose.line ?? clamp(frameR * 0.045 + 3.8, 5, 16) * S.dpx / S.view;      // the outline grows with the head, within limits
  const skin = design.skin ?? '#ffffff', top = design.top ?? {}, bot = design.bottom ?? {};
  const hp = { tilt: 0, turn: 0.25, nod: 0, dx: 0, dy: 0, ...(pose.head ?? {}) };
  const hem = top.hem ?? 0.64, covered = top.color && hem >= 1;
  const out = {}, ax = pose.x ?? 960, ay = pose.y ?? 900;
  c.save();
  if (pose.flip) { c.translate(ax, 0); c.scale(-1, 1); c.translate(-ax, 0); }
  // In a close-up the feet may be thousands of pixels off screen. Squashing around them throws the
  // face out of frame; keep a head-anchored pose's accent local to its collar instead.
  if (pose.pop) { const pv = pose.pivot ?? [ax, pose.anchor === 'head' ? ay + R * 0.9 : ay]; c.translate(pv[0], pv[1]); c.scale(pose.pop[0], pose.pop[1]); c.translate(-pv[0], -pv[1]); }
  withStyle({ line: W0 }, () => {
    // ---- skeleton: pelvis Pv, neck N, a curved spine between them, the head on top
    const th = rad(pose.lean ?? 0), up = [Math.sin(th), -Math.cos(th)], rt = [Math.cos(th), Math.sin(th)];
    const torsoLen = b.torso * R, legLen = b.leg * R, limbW = b.limb * R;
    let Pv, N;
    if (pose.anchor === 'head') { N = [ax - up[0] * b.neck * R - hp.dx * R, ay - up[1] * b.neck * R - hp.dy * R]; Pv = [N[0] - up[0] * torsoLen, N[1] - up[1] * torsoLen]; }
    else { Pv = [ax + (pose.sway ?? 0) * R, ay - legLen * (1 - (pose.crouch ?? 0))]; N = [Pv[0] + up[0] * torsoLen, Pv[1] + up[1] * torsoLen]; }
    const bend = pose.bend ?? 0, Mid = [(Pv[0] + N[0]) / 2 + rt[0] * bend * 0.3 * torsoLen, (Pv[1] + N[1]) / 2 + rt[1] * bend * 0.3 * torsoLen];
    const Cp = [2 * Mid[0] - (Pv[0] + N[0]) / 2, 2 * Mid[1] - (Pv[1] + N[1]) / 2];
    const sp = v => { const t = 1 - v, u = 1 - t; return [u * u * Pv[0] + 2 * u * t * Cp[0] + t * t * N[0], u * u * Pv[1] + 2 * u * t * Cp[1] + t * t * N[1]]; };
    const tan = v => { const t = 1 - v, x = 2 * (1 - t) * (Cp[0] - Pv[0]) + 2 * t * (N[0] - Cp[0]), y = 2 * (1 - t) * (Cp[1] - Pv[1]) + 2 * t * (N[1] - Cp[1]), m = Math.hypot(x, y) || 1; return [x / m, y / m]; };
    const prof = profile(b), wAt = v => { v = clamp(v, 0, 1); for (let i = 0; i < prof.length - 1; i++) if (v <= prof[i + 1][0]) return lerp(prof[i][1], prof[i + 1][1], (v - prof[i][0]) / (prof[i + 1][0] - prof[i][0])); return prof[prof.length - 1][1]; };
    // torso coordinates: u across (-1 left edge .. 1 right edge), v down (0 shoulders .. 1 crotch)
    const pt = (u, v) => { const vc = clamp(v, 0, 1), p = sp(vc), t = tan(vc), n = [-t[1], t[0]], ext = v < 0 ? -v : v > 1 ? 1 - v : 0; return [p[0] + n[0] * u * wAt(v) * R + t[0] * ext * torsoLen, p[1] + n[1] * u * wAt(v) * R + t[1] * ext * torsoLen]; };
    const tN = tan(0);
    const Hc = pose.anchor === 'head' ? [ax, ay] : [N[0] + tN[0] * b.neck * R + hp.dx * R, N[1] + tN[1] * b.neck * R + hp.dy * R];
    const left = prof.map(([v]) => pt(-1, v)), right = prof.map(([v]) => pt(1, v)).reverse(), bottom = pt(0, 1.04), crownPt = pt(0, -0.07);
    const torso = blob([...left, bottom, ...right, crownPt]);
    const sL = pt(-0.72, 0.12), sR = pt(0.72, 0.12), hL = pt(-0.52, 0.9), hR = pt(0.52, 0.9);

    // ---- arms
    const arms = {};
    for (const [key, side, s] of [['L', -1, sL], ['R', 1, sR]]) {
      const a = (key === 'L' ? pose.armL : pose.armR) ?? {}, len = b.arm * R / 2;
      const target = a.at ? (pose.flip ? [2 * ax - a.at[0], a.at[1]] : a.at) : [s[0] + (a.to?.[0] ?? side * 0.95) * R, s[1] + (a.to?.[1] ?? 2.62) * R];
      const k = ik(s, target, len, len, side, a.bend === -1);
      arms[key] = { spec: a, side, s, tip: k.hand, ang: Math.atan2(k.hand[1] - k.elbow[1], k.hand[0] - k.elbow[0]) + rad(a.rot ?? 0), pts: [s, k.elbow, k.hand] };
    }
    const drawArm = A => {
      const sleeve = top.sleeve ?? (top.color ? 'short' : 'none'), col = top.sleeveColor ?? top.color, full = sample(A.pts, false, 10);
      if (sleeve === 'long') {
        const shape = tube(A.pts, limbW * 1.08, limbW * 0.9);
        cel(c, shape, { fill: col, depth: 0.16, rim: W0 * 0.9 });
        if (top.cuff) { const i0 = Math.round(full.length * 0.84); c.save(); c.clip(tube(full.slice(i0), limbW * 1.5, limbW * 1.5, 2)); cel(c, shape, { fill: top.cuff, depth: 0.16, line: 0 }); c.restore(); stroke(c, poly(crossLine(full, i0, limbW * 0.5), false), W0 * 0.6); stroke(c, shape, W0); }
      } else {
        cel(c, tube(A.pts, limbW, limbW * 0.8), { fill: skin, depth: 0.2, shrink: 0.92 });
        if (sleeve === 'short' && col) {
          const n = Math.max(3, Math.round(full.length * 0.42)), part = full.slice(0, n), e = part[n - 1], q = part[n - 2], m = Math.hypot(e[0] - q[0], e[1] - q[1]) || 1, ux = (e[0] - q[0]) / m, uy = (e[1] - q[1]) / m, bw = limbW * 0.3, hw = limbW;
          cel(c, tube(part, limbW * 1.2, limbW * 1.16, 2), { fill: col, depth: 0.16, rim: W0 * 0.8, inner: top.trim ? cc => paint(cc, poly([[e[0] - ux * bw - uy * hw, e[1] - uy * bw + ux * hw], [e[0] + ux * hw - uy * hw, e[1] + uy * hw + ux * hw], [e[0] + ux * hw + uy * hw, e[1] + uy * hw - ux * hw], [e[0] - ux * bw + uy * hw, e[1] - uy * bw - ux * hw]]), top.trim) : undefined });
        }
      }
      // an arm drawn in front of the body: hide its shoulder cap so sleeve and body read as one garment
      if (A.spec.front && S.mode === 'full' && (sleeve === 'long' || sleeve === 'short') && col) { c.save(); c.clip(torso); c.fillStyle = col; c.beginPath(); c.arc(A.s[0], A.s[1], limbW * 0.5, 0, TAU); c.fill(); c.restore(); }
      if (A.spec.hold && S.mode !== 'shadow') { c.save(); c.translate(A.tip[0], A.tip[1]); A.spec.hold(c, { R, ang: A.ang, lw: W0, side: A.side }); c.restore(); }
      if (A.spec.hand !== 'none') drawHand(c, A.tip, A.ang, A.spec.hand ?? 'mitt', (A.spec.thumb ?? 1) * A.side, R, design.glove ?? skin, W0 * 0.85);
    };

    // ---- contact shadow, arms behind the body
    if (pose.shadow !== false && pose.anchor !== 'head' && S.mode === 'full') { c.save(); c.globalAlpha = 0.36; c.fillStyle = '#150c18'; c.beginPath(); c.ellipse(ax, ay + R * 0.05, R * 1.45, R * 0.22, 0, 0, TAU); c.fill(); c.restore(); }
    for (const key of ['L', 'R']) if (!arms[key].spec.front && !arms[key].spec.over) drawArm(arms[key]);

    // ---- legs: fused with the torso into one bean so the outline runs unbroken from hip to foot
    const stance = pose.legs?.stance ?? 0.62, facing = hp.turn >= 0 ? 1 : -1, feetY = pose.anchor === 'head' ? Pv[1] + legLen : ay, baseX = pose.anchor === 'head' ? Pv[0] : ax;
    const feet = [];
    let body = torso;
    for (const [key, side, hip] of [['L', -1, hL], ['R', 1, hR]]) {
      const lg = pose.legs?.[key] ?? {}, foot = [baseX + side * stance * R + (lg.to?.[0] ?? 0) * R, feetY + (lg.to?.[1] ?? 0) * R - (bot.shoes ? 0.12 * R : b.legW * R * 0.3)];
      const d = Math.hypot(foot[0] - hip[0], foot[1] - hip[1]), full = legLen * 1.05;
      const pts = d < full * 0.9 ? [hip, ik(hip, foot, full / 2, full / 2, facing, false).elbow, foot] : [hip, foot];
      body = union(body, tube(pts, b.legW * R, b.legW * R * 0.66));
      feet.push([foot, lg.flip ? -facing : facing]); out['foot' + key] = foot;
    }
    const bb = body.getBounds(), bodyShade = { depth: lerp(0.08, 0.26, S.form), shrink: lerp(0.95, 0.85, S.form), bounds: { x0: bb[0], y0: bb[1], x1: bb[2], y1: bb[3], w: bb[2] - bb[0], h: bb[3] - bb[1], cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2 } };

    // ---- body and clothes
    const B = {
      c, R, lw: W0, pt, design, pose, torso, body, flip: !!pose.flip,
      // repaint part of the body in another colour while keeping the body's shading
      cover(region, color, o = {}) { c.save(); c.clip(region); cel(c, body, { fill: color, line: 0, ...bodyShade, ...o }); c.restore(); },
      // a panel given in torso coordinates [u, v] (add a third value 0 for a rounded corner)
      panel(uv, color, o = {}) { const r = blob(uv.map(([u, v, k]) => [...pt(u, v), k ?? 1])); B.cover(r, color, o); if (o.line !== 0 && S.mode !== 'shadow') { c.save(); c.clip(body); stroke(c, r, o.line ?? W0 * 0.6); c.restore(); } },
      band(v0, v1, color, o) { const e = []; for (let i = 0; i <= 6; i++) e.push(pt(-1.8 + i * 0.6, v0)); for (let i = 6; i >= 0; i--) e.push(pt(-1.8 + i * 0.6, v1)); B.cover(poly(e), color, o); },
      seam(uv, w = W0 * 0.55, color) { c.save(); c.clip(body); stroke(c, curve(uv.map(([u, v]) => pt(u, v))), w, color); c.restore(); },
      buttons(u, v0, v1, n = 3, r = 0.07, color = '#e8d37a') {
        if (!Number.isFinite(r) || r <= 0 || r > 1) throw new Error('B.buttons radius is in head radii: use about .05-.09, not a pixel value such as 5. Draw a larger badge explicitly with cel/circle.');
        for (let i = 0; i < n; i++) { const p = pt(u, n === 1 ? v0 : lerp(v0, v1, i / (n - 1))); cel(c, circle(p[0], p[1], r * R), { fill: color, flat: true, line: W0 * 0.5 }); }
      },
      text(str, u, v, size = 0.9, color = '#f2c230', o = {}) { if (S.mode === 'shadow') return; const p = pt(u, v); c.save(); c.clip(body); c.translate(p[0], p[1]); if (pose.flip) c.scale(-1, 1); label(c, str, 0, 0, { size: size * R, fill: color, sw: o.sw ?? 0, shadow: false, decor: true, rotate: (pose.lean ?? 0) * (pose.flip ? -1 : 1) + (o.rotate ?? 0) }); c.restore(); },
    };
    cel(c, body, { fill: skin, rim: W0 * 0.9, ...bodyShade });
    if (top.color) { B.band(-0.3, Math.min(hem, 1.0), top.color); if (top.trim && !covered) B.band(hem - 0.06, hem, top.trim); }
    if (bot.color) B.band(Math.min(hem, 0.99), 4, bot.color);
    if (S.mode !== 'shadow') design.outfit?.(B);
    if (S.mode === 'full') { c.strokeStyle = S.ink; c.lineWidth = lw(c, W0); c.lineJoin = 'round'; c.stroke(body); }
    for (const [foot, f] of feet) if (bot.shoes) { c.save(); c.translate(foot[0], foot[1] + 0.03 * R); c.scale(R * f, R); cel(c, blob([[-0.36, -0.2], [0.08, -0.32], [0.52, -0.13], [0.7, 0.08], [0.38, 0.18], [-0.36, 0.18]]), { fill: bot.shoes, depth: 0.14, line: W0 * 0.9 }); c.restore(); }

    // ---- skirt or coat tail hanging below the waist (tunics, robes, dresses, long coats)
    if (top.skirt) {
      const k = top.skirt, f = top.flare ?? 1.1, a = pt(-1, 0.72), d = pt(1, 0.72), lo = pt(0, 1), dn = [-tN[0], -tN[1]];
      cel(c, blob([[a[0], a[1], 1], [d[0], d[1], 1], [lo[0] + b.hip * R * f + dn[0] * k * R, lo[1] + dn[1] * k * R, 1], [lo[0] + dn[0] * (k + 0.1) * R, lo[1] + dn[1] * (k + 0.1) * R], [lo[0] - b.hip * R * f + dn[0] * k * R, lo[1] + dn[1] * k * R, 1]]), { fill: top.skirtColor ?? top.color, depth: 0.1, rim: W0 * 0.9, line: W0 });
      design.skirt?.(B);
    }

    // ---- head: back hair, skull, cast shadow of hat and fringe, features, front hair, hat
    c.save(); c.translate(Hc[0], Hc[1]); c.rotate(rad(hp.tilt)); c.scale(R, R);
    const turn = clamp(hp.turn, -1, 1), nod = clamp(hp.nod, -1, 1), cx = turn * 0.3, half = 0.4 * (pose.eyeGap ?? design.eyeGap ?? 1), eyeY = -0.14 + nod * 0.26, far = 1 - 0.3 * Math.abs(turn), fs = 1 - 0.16 * Math.abs(turn);
    const eL = { x: cx - half * (turn > 0 ? 1.08 : far), y: eyeY, s: turn < 0 ? fs : 1, side: -1, w: W0 * 1.1 };
    const eR = { x: cx + half * (turn < 0 ? 1.08 : far), y: eyeY, s: turn > 0 ? fs : 1, side: 1, w: W0 * 1.1 };
    const m0 = { x: cx * 1.15, y: 0.22 + nod * 0.22, w: 0.2, o: 0, turn, lw: W0 * 1.05 };
    const h = { c, R, turn, nod, lw: W0, skin, eyeL: eL, eyeR: eR, mouth: m0, talk: pose.talk ?? 0, design, pose, flip: !!pose.flip };
    design.hairBack?.(c, h);
    cel(c, circle(0, 0, 1), { fill: skin, depth: lerp(0.08, 0.36, S.form), shrink: lerp(0.97, 0.87, S.form), backFill: skin, shade: design.skinShade, inner: S.mode === 'full' ? cc => {
      const L = localLight(cc); cc.save(); cc.translate(-L[0] * 0.12, -L[1] * 0.24);
      withStyle({ mode: 'shadow', shadowColor: design.skinShade ?? shadeOf(skin, S.shadeAmt * 0.95) }, () => { design.hairFront?.(cc, h); design.hat?.(cc, h); });
      cc.restore();
    } : undefined });
    if (S.mode !== 'shadow') {
      design.under?.(c, h);
      const pick = (v, key) => (v && typeof v === 'object' && (v.L || v.R)) ? (v[key] ?? v.L ?? v.R) : v;
      for (const [e, key] of [[eL, 'L'], [eR, 'R']]) {
        let es = pick(pose.eyes ?? design.eyes ?? 'dot', key); if (typeof es === 'string') es = { shape: es };
        const ee = { ...e, s: e.s * (es.size ?? 1), tilt: es.tilt, look: es.look ?? pose.look, x: e.x + (es.dx ?? 0), y: e.y + (es.dy ?? 0) };
        (pose.blink && !CLOSED.includes(es.shape) ? EYES.line : (EYES[es.shape] ?? EYES.dot))(c, ee);
        const nl = es.lashes ?? pose.lashes ?? design.lashes; if (nl) lashes(c, ee, nl);
        brow(c, ee, pick(pose.brows ?? design.brows, key));
      }
      let ms = pose.mouth ?? design.mouth ?? 'smile'; if (typeof ms === 'string') ms = { shape: ms };
      const mm = { ...m0, x: m0.x + (ms.dx ?? 0), y: m0.y + (ms.dy ?? 0), w: m0.w * (ms.w ?? 1), o: ms.open ?? 0 };
      if (h.talk > 0.14 && !ms.mute) MOUTHS[design.mouthOpen ?? 'open'](c, { ...mm, o: h.talk });
      else (MOUTHS[ms.shape] ?? MOUTHS.smile)(c, mm);
      h.mouth = mm;
      design.face?.(c, h);
      pose.extra?.(c, h);
      design.hairFront?.(c, h);
      design.hat?.(c, h);
    }
    c.restore();
    const fc = toFrame(c, Hc[0], Hc[1]);
    // a signature of the drawing (not of its position) so the gates can tell when a face is being reused
    const sigOf = v => JSON.stringify(v, (k, q) => typeof q === 'function' ? 'fn' : typeof q === 'number' ? Math.round(q * 10) / 10 : q) ?? '';
    REG.faces.push({ id: pose.id ?? design.name ?? 'figure', x: fc[0], y: fc[1], r: frameR, extra: !!pose.extraFigure,
      sig: sigOf([pose.eyes, pose.brows, pose.mouth, hp.tilt, hp.turn, hp.nod, pose.lean, pose.armL?.to ?? pose.armL?.at, pose.armR?.to ?? pose.armR?.at, pose.armL?.hand, pose.armR?.hand, !!pose.extra]) });

    // ---- arms in front of the body, then arms in front of the head
    for (const key of ['L', 'R']) if (arms[key].spec.front && !arms[key].spec.over) drawArm(arms[key]);
    for (const key of ['L', 'R']) if (arms[key].spec.over) drawArm(arms[key]);
    Object.assign(out, { head: Hc, R, handL: arms.L.tip, handR: arms.R.tip, shoulderL: sL, shoulderR: sR, feet: [baseX, feetY], neck: N, lw: W0 });
  });
  c.restore();
  if (pose.flip) for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = [2 * ax - out[k][0], out[k][1]];
  return out;
}

// A design is a plain object; .with(patch) derives a variant (a second soldier, the same man without his hat).
export function design(spec) { return { skin: '#ffffff', ...spec, with(patch) { return design({ ...spec, ...patch }); } }; }
