export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const DEG = 180 / Math.PI;

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG so every frame of a render draws the same scatter. */
export function rng(seed: number | string) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 101.3) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Two-bone IK. `bend` in [-1, 1] picks which side the elbow goes (continuous so
 * poses blend without the elbow snapping across).
 */
export function ik(s: Pt, target: Pt, a: number, b: number, bend: number) {
  let dx = target.x - s.x;
  let dy = target.y - s.y;
  let d = Math.hypot(dx, dy) || 0.001;
  const max = a + b - 0.5;
  const min = Math.abs(a - b) + 1;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  } else if (d < min) {
    dx *= min / d;
    dy *= min / d;
    d = min;
  }
  const base = Math.atan2(dy, dx);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const A = Math.acos(cosA);
  const ang = base + bend * A;
  const e = { x: s.x + Math.cos(ang) * a, y: s.y + Math.sin(ang) * a };
  const fx = s.x + dx - e.x;
  const fy = s.y + dy - e.y;
  const fl = Math.hypot(fx, fy) || 0.001;
  const h = { x: e.x + (fx / fl) * b, y: e.y + (fy / fl) * b };
  return { e, h };
}

/** A tapered, round-capped limb from p1 (width w1) to p2 (width w2). */
export function limb(p1: Pt, p2: Pt, w1: number, w2: number, bulge = 0) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 0.001;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const r1 = w1 / 2;
  const r2 = w2 / 2;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const rm = (r1 + r2) / 2 + bulge;
  const f = (n: number) => n.toFixed(1);
  const a1 = `${f(p1.x + nx * r1)} ${f(p1.y + ny * r1)}`;
  const c1 = `${f(mx + nx * rm)} ${f(my + ny * rm)}`;
  const a2 = `${f(p2.x + nx * r2)} ${f(p2.y + ny * r2)}`;
  const b2 = `${f(p2.x - nx * r2)} ${f(p2.y - ny * r2)}`;
  const c2 = `${f(mx - nx * rm)} ${f(my - ny * rm)}`;
  const b1 = `${f(p1.x - nx * r1)} ${f(p1.y - ny * r1)}`;
  return `M${a1} Q${c1} ${a2} A${f(r2)} ${f(r2)} 0 0 0 ${b2} Q${c2} ${b1} A${f(r1)} ${f(r1)} 0 0 0 ${a1} Z`;
}

export const angleOf = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x) * DEG;
export const along = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Mix two #rrggbb colours. */
export function mix(c1: string, c2: string, t: number) {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1);
  const b = p(c2);
  return `#${a.map((v, i) => Math.round(lerp(v, b[i]!, t)).toString(16).padStart(2, '0')).join('')}`;
}
export const darken = (c: string, t: number) => mix(c, '#000000', t);
export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);

/** Per-instance unique ids for SVG gradients/clip paths. */
export const uid = (scope: string, name: string) => `${scope}-${name}`;
