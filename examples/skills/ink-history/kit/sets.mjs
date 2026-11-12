// sets.mjs — building blocks for painted sets.
//
// A set in this style is a small stage painting, not a diagram:
//   - one clear light source: a sky gradient with a glow, or a lamp; everything is shaded to agree with it
//   - perspective: walls, floors and rows of houses run to a vanishing point that is OFF centre
//   - big, simple shadow shapes: a diagonal cast shadow across a wall, a dark foreground, a pool of light
//   - three depths: a dark cropped foreground piece, the acting space, a paler distance
//   - saturated local colour with a darker, slightly violet shadow tone; no texture noise, no grain
//   - inked edges that are thinner than the character outlines (4-6 units) and never ruler-straight
// Sets are painted once per shot and cached, so they may be as rich as you like.
//
// Build a set as a function (c) => { … } out of these helpers plus your own blobs. Start from the
// horizon and vanishing point, lay in sky and far shapes, then walls, floor, furniture, and finish with
// shadow and light passes. Never reuse one set for a whole film: change place, time of day or angle.
import {
  S, W, H, TAU, clamp, lerp, rad, rng, noise1, cel, stroke, brush, paint, wash, glow, linear, blob, curve, poly, circle, oval,
  wobble, shadeOf, lightOf, mix, alpha, lw, Path2D, layer, lineFor,
} from './ink.mjs';
import { PathOp } from '@napi-rs/canvas';

// ------------------------------------------------------------------ perspective
export const toward = (p, vp, t) => [lerp(p[0], vp[0], t), lerp(p[1], vp[1], t)];
// A four-cornered surface (wall, floor, table top). q.at(u, v) maps the unit square onto it with true
// foreshortening, so evenly spaced windows or planks bunch up correctly as they recede.
// Corners go clockwise from top-left: [TL, TR, BR, BL].
export function quad(tl, tr, br, bl) {
  const [x0, y0] = tl, [x1, y1] = tr, [x2, y2] = br, [x3, y3] = bl;
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3, den = dx1 * dy2 - dy1 * dx2 || 1e-9;
  const g = (sx * dy2 - sy * dx2) / den, h = (dx1 * sy - dy1 * sx) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  const at = (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]; };
  const q = { pts: [tl, tr, br, bl], at, path: poly([tl, tr, br, bl]),
    cell: (u0, v0, u1, v1) => quad(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)),
    edge: (u0, v0, u1, v1, n = 8) => Array.from({ length: n + 1 }, (_, i) => at(lerp(u0, u1, i / n), lerp(v0, v1, i / n))) };
  return q;
}
export const rectQuad = (x, y, w, h) => quad([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
const handPoly = (pts, seed = 1, amp = 1.4) => poly(wobble([...pts, pts[0]], amp, seed).slice(0, -1));

// ------------------------------------------------------------------ sky
// stops: colours from top to bottom. sun: {x, y, r, color, strength} adds the glow that lights the scene.
export function sky(c, stops = ['#8fb7d9', '#cfe3ea', '#f6e8c0'], o = {}) {
  c.fillStyle = linear(c, 0, o.y0 ?? 0, 0, o.y1 ?? H, ...stops); c.fillRect(-200, -200, W + 400, H + 400);
  if (o.sun) { const s = o.sun; glow(c, s.x, s.y, s.r ?? 700, s.color ?? '#fff6c8', s.strength ?? 0.9); if (s.disc) { c.fillStyle = s.discColor ?? '#fffbe0'; c.beginPath(); c.arc(s.x, s.y, s.disc, 0, TAU); c.fill(); } }
}
// A cumulus cloud: a puffy top made of overlapping lumps on a flatter base, three tones, no ink outline.
export function cloud(c, x, y, w, o = {}) {
  const r = rng(o.seed ?? 3), n = o.lumps ?? 7, h = w * (o.height ?? 0.3), col = o.color ?? '#fff6dc', shade = o.shade ?? shadeOf(col, 0.35);
  let p = oval(x, y, w * 0.5, h * 0.3); const tops = [];
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, cx = x + (t - 0.5) * w * 0.84 + (r() - 0.5) * w * 0.05, rr = h * (0.3 + 0.55 * Math.sin(t * Math.PI) * (0.55 + r() * 0.6)); tops.push([cx, y - rr * 0.6, rr]); p = p.op(circle(cx, y - rr * 0.6, rr), PathOp.Union); }
  const body = lc => {
    lc.fillStyle = linear(lc, 0, y - h * 1.1, 0, y + h * 0.35, o.rimColor ?? lightOf(col, 0.7, '#ffffff'), col, shade); lc.fill(p);
    lc.save(); lc.clip(p);
    for (const [cx, cy, rr] of tops) { lc.fillStyle = alpha(shade, 0.55); lc.beginPath(); lc.ellipse(cx + rr * 0.25, cy + rr * 0.95, rr * 0.9, rr * 0.5, 0, 0, TAU); lc.fill(); }
    lc.restore();
    if ((o.line ?? 0) > 0) stroke(lc, p, o.line, o.ink);
  };
  if (o.soft === 0) body(c); else layer(c, body, { blur: o.soft ?? 2.2, alpha: o.alpha ?? 1 });
  return p;
}
export function cloudBank(c, o = {}) {      // a row of clouds along the horizon or scattered in a band
  const r = rng(o.seed ?? 11), n = o.n ?? 5;
  for (let i = 0; i < n; i++) cloud(c, (o.x0 ?? -100) + (i + r() * 0.7) * ((o.x1 ?? W + 100) - (o.x0 ?? -100)) / n, (o.y ?? 260) + (r() - 0.5) * (o.spread ?? 120), (o.size ?? 420) * (0.6 + r() * 0.8), { ...o, seed: (o.seed ?? 11) * 7 + i });
}
// Distant land: a filled silhouette from a list of ridge points down to `base`.
export function ridge(c, pts, fill, o = {}) {
  const p = blob([[pts[0][0], o.base ?? H + 40, 1], ...pts.map((q, i) => (i === 0 || i === pts.length - 1) ? [q[0], q[1], 1] : q), [pts[pts.length - 1][0], o.base ?? H + 40, 1]]);
  if (o.flat) { paint(c, p, fill); if (o.line) stroke(c, p, o.line, o.ink); } else cel(c, p, { fill, fill2: o.fill2, depth: o.depth ?? 0.03, shrink: 1, rim: o.rim ?? 0, rimColor: o.rimColor, line: o.line ?? 5, ink: o.ink });
  return p;
}

// ------------------------------------------------------------------ surfaces
// wall(): one lit plane. fill -> fill2 is a top-to-bottom gradient; edge lights the top edge.
export function wall(c, q, o = {}) {
  const fill = o.fill ?? '#b9a383', ys = q.pts.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const p = o.straight ? q.path : handPoly(q.pts, o.seed ?? 2, o.wob ?? 1.2);
  c.fillStyle = linear(c, 0, y0, 0, y1, fill, o.fill2 ?? shadeOf(fill, 0.22)); c.fill(p);
  if (o.inner) { c.save(); c.clip(p); o.inner(c); c.restore(); }
  if ((o.line ?? 5) > 0) stroke(c, p, o.line ?? 5, o.ink);
  if (o.edge) stroke(c, poly([q.pts[0], q.pts[1]], false), o.edge, o.edgeColor ?? lightOf(fill, 0.6));
  return p;
}
// windows(): a grid of openings on a wall quad. Everything is given as fractions of the wall.
//   cols, rows, mx/my (outer margins), gap (0..1 of a cell), frame, glass, sill, bars, lit:[cell numbers], arch
export function windows(c, q, o = {}) {
  const cols = o.cols ?? 3, rows = o.rows ?? 2, mx = o.mx ?? 0.1, my = o.my ?? 0.14, gx = o.gapX ?? 0.42, gy = o.gapY ?? 0.36;
  const cw = (1 - 2 * mx) / cols, ch = (1 - 2 * my) / rows, frame = o.frame ?? '#5b4630', glass = o.glass ?? '#241a1e', line = o.line ?? 4;
  let k = 0;
  for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++, k++) {
    if (o.skip?.includes(k)) continue;
    const u0 = mx + i * cw + cw * gx / 2, u1 = mx + (i + 1) * cw - cw * gx / 2, v0 = my + r * ch + ch * gy / 2, v1 = my + (r + 1) * ch - ch * gy / 2;
    const f = q.cell(u0, v0, u1, v1), pad = o.pad ?? 0.14, g = q.cell(lerp(u0, u1, pad), lerp(v0, v1, pad * 0.8), lerp(u1, u0, pad), lerp(v1, v0, pad * 0.8));
    const lit = o.lit?.includes(k);
    cel(c, f.path, { fill: frame, flat: true, line });
    c.fillStyle = lit ? (o.litColor ?? '#ffd76a') : glass; c.fill(g.path); stroke(c, g.path, line * 0.7);
    if (!lit && o.shine !== false) { c.save(); c.clip(g.path); stroke(c, poly([g.at(0.1, 0.9), g.at(0.5, 0.1)], false), line * 1.6, alpha('#ffffff', 0.14)); c.restore(); }
    if (o.bars !== false) { stroke(c, poly([g.at(0.5, 0), g.at(0.5, 1)], false), line * 0.6, lit ? '#8a5a20' : frame); if (o.bars === 'cross') stroke(c, poly([g.at(0, 0.5), g.at(1, 0.5)], false), line * 0.6, lit ? '#8a5a20' : frame); }
    if (o.sill !== false) { const a = q.at(u0 - cw * 0.03, v1), b = q.at(u1 + cw * 0.03, v1); stroke(c, poly([a, b], false), line * 1.5, o.sill ?? lightOf(frame, 0.35)); stroke(c, poly([[a[0], a[1] + line], [b[0], b[1] + line]], false), line * 0.6); }
  }
}
// bricks(): courses of brick drawn as lighter mortar lines, with a few bricks picked out darker.
export function bricks(c, q, o = {}) {
  const rows = o.rows ?? 9, cols = o.cols ?? 7, r = rng(o.seed ?? 5), col = o.line ?? '#00000030';
  c.save(); c.clip(q.path);
  for (let j = 0; j <= rows; j++) stroke(c, poly(q.edge(0, j / rows, 1, j / rows, 6), false), o.w ?? 3, col);
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) { const u = (i + (j % 2) * 0.5) / cols; if (u > 1) continue; stroke(c, poly([q.at(u, j / rows), q.at(u, (j + 1) / rows)], false), o.w ?? 3, col); if (r() < (o.pick ?? 0.12)) paint(c, q.cell(u, j / rows, Math.min(1, u + 1 / cols), (j + 1) / rows).path, o.pickColor ?? '#00000018'); }
  c.restore();
}
// planks(): boards with dark gaps and a few sweeping grain strokes. dir 'h' = horizontal boards.
export function planks(c, q, o = {}) {
  const n = o.n ?? 6, r = rng(o.seed ?? 8), base = o.fill ?? '#a47a4c', horizontal = (o.dir ?? 'h') === 'h';
  c.save(); c.clip(q.path);
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n, cell = horizontal ? q.cell(0, a, 1, b) : q.cell(a, 0, b, 1), tone = mix(base, r() < 0.5 ? '#000000' : '#ffffff', r() * (o.vary ?? 0.08));
    const ys = cell.pts.map(p => p[1]); c.fillStyle = linear(c, 0, Math.min(...ys), 0, Math.max(...ys), lightOf(tone, 0.08, '#ffffff'), shadeOf(tone, 0.16)); c.fill(cell.path);
    const grains = o.grain ?? 5;
    for (let k = 0; k < grains; k++) {              // long S-curves and the odd knot swirl
      const t0 = -0.1 + r() * 0.4, t1 = Math.min(1.1, t0 + 0.6 + r() * 0.5), m = 0.16 + r() * 0.68, dev = (r() - 0.5) * 0.6;
      const points = [[t0, m], [lerp(t0, t1, 0.3), clamp(m + dev, 0.08, 0.92)], [lerp(t0, t1, 0.64), clamp(m - dev * 0.6, 0.08, 0.92)], [t1, m]];
      const P3 = points.map(([u, v]) => horizontal ? cell.at(u, v) : cell.at(v, u));
      brush(c, P3, [0, o.grainW ?? 6, (o.grainW ?? 6) * 0.7, 0], o.grainColor ?? shadeOf(tone, 0.4));
    }
    if (r() < (o.knots ?? 0.35)) { const u = 0.15 + r() * 0.7, kp = horizontal ? cell.at(u, 0.5) : cell.at(0.5, u), s = (o.knotSize ?? 16) * (0.7 + r() * 0.6); stroke(c, oval(kp[0], kp[1], s * 1.6, s * 0.7, horizontal ? 0 : Math.PI / 2), 3, shadeOf(tone, 0.3)); stroke(c, oval(kp[0], kp[1], s * 0.8, s * 0.3, horizontal ? 0 : Math.PI / 2), 3, shadeOf(tone, 0.3)); }
  }
  for (let i = 1; i < n; i++) stroke(c, poly(horizontal ? q.edge(0, i / n, 1, i / n, 6) : q.edge(i / n, 0, i / n, 1, 6), false), o.gap ?? 5, o.gapColor ?? S.ink);
  c.restore();
  if ((o.line ?? 5) > 0) stroke(c, q.path, o.line ?? 5);
}
// Ground plane seen in perspective: bands of colour plus joints running to the vanishing point.
export function floor(c, q, o = {}) {
  const fill = o.fill ?? '#4a4640', ys = q.pts.map(p => p[1]);
  c.fillStyle = linear(c, 0, Math.min(...ys), 0, Math.max(...ys), o.far ?? lightOf(fill, 0.2, '#ffffff'), fill); c.fill(q.path);
  c.save(); c.clip(q.path);
  const col = o.joint ?? '#00000040', w = o.w ?? 4;
  for (let i = 1; i < (o.rows ?? 5); i++) { const v = Math.pow(i / (o.rows ?? 5), o.bias ?? 1); stroke(c, poly(q.edge(0, v, 1, v, 4), false), w, col); }
  for (let i = 1; i < (o.cols ?? 8); i++) stroke(c, poly([q.at(i / (o.cols ?? 8), 0), q.at(i / (o.cols ?? 8), 1)], false), w, col);
  c.restore();
  if ((o.line ?? 5) > 0) stroke(c, q.path, o.line ?? 5);
}
// A solid box in perspective (house, crate, pedestal, counter). front is a rectangle {x, y, w, h};
// the side face recedes toward vp by `depth` (0..1). Returns {front, side, top} quads to decorate.
export function box(c, front, vp, depth = 0.25, o = {}) {
  const { x, y, w, h } = front, right = vp[0] > x + w / 2, nx = right ? x + w : x;
  const f = rectQuad(x, y, w, h), a = [nx, y], b = [nx, y + h], a2 = toward(a, vp, depth), b2 = toward(b, vp, depth);
  const side = right ? quad(a, a2, b2, b) : quad(a2, a, b, b2);
  const fx = right ? x : x + w, t2 = toward([fx, y], vp, depth), topQ = right ? quad(t2, a2, a, [fx, y]) : quad(a2, t2, [fx, y], a);
  const fill = o.fill ?? '#b08d62';
  if (vp[1] < y && o.top !== false) wall(c, topQ, { fill: o.topFill ?? lightOf(fill, 0.3), line: o.line, seed: o.seed });
  wall(c, side, { fill: o.sideFill ?? shadeOf(fill, 0.5), fill2: shadeOf(o.sideFill ?? shadeOf(fill, 0.5), 0.2), line: o.line, seed: (o.seed ?? 1) + 3 });
  wall(c, f, { fill, fill2: o.fill2, line: o.line, seed: (o.seed ?? 1) + 5, edge: o.edge, edgeColor: o.edgeColor });
  return { front: f, side, top: topQ };
}
// A row of house fronts receding along a street toward vp. near: x of the nearest corner; the row runs
// from there toward the vanishing point. Each house gets its own height, colour and window grid.
export function terrace(c, o = {}) {
  const vp = o.vp ?? [1100, 420], r = rng(o.seed ?? 4), n = o.n ?? 5, base = o.base ?? 900, cols = o.colors ?? ['#9a6a4a', '#7d5340', '#a8805a', '#6f4a3c'];
  const x0 = o.near ?? -80, reach = o.reach ?? 0.82; let t = 0; const houses = [];
  for (let i = 0; i < n; i++) { const span = (reach - t) * (0.3 + r() * 0.16), h = (o.height ?? 760) * (0.72 + r() * 0.4); houses.push({ t0: t, t1: Math.min(reach, t + span), h, col: cols[i % cols.length], i }); t += span; }
  for (const hs of houses.reverse()) {                    // far to near, so near houses overlap
    const bl = toward([x0, base], vp, hs.t0), br = toward([x0, base], vp, hs.t1), tl = toward([x0, base - hs.h], vp, hs.t0), tr = toward([x0, base - hs.h], vp, hs.t1);
    const left = x0 < vp[0], q = left ? quad(tl, tr, br, bl) : quad(tr, tl, bl, br), fill = o.haze ? mix(hs.col, o.haze, hs.t0 * (o.hazeAmount ?? 0.45)) : hs.col;
    // pitched roof behind the wall top on every other house: breaks the skyline
    if ((o.gables ?? true) && hs.i % 2 === 0) { const g0 = q.at(0, 0), g1 = q.at(1, 0), gm = q.at(0.5, -0.2); cel(c, poly([g0, gm, g1]), { fill: shadeOf(fill, 0.6), flat: true, line: o.line ?? 5 }); }
    wall(c, q, { fill, fill2: shadeOf(fill, 0.45), line: o.line ?? 5, seed: hs.i + 3, edge: o.edge, edgeColor: o.edgeColor });
    // cornice: a darker lip that juts out over the wall
    const lip = 0.03, rq = quad(q.at(-0.02, -lip), q.at(1.02, -lip), q.at(1.02, 0.02), q.at(-0.02, 0.02)); wall(c, rq, { fill: shadeOf(fill, 0.55), line: o.line ?? 5, seed: hs.i, edge: o.edge, edgeColor: o.edgeColor });
    windows(c, q, { cols: 2 + Math.floor(r() * 3), rows: 2 + Math.floor(r() * 2), frame: shadeOf(fill, 0.55), glass: o.glass ?? '#1a1014', line: (o.line ?? 5) * 0.8, my: 0.1, lit: o.lit ? [Math.floor(r() * 4)] : undefined, ...(o.windows ?? {}) });
    if (o.doors && r() < 0.6) { const d = q.cell(0.36, 0.72, 0.6, 1); cel(c, d.path, { fill: shadeOf(fill, 0.8), flat: true, line: 4 }); }
  }
}

// ------------------------------------------------------------------ plants
export function tree(c, x, y, s = 1, o = {}) {
  const leaf = o.leaf ?? '#7d9a2e', trunk = o.trunk ?? '#5a3d2a', r = rng(o.seed ?? 6);
  c.save(); c.translate(x, y); c.scale(s, s);
  cel(c, blob([[-26, 0, 1], [-18, -130], [-52, -250], [-20, -262], [0, -190], [30, -272], [56, -258], [22, -130], [30, 0, 1]]), { fill: trunk, depth: 0.2, line: lineFor(6, s) });
  let p = null; const lumps = o.lumps ?? 9;
  for (let i = 0; i < lumps; i++) { const a = i / lumps * TAU, rr = 70 + r() * 46, q = circle(Math.cos(a) * (120 + r() * 30), -330 + Math.sin(a) * (78 + r() * 22), rr); p = p ? p.op(q, PathOp.Union) : q; }
  p = p.op(oval(0, -330, 150, 100), PathOp.Union);
  cel(c, p, { fill: leaf, shade: o.shade ?? shadeOf(leaf, 0.75), depth: 0.1, shrink: 0.9, rim: lineFor(8, s), rimColor: o.rim ?? lightOf(leaf, 0.5, '#f4f08a'), line: lineFor(6, s) });
  c.save(); c.clip(p);
  for (let i = 0; i < 16; i++) { const px = (r() - 0.5) * 380, py = -330 + (r() - 0.5) * 240, q = 22 + r() * 16; brush(c, [[px - q, py - 4], [px, py + q * 0.7], [px + q, py - 6]], [0, lineFor(6, s), 0], shadeOf(leaf, 0.55)); }
  c.restore(); c.restore();
}
export function bush(c, x, y, w, o = {}) {
  const leaf = o.leaf ?? '#86a236', r = rng(o.seed ?? 9), n = o.lumps ?? 5; let p = oval(x, y - w * 0.08, w * 0.5, w * 0.14);
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; p = p.op(circle(x + (t - 0.5) * w * 0.84, y - w * (0.12 + 0.14 * Math.sin(t * Math.PI)), w * (0.15 + r() * 0.07)), PathOp.Union); }
  cel(c, p, { fill: leaf, shade: shadeOf(leaf, 0.75), depth: 0.12, shrink: 0.92, rim: 6, rimColor: lightOf(leaf, 0.5, '#f4f08a'), line: o.line ?? 5 });
}
export function grass(c, x0, x1, y, o = {}) {      // tufts along a line
  const r = rng(o.seed ?? 12), n = o.n ?? 14, col = o.color ?? '#5d7a2a';
  for (let i = 0; i < n; i++) { const x = lerp(x0, x1, (i + r()) / n), h = (o.h ?? 26) * (0.6 + r() * 0.8); for (const d of [-1, 0, 1]) brush(c, [[x + d * 5, y], [x + d * 9, y - h * 0.6], [x + d * 16, y - h]], [5, 3, 0], col); }
}

// ------------------------------------------------------------------ interiors
// room(): a box seen from inside. back = [x0, y0, x1, y1] is the far wall on screen; the side walls, floor
// and ceiling run out to the frame edges. Returns the five quads so you can plank, paper or furnish them.
export function room(c, back, o = {}) {
  const [x0, y0, x1, y1] = back, m = o.margin ?? 60, L = -m, T = -m, Rr = W + m, Bm = H + m;
  const q = { back: rectQuad(x0, y0, x1 - x0, y1 - y0), left: quad([L, T], [x0, y0], [x0, y1], [L, Bm]), right: quad([x1, y0], [Rr, T], [Rr, Bm], [x1, y1]), floor: quad([x0, y1], [x1, y1], [Rr, Bm], [L, Bm]), ceil: quad([L, T], [Rr, T], [x1, y0], [x0, y0]) };
  const wc = o.wall ?? '#a98a5e';
  if (o.paint !== false) {
    wall(c, q.ceil, { fill: o.ceil ?? shadeOf(wc, 0.5), line: 0, straight: true }); wall(c, q.floor, { fill: o.floor ?? '#6b4a34', line: 0, straight: true });
    wall(c, q.left, { fill: o.left ?? shadeOf(wc, 0.3), line: 0, straight: true }); wall(c, q.right, { fill: o.right ?? shadeOf(wc, 0.42), line: 0, straight: true }); wall(c, q.back, { fill: wc, fill2: shadeOf(wc, 0.18), line: 0, straight: true });
  }
  return q;
}
export function roomLines(c, q, w = 6) { for (const k of ['back', 'left', 'right', 'floor', 'ceil']) stroke(c, q[k].path, w); }
// A bare hanging bulb or lantern point with its pool of light.
export function bulb(c, x, y, o = {}) {
  stroke(c, poly([[x, o.from ?? -20], [x, y - 34]], false), 5);
  cel(c, blob([[x - 12, y - 36, 1], [x + 12, y - 36, 1], [x + 14, y - 16], [x + 24, y + 12], [x, y + 34], [x - 24, y + 12], [x - 14, y - 16]]), { fill: o.color ?? '#fff3b0', flat: true, line: 5 });
  glow(c, x, y, o.r ?? 520, o.glow ?? '#ffe9a0', o.strength ?? 0.75);
}
// A framed picture, map or notice on a wall. inside(c, x, y, w, h) paints the content.
export function frame(c, x, y, w, h, o = {}) {
  const col = o.color ?? '#6a4a2c', t = o.thick ?? 16;
  cel(c, poly([[x - t, y - t], [x + w + t, y - t], [x + w + t, y + h + t], [x - t, y + h + t]]), { fill: col, depth: 0.03, rim: 4, line: o.line ?? 6 });
  c.save(); const inner = poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]); c.clip(inner); c.fillStyle = o.fill ?? '#e8dcc0'; c.fillRect(x, y, w, h); o.inside?.(c, x, y, w, h); c.restore(); stroke(c, inner, 4);
}
export function curtain(c, x, y, w, h, o = {}) {      // a gathered drape; side -1 hangs left, 1 right
  const col = o.color ?? '#8f1f26', s = o.side ?? -1, n = o.folds ?? 5;
  const p = blob([[x, y, 1], [x + w, y, 1], [x + w * (s < 0 ? 0.55 : 1), y + h * 0.55], [x + w * (s < 0 ? 0.35 : 1.0), y + h, 1], [x + w * (s < 0 ? 0 : 0.65), y + h, 1], [x + w * (s < 0 ? 0 : 0.45), y + h * 0.55]]);
  cel(c, p, { fill: col, depth: 0.05, rim: 5, line: o.line ?? 6, inner: cc => { for (let i = 1; i < n; i++) { const u = i / n; brush(cc, [[x + w * u, y], [x + w * (s < 0 ? u * 0.7 : 0.3 + u * 0.7), y + h * 0.55], [x + w * (s < 0 ? u * 0.4 : 0.6 + u * 0.4), y + h]], [0, 9, 9, 0], shadeOf(col, 0.6)); } } });
}

// ------------------------------------------------------------------ light and shadow passes
// Run these last. A set without a shadow pass looks like a diagram.
export function castShadow(c, pts, o = {}) { wash(c, poly(pts), o.color ?? alpha(shadeOf('#ffffff', 1.25), o.alpha ?? 0.62), 'multiply'); }
export function lightShape(c, pts, o = {}) { wash(c, poly(pts), o.color ?? alpha('#fff0c0', o.alpha ?? 0.35), 'screen'); }
// Darken the frame edges a little so the eye stays on the cast.
export function vignette(c, o = {}) {
  const g = c.createRadialGradient(W / 2, H * 0.46, H * 0.5, W / 2, H * 0.5, W * 0.72); g.addColorStop(0, alpha(o.color ?? '#1a0c1e', 0)); g.addColorStop(1, alpha(o.color ?? '#1a0c1e', o.strength ?? 0.42));
  c.save(); c.fillStyle = g; c.fillRect(-200, -200, W + 400, H + 400); c.restore();
}
// grade(): tint the whole picture, cast included. Call it at the END of `draw` for night, torchlight, fog
// or a memory: multiply with a blue-violet for night ('#8f8fd0'), a warm orange for firelight ('#ffc890').
// Anything you draw after it (lamps, glows, stars, labels) stays bright.
export function grade(c, color = '#8f8fd0', mode = 'multiply') { if (S.mode !== 'full') return; c.save(); c.globalCompositeOperation = mode; c.fillStyle = color; c.fillRect(-400, -400, W + 800, H + 800); c.restore(); }
// Air between near and far: a veil of the sky colour over the distance.
export function haze(c, y0, y1, color = '#f4dfb0', a = 0.5) { c.save(); c.fillStyle = linear(c, 0, y0, 0, y1, alpha(color, a), alpha(color, 0)); c.fillRect(-200, Math.min(y0, y1), W + 400, Math.abs(y1 - y0)); c.restore(); }
// Sunbeams or lamp rays fanning from a point.
export function rays(c, x, y, o = {}) {
  const n = o.n ?? 9, len = o.len ?? 1600, a0 = rad(o.from ?? 20), a1 = rad(o.to ?? 160);
  c.save(); c.globalCompositeOperation = 'screen';
  for (let i = 0; i < n; i++) { const a = lerp(a0, a1, (i + 0.5) / n), wd = (a1 - a0) / n * 0.3; const g = c.createLinearGradient(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len); g.addColorStop(0, alpha(o.color ?? '#fff3c4', o.alpha ?? 0.4)); g.addColorStop(1, alpha(o.color ?? '#fff3c4', 0)); c.fillStyle = g; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a - wd) * len, y + Math.sin(a - wd) * len); c.lineTo(x + Math.cos(a + wd) * len, y + Math.sin(a + wd) * len); c.closePath(); c.fill(); }
  c.restore();
}
// A soft dark shape in front of everything: the back of a head, a doorway, a branch. Cropped by the
// frame and out of focus, it is the cheapest way to get depth into a shot.
export function foreground(c, fn, o = {}) { layer(c, fn, { blur: o.blur ?? 5, alpha: o.alpha ?? 1 }); }
