import { Flame, clamp, hashString, noise1, rng } from '@moco/kit';
import type { Fx } from '@moco/spec';
import React, { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';

const W = 1080;
const H = 1920;

/** Visibility envelope for a timed effect within a shot. */
export function fxEnvelope(fx: Fx, t: number, shotDuration: number, fade = 0.3) {
  const start = fx.at ?? 0;
  const end = fx.duration !== undefined ? start + fx.duration : shotDuration + 1;
  if (t < start || t > end) return 0;
  const inK = fade > 0 ? clamp((t - start) / fade, 0, 1) : 1;
  const outK = fx.duration !== undefined && fade > 0 ? clamp((end - t) / fade, 0, 1) : 1;
  return Math.min(inK, outK);
}

function Particles({ variant, intensity, t, seed }: { variant: string; intensity: number; t: number; seed: string }) {
  const count = Math.round(18 + intensity * 70);
  const r = rng(`${seed}-${variant}`);
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const x0 = r() * W;
    const y0 = r() * H;
    const s = 0.5 + r();
    const sp = 0.6 + r() * 0.8;
    const ph = r() * 100;
    switch (variant) {
      case 'embers': {
        const y = (((y0 - t * 120 * sp) % H) + H) % H;
        const x = x0 + noise1(t * 0.8 + ph, i) * 40;
        const o = 0.5 + 0.5 * Math.sin(t * 8 * sp + ph);
        items.push(<circle key={i} cx={x} cy={y} r={2.2 * s + 1} fill="#ffb347" opacity={o * 0.9} />);
        items.push(<circle key={`g${i}`} cx={x} cy={y} r={7 * s} fill="#ff7a1a" opacity={o * 0.18} />);
        break;
      }
      case 'petals': {
        const y = ((y0 + t * 110 * sp) % (H + 100)) - 50;
        const x = x0 + Math.sin(t * 1.6 * sp + ph) * 50;
        const rot = t * 90 * sp + ph * 10;
        items.push(<ellipse key={i} cx={x} cy={y} rx={10 * s} ry={5 * s} fill={i % 3 ? '#ff8fab' : '#ff4d6d'} opacity={0.85} transform={`rotate(${rot} ${x} ${y})`} />);
        break;
      }
      case 'sparkles': {
        const y = (((y0 - t * 30 * sp) % H) + H) % H;
        const tw = Math.max(0, Math.sin(t * 3 * sp + ph));
        const k = 10 * s * tw;
        items.push(<path key={i} d={`M${x0} ${y - k} L${x0 + k * 0.25} ${y - k * 0.25} L${x0 + k} ${y} L${x0 + k * 0.25} ${y + k * 0.25} L${x0} ${y + k} L${x0 - k * 0.25} ${y + k * 0.25} L${x0 - k} ${y} L${x0 - k * 0.25} ${y - k * 0.25} Z`} fill="#fff3c4" opacity={0.9 * tw} />);
        break;
      }
      case 'snow': {
        const y = ((y0 + t * 90 * sp) % (H + 40)) - 20;
        const x = x0 + Math.sin(t * 1.2 + ph) * 30;
        items.push(<circle key={i} cx={x} cy={y} r={3 * s + 1} fill="#ffffff" opacity={0.85} />);
        break;
      }
      case 'rain': {
        const y = ((y0 + t * 1400 * sp) % (H + 200)) - 100;
        const x = ((x0 - t * 300 * sp) % W + W) % W;
        items.push(<path key={i} d={`M${x} ${y} l-14 46`} stroke="#c8d8ff" strokeWidth={2.2} opacity={0.5} />);
        break;
      }
      case 'fireflies': {
        const x = x0 + noise1(t * 0.4 + ph, 1) * 120;
        const y = y0 * 0.5 + H * 0.45 + noise1(t * 0.35 + ph, 2) * 120;
        const o = Math.max(0, Math.sin(t * 2.2 * sp + ph));
        items.push(<circle key={i} cx={x} cy={y} r={14 * s} fill="#d9ff7a" opacity={o * 0.18} />);
        items.push(<circle key={`c${i}`} cx={x} cy={y} r={3.2 * s} fill="#f4ffb0" opacity={o} />);
        break;
      }
      case 'leaves': {
        const y = ((y0 + t * 140 * sp) % (H + 100)) - 50;
        const x = x0 + Math.sin(t * 1.3 * sp + ph) * 70;
        const rot = t * 120 * sp + ph * 10;
        items.push(<path key={i} d={`M${x} ${y} c${8 * s} ${-10 * s} ${20 * s} ${-6 * s} ${22 * s} 0 c${-4 * s} ${8 * s} ${-14 * s} ${10 * s} ${-22 * s} 0 Z`} fill={i % 2 ? '#5f9a44' : '#d9a03a'} transform={`rotate(${rot} ${x} ${y})`} />);
        break;
      }
      default: {
        const x = ((x0 + t * 40 * sp) % (W + 100)) - 50;
        const y = y0 + noise1(t * 0.5 + ph, 4) * 30;
        items.push(<circle key={i} cx={x} cy={y} r={2 + 5 * s} fill="#e8c9a0" opacity={0.25 + r() * 0.25} />);
      }
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
      {items}
    </svg>
  );
}

function LightRays({ color, intensity, t, uid }: { color: string; intensity: number; t: number; uid: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}>
      <defs>
        <linearGradient id={`${uid}-ray`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.85} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {Array.from({ length: 7 }, (_, i) => {
        const a = -26 + i * 9 + Math.sin(t * 0.3 + i) * 2;
        const w = 60 + (i % 3) * 50;
        const o = (0.18 + 0.12 * Math.sin(t * 0.8 + i * 1.7)) * intensity;
        return <path key={i} d={`M${-w / 4} 0 L${w / 4} 0 L${w} ${H * 1.1} L${-w} ${H * 1.1} Z`} fill={`url(#${uid}-ray)`} opacity={o} transform={`translate(${W * 0.62} ${-120}) rotate(${a})`} />;
      })}
    </svg>
  );
}

/** World-space aura drawn behind an actor (inside the stage SVG). */
export function Aura({ x, y, r, color, intensity, t, uid }: { x: number; y: number; r: number; color: string; intensity: number; t: number; uid: string }) {
  const id = `${uid}-aura`;
  const pulse = 1 + Math.sin(t * 2.2) * 0.04;
  return (
    <g opacity={intensity}>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor={color} stopOpacity={0.95} />
          <stop offset="0.45" stopColor={color} stopOpacity={0.45} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={r * 1.6 * pulse} fill={`url(#${id})`} />
      <g transform={`translate(${x} ${y}) rotate(${t * 12})`} opacity={0.45}>
        {Array.from({ length: 24 }, (_, i) => (
          <path key={i} d={`M-6 ${-r * 0.55} L0 ${-r * (1.25 + (i % 2) * 0.3)} L6 ${-r * 0.55} Z`} fill={color} transform={`rotate(${i * 15})`} />
        ))}
      </g>
      <circle cx={x} cy={y} r={r * 0.62 * pulse} fill="none" stroke="#fff6d8" strokeWidth={5} opacity={0.7} />
    </g>
  );
}

function DivineLight({ x, color, intensity, t, uid }: { x: number; color: string; intensity: number; t: number; uid: string }) {
  const cx = x * W;
  const w = 220 + Math.sin(t * 2) * 12;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}>
      <defs>
        <linearGradient id={`${uid}-beam`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={color} stopOpacity={0} />
          <stop offset="0.5" stopColor={color} stopOpacity={0.9} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`M${cx - w * 0.35} -40 L${cx + w * 0.35} -40 L${cx + w} ${H * 0.95} L${cx - w} ${H * 0.95} Z`} fill={`url(#${uid}-beam)`} opacity={0.55 * intensity} />
      <path d={`M${cx - w * 0.12} -40 L${cx + w * 0.12} -40 L${cx + w * 0.3} ${H * 0.95} L${cx - w * 0.3} ${H * 0.95} Z`} fill="#ffffff" opacity={0.35 * intensity} />
      <ellipse cx={cx} cy={H * 0.9} rx={w * 1.3} ry={50} fill={color} opacity={0.4 * intensity} />
    </svg>
  );
}

function Shockwave({ x, y, color, k }: { x: number; y: number; color: string; k: number }) {
  const r = 40 + k * 1300;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}>
      <circle cx={x * W} cy={y * H} r={r} fill="none" stroke={color} strokeWidth={60 * (1 - k) + 4} opacity={1 - k} />
      <circle cx={x * W} cy={y * H} r={r * 0.82} fill="none" stroke="#ffffff" strokeWidth={14 * (1 - k) + 2} opacity={(1 - k) * 0.8} />
      <circle cx={x * W} cy={y * H} r={260 * (1 - k)} fill={color} opacity={Math.max(0, 0.6 - k)} />
    </svg>
  );
}

function Lightning({ t, intensity, seed }: { t: number; intensity: number; seed: string }) {
  const period = 2.2 - intensity;
  const cycle = Math.floor(t / period);
  const local = t - cycle * period;
  const r = rng(`${seed}-${cycle}`);
  const visible = local < 0.12 || (local > 0.2 && local < 0.26);
  const flash = Math.max(0, 0.55 - local * 2.2) * intensity;
  if (!visible && flash <= 0) return null;
  let x = 150 + r() * 780;
  let y = -20;
  const pts = [`${x} ${y}`];
  while (y < 900 + r() * 300) {
    x += (r() - 0.5) * 120;
    y += 50 + r() * 70;
    pts.push(`${x.toFixed(0)} ${y.toFixed(0)}`);
  }
  return (
    <>
      <AbsoluteFill style={{ background: '#dfe8ff', opacity: flash, mixBlendMode: 'screen' }} />
      {visible && (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          <polyline points={pts.join(' ')} fill="none" stroke="#b9ccff" strokeWidth={22} opacity={0.35} strokeLinejoin="round" />
          <polyline points={pts.join(' ')} fill="none" stroke="#ffffff" strokeWidth={6} strokeLinejoin="round" />
        </svg>
      )}
    </>
  );
}

/** World-space fire (inside the stage SVG). */
export function FireFx({ x, y, scale, t, uid }: { x: number; y: number; scale: number; t: number; uid: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <defs>
        <radialGradient id={`${uid}-fire`}>
          <stop offset="0" stopColor="#ff9a3c" stopOpacity={0.7} />
          <stop offset="1" stopColor="#ff9a3c" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={0} cy={-120} r={340} fill={`url(#${uid}-fire)`} />
      {[-90, -45, 0, 45, 90].map((dx, i) => (
        <Flame key={dx} x={dx} y={0} s={3.2 - Math.abs(dx) / 45} t={t} seed={i * 3} />
      ))}
    </g>
  );
}

function Fog({ intensity, color, t, seed }: { intensity: number; color: string; t: number; seed: string }) {
  const r = rng(seed);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id={`${seed}-fog`}>
          <stop offset="0" stopColor={color} stopOpacity={0.55} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      {Array.from({ length: 7 }, (_, i) => {
        const x = (((r() * (W + 800) + t * (18 + i * 6)) % (W + 800)) - 400);
        const y = H * (0.55 + r() * 0.4);
        return <ellipse key={i} cx={x} cy={y} rx={420 + r() * 200} ry={150 + r() * 80} fill={`url(#${seed}-fog)`} opacity={intensity} />;
      })}
    </svg>
  );
}

function SpeedLines({ intensity, frame, seed }: { intensity: number; frame: number; seed: string }) {
  const r = rng(`${seed}-${Math.floor(frame / 2)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
      {Array.from({ length: Math.round(30 + intensity * 40) }, (_, i) => {
        const a = r() * Math.PI * 2;
        const r0 = 520 + r() * 300;
        const len = 300 + r() * 900;
        const cx = W / 2;
        const cy = H * 0.45;
        return <path key={i} d={`M${cx + Math.cos(a) * r0} ${cy + Math.sin(a) * r0} L${cx + Math.cos(a) * (r0 + len)} ${cy + Math.sin(a) * (r0 + len)}`} stroke="#ffffff" strokeWidth={2 + r() * 6} opacity={0.25 + r() * 0.4 * intensity} />;
      })}
    </svg>
  );
}

const TINTS: Record<string, [string, React.CSSProperties['mixBlendMode']]> = {
  warm: ['#ff9440', 'soft-light'],
  cool: ['#3d7bff', 'soft-light'],
  sepia: ['#a8763e', 'color'],
  gold: ['#ffc94a', 'overlay'],
  night: ['#1a2a6a', 'multiply'],
  blood: ['#b0102a', 'multiply'],
};

let grainTile: string | null = null;
function getGrainTile() {
  if (grainTile || typeof document === 'undefined') return grainTile;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(256, 256);
  const r = rng('grain');
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(r() * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTile = c.toDataURL('image/png');
  return grainTile;
}

function Grain({ intensity, frame }: { intensity: number; frame: number }) {
  const tile = useMemo(() => getGrainTile(), []);
  if (!tile) return null;
  const r = rng(frame);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${tile})`,
        backgroundSize: '256px 256px',
        backgroundPosition: `${Math.floor(r() * 256)}px ${Math.floor(r() * 256)}px`,
        opacity: intensity * 0.32,
        mixBlendMode: 'overlay',
      }}
    />
  );
}

/** Screen-space effects layered over the camera'd scene. */
export function ScreenFx({ fx, t, frame, shotDuration, uid }: { fx: Fx[]; t: number; frame: number; shotDuration: number; uid: string }) {
  return (
    <>
      {fx.map((f, i) => {
        const key = `${uid}-fx${i}`;
        const env = fxEnvelope(f, t, shotDuration, f.type === 'flash' || f.type === 'shockwave' ? 0 : 0.35);
        if (env <= 0) return null;
        const local = t - (f.at ?? 0);
        switch (f.type) {
          case 'particles':
            return (
              <AbsoluteFill key={key} style={{ opacity: env }}>
                <Particles variant={f.variant} intensity={f.intensity} t={t} seed={key} />
              </AbsoluteFill>
            );
          case 'light-rays':
            return (
              <AbsoluteFill key={key} style={{ opacity: env }}>
                <LightRays color={f.color} intensity={f.intensity} t={t} uid={key} />
              </AbsoluteFill>
            );
          case 'divine-light':
            return (
              <AbsoluteFill key={key} style={{ opacity: env }}>
                <DivineLight x={f.x} color={f.color} intensity={f.intensity} t={t} uid={key} />
              </AbsoluteFill>
            );
          case 'flash': {
            const k = clamp(local / f.duration, 0, 1);
            return <AbsoluteFill key={key} style={{ background: f.color, opacity: (1 - k) * (1 - k) }} />;
          }
          case 'shockwave': {
            const k = clamp(local / f.duration, 0, 1);
            if (k >= 1) return null;
            return <Shockwave key={key} x={f.x ?? 0.5} y={f.y ?? 0.45} color={f.color} k={k} />;
          }
          case 'lightning':
            return <Lightning key={key} t={local} intensity={f.intensity} seed={key} />;
          case 'fog':
            return (
              <AbsoluteFill key={key} style={{ opacity: env }}>
                <Fog intensity={f.intensity} color={f.color} t={t} seed={key} />
              </AbsoluteFill>
            );
          case 'speed-lines':
            return (
              <AbsoluteFill key={key} style={{ opacity: env }}>
                <SpeedLines intensity={f.intensity} frame={frame} seed={key} />
              </AbsoluteFill>
            );
          case 'tint': {
            const [color, mode] = TINTS[f.variant] ?? TINTS.warm!;
            return <AbsoluteFill key={key} style={{ background: color, mixBlendMode: mode, opacity: f.intensity * 0.7 * env }} />;
          }
          case 'vignette':
            return <AbsoluteFill key={key} style={{ background: `radial-gradient(ellipse at 50% 45%, transparent 48%, rgba(8,4,16,${0.9 * f.intensity * env}) 100%)` }} />;
          case 'grain':
            return <Grain key={key} intensity={f.intensity * env} frame={frame} />;
          default:
            return null;
        }
      })}
    </>
  );
}

export { hashString };
