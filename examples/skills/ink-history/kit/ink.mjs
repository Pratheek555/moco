// ink.mjs — drawing core of the ink-history kit.
//
// Everything in the look comes from four habits, and every helper here exists to make one of them cheap:
//   1. a thick, confident, near-black outline around every form            -> cel(), stroke(), brush()
//   2. two-tone cel shading: a hard-edged shadow crescent on the side away
//      from the light, plus a bright rim strip on the side facing it        -> cel({depth, shrink, rim})
//   3. saturated flat colour (no grain, no sepia wash)                      -> palette helpers
//   4. organic hand-drawn shapes (curves with a few sharp corners)          -> blob()/spline()/wobble()
//
// Units: scene units are pixels of the 1920x960 frame at camera zoom 1. Line widths are given in scene
// units and are compensated for any nested scale, so a head drawn in "unit head" space still gets the
// outline you asked for.
import { createCanvas, Path2D, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { createCanvas, Path2D };
export const W = 1920, H = 960;
export const INK = '#1a0e10';            // warm near-black; never pure #000, never grey-brown
export const TAU = Math.PI * 2;

// ---------------------------------------------------------------- numbers
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rad = d => d * Math.PI / 180;
export const f1 = n => Math.round(n * 1000) / 1000;   // path precision: fine enough for unit-sized head space
export function rng(seed = 1) {            // small deterministic generator: same seed, same drawing
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export function noise1(x, seed = 0) {      // smooth 1-D value noise in -1..1
  const i = Math.floor(x), f = x - i, h = n => { const v = Math.sin((n + seed * 57.3) * 127.1) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };
  const u = f * f * (3 - 2 * f); return lerp(h(i), h(i + 1), u);
}

// ---------------------------------------------------------------- colour
export function rgb(col) {
  if (Array.isArray(col)) return col;
  let h = col.replace('#', '');
  if (h.length === 3) h = [...h].map(ch => ch + ch).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length > 6 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
}
export function hex(c) {
  const p = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + p(c[0]) + p(c[1]) + p(c[2]) + (c[3] !== undefined && c[3] < 1 ? p(c[3] * 255) : '');
}
export function mix(a, b, t) { const A = rgb(a), B = rgb(b); return hex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t), lerp(A[3] ?? 1, B[3] ?? 1, t)]); }
export function alpha(col, a) { const A = rgb(col); return hex([A[0], A[1], A[2], a]); }
// Shadow tone of a colour: multiply toward a cool violet. White becomes the mauve-grey of the faces,
// olive becomes a darker brown-olive. Shadows in this style are never plain grey or black.
export function shadeOf(col, amt = S.shadeAmt, tint = S.shadowTint) {
  const A = rgb(col), T = rgb(tint);
  return hex([A[0] * lerp(1, T[0] / 255, amt), A[1] * lerp(1, T[1] / 255, amt), A[2] * lerp(1, T[2] / 255, amt), A[3]]);
}
// Rim / highlight tone: push toward the warm key light.
export function lightOf(col, amt = 0.42, tint = S.key) { return mix(col, tint, amt); }

// ---------------------------------------------------------------- style state
// One mutable style record. `mode` switches how every helper paints:
//   full   : colour + cel shading + ink outline (normal picture)
//   line   : white line art only, interiors erased (explanation-board drawings)
//   shadow : flat silhouette in the shadow tint (cast shadows of hats, hair, figures)
export const S = {
  mode: 'full',
  light: [0.62, -0.78],     // unit vector pointing TOWARD the light, in screen space (y down)
  line: 8,                  // default outline width in scene units
  ink: INK,
  key: '#fff1c4',           // warm light colour used for rims
  shadowTint: '#8d6a6e',    // multiply tint for shadows: warm rose-grey by day; set a blue-violet for night
  shadeAmt: 0.66,
  lineColor: '#ffffff',     // line-art colour in `line` mode
  lineW: 11,                // line-art width in scene units
  shadowColor: '#2a183a66', // silhouette colour in `shadow` mode
  view: 1,                  // device px per scene unit under the current camera (set by the stage)
  dpx: 1,                   // device px per frame px (oversampling of the canvas)
  transient: false,         // true while something is popping in: its lettering is not measured yet
  form: 0.5,                // how far round the forms the shadow reaches: 0.2 flat front light, 0.5 normal, 0.85 hard side light
  backlit: 0,               // 0 = lit from the front or side (shadow crescent on the far edge). 0.1-0.2 = lit from
                            // behind: every form sits in its shadow tone and only a crescent that wide (as a
                            // fraction of the form) catches the light. Dusk, doorways, fires and windows behind the cast.
};
export function withStyle(patch, fn) {
  const old = { ...S }; Object.assign(S, patch);
  try { return fn(); } finally { Object.assign(S, old); }
}
export function setLight(dx, dy) { const n = Math.hypot(dx, dy) || 1; S.light = [dx / n, dy / n]; }
// device pixels per local unit under the current transform
export function sc(c) { const m = c.getTransform(); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1; }
// convert a width given in scene units to the local units of the current transform
export function lw(c, sceneWidth) { return sceneWidth * S.view / sc(c); }
// Outline width for something drawn at scale s (1 = natural size): big things get a bolder line, small
// and distant things a finer one, within the limits the style allows.
export const lineFor = (w, s = 1) => clamp(w * Math.pow(Math.max(s, 0.01), 0.6), 2.5, 14);
// The light direction expressed in the current local space, so that a rotated or mirrored drawing is
// still lit from the same side of the screen.
export function localLight(c) {
  const m = c.getTransform(), det = m.a * m.d - m.b * m.c || 1;
  const x = (m.d * S.light[0] - m.c * S.light[1]) / det, y = (-m.b * S.light[0] + m.a * S.light[1]) / det, n = Math.hypot(x, y) || 1;
  return [x / n, y / n];
}

// ---------------------------------------------------------------- QA registry
// figure() and label() record what ended up on screen so the gates can measure framing and legibility.
export const REG = { faces: [], labels: [], figures: [] };
export function resetReg() { REG.faces.length = 0; REG.labels.length = 0; REG.figures.length = 0; }
export function toFrame(c, x, y) { const m = c.getTransform(); return [(m.a * x + m.c * y + m.e) / S.dpx, (m.b * x + m.d * y + m.f) / S.dpx]; }

// ---------------------------------------------------------------- paths
export function P(d) { return d instanceof Path2D ? d : new Path2D(d); }
// Smooth curve through points (Catmull-Rom). A point written [x, y, 1] is a sharp corner.
// This is the main way to draw an organic shape: list 6-14 points around the silhouette.
export function spline(pts, closed = true, tension = 1) {
  const n = pts.length; if (n < 2) return '';
  const get = i => pts[closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  const segs = closed ? n : n - 1, k = tension / 6;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const t1 = p1[2] ? [0, 0] : [(p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k];
    const t2 = p2[2] ? [0, 0] : [(p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k];
    d += `C${f1(p1[0] + t1[0])} ${f1(p1[1] + t1[1])} ${f1(p2[0] - t2[0])} ${f1(p2[1] - t2[1])} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}
export const blob = (pts, tension = 1) => new Path2D(spline(pts, true, tension));
export const curve = (pts, tension = 1) => new Path2D(spline(pts, false, tension));
export function poly(pts, closed = true) { return new Path2D('M' + pts.map(p => `${f1(p[0])} ${f1(p[1])}`).join('L') + (closed ? 'Z' : '')); }
export function circle(x, y, r) { const p = new Path2D(); p.arc(x, y, r, 0, TAU); p.closePath(); return p; }
export function oval(x, y, rx, ry, rot = 0) { const p = new Path2D(); p.ellipse(x, y, rx, ry, rot, 0, TAU); p.closePath(); return p; }
export function rrect(x, y, w, h, r = 0) { const p = new Path2D(); p.roundRect(x, y, w, h, r); return p; }
// Points along a spline (for brushes, tubes and wobble).
export function sample(pts, closed = false, per = 8, tension = 1) {
  const n = pts.length, out = []; if (n < 2) return pts.map(p => [p[0], p[1]]);
  const get = i => pts[closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  const segs = closed ? n : n - 1, k = tension / 6;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const t1 = p1[2] ? [0, 0] : [(p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k];
    const t2 = p2[2] ? [0, 0] : [(p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k];
    const a = [p1[0] + t1[0], p1[1] + t1[1]], b = [p2[0] - t2[0], p2[1] - t2[1]];
    for (let j = 0; j < per; j++) {
      const t = j / per, u = 1 - t;
      out.push([u * u * u * p1[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p2[0], u * u * u * p1[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p2[1]]);
    }
  }
  if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
// A stroke with changing thickness (eyebrows, lashes, hair wisps, wood grain, creases).
// widths: thickness at evenly spaced stations along the stroke, e.g. [0, 9, 7, 0] tapers both ends.
export function brushPath(pts, widths = [0, 8, 0], per = 8) {
  const s = sample(pts, false, per), n = s.length; if (n < 2) return new Path2D();
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = s[Math.max(0, i - 1)], b = s[Math.min(n - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const m = Math.hypot(nx, ny) || 1; nx /= m; ny /= m;
    const u = i / (n - 1) * (widths.length - 1), j = Math.min(widths.length - 2, Math.floor(u));
    const w = lerp(widths[j], widths[j + 1], u - j) / 2;
    L.push([s[i][0] + nx * w, s[i][1] + ny * w]); R.push([s[i][0] - nx * w, s[i][1] - ny * w]);
  }
  return poly([...L, ...R.reverse()]);
}
// A limb or strap: a tube with round ends following a curve, as a fillable outline.
export function tube(pts, w0, w1 = w0, per = 8) {
  const s = sample(pts, false, per), n = s.length; if (n < 2) return new Path2D();
  const L = [], R = [], cap = (c, r, a0, cw) => { const o = []; for (let i = 1; i < 6; i++) { const a = a0 + (cw ? 1 : -1) * Math.PI * i / 6; o.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } return o; };
  let a0 = 0, a1 = 0;
  for (let i = 0; i < n; i++) {
    const a = s[Math.max(0, i - 1)], b = s[Math.min(n - 1, i + 1)];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (i === 0) a0 = ang; if (i === n - 1) a1 = ang;
    const w = lerp(w0, w1, i / (n - 1)) / 2, nx = -Math.sin(ang), ny = Math.cos(ang);
    L.push([s[i][0] + nx * w, s[i][1] + ny * w]); R.push([s[i][0] - nx * w, s[i][1] - ny * w]);
  }
  const endCap = cap(s[n - 1], w1 / 2, a1 + Math.PI / 2, false), startCap = cap(s[0], w0 / 2, a0 - Math.PI / 2, false);
  return poly([...L, ...endCap, ...R.reverse(), ...startCap]);
}
// Slight hand wobble for long straight edges so sets do not look ruled by a machine.
export function wobble(pts, amp = 1.6, seed = 1, step = 46) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / step));
    for (let j = 0; j < n; j++) {
      const t = j / n, x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t), k = j === 0 ? 0 : 1;
      out.push([x + noise1(x * 0.021 + y * 0.013, seed) * amp * k, y + noise1(y * 0.019 - x * 0.011, seed + 9) * amp * k]);
    }
  }
  out.push(pts[pts.length - 1]); return out;
}
export function bounds(p) { const b = P(p).getBounds(); return { x0: b[0], y0: b[1], x1: b[2], y1: b[3], w: b[2] - b[0], h: b[3] - b[1], cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 }; }

// ---------------------------------------------------------------- painting
// cel(): fill a closed shape the way the style paints every form.
//   fill    lit colour                      shade/deep  shadow colours (default: derived from fill)
//   depth   how far the lit copy is pushed toward the light, as a fraction of the shape's small side
//   shrink  scale of the lit copy; < 1 widens the shadow crescent (heads use about 0.86)
//   rim     width (scene units) of a bright strip on the light-facing edge; rimColor overrides its colour
//   fill2   optional second lit colour for a top-to-bottom gradient
//   inner   callback drawn clipped inside the shape after shading (seams, stripes, cast shadows)
//   line    outline width in scene units (0 = none);  ink  outline colour
//   flat    true = no shading at all (tiny or distant things)
export function cel(c, shape, o = {}) {
  const p = P(shape);
  const rule = o.rule ?? 'nonzero';      // compound cutouts (hood openings, wheel spokes) can need evenodd
  const width = lw(c, o.line ?? S.line);
  if (S.mode === 'shadow') { c.fillStyle = S.shadowColor; c.fill(p, rule); return p; }
  if (S.mode === 'line') {
    if (!o.open) { c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fill(p, rule); c.restore(); }
    if (o.lineInner) { c.save(); c.clip(p, rule); o.inner?.(c); c.restore(); }
    if ((o.line ?? 1) > 0) { c.strokeStyle = S.lineColor; c.lineWidth = lw(c, S.lineW); c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(p); }
    return p;
  }
  const fill = o.fill ?? '#ffffff';
  const b = o.bounds ?? bounds(p), L = o.light ?? localLight(c), pad = 4 * lw(c, 1);
  c.save(); c.clip(p, rule);
  if (o.flat) { c.fillStyle = fill; c.fillRect(b.x0 - pad, b.y0 - pad, b.w + pad * 2, b.h + pad * 2); }
  else {
    const back = S.backlit && o.backlit !== false;
    const shade = o.shade ?? shadeOf(fill, S.shadeAmt * (back ? 0.78 : 1)), deep = o.deep ?? shadeOf(fill, S.shadeAmt * (back ? 1.2 : 1.5));
    const ext = Math.max(b.w, b.h) / 2;
    const g = c.createLinearGradient(b.cx - L[0] * ext, b.cy - L[1] * ext, b.cx + L[0] * ext * 0.3, b.cy + L[1] * ext * 0.3);
    g.addColorStop(0, deep); g.addColorStop(1, shade);
    c.fillStyle = g; c.fillRect(b.x0 - pad, b.y0 - pad, b.w + pad * 2, b.h + pad * 2);
    const depth = (o.depth ?? 0.1) * Math.min(b.w, b.h), sh = o.shrink ?? 0.95;
    if (back) {
      const r = Math.max(lw(c, o.rim ?? 0), S.backlit * Math.min(b.w, b.h) * (o.crescent ?? 1)), q = new Path2D(); q.rect(b.x0 - pad, b.y0 - pad, b.w + pad * 2, b.h + pad * 2);
      q.addPath(p, { a: 1, b: 0, c: 0, d: 1, e: -L[0] * r, f: -L[1] * r });
      c.fillStyle = o.backFill ?? lightOf(fill, 0.25); c.fill(q, 'evenodd');
    } else {
    c.save(); c.translate(b.cx + L[0] * depth, b.cy + L[1] * depth); c.scale(sh, sh); c.translate(-b.cx, -b.cy);
    if (o.fill2) { const g2 = c.createLinearGradient(0, b.y0, 0, b.y1); g2.addColorStop(0, fill); g2.addColorStop(1, o.fill2); c.fillStyle = g2; } else c.fillStyle = fill;
    c.fill(p, rule); c.restore();
    }
    if (o.rim && !back) {
      const r = lw(c, o.rim), q = new Path2D(); q.rect(b.x0 - pad, b.y0 - pad, b.w + pad * 2, b.h + pad * 2);
      q.addPath(p, { a: 1, b: 0, c: 0, d: 1, e: -L[0] * r, f: -L[1] * r });
      c.fillStyle = o.rimColor ?? lightOf(fill); c.fill(q, 'evenodd');
    }
  }
  o.inner?.(c);
  c.restore();
  if (width > 0) { c.strokeStyle = o.ink ?? S.ink; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(p); }
  return p;
}
// An ink line (open or closed path). In line mode it becomes white line art.
export function stroke(c, shape, w = S.line * 0.7, color) {
  if (S.mode === 'shadow') return;
  c.strokeStyle = S.mode === 'line' ? S.lineColor : (color ?? S.ink);
  c.lineWidth = lw(c, S.mode === 'line' ? Math.max(S.lineW * 0.8, w) : w); c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(P(shape));
}
// A solid shape in ink (eyes, brows built with brushPath, silhouettes).
export function solid(c, shape, color) {
  if (S.mode === 'shadow') return;
  c.fillStyle = S.mode === 'line' ? S.lineColor : (color ?? S.ink); c.fill(P(shape));
}
// Tapered ink stroke through points; widths are in scene units.
export function brush(c, pts, widths = [0, 8, 0], color) {
  const k = lw(c, 1);
  if (S.mode === 'line') { stroke(c, curve(pts), S.lineW * 0.8); return; }
  solid(c, brushPath(pts, widths.map(w => w * k)), color);
}
// Flat colour without outline or shading (inside cel's `inner`, skies, light shapes).
export function paint(c, shape, color) { if (S.mode !== 'full') return; c.fillStyle = color; c.fill(P(shape)); }
// Soft light or shadow painted over what is already there. mode: 'multiply' darkens, 'screen' lightens.
export function wash(c, shape, color, mode = 'multiply') {
  if (S.mode !== 'full') return;
  c.save(); c.globalCompositeOperation = mode; c.fillStyle = color; c.fill(P(shape)); c.restore();
}
export function glow(c, x, y, r, color = '#fff4c8', strength = 0.8) {
  if (S.mode !== 'full') return;
  const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, alpha(color, strength)); g.addColorStop(0.45, alpha(color, strength * 0.35)); g.addColorStop(1, alpha(color, 0));
  c.save(); c.globalCompositeOperation = 'screen'; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
}
export function linear(c, x0, y0, x1, y1, ...stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => Array.isArray(s) ? g.addColorStop(s[0], s[1]) : g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), s));
  return g;
}

// ---------------------------------------------------------------- layers
// Draw into an offscreen layer that shares the current transform, then composite it once.
// Use for: group opacity (cross-fades), blur (out-of-focus foreground), line-art erasing, blend modes.
const pool = [];
export function layer(c, fn, o = {}) {
  const cv = c.canvas, w = cv.width, h = cv.height;
  let item = pool.find(q => !q.busy && q.cv.width === w && q.cv.height === h);
  if (!item) { item = { cv: createCanvas(w, h), busy: false }; pool.push(item); }
  item.busy = true;
  const lc = item.cv.getContext('2d');
  lc.save(); lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, w, h); lc.setTransform(c.getTransform());
  try { fn(lc); } finally { lc.restore(); }
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = o.alpha ?? 1; if (o.blur) c.filter = `blur(${o.blur * S.dpx}px)`; if (o.mode) c.globalCompositeOperation = o.mode;
  c.drawImage(item.cv, 0, 0); c.restore();
  item.busy = false;
}
// Line-art group for boards: everything drawn by fn becomes white line art with hidden lines removed.
export function lineArt(c, fn, o = {}) {
  layer(c, lc => withStyle({ mode: 'line', lineColor: o.color ?? '#ffffff', lineW: o.width ?? S.lineW }, () => fn(lc)), { alpha: o.alpha ?? 1 });
}

// ---------------------------------------------------------------- text
let fontReady = false;
export const FONT = 'InkDisplay';
export function initFont() {
  if (fontReady) return; fontReady = true;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'LilitaOne-Regular.ttf');
  if (fs.existsSync(file)) GlobalFonts.registerFromPath(file, FONT);
}
// Display lettering: fat rounded capitals, white (or a flat colour) with a thick ink outline and a hard
// offset shadow. Never use thin or small type; never run subtitles along the bottom.
//   size (scene units), fill, stroke, sw (outline width), rotate (deg), skew, align, shadow [dx, dy, colour]
export function label(c, str, x, y, o = {}) {
  initFont();
  const size = o.size ?? 72, lines = String(str).split('\n'), lh = size * (o.leading ?? 1.02);
  c.save(); c.translate(x, y); if (o.rotate) c.rotate(rad(o.rotate)); if (o.skew) c.transform(1, 0, -o.skew, 1, 0, 0);
  c.font = `${size}px ${FONT}, "Arial Black", sans-serif`; c.textAlign = o.align ?? 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  const line = S.mode === 'line';
  const fill = line ? S.lineColor : (o.fill ?? '#ffffff'), ink = o.stroke ?? S.ink, sw = o.sw ?? size * 0.2;
  let maxW = 0;
  lines.forEach((s, i) => {
    const yy = (i - (lines.length - 1) / 2) * lh; maxW = Math.max(maxW, c.measureText(s).width);
    if (S.mode === 'shadow') return;
    if (!line && o.shadow !== false && sw > 0) { const sh = o.shadow ?? [size * 0.06, size * 0.09, ink]; c.strokeStyle = sh[2]; c.fillStyle = sh[2]; c.lineWidth = sw; c.strokeText(s, sh[0], yy + sh[1]); c.fillText(s, sh[0], yy + sh[1]); }
    if (!line && sw > 0) { c.strokeStyle = ink; c.lineWidth = sw; c.strokeText(s, 0, yy); }
    c.fillStyle = fill; c.fillText(s, 0, yy);
  });
  const ax = (o.align ?? 'center') === 'center' ? -maxW / 2 : (o.align === 'right' ? -maxW : 0), hh = lines.length * lh / 2;
  const cs = [toFrame(c, ax, -hh), toFrame(c, ax + maxW, -hh), toFrame(c, ax + maxW, hh), toFrame(c, ax, hh)];
  if (!o.decor && !S.transient) REG.labels.push({ text: String(str), px: size * sc(c) / S.dpx, box: [Math.min(...cs.map(p => p[0])), Math.min(...cs.map(p => p[1])), Math.max(...cs.map(p => p[0])), Math.max(...cs.map(p => p[1]))] });
  c.restore();
}
// Hand-lettered writing for notes, chalk and signs: the same font, thinner, no outline, slightly uneven.
export function scrawl(c, str, x, y, o = {}) {
  initFont();
  const size = o.size ?? 44, r = rng(o.seed ?? str.length + 3);
  c.save(); c.translate(x, y); if (o.rotate) c.rotate(rad(o.rotate));
  c.font = `${size}px ${FONT}, sans-serif`; c.textBaseline = 'middle'; c.fillStyle = S.mode === 'line' ? S.lineColor : (o.fill ?? S.ink);
  const total = c.measureText(str).width; let cx = (o.align ?? 'center') === 'center' ? -total / 2 : (o.align === 'right' ? -total : 0);
  c.textAlign = 'left';
  for (const ch of String(str)) { const w = c.measureText(ch).width; c.save(); c.translate(cx, (r() - 0.5) * size * 0.1); c.rotate((r() - 0.5) * 0.09); c.fillText(ch, 0, 0); c.restore(); cx += w; }
  if (!o.decor && !S.transient) { const a = toFrame(c, -total / 2, -size / 2), b = toFrame(c, total / 2, size / 2); REG.labels.push({ text: String(str), px: size * sc(c) / S.dpx, box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], scrawl: true }); }
  c.restore();
}
