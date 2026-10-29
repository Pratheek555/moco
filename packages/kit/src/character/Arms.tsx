import React from 'react';
import { HELD_PROPS } from '../props/held.tsx';
import { along, angleOf, darken, ik, lerp, lighten, limb, type Pt } from '../util.ts';
import type { CharacterDef, HandShape } from './types.ts';

const GOLD = '#e2a83a';
const UPPER = 158;
const FORE = 148;

export interface ArmSolve {
  s: Pt;
  e: Pt;
  h: Pt;
  /** Direction the fingers point, degrees (90 = down). */
  dir: number;
}

/** Solve one arm in right-arm space (x outward = +x). */
export function solveArm(shoulder: Pt, target: [number, number], bend: number, twist: number, aim: number): ArmSolve {
  const goal = { x: shoulder.x + target[0], y: shoulder.y + target[1] };
  const { e, h } = ik(shoulder, goal, UPPER, FORE, bend);
  const fore = angleOf(e, h);
  const a1 = (fore * Math.PI) / 180;
  const a2 = (twist * Math.PI) / 180;
  const k = Math.min(1, Math.max(0, aim));
  const vx = Math.cos(a1) * (1 - k) + Math.cos(a2) * k;
  const vy = Math.sin(a1) * (1 - k) + Math.sin(a2) * k;
  const dir = Math.hypot(vx, vy) < 1e-3 ? fore : (Math.atan2(vy, vx) * 180) / Math.PI;
  return { s: shoulder, e, h, dir: aim > 0 ? dir : fore + twist };
}

function Hand({ shape, skin, alta }: { shape: HandShape; skin: string; alta: boolean }) {
  const line = darken(skin, 0.28);
  switch (shape) {
    case 'open':
      return (
        <g>
          <path d="M-17 2 L-19 34 C-19 46 -10 52 0 52 C12 52 19 46 19 34 L17 2 Z" fill={skin} />
          {[
            [-13, 30],
            [-4.5, 35],
            [4.5, 33],
            [13, 26],
          ].map(([x, len]) => (
            <path key={x} d={`M${x} 40 L${x! * 1.08} ${40 + len!}`} stroke={skin} strokeWidth={9.5} strokeLinecap="round" />
          ))}
          <path d="M-16 14 L-34 34" stroke={skin} strokeWidth={10} strokeLinecap="round" />
          {alta && <circle cx={0} cy={28} r={6.5} fill="#d6283a" opacity={0.85} />}
          <path d="M-8 44 L-8 50 M2 46 L2 52" stroke={line} strokeWidth={1.5} opacity={0.5} />
        </g>
      );
    case 'fist':
    case 'hold':
      return (
        <g>
          <path d="M-18 0 L-20 30 C-20 46 -8 50 2 50 C14 50 22 44 22 30 L18 0 Z" fill={skin} />
          <path d="M-14 34 C-8 38 -2 38 2 34 M2 34 C8 38 14 38 18 32 M-12 44 C-4 48 6 48 14 44" stroke={line} strokeWidth={2} fill="none" />
          <path d="M-18 16 C-26 26 -22 36 -10 34" stroke={skin} strokeWidth={10} strokeLinecap="round" fill="none" />
        </g>
      );
    case 'point':
      return (
        <g>
          <path d="M-18 0 L-20 30 C-20 46 -8 50 2 50 C14 50 22 44 22 30 L18 0 Z" fill={skin} />
          <path d="M10 40 L12 86" stroke={skin} strokeWidth={11} strokeLinecap="round" />
          <path d="M-14 36 C-8 40 0 40 4 36" stroke={line} strokeWidth={2} fill="none" />
          <path d="M-18 16 C-26 26 -22 36 -10 34" stroke={skin} strokeWidth={10} strokeLinecap="round" fill="none" />
        </g>
      );
    case 'pray':
      return (
        <g>
          <path d="M-12 0 C-16 30 -12 60 -4 76 C2 82 8 78 10 70 C14 50 14 24 12 0 Z" fill={skin} />
          <path d="M-6 40 L-4 72 M2 42 L4 74" stroke={line} strokeWidth={1.6} opacity={0.5} />
        </g>
      );
    default:
      return (
        <g>
          <path d="M-16 0 C-20 22 -14 42 -6 52 C2 58 12 54 16 42 C20 28 18 10 14 0 Z" fill={skin} />
          <path d="M-14 12 C-24 22 -24 32 -16 36" stroke={skin} strokeWidth={9} strokeLinecap="round" fill="none" />
          <path d="M-4 44 C2 48 8 46 12 40" stroke={line} strokeWidth={1.8} fill="none" opacity={0.6} />
        </g>
      );
  }
}

export function Arm({
  def,
  solve,
  shape,
  hold,
  t,
}: {
  def: CharacterDef;
  solve: ArmSolve;
  shape: HandShape;
  hold?: string;
  t: number;
}) {
  const { s, e, h, dir } = solve;
  const armour = def.top.kind === 'armor';
  const female = def.body === 'female';
  const prop = hold ? HELD_PROPS[hold] : undefined;
  const handShape: HandShape = prop && (shape === 'relaxed' || shape === 'open') ? 'hold' : shape;
  const grip = { x: h.x + Math.cos((dir * Math.PI) / 180) * 28, y: h.y + Math.sin((dir * Math.PI) / 180) * 28 };
  let propAngle = 0;
  if (prop) {
    if (prop.mode === 'follow') propAngle = dir + 90;
    else if (prop.mode === 'flute') propAngle = dir;
    else if (prop.mode === 'upright') propAngle = Math.sin(t * 1.1) * 1.5;
    else propAngle = 0;
  }
  const band = (p: Pt, q: Pt, f: number, w: number, color: string, thick = 7) => {
    const c = along(p, q, f);
    const a = angleOf(p, q);
    return <rect x={c.x - w / 2} y={c.y - thick / 2} width={w} height={thick} rx={thick / 2} fill={color} transform={`rotate(${a + 90} ${c.x} ${c.y})`} />;
  };
  const upperW = (female ? 42 : 54) * def.build;
  const lit = lighten(def.skin, 0.16);
  const shoulder = { x: s.x - 6, y: s.y + 4 };
  return (
    <g>
      <path d={limb(shoulder, e, upperW, female ? 31 : 38, 3)} fill={def.skin} />
      <path d={limb(along(shoulder, e, 0.08), along(shoulder, e, 0.85), upperW * 0.28, 10)} fill={lit} opacity={0.35} transform={`translate(${-upperW * 0.18} 0)`} />
      {female && <path d={limb(shoulder, along(shoulder, e, 0.42), upperW + 6, upperW + 2)} fill={def.top.color} />}
      {armour && <path d={limb(shoulder, along(shoulder, e, 0.3), upperW + 12, upperW + 6)} fill={def.top.color} stroke={darken(def.top.color, 0.35)} strokeWidth={3} />}
      {!female && band(s, e, 0.42, upperW + 2, GOLD, 9)}
      <path d={limb(e, h, female ? 30 : 37, female ? 24 : 28, 1)} fill={def.skin} />
      <path d={limb(along(e, h, 0.1), along(e, h, 0.8), 9, 6)} fill={lit} opacity={0.3} transform={`translate(${-8} 0)`} />
      {armour && <path d={limb(along(e, h, 0.45), along(e, h, 0.93), 40, 34)} fill={def.top.color} stroke={darken(def.top.color, 0.35)} strokeWidth={3} />}
      {female ? (
        <g>
          {band(e, h, 0.82, 32, '#d6283a', 5)}
          {band(e, h, 0.88, 31, GOLD, 5)}
          {band(e, h, 0.94, 30, '#2f9e44', 5)}
        </g>
      ) : (
        !armour && band(e, h, 0.9, 32, GOLD, 8)
      )}
      {prop && prop.mode !== 'hang' && <g transform={`translate(${grip.x} ${grip.y}) rotate(${propAngle})`}>{prop.render(t)}</g>}
      <g transform={`translate(${h.x} ${h.y}) rotate(${dir - 90})`}>
        <Hand shape={handShape} skin={def.skin} alta={shape === 'open' && (def.id.includes('krishna') || female || def.id === 'rama')} />
      </g>
      {prop && prop.mode === 'hang' && <g transform={`translate(${grip.x} ${grip.y})`}>{prop.render(t)}</g>}
    </g>
  );
}

export { lerp, UPPER, FORE };
