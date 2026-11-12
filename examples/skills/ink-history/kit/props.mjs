// props.mjs — a starter shelf of objects, each built the way you should build your own:
// one or two cel() shapes for the mass, a rim on the lit side, a few thinner ink lines for construction.
// A prop is drawn at (x, y) with size s (1 = natural size next to a standing figure about 600 units tall).
// When a character holds something, draw it from the arm's `hold` callback so the fingers wrap over it.
import { S, TAU, rad, lerp, rng, lineFor, cel, stroke, brush, paint, solid, blob, curve, poly, circle, oval, tube, shadeOf, lightOf, label, scrawl, lw, Path2D } from './ink.mjs';
import { pop } from './motion.mjs';
import { PathOp } from '@napi-rs/canvas';

const at = (c, x, y, s, rot, fn) => { c.save(); c.translate(x, y); c.rotate(rad(rot ?? 0)); c.scale(s, s); fn(); c.restore(); };
const L = (o, s = 1, d = 6) => o.line ?? lineFor(d, s);

// ------------------------------------------------------------------ paper things
export function paper(c, x, y, s = 1, o = {}) {       // a sheet or notice; o.lines scribbles text rows, o.title a heading, o.seal a wax seal
  at(c, x, y, s, o.rot, () => {
    const w = o.w ?? 170, h = o.h ?? 220;
    cel(c, blob([[-w / 2, -h / 2, 1], [w / 2 - 26, -h / 2 - 6, 1], [w / 2, -h / 2 + 24, 1], [w / 2 - 6, h / 2, 1], [-w / 2 + 4, h / 2 - 5, 1]]), { fill: o.fill ?? '#f6ecd0', depth: 0.03, line: L(o, s) });
    if (S.mode === 'full') paint(c, poly([[w / 2 - 26, -h / 2 - 6], [w / 2 - 24, -h / 2 + 22], [w / 2, -h / 2 + 24]]), shadeOf(o.fill ?? '#f6ecd0', 0.6));
    if (o.title) label(c, o.title, -4, -h / 2 + 38, { size: o.titleSize ?? 30, fill: S.ink, sw: 0, shadow: false, decor: true });
    const n = o.lines ?? 5, y0 = -h / 2 + (o.title ? 72 : 36);
    for (let i = 0; i < n; i++) stroke(c, curve([[-w / 2 + 22, y0 + i * 26], [0, y0 + i * 26 - 3], [w / 2 - 28 - (i % 3) * 16, y0 + i * 26]]), lineFor(4, s), S.mode === 'full' ? '#8a7a62' : undefined);
    if (o.seal) cel(c, circle(w / 2 - 40, h / 2 - 40, 22), { fill: o.seal === true ? '#b8262c' : o.seal, depth: 0.15, line: lineFor(4, s) });
  });
}
export function scroll(c, x, y, s = 1, o = {}) {      // an unrolled proclamation
  at(c, x, y, s, o.rot, () => {
    const w = o.w ?? 260, h = o.h ?? 330, f = o.fill ?? '#f1e2b6';
    cel(c, blob([[-w / 2, -h / 2 + 20, 1], [w / 2, -h / 2 + 20, 1], [w / 2 - 8, h / 2 - 20, 1], [-w / 2 + 8, h / 2 - 20, 1]]), { fill: f, depth: 0.03, line: L(o, s) });
    for (const yy of [-h / 2 + 12, h / 2 - 12]) cel(c, tube([[-w / 2 - 18, yy], [w / 2 + 18, yy]], 40, 40), { fill: f, shade: shadeOf(f, 0.7), depth: 0.3, line: L(o, s) });
    if (o.title) label(c, o.title, 0, -h / 2 + 76, { size: o.titleSize ?? 40, fill: S.ink, sw: 0, shadow: false, decor: true });
    for (let i = 0; i < (o.lines ?? 5); i++) stroke(c, curve([[-w / 2 + 34, -h / 2 + 124 + i * 32], [0, -h / 2 + 120 + i * 32], [w / 2 - 34 - (i % 2) * 30, -h / 2 + 124 + i * 32]]), lineFor(4, s), S.mode === 'full' ? '#8a7a62' : undefined);
    if (o.seal) cel(c, circle(0, h / 2 - 62, 26), { fill: '#b8262c', depth: 0.15, line: lineFor(4, s) });
  });
}
export function sign(c, x, y, s = 1, o = {}) {        // a board on a post; text may have line breaks
  at(c, x, y, s, o.rot, () => {
    const w = o.w ?? 360, h = o.h ?? 170, f = o.fill ?? '#c79a5e';
    if (o.post !== false) cel(c, poly([[-16, -20], [16, -20], [14, o.postH ?? 300], [-14, o.postH ?? 300]]), { fill: shadeOf(f, 0.5), depth: 0.2, line: L(o, s) });
    cel(c, blob([[-w / 2, -h - 10, 1], [w / 2, -h - 22, 1], [w / 2 + 8, -8, 1], [-w / 2 + 6, 0, 1]]), { fill: f, depth: 0.04, rim: lineFor(5, s), line: L(o, s) });
    if (o.text) label(c, o.text, 2, -h / 2 - 10, { size: o.size ?? 54, fill: o.textFill ?? S.ink, sw: 0, shadow: false, rotate: -2, decor: o.decor });
  });
}
// A cloth banner or flag that ripples. bands: colours top to bottom; t animates the wave.
export function flag(c, x, y, s = 1, o = {}) {
  at(c, x, y, s, o.rot, () => {
    const w = o.w ?? 300, h = o.h ?? 190, t = o.t ?? 0, bands = o.bands ?? ['#d42a1e', '#f4f0e6'], wave = o.wave ?? 12, pole = o.pole ?? 420;
    if (o.pole !== false) cel(c, tube([[0, pole], [0, -h - 30]], 16, 14), { fill: o.poleColor ?? '#8a6a40', depth: 0.25, line: L(o, s) });
    const edge = (yy, k) => Array.from({ length: 7 }, (_, i) => [i * w / 6, yy + Math.sin(i * 1.1 + t * 5 + k) * wave * (i / 6)]);
    const topE = edge(-h, 0), botE = edge(0, 0.6), shape = blob([...topE.map((p, i) => i === 0 || i === 6 ? [p[0], p[1], 1] : p), ...botE.reverse().map((p, i) => i === 0 || i === 6 ? [p[0], p[1], 1] : p)]);
    cel(c, shape, { fill: bands[0], depth: 0.05, rim: lineFor(5, s), line: L(o, s), inner: cc => { bands.forEach((col, i) => { if (!i) return; paint(cc, poly([[-20, -h + i * h / bands.length - wave], [w + 20, -h + i * h / bands.length + wave * 0.4], [w + 20, 60], [-20, 60]]), col); }); o.inside?.(cc, w, h); for (const u of [0.3, 0.62]) brush(cc, [[w * u, -h - 20], [w * u + 14, -h / 2], [w * u - 6, 20]], [0, 16, 16, 0], '#00000022'); } });
  });
}

// ------------------------------------------------------------------ containers and goods
export function bucket(c, x, y, s = 1, o = {}) {      // an oak pail: staves, two iron hoops, a rope handle. (x, y) is the middle of its base
  at(c, x, y, s, o.rot, () => {
    const f = o.fill ?? '#b47c3e', hoop = o.hoop ?? '#6a6e78', tw = 76, bw = 58, h = 134, ry = 17, top = -h, line = L(o, s);
    if (o.handle !== false) { const hp = curve([[-tw + 10, top + 4], [-tw + 2, top - 70], [0, top - 104], [tw - 2, top - 70], [tw - 10, top + 4]]); stroke(c, hp, line * 2.3); stroke(c, hp, line * 1.0, o.rope ?? '#cfa868'); }
    cel(c, oval(0, top, tw, ry), { fill: shadeOf(f, 1.15), flat: true, line });                       // the dark inside
    if (o.water) paint(c, oval(0, top + 5, tw - 10, ry - 7), '#6fb2d6');
    const body = blob([[-tw, top, 1], [-tw * 0.55, top + ry * 0.86], [0, top + ry], [tw * 0.55, top + ry * 0.86], [tw, top, 1], [bw, -6], [bw * 0.5, 8], [0, 12], [-bw * 0.5, 8], [-bw, -6]]);
    cel(c, body, { fill: f, depth: 0.09, rim: lineFor(6, s), line, inner: cc => {
      for (const u of [-0.62, -0.25, 0.12, 0.5]) stroke(cc, curve([[u * tw * 1.05, top + ry * (1 - u * u)], [u * bw * 1.02, 12]]), lineFor(3.5, s), shadeOf(f, 0.8));      // staves
      for (const v of [0.2, 0.7]) {                                                                   // hoops follow the curve of the rim
        const yy = top + h * v, hw = lerp(tw, bw, v) + 8, band = blob([[-hw, yy - 9, 1], [0, yy + ry * 0.9 - 9], [hw, yy - 9, 1], [hw, yy + 11, 1], [0, yy + ry * 0.9 + 11], [-hw, yy + 11, 1]]);
        paint(cc, band, hoop); stroke(cc, band, lineFor(3.5, s));
        if (S.mode === 'full') stroke(cc, curve([[-hw * 0.2, yy + ry * 0.84 - 4], [hw * 0.25, yy + ry * 0.74 - 4]]), lineFor(3, s), lightOf(hoop, 0.6, '#ffffff'));
      }
    } });
  });
}
export function barrel(c, x, y, s = 1, o = {}) {
  at(c, x, y, s, o.rot, () => {
    const f = o.fill ?? '#9a6a3a';
    cel(c, blob([[-70, -200, 1], [70, -200, 1], [92, -100], [70, 0, 1], [-70, 0, 1], [-92, -100]]), { fill: f, depth: 0.08, rim: lineFor(6, s), line: L(o, s), inner: cc => { for (const u of [-0.5, 0, 0.5]) stroke(cc, curve([[u * 120, -200], [u * 160, -100], [u * 120, 0]]), lineFor(3, s), shadeOf(f, 0.6)); for (const yy of [-170, -110, -40]) paint(cc, poly([[-100, yy], [100, yy], [100, yy + 14], [-100, yy + 14]]), '#4f4a52'); } });
    cel(c, oval(0, -200, 70, 15), { fill: lightOf(f, 0.2), flat: true, line: L(o, s) });
  });
}
export function crate(c, x, y, s = 1, o = {}) {
  at(c, x, y, s, o.rot, () => {
    const f = o.fill ?? '#b08a52', w = o.w ?? 190, h = o.h ?? 150;
    cel(c, poly([[-w / 2, -h], [w / 2, -h], [w / 2, 0], [-w / 2, 0]]), { fill: f, depth: 0.05, rim: lineFor(5, s), line: L(o, s), inner: cc => { for (let i = 1; i < 4; i++) stroke(cc, poly([[-w / 2, -h + i * h / 4], [w / 2, -h + i * h / 4]], false), lineFor(3, s), shadeOf(f, 0.6)); paint(cc, poly([[-w / 2, -h], [-w / 2 + 22, -h], [w / 2, -12], [w / 2, 0], [w / 2 - 22, 0], [-w / 2, -h + 12]]), shadeOf(f, 0.35)); } });
    if (o.text) label(c, o.text, 0, -h / 2, { size: o.size ?? 36, fill: S.ink, sw: 0, shadow: false, decor: true });
  });
}
export function sack(c, x, y, s = 1, o = {}) {        // a tied bag: grain, flour, money (o.mark draws a symbol)
  at(c, x, y, s, o.rot, () => {
    const f = o.fill ?? '#c8a86a';
    cel(c, blob([[-20, -150, 1], [0, -168], [22, -150, 1], [16, -128], [70, -70], [78, -10], [0, 8], [-78, -10], [-70, -70], [-16, -128]]), { fill: f, depth: 0.08, rim: lineFor(5, s), line: L(o, s) });
    stroke(c, curve([[-18, -130], [0, -124], [18, -130]]), lineFor(6, s), '#6a4a2a');
    if (o.mark) label(c, o.mark, 0, -52, { size: 64, fill: o.markFill ?? '#3f7a2e', sw: 0, shadow: false, decor: true });
  });
}
export function coins(c, x, y, s = 1, o = {}) {       // a little stack or scatter of gold
  at(c, x, y, s, o.rot, () => { const n = o.n ?? 5; for (let i = 0; i < n; i++) { const cx = (i % 3 - 1) * 46, cy = -Math.floor(i / 3) * 22; cel(c, oval(cx, cy, 30, 12), { fill: '#b8862a', flat: true, line: lineFor(4, s) }); cel(c, oval(cx, cy - 9, 30, 12), { fill: o.fill ?? '#f2c838', flat: true, line: lineFor(4, s) }); } });
}

// ------------------------------------------------------------------ tools and furniture
export function spear(c, x, y, s = 1, o = {}) {       // also pikes, halberds, flagstaffs (o.len); o.head 'spear' | 'axe' | 'none'
  at(c, x, y, s, o.rot, () => {
    const len = o.len ?? 620;
    cel(c, tube([[0, 60], [0, -len]], 15, 13), { fill: o.shaft ?? '#8a6a40', depth: 0.25, line: L(o, s, 5) });
    if ((o.head ?? 'spear') === 'spear') cel(c, blob([[-20, -len + 8, 1], [0, -len - 86, 1], [20, -len + 8, 1], [0, -len + 26]]), { fill: '#c9ccd2', depth: 0.18, rim: lineFor(4, s), line: L(o, s, 5) });
    if (o.head === 'axe') cel(c, blob([[6, -len + 10, 1], [70, -len - 30], [86, -len + 50], [6, -len + 90, 1]]), { fill: '#c9ccd2', depth: 0.14, rim: lineFor(4, s), line: L(o, s, 5) });
  });
}
export function sword(c, x, y, s = 1, o = {}) {
  at(c, x, y, s, o.rot, () => {
    cel(c, blob([[-13, -30, 1], [-11, -250], [0, -290, 1], [11, -250], [13, -30, 1]]), { fill: '#d5d8de', depth: 0.2, rim: lineFor(4, s), line: L(o, s, 5) });
    cel(c, tube([[-46, -28], [46, -28]], 18, 18), { fill: o.hilt ?? '#d9a630', depth: 0.25, line: L(o, s, 5) });
    cel(c, tube([[0, -20], [0, 40]], 20, 18), { fill: '#6a3a2a', depth: 0.25, line: L(o, s, 5) });
  });
}
export function table(c, x, y, s = 1, o = {}) {       // a heavy table seen slightly from above; y is the floor line
  at(c, x, y, s, o.rot, () => {
    const w = o.w ?? 620, h = o.h ?? 230, f = o.fill ?? '#8a5a34', d = o.depth ?? 70;
    for (const u of [-0.42, 0.42]) cel(c, poly([[u * w - 22, -h + 10], [u * w + 22, -h + 10], [u * w + 18, 0], [u * w - 18, 0]]), { fill: shadeOf(f, 0.5), depth: 0.2, line: L(o, s) });
    cel(c, poly([[-w / 2, -h], [w / 2, -h], [w / 2, -h + 36], [-w / 2, -h + 36]]), { fill: shadeOf(f, 0.3), depth: 0.05, line: L(o, s) });
    cel(c, poly([[-w / 2 + d * 0.5, -h - d], [w / 2 - d * 0.5, -h - d], [w / 2, -h], [-w / 2, -h]]), { fill: f, depth: 0.04, rim: lineFor(5, s), line: L(o, s), inner: cc => { for (const u of [0.3, 0.6]) brush(cc, [[-w / 2, -h - d * u], [0, -h - d * u - 5], [w / 2, -h - d * u]], [0, lineFor(4, s), 0], shadeOf(f, 0.5)); } });
  });
}
export function candle(c, x, y, s = 1, o = {}) {      // lit candle with its small glow
  at(c, x, y, s, 0, () => {
    cel(c, poly([[-12, -80], [12, -80], [12, 0], [-12, 0]]), { fill: '#f3ead2', depth: 0.2, line: lineFor(4, s) });
    cel(c, blob([[0, -126, 1], [12, -98], [0, -84], [-12, -98]]), { fill: '#ffd24a', flat: true, line: lineFor(3, s) });
    if (S.mode === 'full') { const g = c.createRadialGradient(0, -100, 0, 0, -100, 200); g.addColorStop(0, '#ffe9a0aa'); g.addColorStop(1, '#ffe9a000'); c.save(); c.globalCompositeOperation = 'screen'; c.fillStyle = g; c.fillRect(-200, -300, 400, 400); c.restore(); }
  });
}

// ------------------------------------------------------------------ comic punctuation
// Speech or thought balloon. fn(c) draws the content centred on (0,0); `tail` points at the speaker.
export function bubble(c, x, y, o = {}, fn) {
  const w = o.w ?? 280, h = o.h ?? 190, k = o.scale ?? 1, tail = o.tail ?? [-90, 150];
  c.save(); c.translate(x, y); c.scale(k, k);
  let p = oval(0, 0, w / 2, h / 2); p = p.op(blob([[tail[0] * 0.25 - 30, tail[1] * 0.3, 1], [tail[0], tail[1], 1], [tail[0] * 0.25 + 34, tail[1] * 0.22, 1]]), PathOp.Union);
  cel(c, p, { fill: o.fill ?? '#ffffff', depth: 0.03, shrink: 0.97, line: o.line ?? 7 });
  if (o.text) label(c, o.text, 0, 0, { size: o.size ?? 60, fill: o.textFill ?? S.ink, sw: 0, shadow: false });
  fn?.(c); c.restore();
}
export function burst(c, x, y, r = 120, o = {}) {     // spiky impact flash behind a hit, a shout, a reveal
  const n = o.points ?? 11, rr = rng(o.seed ?? 3), pts = Array.from({ length: n * 2 }, (_, i) => { const a = i * Math.PI / n + (o.rot ?? 0), q = i % 2 ? r * (0.5 + rr() * 0.12) : r * (0.9 + rr() * 0.25); return [x + Math.cos(a) * q, y + Math.sin(a) * q]; });
  cel(c, poly(pts), { fill: o.fill ?? '#ffe14a', flat: true, line: o.line ?? 6 });
}
export function puff(c, x, y, r = 60, o = {}) {       // dust or smoke: grows with age (0..1) and thins out
  const age = o.age ?? 0, rr = rng(o.seed ?? 5); let p = circle(x, y, r * (0.7 + age * 0.5));
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; p = p.op(circle(x + Math.cos(a) * r * (0.6 + age), y + Math.sin(a) * r * (0.45 + age * 0.6), r * (0.4 + rr() * 0.3)), PathOp.Union); }
  c.save(); c.globalAlpha = 1 - age * 0.9; cel(c, p, { fill: o.fill ?? '#e9dfc8', depth: 0.14, line: o.line ?? 5 }); c.restore();
}
export function sparkle(c, x, y, r = 30, o = {}) {    // four-point glint
  cel(c, blob([[x, y - r, 1], [x + r * 0.2, y - r * 0.2], [x + r, y, 1], [x + r * 0.2, y + r * 0.2], [x, y + r, 1], [x - r * 0.2, y + r * 0.2], [x - r, y, 1], [x - r * 0.2, y - r * 0.2]]), { fill: o.fill ?? '#fff6b0', flat: true, line: o.line ?? 4 });
}
export function speedLines(c, x, y, o = {}) {         // streaks behind something fast; dir in degrees
  const n = o.n ?? 5, len = o.len ?? 260, a = rad(o.dir ?? 180);
  for (let i = 0; i < n; i++) { const off = (i - (n - 1) / 2) * (o.gap ?? 34), sx = x - Math.sin(a) * off, sy = y + Math.cos(a) * off, l = len * (0.6 + ((i * 37) % 10) / 20); brush(c, [[sx, sy], [sx + Math.cos(a) * l, sy + Math.sin(a) * l]], [o.w ?? 9, 0], o.color); }
}
// A fat outlined arrow from a to b (maps, boards, "this goes there"). bend curves it sideways.
export function arrow(c, a, b, o = {}) {
  const w = o.w ?? 34, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux, head = o.head ?? w * 1.5, bend = (o.bend ?? 0) * len;
  const mid = [(a[0] + b[0]) / 2 + nx * bend, (a[1] + b[1]) / 2 + ny * bend], neck = [b[0] - ux * head, b[1] - uy * head];
  let p = tube([a, mid, neck], w, w); p = p.op(poly([[neck[0] + nx * w * 1.25, neck[1] + ny * w * 1.25], b, [neck[0] - nx * w * 1.25, neck[1] - ny * w * 1.25]]), PathOp.Union);
  cel(c, p, { fill: o.fill ?? '#d42a1e', depth: 0.06, line: o.line ?? 6 });
}
// Pop-in wrapper: scale something up from a point with overshoot, starting at time `at`.
export function popIn(c, t, at, x, y, fn, dur = 0.22) {
  const k = pop(t, at, dur); if (k <= 0) return;
  const moving = Math.abs(k - 1) > 0.03, was = S.transient; if (moving) S.transient = true;     // lettering is not measured mid-pop
  c.save(); c.translate(x, y); c.scale(k, k); c.translate(-x, -y); try { fn(); } finally { c.restore(); S.transient = was; }
}
