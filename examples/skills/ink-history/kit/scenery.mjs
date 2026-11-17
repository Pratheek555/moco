// scenery.mjs — whole places, painted from the blocks in sets.mjs.
//
// Each function here is a finished set AND a worked example of how to paint one. Use them with your own
// options (time of day, colours, where the vanishing point sits), or copy one into your story and change
// the architecture. Do not shoot a whole film in one place: the look depends on moving between a street,
// a room, a field, a map, a board.
//
// The recipe is always the same, back to front:
//   1. sky or far wall, with the light source placed where the story's light comes from
//   2. far shapes, pale and veiled with the sky colour (haze)
//   3. the acting space: ground + the main architecture, in saturated colour, inked
//   4. one big shadow shape and one light shape laid over the whole thing
//   5. a dark, cropped foreground piece (optional, but it is what gives depth) and a vignette
import {
  W, H, S, TAU, rng, lerp, clamp, rad, cel, stroke, brush, paint, wash, glow, linear, blob, curve, poly, circle, oval,
  shadeOf, lightOf, mix, alpha, layer, label, Path2D, lineFor, withStyle,
} from './ink.mjs';
import * as st from './sets.mjs';
import { living, elementMotion, motionTime, lifeEnabled, unit } from './motion.mjs';

// ------------------------------------------------------------------ time of day
// A time of day is a sky, the colour of its light, and the colour of its air. Pass `time` to any place,
// and set the story's or shot's `light` / `tint` to match (see the table in SKILL.md).
export const TIME = {
  // land / dim: the colour the ground and buildings are pulled toward at this hour, and how far (0..1)
  day: { sky: ['#3f93dc', '#86c3ee', '#d9eff4'], glow: '#ffffff', glowAmt: 0.5, cloud: '#ffffff', cloudShade: '#bcd0e8', haze: '#cfe4f0', rim: '#fff6c0', land: '#2f4a1c', dim: 0.12 },
  dusk: { sky: ['#a9967e', '#e0cb98', '#fdf1b6', '#f9cf8e'], glow: '#fffbd2', glowAmt: 1, cloud: '#fbf2c4', cloudShade: '#e2c08c', haze: '#e9ad68', rim: '#f8a94e', land: '#4a2a10', dim: 0.5 },
  dawn: { sky: ['#6f7fc0', '#e2a6b0', '#ffd9a0'], glow: '#fff0c8', glowAmt: 0.9, cloud: '#ffd9c8', cloudShade: '#c890a8', haze: '#f0b6a0', rim: '#ffd27a', land: '#4a2c3a', dim: 0.4 },
  night: { sky: ['#0d1234', '#232a66', '#4a4488'], glow: '#aab8ff', glowAmt: 0.42, cloud: '#3d4284', cloudShade: '#23265a', haze: '#34366e', rim: '#93a6ff', land: '#10122e', dim: 0.72 },
  grey: { sky: ['#75808c', '#a3abae', '#d0cebd'], glow: '#ffffff', glowAmt: 0.3, cloud: '#c9cdcc', cloudShade: '#8f989e', haze: '#b9bdb6', rim: '#ecebdc', land: '#3a4038', dim: 0.3 },
};
export const timeOf = o => ({ ...(TIME[o?.time ?? 'dusk'] ?? TIME.dusk), ...(o?.palette ?? {}) });

// heavens(): sky gradient, the glow of the sun or moon, clouds. Returns the palette it used.
//   horizon (y of the horizon), sun [x, y], disc (radius of a visible sun/moon), clouds (count), stars
function draw_heavens(c, o = {}) {
  const p = timeOf(o), hz = o.horizon ?? 600, sun = o.sun ?? [1380, hz - 200], r = rng((o.seed ?? 5) + 1);
  st.sky(c, p.sky, { y0: -200, y1: hz + 60, sun: { x: sun[0], y: sun[1], r: o.sunR ?? 820, color: p.glow, strength: p.glowAmt, disc: o.disc, discColor: o.discColor ?? lightOf(p.glow, 0.5, '#ffffff') } });
  if (o.stars) {
    const stars = Array.from({length:110}, () => [-200+r()*(W+400), -200+r()*(hz+100), r()]);
    living(c, cc => { cc.save(); cc.fillStyle='#ffffff'; const t=motionTime(o);
      stars.forEach(([x,y,k],i) => { cc.globalAlpha=(0.35+k*0.6)*(lifeEnabled(o) ? 0.84+0.16*Math.sin(t*(1.1+k)+i) : 1); cc.beginPath(); cc.arc(x,y,1.6+k*2.6,0,TAU); cc.fill(); }); cc.restore();
    }, {...o,float:false,seed:`stars:${o.seed??5}`});
  }
  const n = o.clouds ?? 4;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.15 + r() * 0.7) / n * (W + 300) - 150, y = 70 + r() * Math.max(60, hz - 360), w = 380 + r() * 420, near = clamp(1 - Math.abs(x - sun[0]) / 1100);
    st.cloud(c, x, y, w, { color: mix(p.cloud, p.glow, near * 0.35), shade: p.cloudShade, seed: i * 7 + (o.seed ?? 5), lumps: 6 + Math.floor(r() * 4), soft: o.cloudSoft });
  }
  return p;
}
const roll = (y, amp, n, seed, x0 = -260, x1 = W + 260) => { const q = rng(seed); return Array.from({ length: n + 1 }, (_, i) => [x0 + i * (x1 - x0) / n, y + (q() - 0.5) * 2 * amp]); };

// ------------------------------------------------------------------ landmarks
// A walled town on the skyline: towers with battlements. `far` (0..1) veils it with the air colour.
export function town(c, x, y, s = 1, o = {}) {
  const col = o.color ?? '#b98a5a', f = mix(col, o.haze ?? '#eab676', o.far ?? 0.5), ink = mix(S.ink, o.haze ?? '#eab676', (o.far ?? 0.5) * 0.7), r = rng(o.seed ?? 8);
  const crenel = (x0, y0, w, h, n) => { const pts = [[x0, y0 + h], [x0, y0]], t = w / (n * 2 - 1); for (let i = 0; i < n * 2 - 1; i++) { const yy = i % 2 ? y0 + t * 0.7 : y0; pts.push([x0 + i * t, yy], [x0 + (i + 1) * t, yy]); } pts.push([x0 + w, y0 + h]); return poly(pts); };
  c.save(); c.translate(x, y); c.scale(s, s);
  for (const [tx, tw, th] of o.towers ?? [[-170, 44, 150], [-60, 58, 250], [40, 40, 130], [130, 62, 200], [230, 40, 110]]) {
    cel(c, crenel(tx - tw / 2, -th, tw, th, 3), { fill: f, shade: shadeOf(f, 0.5), depth: 0.12, line: lineFor(4, s), ink });
    for (let k = 0; k < 2; k++) paint(c, poly([[tx - 4, -th + 40 + k * 46], [tx + 4, -th + 40 + k * 46], [tx + 4, -th + 62 + k * 46], [tx - 4, -th + 62 + k * 46]]), ink);
  }
  cel(c, crenel(-300, -52, 600, 60, 17), { fill: lightOf(f, 0.12, '#ffffff'), shade: shadeOf(f, 0.4), depth: 0.2, line: lineFor(4, s), ink });
  for (let i = 0; i < 4; i++) { const hx = -230 + i * 130 + r() * 40; cel(c, poly([[hx, -52], [hx + 30, -84 - r() * 20], [hx + 66, -52]]), { fill: mix('#a8452e', o.haze ?? '#eab676', (o.far ?? 0.5) * 0.8), flat: true, line: lineFor(3, s), ink }); }
  if (o.smoke !== false && lifeEnabled(o)) living(c,cc=>{
    const t=motionTime(o);for(let i=0;i<3;i++){
      const a=(t*.4+i/3)%1;cc.save();cc.globalAlpha=.18*Math.sin(a*Math.PI);
      paint(cc,oval(38+Math.sin(t+i)*6,-145-a*80,9+a*13,14+a*15),mix(f,'#ffffff',.6));cc.restore();
    }
  },{...o,float:false,seed:`chimney:${x}:${y}`});
  c.restore();
}
// A cypress: the exclamation mark of an Italian hillside. Works for any tall dark conifer.
function draw_cypress(c, x, y, s = 1, o = {}) {
  const col = o.color ?? '#3f5a2a';
  c.save(); c.translate(x, y); c.scale(s, s);
  cel(c, blob([[0, -300, 1], [26, -200], [34, -90], [22, -8], [-22, -8], [-34, -90], [-26, -200]]), { fill: col, shade: shadeOf(col, 0.8), depth: 0.16, shrink: 0.9, rim: lineFor(5, s), rimColor: o.rim ?? lightOf(col, 0.45, '#f4f08a'), line: (o.line ?? 5) / s, ink: o.ink });
  paint(c, poly([[-6, -8], [6, -8], [6, 14], [-6, 14]]), shadeOf('#6a4a30', 0.5));
  c.restore();
}
// An arched gateway with a wooden double door, standing on y. Scale 1 is about 560 tall.
export function gate(c, x, y, s = 1, o = {}) {
  const stone = o.stone ?? '#a58c68', wood = o.wood ?? '#6f4a2c';
  c.save(); c.translate(x, y); c.scale(s, s);
  cel(c, blob([[-230, 0, 1], [-230, -380, 1], [-150, -520], [0, -580], [150, -520], [230, -380, 1], [230, 0, 1]]), { fill: stone, depth: 0.03, rim: lineFor(6, s), line: lineFor(7, s) });
  const door = blob([[-170, 0, 1], [-170, -350, 1], [-110, -455], [0, -500], [110, -455], [170, -350, 1], [170, 0, 1]]);
  if (o.open) { cel(c, door, { fill: o.beyond ?? '#1c1418', flat: true, line: lineFor(6, s) }); }
  else cel(c, door, { fill: wood, depth: 0.03, line: lineFor(6, s), inner: cc => { for (let i = -3; i <= 3; i++) stroke(cc, poly([[i * 48, -520], [i * 48, 0]], false), lineFor(4, s), shadeOf(wood, 0.7)); for (const yy of [-110, -330]) paint(cc, poly([[-180, yy], [180, yy], [180, yy + 26], [-180, yy + 26]]), '#3f3a40'); stroke(cc, poly([[0, -520], [0, 0]], false), lineFor(7, s)); } });
  for (let i = -3; i <= 3; i++) { const a = rad(-90 + i * 24), a2 = rad(-90 + i * 24 + 12); stroke(c, poly([[Math.cos(a2) * 172, -330 + Math.sin(a2) * 172], [Math.cos(a2) * 226, -340 + Math.sin(a2) * 232]], false), lineFor(4, s)); }
  c.restore();
}
// A round stone well with a winch post. The rim is at about y - 150*s; put a bucket there.
export function well(c, x, y, s = 1, o = {}) {
  const stone = o.stone ?? '#9c958c', wood = o.wood ?? '#7a5230';
  c.save(); c.translate(x, y); c.scale(s, s);
  for (const sx of [-130, 130]) cel(c, poly([[sx - 14, -150], [sx + 14, -150], [sx + 12, -420], [sx - 12, -420]]), { fill: wood, depth: 0.2, line: lineFor(6, s) });
  cel(c, poly([[-170, -420], [0, -500], [170, -420], [150, -400], [-150, -400]]), { fill: o.roof ?? '#a8452e', depth: 0.06, rim: lineFor(5, s), line: lineFor(6, s) });
  stroke(c, poly([[-130, -360], [130, -360]], false), lineFor(9, s), shadeOf(wood, 0.4));
  cel(c, blob([[-170, -150, 1], [170, -150, 1], [156, 0], [0, 16], [-156, 0]]), { fill: stone, depth: 0.06, rim: lineFor(6, s), line: lineFor(7, s), inner: cc => { for (let j = 0; j < 3; j++) { stroke(cc, curve([[-170, -105 + j * 50], [0, -92 + j * 50], [170, -105 + j * 50]]), lineFor(4, s), shadeOf(stone, 0.6)); for (let i = -3; i <= 3; i++) stroke(cc, poly([[i * 50 + (j % 2) * 25, -150 + j * 50], [i * 50 + (j % 2) * 25, -100 + j * 50]], false), lineFor(4, s), shadeOf(stone, 0.6)); } } });
  cel(c, oval(0, -150, 170, 34), { fill: lightOf(stone, 0.25, '#ffffff'), flat: true, line: lineFor(7, s) });
  cel(c, oval(0, -150, 124, 22), { fill: '#1c1820', flat: true, line: lineFor(5, s) });
  c.restore();
}

// ------------------------------------------------------------------ outdoors
// hills(): open country. A hazy far ridge (with a town if you like), a middle ridge with trees, and the
// ground the cast stands on. The acting ground is around y 780-900.
//   time, horizon, sun, ground (colour), town:{x, scale}|false, trees:'cypress'|'round'|false, path:true
function draw_hills(c, o = {}) {
  const hz = o.horizon ?? 600, p = heavens(c, { ...o, horizon: hz }), g = mix(o.ground ?? '#93a03a', p.land, p.dim), sd = o.seed ?? 3, r = rng(sd + 40);
  const inkFar = mix(S.ink, p.haze, 0.55);
  st.ridge(c, roll(hz - 36, 44, 7, sd + 11), mix(g, p.haze, 0.66), { flat: true, line: 4, ink: inkFar });
  if (o.town !== false) town(c, o.town?.x ?? 520, hz - 46, o.town?.scale ?? 0.9, { haze: p.haze, far: 0.5, seed: sd });
  st.ridge(c, roll(hz + 26, 30, 6, sd + 23), mix(g, p.haze, 0.36), { fill2: mix(shadeOf(g, 0.3), p.haze, 0.3), depth: 0.02, rim: 5, rimColor: lightOf(mix(g, p.haze, 0.36), 0.5, p.rim), line: 5, ink: mix(S.ink, p.haze, 0.3) });
  if (o.trees !== false) for (let i = 0; i < (o.treeCount ?? 6); i++) {
    const x = -100 + (i + r() * 0.8) * (W + 200) / (o.treeCount ?? 6), y = hz + 30 + r() * 26, s = 0.42 + r() * 0.22;
    if ((o.trees ?? 'cypress') === 'cypress') cypress(c, x, y, s, { color: mix(mix('#3f5a2a', p.land, p.dim), p.haze, 0.2), rim: p.rim, ink: mix(S.ink, p.haze, 0.2) }); else st.tree(c, x, y, s * 0.55, { leaf: mix(mix('#7d9a2e', p.land, p.dim), p.haze, 0.2), rim: p.rim, seed: i + sd });
  }
  st.haze(c, hz - 120, hz + 110, p.haze, 0.42);
  const near = roll(hz + 150, 22, 5, sd + 31);
  st.ridge(c, near, g, { fill2: shadeOf(g, 0.55), depth: 0.02, rim: 7, rimColor: lightOf(g, 0.55, p.rim), line: 6 });
  if (o.path !== false) { const px = o.pathX ?? 1050; cel(c, blob([[px - 30, hz + 150, 1], [px + 40, hz + 150, 1], [px + 260, 700], [px + 620, H + 240, 1], [px - 420, H + 240, 1], [px - 60, 700]]), { fill: o.pathColor ?? '#c9a86a', shade: shadeOf(o.pathColor ?? '#c9a86a', 0.5), depth: 0.02, line: 5 }); }
  c.save(); c.globalAlpha = 0.8; st.grass(c, -200, W + 200, hz + 190, { n: 16, h: 30, color: shadeOf(g, 0.5), seed: sd + 2 }); st.grass(c, -200, W + 200, 860, { n: 12, h: 44, color: shadeOf(g, 0.7), seed: sd + 5 }); c.restore();
  if (o.shadow !== false) st.castShadow(c, [[-260, hz + 130], [o.shadowTo ?? 760, hz + 150], [(o.shadowTo ?? 760) - 280, H + 240], [-260, H + 240]], { alpha: 0.34 });
  // a dark tree cropped by the frame edge: the foreground piece that gives the picture depth
  if (o.fg !== false) { const side = o.fgSide ?? -1, leaf = mix('#5d7a22', p.land, Math.min(1, p.dim + 0.25)); st.tree(c, side < 0 ? -40 : W + 40, H + 60, 2.3, { leaf, shade: shadeOf(leaf, 0.9), rim: mix(leaf, p.rim, 0.6), trunk: mix('#4a2f20', p.land, p.dim), seed: sd + 2 }); }
  glow(c, (o.sun ?? [1380, hz - 200])[0], hz - 40, 700, p.glow, 0.35 * p.glowAmt);
  st.vignette(c, { strength: o.vignette ?? 0.34 });
  return p;
}
// street(): a street running away to a vanishing point between two rows of houses, with a road or canal.
//   time, vp [x, y], colors (near row), farColors, water:true for a canal, towerAtEnd:true
function draw_street(c, o = {}) {
  const vp = o.vp ?? [1160, 600], p = heavens(c, { ...o, horizon: vp[1] + 20, sun: o.sun ?? [vp[0] + 220, vp[1] - 200] });
  if (o.towerAtEnd !== false) town(c, vp[0] + 10, vp[1] + 6, 0.5, { haze: p.haze, far: 0.4, towers: [[-40, 50, 250], [50, 40, 160]] });
  st.terrace(c, { vp, near: W + 580, base: vp[1] + 160, n: 4, height: 700, reach: 0.8, colors: o.farColors ?? ['#7a4a34', '#8b5a3c', '#6d4030'], haze: p.haze, hazeAmount: 0.5, seed: (o.seed ?? 0) + 12, line: 5, edge: 4, edgeColor: p.rim });
  st.terrace(c, { vp, near: -420, base: vp[1] + 200, n: 5, height: 900, reach: 0.9, colors: o.colors ?? ['#4d2f2a', '#643c30', '#75493a', '#573430'], haze: mix(p.haze, '#8a5a3a', 0.4), hazeAmount: 0.3, seed: (o.seed ?? 0) + 7, line: 6, edge: 5, edgeColor: mix(p.rim, '#e07a3a', 0.4), doors: true });
  const way = poly([[380, H + 240], vp, [1500, H + 240]]);
  if (o.water) {
    c.fillStyle=linear(c,0,vp[1],0,H,'#5f8f84','#27504f');c.fill(way);
    // Keep the original six painted perspective ripples. Shimmer supplements, never replaces them.
    for(let i=0;i<6;i++){const y=vp[1]+60+i*i*9;brush(c,[[vp[0]-180-i*50,y],[vp[0]-20,y+3],[vp[0]+140+i*40,y]],[0,4,0],'#bfe0c4');}
    st.water(c,way,{...o,vp,y0:vp[1],color:'#bfe0c4',n:9,alpha:.35});
  }
  else { c.fillStyle = linear(c, 0, vp[1], 0, H, mix(o.road ?? '#8f7a62', p.haze, 0.4), o.road ?? '#6b5a4a'); c.fill(way); for (let i = 1; i < 6; i++) { const y = lerp(vp[1], H + 240, (i / 6) ** 2); stroke(c, poly([[lerp(vp[0], 380, (i / 6) ** 2), y], [lerp(vp[0], 1500, (i / 6) ** 2), y]], false), 3, '#00000030'); } }
  cel(c, poly([[-260, vp[1] + 220], [vp[0] - 150, vp[1] - 4], [vp[0] - 10, vp[1]], [380, H + 240], [-260, H + 240]]), { fill: o.quay ?? '#6d5a50', fill2: shadeOf(o.quay ?? '#6d5a50', 0.6), depth: 0.02, line: 6 });
  cel(c, poly([[W + 260, vp[1] + 160], [vp[0] + 170, vp[1] - 10], [vp[0], vp[1]], [1500, H + 240], [W + 260, H + 240]]), { fill: shadeOf(o.quay ?? '#6d5a50', 0.3), fill2: shadeOf(o.quay ?? '#6d5a50', 0.9), depth: 0.02, line: 6 });
  if (o.tree !== false) st.tree(c, 60, vp[1] + 170, 1.3, { leaf: '#8f9a2c', seed: 4 });
  if (o.nearWall !== false) {                             // a dark cropped wall on the right catches a rim of light
    const nw = st.quad([1690, -280], [W + 280, -460], [W + 280, H + 340], [1770, H + 140]);
    st.wall(c, nw, { fill: '#553530', fill2: '#2f1d1f', line: 7 }); st.planks(c, nw, { n: 5, dir: 'v', fill: '#4a2e2a', grain: 1, knots: 0, gap: 5, line: 7 });
    stroke(c, poly([[1690, -280], [1770, H + 140]], false), 8, p.rim);
  }
  glow(c, vp[0] + 220, vp[1] - 180, 900, p.glow, 0.5 * p.glowAmt);
  st.castShadow(c, [[-260, vp[1]], [900, vp[1] + 40], [700, H + 240], [-260, H + 240]], { alpha: 0.4 });
  st.vignette(c, { strength: 0.34 });
  return p;
}
// wallSide(): the cast stands in front of a long wall seen square-on, like a stage flat: big dressed
// stones, a strip of ground, and a hard diagonal of light and shadow across the wall.
//   ground (y where wall meets floor), stone, floorColor, courses, gate:{x, scale, open}|false, lightFrom: -1|1
function draw_wallSide(c, o = {}) {
  const base = o.ground ?? 660, stone = o.stone ?? '#b49a78', L = -260, R = W + 260, dir = o.lightFrom ?? 1;
  const q = st.rectQuad(L, -260, R - L, base + 260);
  st.wall(c, q, { fill: lightOf(stone, 0.1, '#ffffff'), fill2: shadeOf(stone, 0.35), line: 0, straight: true });
  st.bricks(c, q, { rows: o.courses ?? 6, cols: 8, line: alpha(S.ink, 0.55), w: 5, pick: 0.22, pickColor: '#3a200018', seed: o.seed ?? 5 });
  if (o.band) cel(c, poly([[L, base - 190], [R, base - 190], [R, base - 130], [L, base - 130]]), { fill: o.band, depth: 0.2, line: 5 });
  if (o.gate) gate(c, o.gate.x ?? 1450, base, o.gate.scale ?? 1, o.gate);
  const fl = st.quad([L, base], [R, base], [R + 400, H + 260], [L - 400, H + 260]);
  st.floor(c, fl, { fill: o.floorColor ?? '#4c4844', far: lightOf(o.floorColor ?? '#4c4844', 0.25, '#ffffff'), rows: 4, cols: 12, bias: 1.5, joint: '#00000038', line: 0 });
  stroke(c, poly([[L, base], [R, base]], false), 7);
  cel(c, poly([[L, base], [R, base], [R, base + 26], [L, base + 26]]), { fill: shadeOf(stone, 0.55), flat: true, line: 5 });
  const a = dir > 0 ? 620 : W - 620, b = dir > 0 ? 1080 : W - 1080;
  st.castShadow(c, [[dir > 0 ? L : R, -260], [a, -260], [b, base], [dir > 0 ? L : R, base]], { alpha: 0.42 });
  st.lightShape(c, [[a, -260], [dir > 0 ? R : L, -260], [dir > 0 ? R : L, base], [b, base]], { alpha: 0.22 });
  st.castShadow(c, [[dir > 0 ? L : R, base], [b, base], [b + dir * 260, H + 260], [dir > 0 ? L : R, H + 260]], { alpha: 0.3 });
  st.vignette(c, { strength: 0.3 });
}
// ramparts(): looking up at a town wall from outside. Battlements cut the sky; the ground is a dark strip.
//   time, top (y of the battlements), stone, ground (y), tower:false, sky:false (wall only: use it with
//   painted() when somebody has to stand BEHIND the battlements)
function draw_ramparts(c, o = {}) {
  const top = o.top ?? 330, base = o.ground ?? 820, stone = o.stone ?? '#8f8478';
  const p = o.sky === false ? timeOf(o) : heavens(c, { ...o, horizon: base, sun: o.sun ?? [1500, 160] });
  const pts = [[-260, base + 300], [-260, top]], t = 96; for (let x = -260, i = 0; x < W + 260; x += t, i++) { const yy = i % 2 ? top + 62 : top; pts.push([x, yy], [x + t, yy]); } pts.push([W + 260, base + 300]);
  cel(c, poly(pts), { fill: stone, fill2: shadeOf(stone, 0.5), depth: 0.012, shrink: 1, rim: 7, rimColor: lightOf(stone, 0.5, p.rim), line: 8, inner: cc => st.bricks(cc, st.rectQuad(-260, top, W + 520, base - top + 200), { rows: 7, cols: 9, line: alpha(S.ink, 0.5), w: 5, pick: 0.2, seed: o.seed ?? 9 }) });
  if (o.tower !== false) { const tx = o.towerX ?? 300, tw = 330; const tp = [[tx, base + 300], [tx, top - 190]]; for (let x = tx, i = 0; x < tx + tw - 1; x += tw / 5, i++) { const yy = i % 2 ? top - 140 : top - 190; tp.push([x, yy], [x + tw / 5, yy]); } tp.push([tx + tw, base + 300]); cel(c, poly(tp), { fill: lightOf(stone, 0.08, '#ffffff'), fill2: shadeOf(stone, 0.45), depth: 0.03, rim: 7, rimColor: lightOf(stone, 0.5, p.rim), line: 8, inner: cc => { st.bricks(cc, st.rectQuad(tx, top - 190, tw, base - top + 400), { rows: 9, cols: 3, line: alpha(S.ink, 0.5), w: 5, seed: 3 }); cel(cc, blob([[tx + tw / 2 - 30, top + 60, 1], [tx + tw / 2 - 30, top - 30], [tx + tw / 2, top - 62], [tx + tw / 2 + 30, top - 30], [tx + tw / 2 + 30, top + 60, 1]]), { fill: '#1c1418', flat: true, line: 5 }); } }); }
  cel(c, poly([[-260, base], [W + 260, base], [W + 260, H + 260], [-260, H + 260]]), { fill: o.floorColor ?? '#4a4a3a', fill2: shadeOf(o.floorColor ?? '#4a4a3a', 0.7), depth: 0.02, line: 7 });
  st.castShadow(c, [[-260, top + 60], [W + 260, top + 60], [W + 260, top + 190], [-260, top + 250]], { alpha: 0.28 });
  st.vignette(c, { strength: 0.36 });
  return p;
}
// nightField(): open ground under a night sky: moon, stars, dark ridges, optional beams of light.
function draw_nightField(c, o = {}) {
  const hz = o.horizon ?? 560, p = heavens(c, { time: 'night', stars: true, disc: o.moon === false ? 0 : 46, clouds: 5, ...o, horizon: hz, sun: o.sun ?? [1480, 150], sunR: 560 });
  if (o.beams) st.rays(c, o.beams.x ?? 900, hz + 40, { n: o.beams.n ?? 5, from: 230, to: 310, len: 900, color: '#c9d2ff', alpha: 0.3 });
  st.ridge(c, roll(hz - 20, 50, 6, (o.seed ?? 3) + 11), '#1d2147', { flat: true, line: 5 });
  st.ridge(c, roll(hz + 80, 30, 5, (o.seed ?? 3) + 23), o.ground ?? '#2b2a3f', { fill2: '#17141f', depth: 0.02, rim: 6, rimColor: '#5d66a8', line: 6 });
  st.haze(c, hz - 60, hz + 100, '#4a4c8a', 0.35);
  st.vignette(c, { strength: 0.45, color: '#05030c' });
  return p;
}

// ------------------------------------------------------------------ indoors
// plankRoom(): a timber room: boarded walls with flowing grain, a board floor, one hanging lamp.
//   back [x0, y0, x1, y1] (the far wall on screen), wood, floorColor, lamp:{x, y}|false, picture:(c,x,y,w,h)=>…
function draw_plankRoom(c, o = {}) {
  const wood = o.wood ?? '#b08a52', back = o.back ?? [380, 150, 1540, 640];
  const q = st.room(c, back, { wall: wood, floor: o.floorColor ?? '#7a5236' });
  st.planks(c, q.back, { n: 6, fill: wood, grain: 6, knots: 0.65, gap: 6, line: 0, seed: 3 });
  st.planks(c, q.left, { n: 6, fill: shadeOf(wood, 0.3), grain: 5, knots: 0.5, gap: 6, line: 0, seed: 5 });
  st.planks(c, q.right, { n: 6, fill: shadeOf(wood, 0.45), grain: 5, knots: 0.5, gap: 6, line: 0, seed: 7 });
  st.planks(c, q.ceil, { n: 5, dir: 'v', fill: shadeOf(wood, 0.6), grain: 1, knots: 0, gap: 6, line: 0, seed: 9 });
  st.planks(c, q.floor, { n: 7, dir: 'v', fill: o.floorColor ?? '#7a5236', grain: 2, knots: 0.2, gap: 6, line: 0, seed: 11 });
  st.roomLines(c, q, 7);
  if (o.picture) st.frame(c, o.pictureAt?.[0] ?? back[0] + 150, o.pictureAt?.[1] ?? back[1] + 70, o.pictureAt?.[2] ?? 330, o.pictureAt?.[3] ?? 230, { inside: o.picture });
  const lamp = o.lamp === false ? null : { x: (back[0] + back[2]) / 2 - 240, y: back[1] + 40, ...(o.lamp ?? {}) };
  st.castShadow(c, [[-260, -260], [W + 260, -260], [W + 260, H + 260], [-260, H + 260]], { alpha: o.dim ?? 0.3 });
  if (lamp) st.bulb(c, lamp.x, lamp.y, { r: 760, strength: 0.9 });
  st.vignette(c, { strength: 0.4 });
  return q;
}
// hall(): a stone hall: tall arched windows throwing shafts of light across a tiled floor.
//   time (what is outside the windows), stone, floorColor, windows (count), banner:[colours]|false
function draw_hall(c, o = {}) {
  const stone = o.stone ?? '#9d8f84', base = o.ground ?? 640, p = timeOf({ time: o.time ?? 'day' }), n = o.windows ?? 3;
  const q = st.rectQuad(-260, -260, W + 520, base + 260);
  st.wall(c, q, { fill: stone, fill2: shadeOf(stone, 0.4), line: 0, straight: true });
  st.bricks(c, q, { rows: 7, cols: 9, line: alpha(S.ink, 0.45), w: 5, pick: 0.18, seed: o.seed ?? 6 });
  const xs = Array.from({ length: n }, (_, i) => (o.windowX ?? 330) + i * (o.windowGap ?? 520));
  for (const x of xs) {
    const win = blob([[x - 86, base - 190, 1], [x - 86, base - 470, 1], [x - 50, base - 560], [x, base - 590], [x + 50, base - 560], [x + 86, base - 470, 1], [x + 86, base - 190, 1]]);
    cel(c, win, { fill: p.sky[1], flat: true, line: 0, inner: cc => { cc.fillStyle = linear(cc, 0, base - 600, 0, base - 190, ...p.sky); cc.fill(win); stroke(cc, poly([[x, base - 600], [x, base - 190]], false), 7); stroke(cc, poly([[x - 90, base - 400], [x + 90, base - 400]], false), 7); } });
    stroke(c, win, 14, shadeOf(stone, 0.6)); stroke(c, win, 6);
    cel(c, poly([[x - 110, base - 190], [x + 110, base - 190], [x + 100, base - 166], [x - 100, base - 166]]), { fill: lightOf(stone, 0.2, '#ffffff'), flat: true, line: 5 });
  }
  if (o.banner !== false) for (const [i, x] of xs.slice(0, -1).entries()) {
    const bx=x+(o.windowGap??520)/2, cols=o.banner??['#f2c230','#2f4aa0'];
    living(c,cc=>{
      const dx=lifeEnabled(o)?Math.sin(motionTime(o)*TAU*.7+bx)*4:0;
      cel(cc,blob([[bx-62,base-600,1],[bx+62,base-600,1],[bx+62+dx,base-330,1],[bx+dx,base-280,1],[bx-62+dx,base-330,1]]),{fill:cols[i%cols.length],depth:.05,rim:5,line:6,
        inner:dd=>paint(dd,poly([[bx,base-600],[bx+70,base-600],[bx+70+dx,base-250],[bx+dx,base-250]]),cols[(i+1)%cols.length])});
    },{...o,float:false,seed:`banner:${bx}`});
    stroke(c,poly([[bx-80,base-602],[bx+80,base-602]],false),9,'#5a3d2a');
  }
  const fl = st.quad([-260, base], [W + 260, base], [W + 760, H + 260], [-760, H + 260]);
  st.floor(c, fl, { fill: o.floorColor ?? '#6a4f44', far: lightOf(o.floorColor ?? '#6a4f44', 0.2, '#ffffff'), rows: 4, cols: 11, bias: 1.5, joint: '#00000040', line: 0 });
  cel(c, poly([[-260, base - 14], [W + 260, base - 14], [W + 260, base + 16], [-260, base + 16]]), { fill: shadeOf(stone, 0.6), flat: true, line: 5 });
  st.castShadow(c, [[-260, -260], [W + 260, -260], [W + 260, H + 260], [-260, H + 260]], { alpha: o.dim ?? 0.34 });
  for (const x of xs) { st.lightShape(c, [[x - 86, base - 560], [x + 86, base - 560], [x + 470, H + 260], [x + 60, H + 260]], { alpha: 0.2, color: alpha(p.glow, 0.24) }); st.lightShape(c, [[x + 150, base + 60], [x + 330, base + 60], [x + 470, H + 260], [x + 200, H + 260]], { alpha: 0.2 }); }
  st.vignette(c, { strength: 0.4 });
}
// burst(): a backdrop for a reaction close-up: rays fanning out from behind the head.
//   x, y (centre), color (ray), dark (between rays), rays (count)
function draw_burst(c, o = {}) {
  const x = o.x ?? W / 2, y = o.y ?? H * 0.45, a = o.color ?? '#f2a51e', b = o.dark ?? '#1b1830', n = o.rays ?? 13, R = 1700;
  c.fillStyle = b; c.fillRect(-260, -260, W + 520, H + 520);
  const g = c.createRadialGradient(x, y, 0, x, y, 1100); g.addColorStop(0, lightOf(a, 0.5, '#fff6c0')); g.addColorStop(0.45, a); g.addColorStop(1, mix(a, b, 0.85));
  c.fillStyle = g;
  for (let i = 0; i < n; i++) { const a0 = (i / n) * TAU + (o.turn ?? 0.1) + (lifeEnabled(o) ? motionTime(o)*Math.PI/90 : 0), a1 = a0 + TAU / n * 0.5; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R); c.lineTo(x + Math.cos(a1) * R, y + Math.sin(a1) * R); c.closePath(); c.fill(); }
  glow(c, x, y, 620, lightOf(a, 0.6, '#ffffff'), 0.6);
  st.vignette(c, { strength: 0.5, color: b });
}
// gloom(): a dark, brushy nowhere for a menacing or private close-up; the face is lit by its own rim.
function draw_gloom(c, o = {}) {
  const col = o.color ?? '#2a2a30', r = rng(o.seed ?? 4);
  c.fillStyle = linear(c, 0, -200, 0, H + 200, lightOf(col, 0.16, '#ffffff'), shadeOf(col, 0.7)); c.fillRect(-260, -260, W + 520, H + 520);
  for (let i = 0; i < 14; i++) { const y = -200 + r() * (H + 400), x = -260 + r() * W; brush(c, [[x, y], [x + 500 + r() * 500, y + (r() - 0.5) * 60], [x + 1100 + r() * 600, y + (r() - 0.5) * 90]], [0, 26 + r() * 30, 0], alpha(r() < 0.5 ? '#000000' : '#ffffff', 0.05)); }
  if (o.glow !== false) glow(c, o.x ?? W / 2, o.y ?? H / 2, 900, o.glowColor ?? '#7a7a9a', 0.3);
  st.vignette(c, { strength: 0.55, color: '#050308' });
}
// tabletop(): looking down at a table or the ground for an object close-up (a document, a coin, a bucket).
function draw_tabletop(c, o = {}) {
  const wood = o.wood ?? '#8a6238';
  st.planks(c, st.rectQuad(-260, -260, W + 520, H + 520), { n: o.boards ?? 5, fill: wood, grain: 3, knots: 0.5, gap: 7, line: 0, seed: o.seed ?? 21 });
  st.castShadow(c, [[-260, -260], [700, -260], [200, H + 260], [-260, H + 260]], { alpha: 0.4 });
  if (o.pool !== false) glow(c, o.x ?? W / 2, o.y ?? H / 2, 760, '#fff0c0', 0.42);
  st.vignette(c, { strength: 0.46 });
}

function place(c, kind, o, draw) {
  if ((o.still || o.life === false) && S.clock?.life) return withStyle({clock:{...S.clock,life:false}},()=>draw(c));
  const m = elementMotion('place', kind, o);
  const result = draw(c);
  if (o.ambient !== false && lifeEnabled(o)) {
    const indoor = ['plankRoom','hall','tabletop','gloom','wallSide'].includes(kind);
    if (!['burst','cypress'].includes(kind)) st.atmosphere(c, { ...o, seed:m.seed, indoor,
      birds: !indoor && kind !== 'nightField', crowd: kind === 'street' && o.crowd === true, crowdX:o.crowdX??o.vp?.[0]??960,
      horizon:o.horizon ?? o.vp?.[1] ?? 600, leaves:kind==='hills' });
  }
  return result;
}
export function hills(c,o={}) { return place(c,'hills',o,cc=>draw_hills(cc,o)); }
export function street(c,o={}) { return place(c,'street',o,cc=>draw_street(cc,o)); }
export function wallSide(c,o={}) { return place(c,'wallSide',o,cc=>draw_wallSide(cc,o)); }
export function ramparts(c,o={}) { return place(c,'ramparts',o,cc=>draw_ramparts(cc,o)); }
export function nightField(c,o={}) { return place(c,'nightField',o,cc=>draw_nightField(cc,o)); }
export function plankRoom(c,o={}) { return place(c,'plankRoom',o,cc=>draw_plankRoom(cc,o)); }
export function hall(c,o={}) { return place(c,'hall',o,cc=>draw_hall(cc,o)); }
export function tabletop(c,o={}) { return place(c,'tabletop',o,cc=>draw_tabletop(cc,o)); }
export function heavens(c,o={}) {
  if ((o.still || o.life === false) && S.clock?.life) return withStyle({clock:{...S.clock,life:false}},()=>draw_heavens(c,o));
  return draw_heavens(c,o);
}
export function gloom(c,o={}) { return place(c,'gloom',o,cc=>draw_gloom(cc,o)); }
export function burst(c,o={}) { const m=elementMotion('burst',o.seed??1,o); return living(c,cc=>draw_burst(cc,o),{...o,seed:m.seed,float:false}); }
export function cypress(c,x,y,s=1,o={}) { const m=elementMotion('cypress','cypress',o); return living(c,cc=>draw_cypress(cc,x,y,s,o),{...o,seed:m.seed,kind:'wind',float:true,amount:1,cached:true,pivot:[x,y]}); }
