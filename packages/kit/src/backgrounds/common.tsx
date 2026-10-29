import type { TimeOfDay } from '@moco/spec';
import React from 'react';
import { mix, noise1, rng } from '../util.ts';

export const W = 1080;
export const H = 1920;
/** Art extends this far past every frame edge so camera moves never show a seam. */
export const BLEED = 260;

export interface BgContext {
  /** Seconds since the start of the shot. */
  t: number;
  time: TimeOfDay;
  /** Unique per instance, for SVG ids. */
  uid: string;
}

export interface BgLayer {
  /** 0 = infinitely far (sky), 1 = the actors' plane, >1 = in front of actors. */
  depth: number;
  node: React.ReactNode;
}

export interface Palette {
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  sun: string;
  glow: string;
  haze: string;
  far: string;
  mid: string;
  near: string;
  light: number;
}

export const SKY: Record<TimeOfDay, Palette> = {
  dawn: { skyTop: '#6d79c9', skyMid: '#f0a3b6', skyBottom: '#ffd7a6', sun: '#fff1c4', glow: '#ffb48c', haze: '#f6c6b4', far: '#a38bb8', mid: '#7c6a94', near: '#5a4a6e', light: 0.85 },
  day: { skyTop: '#4f9ff0', skyMid: '#93ccf6', skyBottom: '#e6f3fb', sun: '#fffbea', glow: '#fff3c0', haze: '#d9ebf6', far: '#8fb4cf', mid: '#6d93ae', near: '#4f7590', light: 1 },
  dusk: { skyTop: '#33245e', skyMid: '#d4566c', skyBottom: '#ffb15a', sun: '#ffd57c', glow: '#ff8a4a', haze: '#f29e6f', far: '#8a4f6f', mid: '#5f3550', near: '#3e2238', light: 0.75 },
  night: { skyTop: '#060a22', skyMid: '#141d48', skyBottom: '#2a386c', sun: '#f3f0dc', glow: '#8ea6ff', haze: '#26325e', far: '#202a52', mid: '#161e3e', near: '#0e1430', light: 0.45 },
};

export const tone = (c: string, time: TimeOfDay, amount = 1) => {
  const grade: Record<TimeOfDay, [string, number]> = {
    dawn: ['#ff9a8a', 0.18],
    day: ['#ffffff', 0],
    dusk: ['#ff7040', 0.26],
    night: ['#101a48', 0.62],
  };
  const [g, k] = grade[time];
  return mix(c, g, k * amount);
};

export function Rect({ fill, y = -BLEED, h = H + BLEED * 2 }: { fill: string; y?: number; h?: number }) {
  return <rect x={-BLEED} y={y} width={W + BLEED * 2} height={h} fill={fill} />;
}

export function SkyGradient({ pal, uid, horizon = 1300 }: { pal: Palette; uid: string; horizon?: number }) {
  const id = `${uid}-sky`;
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1={-BLEED} x2="0" y2={horizon} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.skyTop} />
          <stop offset="0.55" stopColor={pal.skyMid} />
          <stop offset="1" stopColor={pal.skyBottom} />
        </linearGradient>
      </defs>
      <Rect fill={`url(#${id})`} />
    </g>
  );
}

export function Sun({ x, y, r, pal, uid, time }: { x: number; y: number; r: number; pal: Palette; uid: string; time: TimeOfDay }) {
  const id = `${uid}-sun`;
  const moon = time === 'night';
  return (
    <g>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor={pal.glow} stopOpacity={moon ? 0.45 : 0.85} />
          <stop offset="1" stopColor={pal.glow} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={r * 4.2} fill={`url(#${id})`} />
      <circle cx={x} cy={y} r={r} fill={pal.sun} />
      {moon && (
        <g fill="#d9d5bf" opacity={0.6}>
          <circle cx={x - r * 0.3} cy={y - r * 0.2} r={r * 0.16} />
          <circle cx={x + r * 0.25} cy={y + r * 0.3} r={r * 0.12} />
          <circle cx={x + r * 0.35} cy={y - r * 0.35} r={r * 0.08} />
        </g>
      )}
    </g>
  );
}

export function Stars({ seed, count, t, maxY = 1100, opacity = 1 }: { seed: string; count: number; t: number; maxY?: number; opacity?: number }) {
  const r = rng(seed);
  return (
    <g opacity={opacity}>
      {Array.from({ length: count }, (_, i) => {
        const x = r() * (W + BLEED * 2) - BLEED;
        const y = r() * (maxY + BLEED) - BLEED;
        const size = r() < 0.08 ? 3.2 : 1 + r() * 1.6;
        const tw = 0.55 + 0.45 * Math.sin(t * (1 + r() * 2.5) + i);
        return <circle key={i} cx={x} cy={y} r={size} fill="#fffbe8" opacity={tw} />;
      })}
    </g>
  );
}

export function Cloud({ x, y, s, fill, opacity = 1 }: { x: number; y: number; s: number; fill: string; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={opacity} fill={fill}>
      <ellipse cx={0} cy={0} rx={120} ry={34} />
      <circle cx={-50} cy={-16} r={42} />
      <circle cx={10} cy={-34} r={56} />
      <circle cx={66} cy={-12} r={40} />
    </g>
  );
}

export function Clouds({ seed, y0, y1, count, fill, opacity, t, speed = 6 }: { seed: string; y0: number; y1: number; count: number; fill: string; opacity: number; t: number; speed?: number }) {
  const r = rng(seed);
  const span = W + BLEED * 2 + 400;
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const x0 = r() * span;
        const x = ((x0 + t * speed * (0.6 + r())) % span) - BLEED - 200;
        return <Cloud key={i} x={x} y={y0 + r() * (y1 - y0)} s={0.6 + r() * 0.9} fill={fill} opacity={opacity * (0.6 + r() * 0.4)} />;
      })}
    </g>
  );
}

/** A ridge line path (mountains/hills) filled down to the bottom of the bleed. */
export function ridge(seed: number, y: number, amp: number, freq: number, jag = 0) {
  const pts: string[] = [];
  const x0 = -BLEED - 20;
  const x1 = W + BLEED + 20;
  for (let x = x0; x <= x1; x += 20) {
    const n = noise1(x * freq, seed) * amp + noise1(x * freq * 3.1, seed + 7) * amp * 0.3 + (jag ? Math.abs(noise1(x * freq * 9, seed + 3)) * jag : 0);
    pts.push(`${x} ${(y - n).toFixed(1)}`);
  }
  return `M${x0} ${H + BLEED} L${pts.join(' L')} L${x1} ${H + BLEED} Z`;
}

export function Haze({ y, h, color, opacity, uid, name }: { y: number; h: number; color: string; opacity: number; uid: string; name: string }) {
  const id = `${uid}-haze-${name}`;
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0} />
          <stop offset="0.5" stopColor={color} stopOpacity={opacity} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect x={-BLEED} y={y - h / 2} width={W + BLEED * 2} height={h} fill={`url(#${id})`} />
    </g>
  );
}

export function Ground({ y, top, bottom, uid, name = 'ground' }: { y: number; top: string; bottom: string; uid: string; name?: string }) {
  const id = `${uid}-${name}`;
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1={y} x2="0" y2={H + BLEED} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect x={-BLEED} y={y} width={W + BLEED * 2} height={H + BLEED - y} fill={`url(#${id})`} />
    </g>
  );
}

export function Glow({ x, y, r, color, opacity, uid, name }: { x: number; y: number; r: number; color: string; opacity: number; uid: string; name: string }) {
  const id = `${uid}-glow-${name}`;
  return (
    <g>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor={color} stopOpacity={opacity} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={r} fill={`url(#${id})`} />
    </g>
  );
}

export function Flame({ x, y, s, t, seed = 0 }: { x: number; y: number; s: number; t: number; seed?: number }) {
  const f = (k: number) => noise1(t * 6 + k + seed, seed);
  const w = 1 + f(1) * 0.12;
  const h = 1 + f(2) * 0.18;
  return (
    <g transform={`translate(${x} ${y}) scale(${s * w} ${s * h})`}>
      <path d={`M0 0 C-14 -10 -16 -34 ${f(3) * 6} -62 C14 -36 14 -10 0 0 Z`} fill="#ff9a1f" />
      <path d={`M0 -2 C-8 -10 -9 -26 ${f(4) * 4} -44 C8 -26 8 -10 0 -2 Z`} fill="#ffd84a" />
      <ellipse cx={0} cy={-8} rx={3.5} ry={7} fill="#fff8d8" />
    </g>
  );
}

/** A flag that waves; anchored at its pole-top. */
export function Flag({ x, y, w, h, color, t, speed = 3 }: { x: number; y: number; w: number; h: number; color: string; t: number; speed?: number }) {
  const pts: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const wave = Math.sin(t * speed - u * 5) * h * 0.18 * u;
    pts.push(`${x + u * w} ${y + wave + u * h * 0.08}`);
  }
  const bottom: string[] = [];
  for (let i = 8; i >= 0; i--) {
    const u = i / 8;
    const wave = Math.sin(t * speed - u * 5) * h * 0.18 * u;
    bottom.push(`${x + u * w} ${y + h * (1 - u * 0.7) + wave}`);
  }
  return <path d={`M${pts.join(' L')} L${bottom.join(' L')} Z`} fill={color} />;
}
