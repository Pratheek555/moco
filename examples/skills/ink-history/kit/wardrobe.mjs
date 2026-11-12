// wardrobe.mjs — hair, hats, facial hair, spectacles and garment details.
//
// These are worked examples of how to build period identity out of blobs, not a closed catalogue.
// Read two or three, then draw what your story needs the same way:
//   - list the silhouette as 6-14 points in head space (centre 0,0; radius 1; top of the skull is y=-1),
//     mark sharp corners with a third value of 1, and pass the blob to cel()
//   - give it a rim (the light catches hat brims and hair) and one or two tapered shine strokes
//   - let it overlap the face: fringes cross an eye, brims cut the forehead, moustaches hide the mouth
// Everything is called with (c, h, options) where h is the head context from figure():
//   h.turn (-1..1), h.lw (outline weight), h.eyeL / h.eyeR / h.mouth ({x, y}), h.skin
import { S, rad, lerp, cel, stroke, solid, brush, paint, blob, curve, poly, circle, oval, tube, brushPath, shadeOf, lightOf, mix, lw, Path2D } from './ink.mjs';
import { PathOp } from '@napi-rs/canvas';

export const ring = (a0, a1, r, n, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => { const a = rad(lerp(a0, a1, i / (n - 1))); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const shine = (c, h, pts, col, w = 2.2) => { if (S.mode === 'full') brush(c, pts, [0, h.lw * w, h.lw * w * 0.7, 0], col); };
// a tapered shape in head units (moustache halves, locks of hair): cel-shaded and outlined
const lock = (c, h, pts, widths, col, o = {}) => cel(c, brushPath(pts, widths, 10), { fill: col, depth: 0.14, line: h.lw * 0.75, ...o });

// ------------------------------------------------------------------ hair
export function hairShort(c, h, o = {}) {
  const col = o.color ?? '#4a3024', t = h.turn * 0.2, y = o.hairline ?? -0.47;
  cel(c, blob([...ring(170, 370, 1.07, 9), [0.92 + t * 0.3, y + 0.24, 1], [0.48 + t, y - 0.05], [-0.08 + t, y + (o.part ?? 0.1)], [-0.6 + t, y - 0.02], [-0.96 + t * 0.3, y + 0.26, 1]]), { fill: col, depth: 0.07, rim: h.lw * 1.3, line: h.lw });
  shine(c, h, [[-0.62, -0.78], [-0.2, -0.95], [0.3, -0.9]], lightOf(col, 0.3));
}
export function hairSwept(c, h, o = {}) {       // volume swept up and back: officers, dandies, orators
  const col = o.color ?? '#3b2a26', t = h.turn * 0.2, v = o.volume ?? 1;
  cel(c, blob([[-1.02, 0.16, 1], [-1.13, -0.42], [-0.86, -1.0 * v], [-0.3, -1.3 * v], [0.38, -1.33 * v], [0.92, -1.02 * v], [1.12, -0.45], [1.02, 0.14, 1], [0.88 + t * 0.3, -0.36], [0.42 + t, -0.63], [-0.26 + t, -0.5], [-0.82 + t * 0.3, -0.3]]), { fill: col, depth: 0.07, rim: h.lw * 1.3, line: h.lw });
  for (const [x0, x1, yy] of [[-0.45, 0.05, -0.62], [-0.1, 0.5, -0.74]]) stroke(c, curve([[x0 + t, yy], [(x0 + x1) / 2 + t * 0.6, yy - 0.34], [x1 + 0.3, yy - 0.5 * v]]), h.lw * 0.5);
  shine(c, h, [[-0.75, -0.75 * v], [-0.3, -1.08 * v], [0.3, -1.12 * v]], lightOf(col, 0.32));
}
export function hairCurls(c, h, o = {}) {       // a cloud of lumps
  const col = o.color ?? '#6b4a32', n = o.lumps ?? 9, r = o.size ?? 0.34;
  let p = null;
  ring(o.from ?? 160, o.to ?? 380, 0.98, n).forEach(([x, y], i) => { const q = circle(x, y, r * (i % 2 ? 0.92 : 1.08)); p = p ? p.op(q, PathOp.Union) : q; });
  cel(c, p, { fill: col, depth: 0.06, rim: h.lw * 1.2, line: h.lw });
  if (S.mode === 'full') ring(200, 340, 0.98, 4).forEach(([x, y]) => stroke(c, curve([[x - 0.12, y - 0.05], [x, y - 0.17], [x + 0.12, y - 0.08]]), h.lw * 0.45, lightOf(col, 0.35)));
}
export function hairLongBack(c, h, o = {}) {    // drawn in design.hairBack: hair falling behind the head
  const col = o.color ?? '#c9a24e', L = o.length ?? 1.2, wv = o.wave ?? 0.08;
  cel(c, blob([[-1.16, -0.25], [-0.82, -1.02], [0, -1.2], [0.82, -1.02], [1.16, -0.25], [1.22 + wv, 0.5], [1.12 - wv, L], [0.7, L + 0.22], [0.2, L + 0.05], [-0.2, L + 0.05], [-0.7, L + 0.22], [-1.12 + wv, L], [-1.22 - wv, 0.5]]), { fill: col, depth: 0.05, rim: h.lw * 1.2, line: h.lw });
}
export function fringe(c, h, o = {}) {          // drawn in design.hairFront: a cut fringe with points
  const col = o.color ?? '#c9a24e', t = h.turn * 0.22, d = o.depth ?? 0;
  cel(c, blob([[-1.02, -0.05, 1], [-1.05, -0.55], [-0.62, -0.99], [0, -1.09], [0.62, -0.99], [1.05, -0.55], [1.02, -0.05, 1], [0.82 + t * 0.3, -0.36 + d], [0.5 + t, -0.28 + d, 1], [0.24 + t, -0.52 + d], [-0.08 + t, -0.3 + d, 1], [-0.42 + t, -0.54 + d], [-0.74 + t * 0.4, -0.3 + d, 1]]), { fill: col, depth: 0.07, rim: h.lw * 1.2, line: h.lw });
  shine(c, h, [[-0.6, -0.8], [-0.1, -0.96], [0.45, -0.86]], lightOf(col, 0.4));
}
export function sideSweep(c, h, o = {}) {       // one heavy lock across the brow; `side` -1 or 1 picks the eye it hides
  const col = o.color ?? '#5c3b2a', s = o.side ?? 1, t = h.turn * 0.15;
  cel(c, blob([[-1.04 * s, 0.1, 1], [-1.1 * s, -0.5], [-0.7 * s, -1.02], [0, -1.12], [0.72 * s, -1.0], [1.1 * s, -0.5], [1.06 * s, 0.34, 1], [0.86 * s + t, 0.1], [0.34 * s + t, -0.18], [-0.3 * s + t, -0.52], [-0.82 * s, -0.42]]), { fill: col, depth: 0.07, rim: h.lw * 1.3, line: h.lw });
  shine(c, h, [[-0.5 * s, -0.86], [0.1 * s, -0.8], [0.62 * s, -0.42]], lightOf(col, 0.36));
  stroke(c, curve([[-0.2 * s + t, -0.56], [0.36 * s + t, -0.3], [0.8 * s, 0.02]]), h.lw * 0.45);
}
export function baldRing(c, h, o = {}) {        // tufts at the sides, bare on top
  const col = o.color ?? '#b9b3ad';
  for (const s of [-1, 1]) cel(c, blob([[s * 0.86, -0.56, 1], [s * 1.14, -0.42], [s * 1.2, 0.02], [s * 1.02, 0.28, 1], [s * 0.93, -0.1]]), { fill: col, depth: 0.1, line: h.lw * 0.9 });
}
export function bun(c, h, o = {}) {             // call from hairBack, pair with hairShort or fringe in front
  const col = o.color ?? '#4a3024'; cel(c, circle(o.x ?? 0, o.y ?? -1.18, o.r ?? 0.42), { fill: col, depth: 0.1, rim: h.lw * 1.2, line: h.lw });
}

// ------------------------------------------------------------------ hats
// Hats sit low: the brim cuts across the forehead (about y -0.5) and throws a shadow on the face.
function hatFrame(c, o, fn) { c.save(); c.translate(o.dx ?? 0, o.dy ?? 0); c.rotate(rad(o.tilt ?? 0)); fn(); c.restore(); }
export function topHat(c, h, o = {}) {
  const col = o.color ?? '#2c2630', band = o.band ?? '#8a4fa0', H = o.height ?? 1.35;
  hatFrame(c, o, () => {
    const crown = blob([[-0.78, -0.66, 1], [-0.84, -0.66 - H * 0.5], [-0.93, -0.66 - H, 1], [0, -0.78 - H], [0.93, -0.66 - H, 1], [0.84, -0.66 - H * 0.5], [0.78, -0.66, 1], [0, -0.5]]);
    cel(c, crown, { fill: col, depth: 0.1, rim: h.lw * 1.5, line: h.lw, inner: cc => { cc.save(); cc.clip(poly([[-1.2, -0.72], [1.2, -0.72], [1.2, -1.06], [0, -0.98], [-1.2, -1.06]])); cel(cc, crown, { fill: band, depth: 0.1, line: 0 }); cc.restore(); } });
    shine(c, h, [[-0.6, -0.82 - H * 0.9], [-0.56, -0.9 - H * 0.45], [-0.52, -1.16]], lightOf(col, 0.3), 1.6);
    cel(c, oval(0, -0.64, 1.36, 0.23), { fill: col, depth: 0.2, rim: h.lw * 1.4, line: h.lw });
    stroke(c, curve([[-0.8, -0.68], [0, -0.56], [0.8, -0.68]]), h.lw * 0.5);
  });
}
export function bowler(c, h, o = {}) {
  const col = o.color ?? '#33282a';
  hatFrame(c, o, () => {
    cel(c, blob([[-0.88, -0.6, 1], [-0.9, -1.15], [-0.45, -1.52], [0.45, -1.52], [0.9, -1.15], [0.88, -0.6, 1], [0, -0.5]]), { fill: col, depth: 0.1, rim: h.lw * 1.5, line: h.lw, inner: o.band ? cc => paint(cc, poly([[-1, -0.6], [1, -0.6], [1, -0.82], [-1, -0.82]]), o.band) : undefined });
    shine(c, h, [[-0.62, -1.02], [-0.4, -1.32], [-0.05, -1.42]], lightOf(col, 0.3), 1.8);
    cel(c, oval(0, -0.6, 1.28, 0.18), { fill: col, depth: 0.2, rim: h.lw * 1.3, line: h.lw });
  });
}
export function flatCap(c, h, o = {}) {         // workers, newsboys, drivers; the peak points where the face looks
  const col = o.color ?? '#7b6a4c', d = h.turn >= 0 ? 1 : -1;
  hatFrame(c, o, () => {
    cel(c, blob([[-0.5 * d, -0.52], [0.9 * d, -0.6], [1.5 * d, -0.44], [1.42 * d, -0.3], [0.5 * d, -0.4]]), { fill: shadeOf(col, 0.4), depth: 0.2, line: h.lw });
    cel(c, blob([[-1.08 * d, -0.46, 1], [-1.04 * d, -0.95], [-0.35 * d, -1.24], [0.6 * d, -1.2], [1.12 * d, -0.84], [1.16 * d, -0.52, 1], [0.2 * d, -0.42]]), { fill: col, depth: 0.09, rim: h.lw * 1.4, line: h.lw });
    stroke(c, curve([[-0.3 * d, -1.2], [0.1 * d, -0.9], [0.9 * d, -0.62]]), h.lw * 0.45);
  });
}
export function kepi(c, h, o = {}) {            // soldiers, postmen, station masters, police
  const col = o.color ?? '#3b4a7a', band = o.band ?? '#b8323a', d = h.turn >= 0 ? 1 : -1;
  hatFrame(c, o, () => {
    const crown = blob([[-0.88, -0.52, 1], [-0.8, -1.3, 1], [0, -1.42], [0.8, -1.3, 1], [0.88, -0.52, 1], [0, -0.42]]);
    cel(c, crown, { fill: col, depth: 0.1, rim: h.lw * 1.4, line: h.lw, inner: cc => { cc.save(); cc.clip(poly([[-1, -0.4], [1, -0.4], [1, -0.78], [0, -0.7], [-1, -0.78]])); cel(cc, crown, { fill: band, depth: 0.1, line: 0 }); cc.restore(); } });
    cel(c, blob([[-0.2 * d, -0.5], [0.86 * d, -0.56], [1.34 * d, -0.36], [1.2 * d, -0.26], [0.3 * d, -0.36]]), { fill: '#1f1a1e', depth: 0.25, rim: h.lw, rimColor: '#6d6a78', line: h.lw });
    if (o.badge !== false) cel(c, circle(0.25 * d, -0.92, 0.13), { fill: o.badge ?? '#e9c84a', flat: true, line: h.lw * 0.6 });
  });
}
export function helmet(c, h, o = {}) {          // a steel dome with a brim: kettle hats, tin hats, miners
  const col = o.color ?? '#7d7f86', brim = o.brim ?? 1.26, strap = o.strap ?? '#b9a877';
  hatFrame(c, o, () => {
    if (o.strap !== false) for (const s of [-1, 1]) cel(c, tube([[s * 0.84, -0.42], [s * 0.86, 0.3], [s * 0.72, 0.84]], 0.13, 0.11), { fill: strap, depth: 0.2, line: h.lw * 0.7 });
    cel(c, blob([[-1.0, -0.5, 1], [-0.98, -1.02], [-0.5, -1.44], [0.5, -1.44], [0.98, -1.02], [1.0, -0.5, 1], [0, -0.4]]), { fill: col, depth: 0.1, rim: h.lw * 1.6, line: h.lw });
    shine(c, h, [[-0.74, -0.92], [-0.5, -1.22], [-0.06, -1.34]], lightOf(col, 0.35), 2);
    cel(c, oval(0, -0.52, brim, 0.2), { fill: col, depth: 0.22, rim: h.lw * 1.5, line: h.lw });
    stroke(c, curve([[-0.94, -0.58], [0, -0.46], [0.94, -0.58]]), h.lw * 0.5);
    if (o.spike) cel(c, blob([[-0.1, -1.34, 1], [0, -1.86, 1], [0.1, -1.34, 1]]), { fill: o.spike, depth: 0.2, line: h.lw * 0.8 });
  });
}
export function fez(c, h, o = {}) {
  const col = o.color ?? '#b8262c';
  hatFrame(c, o, () => {
    cel(c, blob([[-0.72, -0.58, 1], [-0.56, -1.58, 1], [0, -1.66], [0.56, -1.58, 1], [0.72, -0.58, 1], [0, -0.46]]), { fill: col, depth: 0.1, rim: h.lw * 1.5, line: h.lw });
    stroke(c, curve([[0, -1.62], [0.5, -1.5], [0.7, -1.0]]), h.lw * 0.6); solid(c, blob([[0.62, -1.0], [0.78, -1.0], [0.8, -0.7], [0.62, -0.7]]));
  });
}
export function crown(c, h, o = {}) {
  const col = o.color ?? '#f0c23a', j = o.jewel ?? '#d5303e';
  hatFrame(c, o, () => {
    cel(c, blob([[-0.86, -0.58, 1], [-1.0, -1.5, 1], [-0.52, -1.08, 1], [-0.28, -1.66, 1], [0, -1.12, 1], [0.28, -1.66, 1], [0.52, -1.08, 1], [1.0, -1.5, 1], [0.86, -0.58, 1], [0, -0.46]]), { fill: col, depth: 0.09, rim: h.lw * 1.5, rimColor: '#fff3a8', line: h.lw });
    for (const x of [-0.5, 0, 0.5]) cel(c, circle(x, -0.78 + Math.abs(x) * 0.08, 0.1), { fill: j, flat: true, line: h.lw * 0.55 });
  });
}
export function strawHat(c, h, o = {}) {        // farmers, boaters, summer crowds
  const col = o.color ?? '#e3c46c', band = o.band ?? '#b8323a';
  hatFrame(c, o, () => {
    const crown = blob([[-0.78, -0.6, 1], [-0.74, -1.1, 1], [0, -1.2], [0.74, -1.1, 1], [0.78, -0.6, 1], [0, -0.5]]);
    cel(c, crown, { fill: col, depth: 0.1, rim: h.lw * 1.4, line: h.lw, inner: cc => { cc.save(); cc.clip(poly([[-1, -0.56], [1, -0.56], [1, -0.82], [-1, -0.82]])); cel(cc, crown, { fill: band, depth: 0.1, line: 0 }); cc.restore(); } });
    cel(c, oval(0, -0.58, o.brim ?? 1.72, 0.27), { fill: col, depth: 0.2, rim: h.lw * 1.5, line: h.lw, inner: cc => { for (let i = -3; i <= 3; i++) stroke(cc, curve([[i * 0.46 - 0.1, -0.8], [i * 0.5, -0.4]]), h.lw * 0.3, shadeOf(col, 0.5)); } });
    stroke(c, curve([[-0.76, -0.62], [0, -0.5], [0.76, -0.62]]), h.lw * 0.5);
  });
}
export function hood(c, h, o = {}) {            // cloth wrapped round the head: coifs, cowls, headscarves, veils
  const col = o.color ?? '#8b5a3c', t = h.turn * 0.24, open = o.open ?? 0.78;
  const outer = blob([[-1.12, 0.2], [-1.16, -0.5], [-0.72, -1.1], [0, -1.24 - (o.point ?? 0)], [0.72, -1.1], [1.16, -0.5], [1.12, 0.2], [0.98, 0.86], [0.4, 1.16], [-0.4, 1.16], [-0.98, 0.86]]);
  const p = outer.op(oval(t, 0.1, open, open * 1.02), PathOp.Difference);
  cel(c, p, { fill: col, depth: 0.06, rim: h.lw * 1.3, line: h.lw, rule: 'evenodd' });
  if (S.mode === 'full') for (const s of [-1, 1]) stroke(c, curve([[s * 0.86, -0.72], [s * 1.0, -0.1], [s * 0.86, 0.6]]), h.lw * 0.4, shadeOf(col, 0.8));
}

// ------------------------------------------------------------------ facial hair and spectacles
// Call from design.face (drawn over the mouth) or design.under (drawn before eyes and mouth).
export function moustache(c, h, o = {}) {
  const col = o.color ?? '#4a3024', m = h.mouth, s = o.size ?? 1, y = m.y - 0.13 + (o.dy ?? 0), style = o.style ?? 'handlebar';
  const half = (d) => {
    const P = (pts) => pts.map(([x, yy]) => [m.x + d * x * s, y + yy * s]);
    if (style === 'handlebar') lock(c, h, P([[0, 0.02], [0.2, 0.07], [0.44, 0.0], [0.56, -0.16]]), [0.2 * s, 0.22 * s, 0.13 * s, 0.02], col);
    else if (style === 'walrus') lock(c, h, P([[0, -0.02], [0.2, 0.05], [0.36, 0.2], [0.4, 0.36]]), [0.2 * s, 0.28 * s, 0.22 * s, 0.05], col);
    else if (style === 'chevron') lock(c, h, P([[0, -0.03], [0.2, 0.02], [0.4, 0.1]]), [0.2 * s, 0.2 * s, 0.06], col);
    else if (style === 'pencil') lock(c, h, P([[0.02, 0], [0.18, 0.0], [0.34, 0.03]]), [0.07 * s, 0.07 * s, 0.01], col);
    else lock(c, h, P([[0, 0.02], [0.3, 0.1], [0.62, 0.02], [0.82, -0.2], [0.7, -0.36]]), [0.2 * s, 0.26 * s, 0.17 * s, 0.09 * s, 0.01], col);   // 'imperial': huge, curling up
  };
  half(-1); half(1);
}
export function beard(c, h, o = {}) {
  const col = o.color ?? '#4a3024', m = h.mouth, style = o.style ?? 'full', L = o.length ?? 1;
  if (style === 'goatee') { cel(c, blob([[m.x - 0.14, m.y + 0.2, 1], [m.x + 0.14, m.y + 0.2, 1], [m.x + 0.12, m.y + 0.42 * L], [m.x, m.y + 0.62 * L, 1], [m.x - 0.12, m.y + 0.42 * L]]), { fill: col, depth: 0.14, line: h.lw * 0.8 }); return; }
  const t = h.turn * 0.22;
  cel(c, blob([[-0.98 + t * 0.2, 0.02, 1], [-0.72 + t, 0.34], [-0.3 + t, 0.16], [m.x, m.y - 0.2], [0.3 + t, 0.16], [0.72 + t, 0.34], [0.98 + t * 0.2, 0.02, 1], [0.94, 0.62], [0.5 + t, 1.02 + 0.3 * (L - 1)], [t, 1.16 + 0.5 * (L - 1)], [-0.5 + t, 1.02 + 0.3 * (L - 1)], [-0.94, 0.62]]), { fill: col, depth: 0.06, rim: h.lw * 1.2, line: h.lw });
  if (S.mode === 'full') for (const x of [-0.4, 0, 0.4]) stroke(c, curve([[x + t, 0.72], [x * 1.05 + t, 0.94 + 0.3 * (L - 1)]]), h.lw * 0.4, shadeOf(col, 0.8));
}
export function glasses(c, h, o = {}) {
  const r = o.r ?? 0.2, col = o.color ?? S.ink, eL = h.eyeL, eR = h.eyeR;
  for (const e of [eL, eR]) { if (S.mode === 'full' && o.lens !== false) paint(c, o.square ? poly([[e.x - r, e.y - r * 0.8], [e.x + r, e.y - r * 0.8], [e.x + r, e.y + r * 0.8], [e.x - r, e.y + r * 0.8]]) : circle(e.x, e.y, r * e.s), '#ffffff55'); stroke(c, o.square ? blob([[e.x - r, e.y - r * 0.8, 1], [e.x + r, e.y - r * 0.8, 1], [e.x + r, e.y + r * 0.8, 1], [e.x - r, e.y + r * 0.8, 1]]) : circle(e.x, e.y, r * e.s), h.lw * 0.6, col); }
  stroke(c, curve([[eL.x + r, eL.y - 0.02], [(eL.x + eR.x) / 2, eL.y - 0.07], [eR.x - r * eR.s, eR.y - 0.02]]), h.lw * 0.6, col);
}
export function monocle(c, h, o = {}) {
  const e = (o.side ?? 1) > 0 ? h.eyeR : h.eyeL, r = 0.22;
  if (S.mode === 'full') paint(c, circle(e.x, e.y, r), '#ffffff66');
  stroke(c, circle(e.x, e.y, r), h.lw * 0.7, o.color ?? '#d9b648'); stroke(c, curve([[e.x + r * 0.6, e.y + r * 0.8], [e.x + 0.3, 0.6], [e.x + 0.1, 1.1]]), h.lw * 0.35, o.color ?? '#d9b648');
}
export function blush(c, h, o = {}) { if (S.mode !== 'full') return; for (const e of [h.eyeL, h.eyeR]) paint(c, oval(e.x + e.side * 0.06, e.y + 0.24, 0.13 * e.s, 0.075), o.color ?? '#f7a6a088'); }
// Comic punctuation around a face: sweat, tears, anger marks, shock lines. Call from pose.extra.
export function sweat(c, h, o = {}) { const x = o.x ?? 0.72, y = o.y ?? -0.55, s = o.size ?? 1; cel(c, blob([[x, y - 0.2 * s, 1], [x + 0.11 * s, y + 0.04 * s], [x, y + 0.13 * s], [x - 0.11 * s, y + 0.04 * s]]), { fill: '#9fd8ef', flat: true, line: h.lw * 0.55 }); }
export function tears(c, h) { for (const e of [h.eyeL, h.eyeR]) cel(c, blob([[e.x - 0.07, e.y + 0.08, 1], [e.x + 0.07, e.y + 0.08, 1], [e.x + 0.1, e.y + 0.5], [e.x, e.y + 0.62], [e.x - 0.1, e.y + 0.5]]), { fill: '#9fd8ef', flat: true, line: h.lw * 0.5 }); }
export function vein(c, h, o = {}) { const x = o.x ?? 0.62, y = o.y ?? -0.62, d = 0.09; for (const [a, b] of [[[x - d, y - d * 0.3], [x - d * 0.3, y - d]], [[x + d, y - d * 0.3], [x + d * 0.3, y - d]], [[x - d, y + d * 0.3], [x - d * 0.3, y + d]], [[x + d, y + d * 0.3], [x + d * 0.3, y + d]]]) stroke(c, curve([a, [x + (a[0] - x) * 0.25, y + (a[1] - y) * 0.25], b]), h.lw * 0.6, '#d5303e'); }
export function shockLines(c, h, o = {}) { for (const a of o.angles ?? [205, 230, 255, 285, 310, 335]) { const r0 = 1.22, r1 = 1.48, q = rad(a); brush(c, [[Math.cos(q) * r0, Math.sin(q) * r0], [Math.cos(q) * r1, Math.sin(q) * r1]], [h.lw * 0.9, h.lw * 0.2]); } }

// ------------------------------------------------------------------ garment details
// Called from design.outfit(B). B.panel / B.band / B.seam / B.buttons work in torso coordinates:
// u across (-1 left edge, 1 right edge), v down (0 shoulders, 1 crotch). They bend with the body.
export function lapels(B, color, o = {}) {
  const d = o.depth ?? 0.55, w = o.width ?? 0.62;
  B.panel([[-0.08, -0.05], [-w - 0.25, -0.02], [-w, d * 0.5], [-0.06, d]], color); B.panel([[0.08, -0.05], [w + 0.25, -0.02], [w, d * 0.5], [0.06, d]], color);
}
export function shirtFront(B, color = '#f3ead8', o = {}) { const w = o.width ?? 0.3; B.panel([[-w, -0.1], [w, -0.1], [w * 0.5, o.to ?? 0.62], [-w * 0.5, o.to ?? 0.62]], color); }
export function tie(B, color = '#b8323a', o = {}) { B.panel([[-0.1, 0.02], [0.1, 0.02], [0.14, o.to ?? 0.5], [0, (o.to ?? 0.5) + 0.07], [-0.14, o.to ?? 0.5]], color); }
export function bowTie(B, color = '#d5303e') { B.panel([[-0.34, 0.0], [0, 0.07], [0.34, 0.0], [0.34, 0.17], [0, 0.1], [-0.34, 0.17]], color); B.buttons(0, 0.085, 0.085, 1, 0.07, color); }
export function belt(B, v = 0.66, color = '#4a3024', buckle = '#e9c84a') { B.band(v, v + 0.07, color); B.seam([[-1.4, v], [1.4, v]]); B.seam([[-1.4, v + 0.07], [1.4, v + 0.07]]); if (buckle) B.panel([[-0.14, v - 0.012], [0.14, v - 0.012], [0.14, v + 0.082], [-0.14, v + 0.082]], buckle); }
export function sash(B, color = '#d5303e', dir = 1) { B.panel([[-1.2 * dir, 0.02], [-0.7 * dir, -0.05], [1.3 * dir, 0.62], [1.2 * dir, 0.8]], color); }
export function apron(B, color = '#e9e0cc', o = {}) { B.panel([[-0.36, 0.1], [0.36, 0.1], [0.42, 0.3], [0.8, 0.42], [0.86, 1.1], [-0.86, 1.1], [-0.8, 0.42], [-0.42, 0.3]], color); B.seam([[-0.36, 0.1], [-0.62, -0.1]]); B.seam([[0.36, 0.1], [0.62, -0.1]]); if (o.pocket !== false) B.seam([[-0.3, 0.62], [-0.28, 0.8], [0.28, 0.8], [0.3, 0.62]]); }
export function collar(B, color = '#f3ead8', o = {}) { B.panel([[-0.62, -0.08], [0, 0.02], [0.62, -0.08], [0.5, 0.1], [0, 0.19 + (o.deep ?? 0)], [-0.5, 0.1]], color); }
export function tabard(B, left, right, o = {}) { B.panel([[-0.72, -0.1], [0, -0.1], [0, 1.08], [-0.86, 1.08], [-0.82, 0.4]], left); B.panel([[0, -0.1], [0.72, -0.1], [0.82, 0.4], [0.86, 1.08], [0, 1.08]], right); }
export function epaulettes(B, color = '#e9c84a') { for (const s of [-1, 1]) B.panel([[s * 0.5, -0.04], [s * 1.25, -0.02], [s * 1.25, 0.13], [s * 0.5, 0.1]], color); }
export function medals(B, n = 3, o = {}) { for (let i = 0; i < n; i++) { const u = (o.u ?? 0.45) + (i - (n - 1) / 2) * 0.16; B.panel([[u - 0.05, 0.24], [u + 0.05, 0.24], [u + 0.05, 0.32], [u - 0.05, 0.32]], ['#d5303e', '#3b62c4', '#f3ead8'][i % 3], { line: B.lw * 0.4 }); B.buttons(u, 0.37, 0.37, 1, 0.055, '#e9c84a'); } }
export function strap(B, from = [-0.8, 0], to = [0.7, 0.8], color = '#6a4a30', w = 0.11) { B.panel([[from[0] - w, from[1]], [from[0] + w, from[1]], [to[0] + w, to[1]], [to[0] - w, to[1]]], color); }
export function patch(B, u, v, color = '#8a6a44', size = 0.14) { B.panel([[u - size, v - size * 0.5], [u + size, v - size * 0.4], [u + size * 0.9, v + size * 0.5], [u - size * 0.9, v + size * 0.6]], color, { line: B.lw * 0.4 }); }
