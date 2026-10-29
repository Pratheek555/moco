import React from 'react';
import { clamp, darken, lerp, lighten, mix } from '../util.ts';
import type { CharacterDef, ExpressionVector, RigState } from './types.ts';

const GOLD = '#e2a83a';
const GOLD_DARK = '#a8741c';
const INK = '#1a1014';

// Head-local coordinates: origin at the head centre, face spans x ±78, y -92…90.

const FACE = 'M0 -92 C50 -92 79 -58 79 -6 C79 40 54 76 0 90 C-54 76 -79 40 -79 -6 C-79 -58 -50 -92 0 -92 Z';
const FACE_F = 'M0 -90 C48 -90 75 -58 75 -8 C75 38 50 72 0 86 C-50 72 -75 38 -75 -8 C-75 -58 -48 -90 0 -90 Z';
const EYE = 'M-17 2 C-10 -11 10 -14 21 -3 C12 8 -6 10 -17 2 Z';

export function HairBack({ def, t }: { def: CharacterDef; t: number }) {
  const c = def.hair.color;
  const sway = Math.sin(t * 1.3) * 3;
  switch (def.hair.style) {
    case 'wavy-long': {
      const curl = (x: number, y: number, r: number, k: number) => <circle key={`${x}${y}`} cx={x + sway * k} cy={y} r={r} />;
      return (
        <g fill={c}>
          <path d={`M-86 -50 C-104 20 -100 100 ${-96 + sway} 150 L${96 + sway} 150 C100 100 104 20 86 -50 Z`} />
          {[[-84, 156, 16], [-58, 166, 16], [-30, 168, 14], [30, 168, 14], [58, 166, 16], [84, 156, 16]].map(([x, y, r], i) => curl(x!, y!, r!, i % 2 ? 1 : 0.6))}
          <path d={`M-60 40 C-70 90 -60 130 -66 170 M60 40 C70 90 60 130 66 170`} stroke={lighten(c, 0.14)} strokeWidth={4} fill="none" opacity={0.5} />
        </g>
      );
    }
    case 'long-open':
      return (
        <path
          fill={c}
          d={`M-82 -50 C-112 60 -116 240 ${-108 + sway} 400 C-90 430 -60 424 -40 404 L40 404 C60 424 90 430 ${108 + sway} 400 C116 240 112 60 82 -50 Z`}
        />
      );
    case 'braid':
      return <path fill={c} d="M-82 -48 C-100 40 -98 110 -92 150 L92 150 C98 110 100 40 82 -48 Z" />;
    case 'jata':
      return (
        <g fill={c}>
          {[-88, -64, 64, 88].map((x, i) => (
            <path
              key={x}
              d={`M${x - 12} -30 C${x - 22 + sway} 60 ${x + 10} 120 ${x - 8 + sway * (i % 2 ? 1 : -1)} 210 L${x + 12} 210 C${x + 24} 120 ${x - 2} 60 ${x + 12} -30 Z`}
            />
          ))}
        </g>
      );
    case 'child-curls':
      return <path fill={c} d="M-84 -40 C-96 20 -90 60 -78 82 L78 82 C90 60 96 20 84 -40 Z" />;
    default:
      return null;
  }
}

function HairFront({ def }: { def: CharacterDef }) {
  const c = def.hair.color;
  const hi = lighten(c, 0.18);
  switch (def.hair.style) {
    case 'wavy-long':
    case 'braid':
    case 'long-open': {
      const female = def.body === 'female';
      return (
        <g>
          <path
            fill={c}
            d={
              female
                ? 'M-80 -14 C-86 -78 -50 -104 0 -104 C50 -104 86 -78 80 -14 C70 -50 40 -70 4 -72 L0 -64 L-4 -72 C-40 -70 -70 -50 -80 -14 Z'
                : 'M-80 -18 C-86 -80 -50 -104 0 -104 C50 -104 86 -80 80 -18 C72 -40 56 -58 30 -62 C14 -52 -8 -56 -22 -64 C-46 -60 -70 -46 -80 -18 Z'
            }
          />
          <path d="M-46 -88 C-26 -98 6 -98 28 -92" stroke={hi} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.6} />
          {def.hair.style === 'braid' && (
            <g>
              {Array.from({ length: 9 }, (_, i) => (
                <ellipse key={i} cx={86 + Math.sin(i * 0.8) * 4} cy={70 + i * 34} rx={17 - i * 0.7} ry={21} fill={i % 2 ? c : hi} stroke={darken(c, 0.4)} strokeWidth={2} />
              ))}
              <circle cx={84} cy={64} r={9} fill="#fff8e6" />
              <circle cx={96} cy={60} r={7} fill="#ff8fab" />
            </g>
          )}
        </g>
      );
    }
    case 'short':
      return <path fill={c} d="M-80 -20 C-84 -80 -48 -102 0 -102 C48 -102 84 -80 80 -20 C66 -54 30 -66 0 -64 C-30 -66 -66 -54 -80 -20 Z" />;
    case 'child-curls':
      return (
        <g fill={c}>
          <path d="M-80 -14 C-86 -80 -50 -102 0 -102 C50 -102 86 -80 80 -14 C66 -50 30 -60 0 -58 C-30 -60 -66 -50 -80 -14 Z" />
          {[-62, -40, -16, 10, 34, 58].map((x, i) => (
            <circle key={x} cx={x} cy={-62 + (i % 2) * 6} r={13} />
          ))}
          <ellipse cx={0} cy={-112} rx={22} ry={18} />
        </g>
      );
    case 'bun-top':
      return (
        <g fill={c}>
          <path d="M-79 -10 C-82 -76 -46 -100 0 -100 C46 -100 82 -76 79 -10 C66 -50 34 -64 0 -64 C-34 -64 -66 -50 -79 -10 Z" />
          <ellipse cx={0} cy={-118} rx={36} ry={30} />
          <ellipse cx={0} cy={-150} rx={20} ry={18} />
          <path d="M-34 -104 C-10 -94 10 -94 34 -104" stroke={darken(c, 0.25)} strokeWidth={4} fill="none" />
          <circle cx={0} cy={-92} r={6} fill="#7a4a2a" />
        </g>
      );
    case 'jata':
      return (
        <g>
          <path fill={def.hair.color} d="M-80 -12 C-84 -76 -46 -100 0 -100 C46 -100 84 -76 80 -12 C66 -50 34 -64 0 -64 C-34 -64 -66 -50 -80 -12 Z" />
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={i} cx={0} cy={-112 - i * 30} rx={44 - i * 7} ry={22} fill={i % 2 ? def.hair.color : lighten(def.hair.color, 0.12)} stroke={darken(def.hair.color, 0.4)} strokeWidth={2} />
          ))}
          <path d="M14 -230 C30 -262 50 -270 66 -262" stroke="#9fd8ff" strokeWidth={7} fill="none" strokeLinecap="round" opacity={0.85} />
          <path d="M18 -224 C36 -246 56 -246 70 -236" stroke="#d6f0ff" strokeWidth={3} fill="none" strokeLinecap="round" />
          <path d="M-48 -176 A30 30 0 1 0 -14 -132 A24 24 0 1 1 -48 -176 Z" fill="#fff6d8" stroke="#e8d9a8" strokeWidth={2} />
          {[-30, 0, 30].map((x) => (
            <circle key={x} cx={x} cy={-98} r={5} fill="#7a4a2a" />
          ))}
        </g>
      );
    case 'shikha':
      return (
        <g>
          <path d="M-4 -96 C-10 -128 10 -150 34 -146 C16 -138 8 -122 10 -98 Z" fill={def.hair.color} />
          <path d="M-56 -70 C-30 -84 30 -84 56 -70" stroke={darken(def.skin, 0.12)} strokeWidth={3} fill="none" opacity={0.5} />
        </g>
      );
    default:
      return null;
  }
}

function Crown({ def }: { def: CharacterDef }) {
  const gem = def.crownGem;
  switch (def.crown) {
    case 'mukut':
      return (
        <g>
          <path d="M-70 -64 C-72 -110 -44 -134 -22 -148 C-10 -166 10 -166 22 -148 C44 -134 72 -110 70 -64 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={3} />
          <path d="M-52 -76 C-52 -108 -32 -124 -14 -134 C-6 -146 6 -146 14 -134 C32 -124 52 -108 52 -76 Z" fill="none" stroke={GOLD_DARK} strokeWidth={2.5} opacity={0.7} />
          <rect x={-74} y={-80} width={148} height={20} rx={8} fill={GOLD} stroke={GOLD_DARK} strokeWidth={3} />
          {[-56, -28, 0, 28, 56].map((x) => (
            <circle key={x} cx={x} cy={-70} r={x === 0 ? 0 : 4.5} fill="#fff6dc" />
          ))}
          <circle cx={0} cy={-104} r={13} fill={gem} stroke="#fff3c4" strokeWidth={3} />
          <circle cx={-4} cy={-108} r={4} fill="#ffffff" opacity={0.7} />
          <circle cx={-34} cy={-98} r={6} fill="#1f9e5a" />
          <circle cx={34} cy={-98} r={6} fill="#1f9e5a" />
          <circle cx={0} cy={-152} r={6} fill="#fff6dc" />
        </g>
      );
    case 'kirita':
    case 'dark-kirita':
    case 'sun-kirita': {
      const metal = def.crown === 'dark-kirita' ? '#9a7426' : GOLD;
      const edge = def.crown === 'dark-kirita' ? '#4e3a14' : GOLD_DARK;
      return (
        <g>
          {def.crown === 'sun-kirita' && (
            <g>
              {Array.from({ length: 16 }, (_, i) => (
                <path key={i} d="M-9 -150 L0 -232 L9 -150 Z" fill="#ffb12b" transform={`rotate(${i * 22.5} 0 -150)`} opacity={0.95} />
              ))}
              <circle cx={0} cy={-150} r={60} fill="#ffc94a" stroke="#f08c00" strokeWidth={4} />
            </g>
          )}
          <path d="M-68 -66 L-50 -142 C-34 -186 -14 -206 0 -224 C14 -206 34 -186 50 -142 L68 -66 Z" fill={metal} stroke={edge} strokeWidth={3} />
          {[-104, -134, -164].map((y, i) => (
            <path key={y} d={`M${-58 + i * 8} ${y} C${-20} ${y - 12} 20 ${y - 12} ${58 - i * 8} ${y}`} stroke={edge} strokeWidth={4} fill="none" />
          ))}
          <path d="M-74 -62 C-90 -76 -92 -96 -78 -104 C-76 -90 -68 -82 -58 -78 Z" fill={metal} stroke={edge} strokeWidth={2} />
          <path d="M74 -62 C90 -76 92 -96 78 -104 C76 -90 68 -82 58 -78 Z" fill={metal} stroke={edge} strokeWidth={2} />
          <rect x={-76} y={-80} width={152} height={22} rx={9} fill={metal} stroke={edge} strokeWidth={3} />
          {[-54, -30, 30, 54].map((x) => (
            <circle key={x} cx={x} cy={-69} r={4.5} fill="#fff4d0" />
          ))}
          <path d="M0 -122 L14 -100 L0 -78 L-14 -100 Z" fill={gem} stroke="#fff3c4" strokeWidth={3} />
          <circle cx={0} cy={-226} r={9} fill={metal} stroke={edge} strokeWidth={2} />
          <circle cx={0} cy={-150} r={6} fill={gem} />
        </g>
      );
    }
    case 'band':
      return (
        <g>
          <path d="M-78 -54 C-60 -76 60 -76 78 -54 L76 -38 C56 -58 -56 -58 -76 -38 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={3} />
          <path d="M-14 -66 L0 -98 L14 -66 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={2.5} />
          <circle cx={0} cy={-62} r={9} fill={def.crownGem} stroke="#fff3c4" strokeWidth={2.5} />
        </g>
      );
    case 'tiara':
      return (
        <g>
          <path d="M-60 -72 C-30 -90 30 -90 60 -72 L52 -64 C26 -78 -26 -78 -52 -64 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={2.5} />
          {[-34, 0, 34].map((x) => (
            <path key={x} d={`M${x - 9} -80 L${x} ${x === 0 ? -108 : -98} L${x + 9} -80 Z`} fill={GOLD} stroke={GOLD_DARK} strokeWidth={2} />
          ))}
          <path d="M0 -76 L0 -58" stroke={GOLD} strokeWidth={3} />
          <path d="M0 -60 L8 -50 L0 -40 L-8 -50 Z" fill={def.crownGem} stroke={GOLD} strokeWidth={2.5} />
          <circle cx={0} cy={-36} r={3.5} fill="#fff4d0" />
        </g>
      );
    case 'helmet':
      return (
        <g>
          <path d="M-82 -26 C-86 -110 -40 -118 0 -118 C40 -118 86 -110 82 -26 L66 -36 C40 -60 -40 -60 -66 -36 Z" fill="#a07a3c" stroke="#5c4326" strokeWidth={3} />
          <path d="M0 -118 L0 -40" stroke="#5c4326" strokeWidth={6} />
          <path d="M-6 -150 C-2 -134 2 -126 6 -118 L-6 -118 Z" fill="#b8322a" />
          <path d="M0 -118 C20 -150 40 -160 64 -158 C44 -144 24 -132 8 -116 Z" fill="#b8322a" />
        </g>
      );
    default:
      return null;
  }
}

function PeacockFeather({ t }: { t: number }) {
  const sway = Math.sin(t * 1.6) * 2.5;
  return (
    <g transform={`rotate(${18 + sway} 26 -120)`}>
      <path d="M26 -120 C28 -170 30 -220 30 -268" stroke="#6b8f3a" strokeWidth={3} fill="none" />
      {Array.from({ length: 14 }, (_, i) => {
        const y = -150 - i * 9;
        const w = 10 + Math.sin((i / 13) * Math.PI) * 18;
        return <path key={i} d={`M29 ${y} C${29 - w} ${y - 10} ${29 - w * 1.2} ${y - 22} ${29 - w * 1.1} ${y - 30} M29 ${y} C${29 + w} ${y - 10} ${29 + w * 1.2} ${y - 22} ${29 + w * 1.1} ${y - 30}`} stroke="#3f9a52" strokeWidth={2} fill="none" opacity={0.85} />;
      })}
      <ellipse cx={30} cy={-262} rx={24} ry={36} fill="#2f9e44" />
      <ellipse cx={30} cy={-258} rx={17} ry={26} fill="#e2a83a" />
      <ellipse cx={30} cy={-255} rx={12} ry={18} fill="#1c7ed6" />
      <ellipse cx={30} cy={-252} rx={7} ry={10} fill="#0b1f4d" />
      <ellipse cx={28} cy={-256} rx={2.5} ry={3.5} fill="#ffffff" opacity={0.6} />
    </g>
  );
}

function Eye({ side, x, y, def, ex, blink, look, id }: { side: 1 | -1; x: number; y: number; def: CharacterDef; ex: ExpressionVector; blink: number; look: { x: number; y: number }; id: string }) {
  const closed = Math.max(ex.eyeClosed, blink > 0.86 ? 1 : 0);
  const open = clamp(ex.eyeOpen * (1 - blink) * (1 - ex.eyeSmile * 0.42), 0, 1.4);
  const lid = darken(def.skin, 0.35);
  if (closed >= 0.5) {
    const serene = ex.eyeClosed >= 0.5;
    return (
      <g transform={`translate(${x} ${y}) scale(${side * 1.14} 1.14)`}>
        <path d={serene ? 'M-17 0 C-6 9 10 9 21 -2' : 'M-17 1 C-6 6 10 5 21 -3'} stroke={INK} strokeWidth={4.5} fill="none" strokeLinecap="round" />
        <path d="M21 -2 L27 -6" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
        {serene && <path d="M-6 7 L-8 12 M4 8 L4 13 M13 5 L15 10" stroke={INK} strokeWidth={2} strokeLinecap="round" />}
      </g>
    );
  }
  const lx = clamp(look.x, -1, 1) * 6;
  const ly = clamp(look.y, -1, 1) * 3.5 - ex.eyeSmile * 2;
  const clip = `${id}-eye-${side}`;
  return (
    <g transform={`translate(${x} ${y - ex.eyeSmile * 2}) scale(${side * 1.14} 1.14)`}>
      <defs>
        <clipPath id={clip}>
          <path d={EYE} transform={`scale(1 ${open})`} />
        </clipPath>
      </defs>
      <path d={EYE} transform={`scale(1 ${open})`} fill="#fffaf2" />
      <g clipPath={`url(#${clip})`}>
        <circle cx={lx * side + 1} cy={ly} r={10.5} fill={def.iris} />
        <circle cx={lx * side + 1} cy={ly} r={6.5} fill="#0a0608" />
        <circle cx={lx * side - 2.5} cy={ly - 4} r={3.2} fill="#ffffff" />
        <circle cx={lx * side + 4.5} cy={ly + 3} r={1.5} fill="#ffffff" opacity={0.8} />
        <path d={EYE} transform={`scale(1 ${open})`} fill="none" stroke={lid} strokeWidth={6} opacity={0.18} />
      </g>
      <path d={`M-17 2 C-10 ${-11 * open} 10 ${-14 * open} 21 ${-3 * open}`} stroke={INK} strokeWidth={4.5} fill="none" strokeLinecap="round" />
      <path d={`M21 ${-3 * open} L28 ${-8 - open}`} stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      <path d={`M-14 4 C-4 ${10 * open} 8 ${9 * open} 19 ${-1 * open}`} stroke={INK} strokeWidth={1.6} fill="none" opacity={0.55} />
    </g>
  );
}

function Mouth({ def, ex, talk, round, vanara }: { def: CharacterDef; ex: ExpressionVector; talk: number; round: number; vanara: boolean }) {
  const open = clamp(Math.max(ex.mouthOpen, talk), 0, 1);
  const w = 34 * ex.mouthWidth * (1 - round * 0.35) * (vanara ? 1.15 : 1);
  const c = ex.mouthCurve;
  const cy = -c * 7;
  const lip = def.lips;
  if (open < 0.06) {
    return (
      <g>
        <path d={`M${-w / 2} ${cy} Q0 ${-c * 2 + 3 + c * 4} ${w / 2} ${cy}`} stroke={darken(lip, 0.25)} strokeWidth={3.5} fill="none" strokeLinecap="round" />
        <path d={`M${-w * 0.26} 6 Q0 ${11 + c} ${w * 0.26} 6`} stroke={lip} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.55} />
      </g>
    );
  }
  const h = open * 20;
  const top = -c * 2 - open * 3;
  const bottom = h + 4 - c;
  const shape = `M${-w / 2} ${cy} Q0 ${top} ${w / 2} ${cy} Q0 ${bottom * 1.3} ${-w / 2} ${cy} Z`;
  const clip = `mouth-${def.id}-${Math.round(open * 100)}-${Math.round(c * 10)}`;
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <path d={shape} />
        </clipPath>
      </defs>
      <path d={shape} fill="#5a1a22" />
      <g clipPath={`url(#${clip})`}>
        <ellipse cx={0} cy={bottom * 0.9} rx={w * 0.3} ry={h * 0.4 + 2} fill="#c45864" />
        {(ex.teeth || open > 0.45) && <rect x={-w / 2} y={Math.min(cy, top) - 2} width={w} height={6 + open * 2} fill="#fffaf0" />}
      </g>
      <path d={shape} fill="none" stroke={darken(lip, 0.1)} strokeWidth={3} strokeLinejoin="round" />
    </g>
  );
}

function Tilak({ def }: { def: CharacterDef }) {
  switch (def.tilak) {
    case 'vaishnava':
      return (
        <g>
          <path d="M-10 -76 L-8 -40 C-6 -30 6 -30 8 -40 L10 -76" stroke="#fff4d6" strokeWidth={4.5} fill="none" strokeLinecap="round" />
          <path d="M0 -70 L0 -42" stroke="#d6283a" strokeWidth={4} strokeLinecap="round" />
        </g>
      );
    case 'tripundra':
      return (
        <g>
          {[-64, -55, -46].map((y) => (
            <path key={y} d={`M-36 ${y + 2} Q0 ${y - 4} 36 ${y + 2}`} stroke="#f5f1e6" strokeWidth={4} fill="none" strokeLinecap="round" />
          ))}
          {!def.thirdEye && <circle cx={0} cy={-55} r={4.5} fill="#d6283a" />}
        </g>
      );
    case 'red-line':
      return <path d="M0 -74 L0 -44" stroke="#c92a2a" strokeWidth={5} strokeLinecap="round" />;
    case 'bindi':
      return <circle cx={0} cy={-40} r={5.5} fill="#c92a2a" />;
    default:
      return null;
  }
}

function Earring({ def, x, t }: { def: CharacterDef; x: number; t: number }) {
  const swing = Math.sin(t * 2.1 + x) * 4;
  switch (def.earrings) {
    case 'kundal':
      return (
        <g transform={`rotate(${swing} ${x} 18)`}>
          <circle cx={x} cy={40} r={14} fill="none" stroke={GOLD} strokeWidth={5.5} />
          <circle cx={x} cy={54} r={4.5} fill={def.crownGem} />
        </g>
      );
    case 'jhumka':
      return (
        <g transform={`rotate(${swing} ${x} 18)`}>
          <path d={`M${x - 12} 46 C${x - 12} 28 ${x + 12} 28 ${x + 12} 46 Z`} fill={GOLD} stroke={GOLD_DARK} strokeWidth={2} />
          {[-9, -3, 3, 9].map((d) => (
            <circle key={d} cx={x + d} cy={50} r={2.6} fill="#fff4d0" />
          ))}
        </g>
      );
    case 'hoop':
      return <circle cx={x} cy={34} r={11} fill="none" stroke={GOLD} strokeWidth={3} />;
    case 'rudraksha':
      return <circle cx={x} cy={30} r={7} fill="#7a3f22" stroke="#4a2414" strokeWidth={2} />;
    default:
      return null;
  }
}

function Beard({ def, front }: { def: CharacterDef; front: boolean }) {
  const c = def.beard.color;
  const s = def.beard.style;
  if (s === 'none') return null;
  const mustache = (
    <path
      d={s === 'mustache' ? 'M-34 40 C-24 30 -10 36 0 44 C10 36 24 30 34 40 C40 34 44 26 42 20 C46 34 38 50 24 48 C14 46 6 48 0 50 C-6 48 -14 46 -24 48 C-38 50 -46 34 -42 20 C-44 26 -40 34 -34 40 Z' : 'M-30 44 C-20 34 -8 38 0 44 C8 38 20 34 30 44 C22 52 10 50 0 50 C-10 50 -22 52 -30 44 Z'}
      fill={c}
    />
  );
  if (front) return mustache;
  if (s === 'long')
    return (
      <path
        fill={c}
        d="M-70 0 C-74 70 -60 140 -36 200 C-20 236 -8 250 0 256 C8 250 20 236 36 200 C60 140 74 70 70 0 C62 40 48 62 30 66 C14 74 -14 74 -30 66 C-48 62 -62 40 -70 0 Z"
      />
    );
  if (s === 'short')
    return <path fill={c} d="M-74 -4 C-76 50 -50 104 0 118 C50 104 76 50 74 -4 C64 36 46 60 28 66 C12 72 -12 72 -28 66 C-46 60 -64 36 -74 -4 Z" />;
  return null;
}

function VanaraFace({ def, ex, rig, id }: { def: CharacterDef; ex: ExpressionVector; rig: RigState; id: string }) {
  const muzzle = '#f3cfa6';
  const fur = def.skin;
  return (
    <g>
      <ellipse cx={-84} cy={-4} rx={18} ry={22} fill={fur} />
      <ellipse cx={84} cy={-4} rx={18} ry={22} fill={fur} />
      <ellipse cx={-84} cy={-4} rx={9} ry={12} fill={muzzle} />
      <ellipse cx={84} cy={-4} rx={9} ry={12} fill={muzzle} />
      <path d={FACE} fill={fur} />
      <path d="M-79 10 L-94 22 L-80 30 L-92 44 L-74 46 Z M79 10 L94 22 L80 30 L92 44 L74 46 Z" fill={darken(fur, 0.08)} />
      <path d="M-58 -50 C-40 -64 -12 -60 0 -46 C12 -60 40 -64 58 -50 C60 -20 40 -6 0 -6 C-40 -6 -60 -20 -58 -50 Z" fill={muzzle} opacity={0.7} />
      <ellipse cx={0} cy={36} rx={56} ry={46} fill={muzzle} />
      <path d="M-50 -34 C-30 -46 -10 -42 -4 -36 M50 -34 C30 -46 10 -42 4 -36" stroke={darken(fur, 0.35)} strokeWidth={7} strokeLinecap="round" fill="none" />
      <Eye side={-1} x={-28} y={-20} def={def} ex={ex} blink={rig.blink} look={rig.look} id={id} />
      <Eye side={1} x={28} y={-20} def={def} ex={ex} blink={rig.blink} look={rig.look} id={id} />
      <path d="M-9 12 C-4 6 4 6 9 12 C6 18 -6 18 -9 12 Z" fill="#3a1f18" />
      <g transform="translate(0 46)">
        <Mouth def={def} ex={ex} talk={rig.talk} round={rig.round} vanara />
      </g>
    </g>
  );
}

export function Head({ def, rig, id }: { def: CharacterDef; rig: RigState; id: string }) {
  const ex = rig.expression;
  const female = def.body === 'female';
  const shade = darken(def.skin, 0.14);
  const browTilt = ex.browTilt * 14;
  const brow = (side: 1 | -1) => (
    <path
      d="M-17 4 C-6 -6 8 -8 19 -1"
      transform={`translate(${side * 31} ${-30 + ex.browY}) scale(${side} 1) rotate(${-browTilt})`}
      stroke={def.hair.style === 'bald' || def.hair.style === 'shikha' ? darken(def.skin, 0.55) : mix(def.hair.color, INK, 0.3)}
      strokeWidth={female ? 4.5 : 6}
      strokeLinecap="round"
      fill="none"
    />
  );
  return (
    <g>
      {def.peacockFeather && <PeacockFeather t={rig.time} />}
      {def.head === 'vanara' ? (
        <VanaraFace def={def} ex={ex} rig={rig} id={id} />
      ) : (
        <g>
          <ellipse cx={-78} cy={2} rx={12} ry={21} fill={def.skin} />
          <ellipse cx={78} cy={2} rx={12} ry={21} fill={def.skin} />
          <ellipse cx={-79} cy={4} rx={5} ry={11} fill={shade} />
          <ellipse cx={79} cy={4} rx={5} ry={11} fill={shade} />
          <path d={female ? FACE_F : FACE} fill={def.skin} />
          <path d="M44 -70 C70 -40 76 10 60 46 C70 10 66 -36 44 -70 Z" fill={shade} opacity={0.5} />
          <Beard def={def} front={false} />
          <ellipse cx={-44} cy={28} rx={15} ry={9} fill="#ff5f78" opacity={ex.blush * 0.45} />
          <ellipse cx={44} cy={28} rx={15} ry={9} fill="#ff5f78" opacity={ex.blush * 0.45} />
          <Eye side={-1} x={-31} y={-2} def={def} ex={ex} blink={rig.blink} look={rig.look} id={id} />
          <Eye side={1} x={31} y={-2} def={def} ex={ex} blink={rig.blink} look={rig.look} id={id} />
          {brow(-1)}
          {brow(1)}
          <path d="M3 4 C6 14 8 22 6 28" stroke={shade} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.6} />
          <path d="M-7 30 C-3 35 4 35 8 30" stroke={darken(def.skin, 0.3)} strokeWidth={3} fill="none" strokeLinecap="round" />
          <g transform="translate(0 52)">
            <Mouth def={def} ex={ex} talk={rig.talk} round={rig.round} vanara={false} />
          </g>
          <Beard def={def} front />
          <Tilak def={def} />
          {def.thirdEye && (
            <g>
              <path d="M0 -78 C7 -66 7 -54 0 -42 C-7 -54 -7 -66 0 -78 Z" fill="#fff6ee" stroke={INK} strokeWidth={2.5} />
              <ellipse cx={0} cy={-60} rx={3} ry={7} fill="#c92a2a" />
            </g>
          )}
          {female && def.tilak !== 'bindi' && <circle cx={0} cy={-40} r={5} fill="#c92a2a" />}
          {female && <circle cx={-10} cy={34} r={4} fill="none" stroke={GOLD} strokeWidth={2} />}
        </g>
      )}
      <Earring def={def} x={-80} t={rig.time} />
      <Earring def={def} x={80} t={rig.time} />
      {def.head !== 'vanara' && <HairFront def={def} />}
      <Crown def={def} />
      {def.head === 'vanara' && def.tilak !== 'none' && <path d="M0 -84 L0 -56" stroke="#e8590c" strokeWidth={8} strokeLinecap="round" />}
    </g>
  );
}

export { lerp };
