import React from 'react';
import { darken, lighten } from '../util.ts';
import type { CharacterDef, LegsMode } from './types.ts';

const GOLD = '#e2a83a';
const GOLD_DARK = '#a8741c';

// Character coordinates: feet at (0, 0), up is negative y. Waist ≈ -500,
// shoulders ≈ -735, head centre ≈ -880.

export const WAIST_Y = -505;
export const SHOULDER_Y = -728;
export const NECK_Y = -776;
export const HEAD_Y = -864;

export function shoulderX(def: CharacterDef) {
  return (def.body === 'female' ? 84 : 92) * def.build;
}

/** Things behind the whole body: tail, quiver, flowing cloth ends. */
export function BackLayer({ def, t }: { def: CharacterDef; t: number }) {
  const sway = Math.sin(t * 1.4);
  return (
    <g>
      {def.tail && (
        <path
          d={`M40 -470 C140 -430 210 -500 ${230 + sway * 8} -620 C${244 + sway * 10} -700 ${206 + sway * 6} -760 ${168 + sway * 4} -730 C150 -716 160 -690 182 -694`}
          stroke={def.skin}
          strokeWidth={24}
          fill="none"
          strokeLinecap="round"
        />
      )}
      {def.quiver && (
        <g transform="rotate(-20 80 -640)">
          {[-12, 0, 12].map((dx) => (
            <g key={dx}>
              <path d={`M${80 + dx} -900 L${80 + dx} -820`} stroke="#6b4a2a" strokeWidth={4} />
              <path d={`M${80 + dx} -912 c-7 8 -8 20 -4 30 l4 -6 l4 6 c4 -10 3 -22 -4 -30 Z`} fill="#d9cdb4" stroke="#9c8a68" strokeWidth={1.5} />
            </g>
          ))}
          <rect x={54} y={-840} width={52} height={250} rx={14} fill="#8a5a2b" stroke="#5a3a1a" strokeWidth={3} />
          <rect x={54} y={-840} width={52} height={20} rx={8} fill={GOLD} />
          <rect x={54} y={-680} width={52} height={12} fill={GOLD} />
        </g>
      )}
      {def.lower.kind === 'saree' && (
        <path d={`M-70 -740 C-130 -640 ${-150 + sway * 6} -480 ${-140 + sway * 8} -330 L-96 -340 C-100 -480 -90 -620 -40 -720 Z`} fill={darken(def.lower.color, 0.12)} />
      )}
      {def.scarf && (
        <path d={`M-96 -730 C-150 -600 ${-160 + sway * 6} -470 ${-150 + sway * 10} -360 L-120 -356 C-124 -470 -112 -600 -70 -716 Z`} fill={darken(def.scarf.color, 0.15)} />
      )}
    </g>
  );
}

function Feet({ def, spread, lift }: { def: CharacterDef; spread: number; lift: [number, number] }) {
  const foot = (x: number, dy: number, flip: number) => (
    <g transform={`translate(${x} ${-dy}) scale(${flip} 1)`}>
      <path d="M-16 -46 C-20 -16 -22 -4 -14 0 C-2 6 20 6 28 0 C32 -6 26 -18 18 -46 Z" fill={def.skin} />
      <path d="M-16 -44 L18 -44" stroke={GOLD} strokeWidth={6} strokeLinecap="round" />
      {def.body === 'female' && [-10, 0, 10].map((d) => <circle key={d} cx={d} cy={-38} r={2.5} fill={GOLD} />)}
    </g>
  );
  return (
    <g>
      {foot(-spread, lift[0], -1)}
      {foot(spread, lift[1], 1)}
    </g>
  );
}

function SitLegs({ def }: { def: CharacterDef }) {
  const c = def.lower.color;
  return (
    <g>
      <path d="M-226 -12 C-236 -96 -150 -122 -60 -124 C-20 -126 20 -126 60 -124 C150 -122 236 -96 226 -12 C140 8 -140 8 -226 -12 Z" fill={c} />
      <path d="M-200 -40 C-120 -70 -40 -76 0 -70 M200 -40 C120 -70 40 -76 0 -70" stroke={darken(c, 0.18)} strokeWidth={5} fill="none" />
      <path d="M-226 -12 C-140 8 140 8 226 -12" stroke={def.lower.border} strokeWidth={14} fill="none" />
      <ellipse cx={-70} cy={-96} rx={34} ry={18} fill={def.skin} transform="rotate(-12 -70 -96)" />
      <ellipse cx={70} cy={-96} rx={34} ry={18} fill={def.skin} transform="rotate(12 70 -96)" />
    </g>
  );
}

export function LowerBody({ def, legs, walk }: { def: CharacterDef; legs: LegsMode; walk: number }) {
  if (legs === 'sit') return <SitLegs def={def} />;
  const wide = legs === 'wide' ? 1 : 0;
  const stepping = legs === 'walk';
  const lift: [number, number] = stepping ? [Math.max(0, Math.sin(walk)) * 26, Math.max(0, -Math.sin(walk)) * 26] : [0, 0];
  const skew = stepping ? Math.sin(walk) * 3 : 0;
  const spread = 44 + wide * 34;
  const c = def.lower.color;
  const b = def.build;
  const kind = def.lower.kind;

  if (kind === 'tiger-skin') {
    return (
      <g>
        {[-1, 1].map((s) => (
          <path key={s} d={`M${s * 40} -320 C${s * 44} -200 ${s * (spread + 2)} -110 ${s * spread} -40`} stroke={def.skin} strokeWidth={46} strokeLinecap="round" fill="none" />
        ))}
        <Feet def={def} spread={spread} lift={lift} />
        <path d={`M${-80 * b} -505 C${-96 * b} -420 ${-104 * b} -340 ${-108 * b} -290 L-80 -300 L-60 -270 L-30 -300 L0 -276 L30 -300 L60 -270 L80 -300 L${108 * b} -290 C${104 * b} -340 ${96 * b} -420 ${80 * b} -505 Z`} fill={c} />
        {[[-70, -460], [-30, -410], [20, -450], [60, -390], [-60, -350], [10, -340]].map(([x, y], i) => (
          <path key={i} d={`M${x! - 14} ${y} C${x! - 4} ${y! - 10} ${x! + 6} ${y! + 6} ${x! + 16} ${y! - 4}`} stroke="#2a1a10" strokeWidth={7} strokeLinecap="round" fill="none" />
        ))}
        <rect x={-84 * b} y={-520} width={168 * b} height={28} rx={12} fill={def.sash} />
      </g>
    );
  }

  const hem = kind === 'saree' || kind === 'robe' ? -14 : -58;
  const hemW = (kind === 'saree' ? 124 : 112) + wide * 30;
  const waistW = (def.body === 'female' ? 66 : 80) * b;
  const fold = darken(c, 0.12);
  const border = def.lower.border;
  return (
    <g>
      {kind === 'dhoti' &&
        [-1, 1].map((s) => (
          <path key={s} d={`M${s * (spread - 4)} -90 L${s * spread} -40`} stroke={def.skin} strokeWidth={40} strokeLinecap="round" />
        ))}
      <Feet def={def} spread={spread} lift={lift} />
      <g transform={`translate(0 -505) skewX(${skew}) translate(0 505)`}>
        <path d={`M${-waistW} -505 C${-waistW - 18} -300 ${-hemW + 8} -160 ${-hemW} ${hem} C-60 ${hem + 16} -12 ${hem - 2} 0 ${hem - 10} C12 ${hem - 2} 60 ${hem + 16} ${hemW} ${hem} C${hemW - 8} -160 ${waistW + 18} -300 ${waistW} -505 Z`} fill={c} />
        <path d={`M${-hemW} ${hem} C-60 ${hem + 16} -12 ${hem - 2} 0 ${hem - 10} C12 ${hem - 2} 60 ${hem + 16} ${hemW} ${hem}`} stroke={border} strokeWidth={kind === 'saree' ? 26 : 16} fill="none" />
        {kind === 'dhoti' && (
          <g>
            <path d={`M-20 -495 C-26 -300 -30 -160 -34 ${hem - 6} L34 ${hem - 6} C30 -160 26 -300 20 -495 Z`} fill={fold} />
            {[-18, -6, 6, 18].map((x) => (
              <path key={x} d={`M${x * 0.6} -480 C${x * 0.8} -300 ${x} -160 ${x * 1.2} ${hem - 8}`} stroke={darken(c, 0.24)} strokeWidth={2.5} fill="none" opacity={0.7} />
            ))}
            <path d={`M-34 ${hem - 6} L34 ${hem - 6}`} stroke={border} strokeWidth={10} />
            <path d={`M-62 -300 C-50 -240 -48 -180 -54 -120 M62 -300 C50 -240 48 -180 54 -120`} stroke={fold} strokeWidth={4} fill="none" opacity={0.8} />
          </g>
        )}
        {kind === 'saree' && (
          <g>
            {[-40, -26, -12, 2, 16, 30].map((x, i) => (
              <path key={x} d={`M${x * 0.4} -470 C${x * 0.6} -300 ${x} -140 ${x * 1.6} ${hem - 6}`} stroke={darken(c, 0.18 + (i % 2) * 0.06)} strokeWidth={3} fill="none" />
            ))}
            <path d={`M-90 -200 C-40 -214 40 -214 90 -200`} stroke={lighten(border, 0.1)} strokeWidth={6} fill="none" opacity={0.7} />
          </g>
        )}
      </g>
      <rect x={-waistW - 6} y={-524} width={(waistW + 6) * 2} height={30} rx={13} fill={def.sash} />
      <path d={`M${-waistW - 6} -509 L${waistW + 6} -509`} stroke={lighten(def.sash, 0.25)} strokeWidth={3} opacity={0.6} />
      <circle cx={0} cy={-509} r={11} fill={GOLD} stroke={GOLD_DARK} strokeWidth={2.5} />
      {kind !== 'saree' && <path d={`M-10 -496 C-16 -440 -10 -400 -18 -360 L-4 -362 C2 -410 -2 -446 2 -496 Z M10 -496 C18 -440 14 -400 20 -366 L8 -364 C2 -410 6 -446 -2 -496 Z`} fill={def.sash} />}
    </g>
  );
}

function Necklace({ def }: { def: CharacterDef }) {
  switch (def.necklace) {
    case 'gold':
      return (
        <g>
          <path d="M-58 -760 C-50 -700 50 -700 58 -760" stroke={GOLD} strokeWidth={8} fill="none" strokeLinecap="round" />
          <path d="M-48 -752 C-40 -716 40 -716 48 -752" stroke={GOLD_DARK} strokeWidth={2.5} fill="none" />
          <path d="M0 -712 C10 -700 10 -688 0 -678 C-10 -688 -10 -700 0 -712 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={2} />
          <circle cx={0} cy={-694} r={5} fill={def.crownGem} />
        </g>
      );
    case 'pearl':
      return (
        <g>
          {Array.from({ length: 15 }, (_, i) => {
            const a = Math.PI * (i / 14);
            return <circle key={i} cx={-58 * Math.cos(a)} cy={-760 + Math.sin(a) * 52} r={4.8} fill="#fbf7ee" stroke="#d8cfbd" strokeWidth={1} />;
          })}
          {Array.from({ length: 13 }, (_, i) => {
            const a = Math.PI * (i / 12);
            return <circle key={`b${i}`} cx={-46 * Math.cos(a)} cy={-756 + Math.sin(a) * 34} r={4} fill={GOLD} />;
          })}
        </g>
      );
    case 'rudraksha':
      return (
        <g>
          {Array.from({ length: 19 }, (_, i) => {
            const a = Math.PI * (i / 18);
            return <circle key={i} cx={-62 * Math.cos(a)} cy={-762 + Math.sin(a) * 120} r={6.5} fill="#7a3f22" stroke="#4a2414" strokeWidth={1.5} />;
          })}
          {Array.from({ length: 13 }, (_, i) => {
            const a = Math.PI * (i / 12);
            return <circle key={`s${i}`} cx={-48 * Math.cos(a)} cy={-758 + Math.sin(a) * 50} r={5.5} fill="#8a4a2a" stroke="#4a2414" strokeWidth={1.5} />;
          })}
        </g>
      );
    case 'vaijayanti': {
      const colours = ['#fff6e8', '#e8364f', '#ffd43b', '#ff8a3d', '#fff6e8', '#d6336c'];
      const pts: React.ReactNode[] = [];
      const n = 44;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI * (i / n);
        const x = -60 * Math.cos(a) * (0.55 + 0.45 * Math.sin(a) ** 0.3);
        const y = -762 + Math.sin(a) ** 1.6 * 330;
        if (i % 3 === 0) pts.push(<ellipse key={`l${i}`} cx={x + (x < 0 ? -7 : 7)} cy={y + 2} rx={8} ry={3.6} fill="#2f9e44" transform={`rotate(${x < 0 ? -40 : 40} ${x} ${y})`} />);
        pts.push(<circle key={i} cx={x} cy={y} r={7.5} fill={colours[i % colours.length]} stroke="rgba(60,20,10,0.18)" strokeWidth={1.2} />);
      }
      return (
        <g>
          <path d="M-58 -760 C-50 -706 50 -706 58 -760" stroke={GOLD} strokeWidth={7} fill="none" />
          {pts}
          <circle cx={0} cy={-428} r={11} fill="#ffd43b" stroke="#e8364f" strokeWidth={3} />
        </g>
      );
    }
    default:
      return null;
  }
}

/** Torso, neck, necklaces and draped cloth — everything between the waist and the chin. */
export function Torso({ def, t, breath }: { def: CharacterDef; t: number; breath: number }) {
  const b = def.build;
  const female = def.body === 'female';
  const sw = (female ? 98 : 112) * b;
  const ww = (female ? 62 : 74) * b;
  const shade = darken(def.skin, 0.13);
  const top = def.top;
  const sway = Math.sin(t * 1.3);
  const torso = `M-34 -772 C-60 -760 ${-sw + 4} -752 ${-sw} -736 C${-sw - 16} -724 ${-sw - 8} -694 ${-sw + 6} -676 C${-sw + 22} -620 ${-ww - 6} -570 ${-ww} -500 L${ww} -500 C${ww + 6} -570 ${sw - 22} -620 ${sw - 6} -676 C${sw + 8} -694 ${sw + 16} -724 ${sw} -736 C${sw - 4} -752 60 -760 34 -772 Z`;
  return (
    <g transform={`translate(0 ${-breath * 2 - 500}) scale(1 ${1 + breath * 0.006}) translate(0 500)`}>
      <path d="M-26 -812 L-28 -756 L28 -756 L26 -812 Z" fill={def.skin} />
      <path d="M-26 -800 C-10 -782 10 -782 26 -800 L26 -776 C10 -766 -10 -766 -26 -776 Z" fill={shade} opacity={0.7} />
      <path d={torso} fill={def.skin} />
      <path d={`M${sw - 24} -730 C${sw - 2} -700 ${sw - 20} -640 ${sw - 44} -600 C${ww + 4} -560 ${ww + 2} -530 ${ww} -500 L${ww - 26} -500 C${ww - 20} -560 ${sw - 50} -640 ${sw - 24} -730 Z`} fill={shade} opacity={0.45} />
      {!female && top.kind === 'bare' && (
        <g opacity={0.5}>
          <path d={`M${-70 * b} -656 C${-40 * b} -634 -14 -640 -6 -660 M${70 * b} -656 C${40 * b} -634 14 -640 6 -660`} stroke={shade} strokeWidth={4} fill="none" strokeLinecap="round" />
          <path d="M0 -640 L0 -560" stroke={shade} strokeWidth={3} opacity={0.6} />
          <circle cx={0} cy={-540} r={4} fill={shade} />
        </g>
      )}
      {top.kind === 'armor' && (
        <g>
          <path d={`M${-sw + 14} -720 C-50 -750 50 -750 ${sw - 14} -720 C${sw - 10} -650 ${ww + 6} -560 ${ww} -510 L${-ww} -510 C${-ww - 6} -560 ${-sw + 10} -650 ${-sw + 14} -720 Z`} fill={top.color} stroke={darken(top.color, 0.35)} strokeWidth={4} />
          <path d={`M${-sw + 30} -700 C-40 -650 -12 -650 -4 -690 M${sw - 30} -700 C40 -650 12 -650 4 -690`} stroke={darken(top.color, 0.3)} strokeWidth={4} fill="none" />
          {[-600, -570, -540].map((y) => (
            <path key={y} d={`M${-ww - 2} ${y} C-30 ${y + 8} 30 ${y + 8} ${ww + 2} ${y}`} stroke={darken(top.color, 0.3)} strokeWidth={3.5} fill="none" />
          ))}
          <path d={`M${-sw + 14} -720 C-50 -750 50 -750 ${sw - 14} -720`} stroke={top.accent} strokeWidth={8} fill="none" />
          <circle cx={0} cy={-650} r={def.id === 'karna' ? 26 : 16} fill={def.id === 'karna' ? '#ffcf4a' : top.accent} stroke={lighten(top.color, 0.4)} strokeWidth={4} />
          {def.id === 'karna' &&
            Array.from({ length: 12 }, (_, i) => <path key={i} d="M0 -684 L5 -676 L-5 -676 Z" fill="#fff0b0" transform={`rotate(${i * 30} 0 -650)`} />)}
          <path d={`M${-sw + 16} -716 C${-sw + 30} -700 ${-sw + 30} -660 ${-sw + 20} -640`} stroke={lighten(top.color, 0.35)} strokeWidth={4} fill="none" opacity={0.7} />
        </g>
      )}
      {top.kind === 'blouse' && (
        <g>
          <path d={`M${-sw + 2} -730 C-50 -760 50 -760 ${sw - 2} -730 C${sw - 2} -680 ${sw - 30} -632 ${ww + 10} -612 C30 -600 -30 -600 ${-ww - 10} -612 C${-sw + 30} -632 ${-sw + 2} -680 ${-sw + 2} -730 Z`} fill={top.color} />
          <path d={`M${-ww - 10} -612 C-30 -600 30 -600 ${ww + 10} -612`} stroke={top.accent} strokeWidth={5} fill="none" />
          <path d="M-30 -760 C-16 -734 16 -734 30 -760" stroke={top.accent} strokeWidth={4} fill="none" />
          <circle cx={0} cy={-548} r={3.5} fill={shade} />
        </g>
      )}
      {top.kind === 'robe' && (
        <g>
          <path d={`M${-sw} -736 C-60 -756 10 -770 34 -772 C40 -740 ${sw - 30} -640 ${ww} -500 L${-ww} -500 C${-ww - 6} -570 ${-sw + 22} -620 ${-sw + 6} -676 C${-sw - 8} -694 ${-sw - 16} -724 ${-sw} -736 Z`} fill={top.color} />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${-50 + i * 30} ${-740 + i * 14} C${-10 + i * 30} ${-640 + i * 10} ${10 + i * 20} ${-580} ${20 + i * 18} -510`} stroke={top.accent} strokeWidth={3} fill="none" opacity={0.6} />
          ))}
          <path d={`M34 -772 C40 -740 ${sw - 30} -640 ${ww} -500`} stroke={top.accent} strokeWidth={8} fill="none" />
        </g>
      )}
      {def.sacredThread && <path d={`M${-sw + 30} -742 C-30 -650 20 -580 ${ww - 4} -506`} stroke="#f7f1e1" strokeWidth={4} fill="none" />}
      {def.scarf && (
        <g>
          <path d={`M${-sw + 6} -742 C-40 -690 30 -600 ${ww + 10} -520 L${ww + 26} -548 C40 -630 -20 -720 ${-sw + 40} -760 Z`} fill={def.scarf.color} />
          <path d={`M${-sw + 6} -742 C-40 -690 30 -600 ${ww + 10} -520`} stroke={def.scarf.accent} strokeWidth={5} fill="none" />
          <path d={`M${ww + 14} -530 C${ww + 30} -470 ${ww + 30 + sway * 6} -420 ${ww + 20 + sway * 10} -360 L${ww + 46 + sway * 10} -364 C${ww + 50} -430 ${ww + 46} -490 ${ww + 30} -540 Z`} fill={def.scarf.color} />
        </g>
      )}
      {def.lower.kind === 'saree' && (
        <g>
          <path d={`M${-sw + 4} -740 C-40 -700 10 -620 ${ww + 6} -540 L${ww + 6} -600 C30 -650 -20 -720 ${-sw + 50} -764 Z`} fill={def.lower.color} />
          <path d={`M${-sw + 4} -740 C-40 -700 10 -620 ${ww + 6} -540`} stroke={def.lower.border} strokeWidth={10} fill="none" />
        </g>
      )}
      <Necklace def={def} />
      {def.snake && (
        <g>
          <path d="M-70 -760 C-60 -700 60 -700 74 -760 C80 -800 98 -812 104 -790" stroke="#3f8f3a" strokeWidth={15} fill="none" strokeLinecap="round" />
          <path d="M-70 -760 C-60 -700 60 -700 74 -760" stroke="#9bd17a" strokeWidth={4} fill="none" strokeDasharray="2 10" />
          <path d="M96 -812 C88 -846 120 -856 126 -828 C130 -812 118 -800 104 -796 Z" fill="#3f8f3a" />
          <circle cx={112} cy={-830} r={2.5} fill="#111" />
        </g>
      )}
    </g>
  );
}

export const torsoTopY = (def: CharacterDef) => (def.top.kind === 'armor' ? -748 : -760);
