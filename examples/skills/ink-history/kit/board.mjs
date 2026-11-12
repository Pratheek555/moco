// board.mjs — the two explanation inserts of the format: the blueprint board and the map.
//
// BLUEPRINT BOARD. When the narrator explains HOW something happened, the film cuts to a sheet of blue
// paper lying on a wooden desk, a fat pencil and an eraser at the corners, and the event is acted out
// by the story's own characters as thick white line drawings. They are cartoons, not icons: the same
// heads, hats and moustaches as the colour scenes, drawn with one even white line, moving as cut-outs
// (slide in, swap pose, pop, cross-fade to the next drawing). No boxes-and-arrows diagrams.
//
// MAP. When the narrator explains WHERE, the film cuts to a map: mottled blue sea, parchment land with
// a dot pattern, the countries that matter in flat saturated colour with a contrasting border, and the
// countries themselves act (they get faces, they shove, small figures stand on them, things pop in).
import {
  S, W, H, TAU, clamp, lerp, rad, rng, noise1, cel, stroke, brush, paint, solid, blob, curve, poly, circle, oval, linear,
  shadeOf, lightOf, mix, alpha, label, lineArt, layer, withStyle, Path2D,
} from './ink.mjs';
import { planks, rectQuad } from './sets.mjs';

// ------------------------------------------------------------------ blueprint board
// boardSet(c, o): paint the desk, paper, pencil and eraser. Use it as a shot's `set`.
//   paper: paper colour, tilt: degrees the sheet is turned, title: a short date/place line at top right.
export function boardSet(c, o = {}) {
  const col = o.paper ?? '#4f81c7', tilt = o.tilt ?? 2.4;
  planks(c, rectQuad(-240, -240, W + 480, H + 480), { n: 9, fill: o.desk ?? '#8a6238', grain: 3, knots: 0.5, gap: 6, line: 0, seed: 21 });
  c.save(); c.translate(W / 2, H / 2); c.rotate(rad(tilt)); c.translate(-W / 2, -H / 2);
  const sheet = poly([[-300, 18], [W + 300, 18], [W + 300, H - 62], [-300, H - 62]]);
  c.save(); c.shadowColor = '#00000066'; c.shadowBlur = 26 * S.dpx; c.shadowOffsetY = 12 * S.dpx; c.fillStyle = col; c.fill(sheet); c.restore();
  c.save(); c.clip(sheet);                       // soft pigment mottle: large pale and dark clouds, never grain
  const r = rng(o.seed ?? 4);
  for (let i = 0; i < 26; i++) { const x = r() * W, y = r() * H, rr = 160 + r() * 320, g = c.createRadialGradient(x, y, 0, x, y, rr), tone = r() < 0.5 ? '#ffffff' : '#0a2a6a'; g.addColorStop(0, alpha(tone, 0.07)); g.addColorStop(1, alpha(tone, 0)); c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  c.restore();
  stroke(c, sheet, 7);
  if (o.title) label(c, o.title, W - 130, 104, { size: o.titleSize ?? 50, align: 'right', fill: '#ffffff', sw: 0, shadow: false });
  c.restore();
  if (o.pencil !== false) pencil(c, 70, 190, o.pencilColor ?? '#b8362c');
  if (o.eraser !== false) eraser(c, 1800, 780);
}
function pencil(c, x, y, col) {
  c.save(); c.translate(x, y); c.rotate(rad(-52)); c.scale(1.5, 1.5);
  c.save(); c.globalAlpha = 0.3; c.fillStyle = '#0a1430'; c.fillRect(-330, 2, 420, 64); c.restore();
  cel(c, poly([[-340, -32], [60, -32], [60, 32], [-340, 32]]), { fill: col, depth: 0.2, line: 7, inner: cc => { paint(cc, poly([[-340, -10], [60, -10], [60, 6], [-340, 6]]), shadeOf(col, 0.5)); } });
  cel(c, poly([[60, -32], [130, 0], [60, 32]]), { fill: '#e6c79a', depth: 0.2, line: 7 });
  solid(c, poly([[108, -10], [134, 0], [108, 10]]));
  c.restore();
}
function eraser(c, x, y) {
  c.save(); c.translate(x, y); c.rotate(rad(-16));
  c.save(); c.globalAlpha = 0.3; c.fillStyle = '#0a1430'; c.fillRect(-36, -120, 96, 260); c.restore();
  cel(c, blob([[-40, -100, 1], [10, -138, 1], [48, -108, 1], [50, 118, 1], [-38, 126, 1]]), { fill: '#eeeceb', depth: 0.08, line: 7, inner: cc => paint(cc, poly([[-40, -100], [10, -138], [48, -108], [8, -74]]), '#ffffff') });
  c.restore();
}
// sketch(c, fn, o): draw white line art on the board. Inside fn, use the normal kit calls (figure, props,
// stroke, cel, label, your own blobs): they come out as even white lines with hidden lines removed.
//   alpha fades the whole drawing (cross-fade two sketches by giving one alpha u and the other 1 - u);
//   width is the line thickness; tilt should match the board's tilt.
export function sketch(c, fn, o = {}) {
  c.save(); c.translate(W / 2, H / 2); c.rotate(rad(o.tilt ?? 2.4)); c.translate(-W / 2, -H / 2);
  c.clip(poly([[-300, 22], [W + 300, 22], [W + 300, H - 66], [-300, H - 66]]));          // drawings stop at the edge of the sheet
  lineArt(c, fn, { alpha: o.alpha ?? 1, width: o.width ?? 11, color: o.color ?? '#ffffff' });
  c.restore();
}

// ------------------------------------------------------------------ maps
// coast(points, o): turn a rough outline of 6-20 points into a wandering coastline or border.
// The same seed always gives the same shape, so a country keeps its outline between shots.
export function coast(pts, o = {}) {
  const r = rng(o.seed ?? 7), rough = o.rough ?? 0.16, depth = o.detail ?? 3;
  let cur = pts.map(p => [p[0], p[1]]);
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = (r() - 0.5) * 2 * rough * len;
      next.push(a, [(a[0] + b[0]) / 2 - (b[1] - a[1]) / len * k, (a[1] + b[1]) / 2 + (b[0] - a[0]) / len * k]);
    }
    cur = next;
  }
  return blob(cur, 0.6);
}
// sea(c, o): mottled blue water filling the frame.
export function sea(c, o = {}) {
  const col = o.color ?? '#4a68d0';
  c.fillStyle = col; c.fillRect(-240, -240, W + 480, H + 480);
  const r = rng(o.seed ?? 3);
  for (let i = 0; i < 34; i++) { const x = r() * W, y = r() * H, rr = 120 + r() * 300, g = c.createRadialGradient(x, y, 0, x, y, rr), tone = r() < 0.55 ? '#9ab4ff' : '#1a2a8a'; g.addColorStop(0, alpha(tone, 0.16)); g.addColorStop(1, alpha(tone, 0)); c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
}
// land(c, shape, o): neutral country: parchment with a dot pattern, a pale shore line and a dark edge.
export function land(c, shape, o = {}) {
  const fill = o.fill ?? '#c9a85e';
  if (o.shore !== false) { c.save(); c.strokeStyle = alpha(o.shoreColor ?? '#cfe0ff', 0.55); c.lineWidth = o.shore ?? 22; c.lineJoin = 'round'; c.stroke(shape); c.restore(); }
  cel(c, shape, { fill, flat: true, line: o.line ?? 6, ink: o.ink ?? '#6a5220', inner: cc => {
    if (o.dots !== false) { cc.fillStyle = o.dotColor ?? '#8fae6a'; const step = o.step ?? 22; for (let y = -240; y < H + 240; y += step) for (let x = -240 + ((y / step) % 2) * step / 2; x < W + 240; x += step) { cc.beginPath(); cc.arc(x, y, step * 0.17, 0, TAU); cc.fill(); } }
  } });
}
// region(c, shape, o): a country that matters: flat saturated colour, a contrasting border.
export function region(c, shape, o = {}) {
  const fill = o.fill ?? '#d42a1e';
  cel(c, shape, { fill, flat: true, line: 0, inner: cc => { cc.strokeStyle = o.inner ?? shadeOf(fill, 0.5); cc.lineWidth = o.innerW ?? 26; cc.lineJoin = 'round'; cc.stroke(shape); } });
  c.save(); c.strokeStyle = o.border ?? shadeOf(fill, 0.9); c.lineWidth = o.borderW ?? 8; c.lineJoin = 'round'; c.stroke(shape); c.restore();
}
// mapFace(c, x, y, s, o): a face drawn straight onto a country so that it can react.
//   mood: 'angry' | 'smug' | 'scared' | 'sad' | 'happy' | 'asleep'
export function mapFace(c, x, y, s = 1, o = {}) {
  const mood = o.mood ?? 'angry', w = 9 * s;
  c.save(); c.translate(x, y); c.scale(o.flip ? -1 : 1, 1);
  const eye = (ex, tilt) => {
    if (mood === 'asleep' || mood === 'happy') { brush(c, [[ex - 26 * s, -4 * s], [ex, (mood === 'happy' ? -18 : 10) * s], [ex + 26 * s, -4 * s]], [w * 0.6, w, w * 0.6]); return; }
    if (mood === 'scared') { cel(c, oval(ex, 0, 22 * s, 26 * s), { fill: '#fff', flat: true, line: w * 0.7 }); solid(c, circle(ex, 0, 6 * s)); return; }
    const p = new Path2D(); p.ellipse(ex, 0, 24 * s, 20 * s, rad(tilt), 0, Math.PI); p.closePath(); cel(c, p, { fill: '#fff', flat: true, line: w * 0.7 }); solid(c, circle(ex + 4 * s, 8 * s, 6 * s));
    brush(c, [[ex - 34 * s * Math.cos(rad(tilt)), -34 * s * Math.sin(rad(tilt)) - 6 * s], [ex + 34 * s * Math.cos(rad(tilt)), 34 * s * Math.sin(rad(tilt)) - 6 * s]], [w * 1.3, w]);
  };
  const t = mood === 'angry' ? 22 : mood === 'sad' ? -20 : mood === 'smug' ? 6 : 0;
  eye(-46 * s, t); eye(46 * s, -t);
  if (mood === 'angry') cel(c, blob([[-34 * s, 58 * s, 1], [34 * s, 50 * s, 1], [28 * s, 86 * s], [-26 * s, 90 * s]]), { fill: '#fff', flat: true, line: w * 0.7 });
  else if (mood === 'scared') cel(c, oval(0, 70 * s, 20 * s, 28 * s), { fill: '#5a2530', flat: true, line: w * 0.7 });
  else if (mood === 'sad') brush(c, [[-30 * s, 78 * s], [0, 58 * s], [30 * s, 78 * s]], [w * 0.6, w, w * 0.6]);
  else brush(c, [[-32 * s, 56 * s], [0, (mood === 'smug' ? 70 : 82) * s], [32 * s, (mood === 'smug' ? 46 : 56) * s]], [w * 0.6, w, w * 0.6]);
  c.restore();
}
// A place name on a map: bold white capitals with an ink outline, optionally with a pin.
export function place(c, text, x, y, o = {}) {
  if (o.pin) { cel(c, blob([[x, y, 1], [x - 20, y - 44], [x, y - 76], [x + 20, y - 44]]), { fill: o.pinColor ?? '#e8322a', flat: true, line: 5 }); solid(c, circle(x, y - 48, 7)); }
  label(c, text, x + (o.dx ?? 0), y + (o.dy ?? (o.pin ? -110 : 0)), { size: o.size ?? 52, fill: o.fill ?? '#ffffff', sw: o.sw, rotate: o.rotate });
}
