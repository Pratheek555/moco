import React from 'react';

// Held props: drawn with the grip at (0, 0) and "up" = -y. `mode` says how the
// prop follows the hand: upright props stay vertical (staffs, bows), `follow`
// props point where the fingers point (raised weapons), `flute` lies along the hand.

const GOLD = '#e2a83a';
const GOLD_DARK = '#a8741c';

export type HoldMode = 'upright' | 'follow' | 'flute' | 'hang';

export interface HeldPropDef {
  mode: HoldMode;
  render: (t: number) => React.ReactElement;
}

const Flute = () => (
  <g>
    <rect x={-262} y={-8} width={330} height={16} rx={8} fill="#8a5a2b" />
    <rect x={-262} y={-8} width={330} height={6} rx={3} fill="#b07a42" opacity={0.7} />
    {[-210, -180, -150, -120, -90].map((x) => (
      <circle key={x} cx={x} cy={0} r={3.2} fill="#3a2414" />
    ))}
    {[-250, -40, 50].map((x) => (
      <rect key={x} x={x} y={-9} width={8} height={18} fill={GOLD} />
    ))}
    <path d="M60 8 C66 40 58 70 66 96" stroke="#d6283a" strokeWidth={4} fill="none" />
    <circle cx={66} cy={98} r={7} fill="#d6283a" />
  </g>
);

const Bow = ({ drawn = false }: { drawn?: boolean }) => (
  <g>
    <path d="M0 -270 C64 -190 64 190 0 270" stroke="#7a4a1f" strokeWidth={13} fill="none" strokeLinecap="round" />
    <path d="M0 -270 C64 -190 64 190 0 270" stroke={GOLD} strokeWidth={4} fill="none" strokeDasharray="6 30" />
    {!drawn && <path d="M0 -270 L0 270" stroke="#efe6d2" strokeWidth={2.5} />}
    <rect x={14} y={-22} width={34} height={44} rx={8} fill="#5a3a1a" />
  </g>
);

const Mace = () => (
  <g>
    <rect x={-7} y={-250} width={14} height={300} rx={6} fill="#8a5a2b" />
    <rect x={-11} y={30} width={22} height={24} rx={6} fill={GOLD} />
    <circle cx={0} cy={-280} r={58} fill={GOLD} stroke={GOLD_DARK} strokeWidth={4} />
    <path d="M-58 -280 C-30 -266 30 -266 58 -280 M-50 -306 C-20 -294 20 -294 50 -306 M-50 -254 C-20 -244 20 -244 50 -254" stroke={GOLD_DARK} strokeWidth={4} fill="none" />
    <circle cx={-18} cy={-300} r={12} fill="#fff3c4" opacity={0.55} />
    <path d="M0 -338 L0 -362" stroke={GOLD} strokeWidth={10} strokeLinecap="round" />
  </g>
);

const Trident = () => (
  <g>
    <rect x={-6} y={-420} width={12} height={720} rx={5} fill="#8a6a4a" />
    <path d="M-62 -470 C-64 -420 -40 -400 0 -400 C40 -400 64 -420 62 -470 L52 -470 C50 -432 30 -418 8 -418 L8 -500 L0 -540 L-8 -500 L-8 -418 C-30 -418 -50 -432 -52 -470 Z" fill="#cfd6de" stroke="#7d8894" strokeWidth={3} />
    <path d="M-62 -470 L-52 -506 L-52 -470 Z M62 -470 L52 -506 L52 -470 Z" fill="#cfd6de" stroke="#7d8894" strokeWidth={2} />
    <g transform="translate(0 -360)">
      <path d="M-26 -22 L26 22 M-26 22 L26 -22" stroke="#7a4a2a" strokeWidth={4} />
      <path d="M-26 -24 C-6 -12 -6 12 -26 24 Z M26 -24 C6 -12 6 12 26 24 Z" fill="#c9844a" stroke="#7a4a2a" strokeWidth={2.5} />
      <path d="M-14 -4 C-4 2 4 -2 14 4" stroke="#d6283a" strokeWidth={3} fill="none" />
    </g>
    <path d="M10 -392 C40 -380 46 -350 30 -330" stroke="#d6283a" strokeWidth={4} fill="none" />
  </g>
);

const Spear = () => (
  <g>
    <rect x={-5} y={-480} width={10} height={760} rx={4} fill="#7a5530" />
    <path d="M0 -580 C18 -540 18 -500 8 -480 L-8 -480 C-18 -500 -18 -540 0 -580 Z" fill="#cfd6de" stroke="#7d8894" strokeWidth={3} />
    <path d="M-10 -478 L10 -478" stroke={GOLD} strokeWidth={8} />
    <path d="M6 -470 C26 -460 30 -440 20 -420" stroke="#d6283a" strokeWidth={5} fill="none" />
  </g>
);

const Sword = () => (
  <g>
    <path d="M-10 -36 L-12 -330 L0 -370 L12 -330 L10 -36 Z" fill="#dfe5eb" stroke="#7d8894" strokeWidth={3} />
    <path d="M0 -330 L0 -40" stroke="#ffffff" strokeWidth={2} opacity={0.7} />
    <rect x={-40} y={-40} width={80} height={14} rx={6} fill={GOLD} />
    <rect x={-8} y={-26} width={16} height={56} rx={6} fill="#5a3a1a" />
    <circle cx={0} cy={36} r={10} fill={GOLD} />
  </g>
);

const Lotus = () => (
  <g>
    <path d="M0 0 C-4 -40 4 -70 0 -100" stroke="#2f9e44" strokeWidth={6} fill="none" />
    {[-60, -30, 0, 30, 60].map((r) => (
      <path key={r} d="M0 -100 C-22 -130 -16 -170 0 -186 C16 -170 22 -130 0 -100 Z" fill={r === 0 ? '#ff8fab' : '#ffb3c6'} stroke="#e8597d" strokeWidth={2} transform={`rotate(${r} 0 -100)`} />
    ))}
    <circle cx={0} cy={-112} r={10} fill="#ffd43b" />
  </g>
);

const Conch = () => (
  <g transform="rotate(-20)">
    <path d="M-30 -10 C-46 -60 -10 -110 30 -96 C66 -84 70 -40 46 -10 C30 10 -10 16 -30 -10 Z" fill="#fbf6ec" stroke="#c9b99a" strokeWidth={3} />
    <path d="M-16 -30 C0 -60 30 -70 44 -50 M-10 -14 C10 -40 36 -44 50 -28" stroke="#d8c8a8" strokeWidth={3} fill="none" />
    <path d="M46 -10 C60 0 70 -6 74 -18" stroke="#c9b99a" strokeWidth={6} strokeLinecap="round" fill="none" />
    <circle cx={10} cy={-60} r={6} fill={GOLD} />
  </g>
);

const Chakra = (t: number) => (
  <g transform="translate(0 -170)">
    <circle r={78} fill="#ffd36b" opacity={0.25} />
    <g transform={`rotate(${t * 540})`}>
      <circle r={58} fill="none" stroke={GOLD} strokeWidth={10} />
      {Array.from({ length: 16 }, (_, i) => (
        <path key={i} d="M-7 -58 L0 -80 L7 -58 Z" fill="#ffcf4a" stroke={GOLD_DARK} strokeWidth={1.5} transform={`rotate(${i * 22.5})`} />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <path key={`s${i}`} d="M0 0 L0 -54" stroke={GOLD_DARK} strokeWidth={4} transform={`rotate(${i * 45})`} />
      ))}
      <circle r={14} fill="#d6283a" stroke={GOLD} strokeWidth={4} />
    </g>
  </g>
);

const Kamandalu = () => (
  <g>
    <path d="M-30 6 C-30 -22 30 -22 30 6" stroke="#5a3a1a" strokeWidth={7} fill="none" />
    <path d="M-48 30 C-60 80 -40 120 0 124 C40 120 60 80 48 30 C30 12 -30 12 -48 30 Z" fill="#7a4a24" stroke="#4a2a12" strokeWidth={3} />
    <path d="M48 44 C70 40 80 30 86 20" stroke="#7a4a24" strokeWidth={9} strokeLinecap="round" fill="none" />
    <path d="M-44 44 C-20 54 20 54 44 44" stroke={GOLD} strokeWidth={4} fill="none" />
  </g>
);

const Scroll = () => (
  <g transform="rotate(-8)">
    <rect x={-90} y={-14} width={180} height={28} rx={6} fill="#e9d6a8" stroke="#b39459" strokeWidth={3} />
    {[-60, -30, 0, 30, 60].map((x) => (
      <path key={x} d={`M${x} -10 L${x} 10`} stroke="#b39459" strokeWidth={2} />
    ))}
    <path d="M-96 -2 L96 -2" stroke="#8a5a2b" strokeWidth={3} />
  </g>
);

const Arrow = () => (
  <g>
    <path d="M0 -240 L0 160" stroke="#7a5530" strokeWidth={6} />
    <path d="M0 -268 L10 -236 L-10 -236 Z" fill="#cfd6de" stroke="#7d8894" strokeWidth={2} />
    <path d="M0 130 l-12 34 l12 -8 l12 8 Z" fill="#f4efe6" stroke="#b8a888" strokeWidth={1.5} />
  </g>
);

export const HELD_PROPS: Record<string, HeldPropDef> = {
  flute: { mode: 'flute', render: () => <Flute /> },
  bow: { mode: 'upright', render: () => <Bow /> },
  'bow-drawn': { mode: 'upright', render: () => <Bow drawn /> },
  arrow: { mode: 'follow', render: () => <Arrow /> },
  mace: { mode: 'follow', render: () => <Mace /> },
  trident: { mode: 'upright', render: () => <Trident /> },
  spear: { mode: 'upright', render: () => <Spear /> },
  sword: { mode: 'follow', render: () => <Sword /> },
  lotus: { mode: 'upright', render: () => <Lotus /> },
  conch: { mode: 'upright', render: () => <Conch /> },
  chakra: { mode: 'upright', render: (t) => Chakra(t) },
  kamandalu: { mode: 'hang', render: () => <Kamandalu /> },
  scroll: { mode: 'upright', render: () => <Scroll /> },
};
