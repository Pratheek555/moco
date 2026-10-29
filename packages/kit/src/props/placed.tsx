import type { TimeOfDay } from '@moco/spec';
import React from 'react';
import { Flag, Flame, Glow, tone } from '../backgrounds/common.tsx';
import { darken, lighten, noise1 } from '../util.ts';

// Placed props use character units: origin on the ground, ~1000 units = a person.
// Vehicles split into back/front layers so riders sit between them.

export interface PropContext {
  t: number;
  moving: boolean;
  time: TimeOfDay;
  uid: string;
}

export interface PlacedPropDef {
  render: (ctx: PropContext) => { back: React.ReactNode; front?: React.ReactNode };
  /** Vehicles: where riders stand (floor y, x span) in prop units. */
  seat?: { y: number; x0: number; x1: number };
}

const GOLD = '#e2a83a';

function Horse({ t, moving, time, far = false }: { t: number; moving: boolean; time: TimeOfDay; far?: boolean }) {
  const coat = tone(far ? '#d9d2c3' : '#f6f3ec', time);
  const shade = darken(coat, 0.13);
  const mane = tone(far ? '#cbbf9f' : '#efe4c4', time);
  const hoof = tone('#4a3a2a', time);
  const red = tone('#b8322a', time);
  const gold = tone(GOLD, time);
  const phase = t * Math.PI * 2 * 2.1 + (far ? 1.4 : 0);
  const bob = moving ? Math.sin(phase * 2) * 9 : Math.sin(t * 1.6) * 2;
  const tilt = moving ? Math.sin(phase) * 2.2 : 0;
  const leg = (x: number, y: number, offset: number, front: boolean, colour: string) => {
    const p = phase + offset;
    const a1 = moving ? Math.sin(p) * (front ? 34 : 28) : 0;
    const bend = moving ? Math.max(0, Math.sin(p + (front ? 1.3 : -1.1))) * (front ? 80 : -60) : 0;
    const upperLen = front ? 170 : 200;
    return (
      <g transform={`translate(${x} ${y}) rotate(${a1})`}>
        <path d={front ? `M-26 0 C-28 60 -20 120 -16 ${upperLen} L16 ${upperLen} C20 120 26 60 26 0 Z` : `M-36 0 C-40 70 -26 140 -18 ${upperLen} L18 ${upperLen} C22 140 40 70 36 0 Z`} fill={colour} />
        <g transform={`translate(0 ${upperLen - 6}) rotate(${bend})`}>
          <path d="M-14 0 L-12 150 L12 150 L14 0 Z" fill={colour} />
          <ellipse cx={0} cy={152} rx={15} ry={12} fill={colour} />
          <path d="M-16 156 L-18 182 L20 182 L16 156 Z" fill={hoof} />
        </g>
      </g>
    );
  };
  const wave = (k: number) => Math.sin(t * (moving ? 9 : 2.2) + k) * (moving ? 10 : 3);
  return (
    <g transform={`translate(0 ${-bob}) rotate(${tilt} 0 -400)`}>
      {leg(-236, -400, 2.6, false, shade)}
      {leg(126, -350, 0.9, true, shade)}
      <path d={`M-318 -500 C${-380 + wave(1)} -470 ${-420 + wave(2)} -380 ${-430 + wave(3)} -250 C${-400 + wave(2)} -300 ${-370 + wave(1)} -330 -330 -420 Z`} fill={mane} />
      <path d="M-320 -470 C-335 -540 -290 -575 -230 -570 C-150 -560 -60 -535 20 -555 C60 -565 85 -580 110 -585 C170 -640 210 -740 250 -795 C262 -812 280 -812 292 -796 C330 -740 380 -680 420 -630 C440 -605 425 -580 400 -578 C370 -576 340 -600 315 -640 C300 -660 290 -670 270 -670 C240 -600 200 -500 170 -430 C160 -390 150 -350 120 -330 C40 -320 -100 -325 -200 -345 C-250 -355 -300 -400 -320 -470 Z" fill={coat} />
      <path d="M-200 -350 C-100 -330 40 -325 118 -334 C80 -350 -60 -352 -190 -372 Z" fill={shade} />
      <path d="M150 -440 C190 -520 226 -620 262 -690 C250 -600 210 -510 172 -430 Z" fill={shade} opacity={0.7} />
      <path d="M268 -808 L282 -862 L298 -806 Z" fill={coat} />
      <ellipse cx={322} cy={-728} rx={9} ry={8} fill="#20140c" />
      <circle cx={319} cy={-731} r={2.5} fill="#ffffff" />
      <ellipse cx={408} cy={-606} rx={7} ry={5} fill={darken(coat, 0.35)} />
      <path d="M380 -582 C392 -578 404 -580 412 -588" stroke={darken(coat, 0.3)} strokeWidth={3} fill="none" />
      <path d={`M252 -800 C${214 + wave(4)} -760 ${184 + wave(5)} -700 ${160 + wave(6)} -650 C${136 + wave(7)} -610 ${116 + wave(8)} -592 ${96 + wave(9)} -580 L110 -585 C170 -640 210 -740 250 -795 Z`} fill={mane} />
      {[0, 1, 2, 3, 4].map((k) => (
        <path key={k} d={`M${240 - k * 30} ${-780 + k * 46} q${-34 + wave(k)} 10 ${-48 + wave(k + 2)} 40`} stroke={mane} strokeWidth={14} strokeLinecap="round" fill="none" />
      ))}
      <path d="M300 -800 L360 -660 M300 -650 C330 -640 360 -640 392 -612 M262 -700 C300 -690 330 -660 352 -630" stroke={gold} strokeWidth={6} fill="none" />
      <path d={`M276 -808 C${270 + wave(10)} -850 ${284} -880 ${300 + wave(11)} -892`} stroke={red} strokeWidth={14} strokeLinecap="round" fill="none" />
      <path d="M-170 -566 C-120 -560 -20 -548 40 -560 L52 -420 C-20 -414 -120 -418 -186 -430 Z" fill={red} />
      <path d="M-186 -430 C-120 -418 -20 -414 52 -420" stroke={gold} strokeWidth={8} fill="none" />
      {[-150, -100, -50, 0].map((x) => (
        <circle key={x} cx={x} cy={-436} r={6} fill={gold} />
      ))}
      <path d="M150 -470 C120 -430 120 -380 140 -350" stroke={gold} strokeWidth={10} fill="none" />
      {leg(-268, -410, 0.4, false, coat)}
      {leg(96, -350, 3.1, true, coat)}
    </g>
  );
}

const CHARIOT_SCALE = 1.3;

function Chariot({ t, moving, time }: PropContext) {
  const wood = tone('#7a4a24', time);
  const panel = tone('#9b2335', time);
  const gold = tone(GOLD, time);
  const spin = moving ? t * 220 : 0;
  const bounce = moving ? Math.abs(Math.sin(t * 13)) * 4 : 0;
  const wheel = (
    <g transform={`translate(-10 -210) rotate(${spin})`}>
      <circle r={206} fill="none" stroke={wood} strokeWidth={26} />
      <circle r={206} fill="none" stroke={gold} strokeWidth={6} />
      <circle r={180} fill="none" stroke={darken(wood, 0.2)} strokeWidth={4} />
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d="M-6 -26 L-4 -184 L4 -184 L6 -26 Z" fill={wood} transform={`rotate(${i * 30})`} />
      ))}
      <circle r={38} fill={gold} stroke={darken(wood, 0.2)} strokeWidth={5} />
      <circle r={12} fill={darken(wood, 0.3)} />
    </g>
  );
  const side = (
    <g transform={`translate(0 ${-bounce})`}>
      <path d="M-230 -280 L-230 -690 C-140 -700 -40 -700 40 -730 C120 -760 190 -800 236 -870 L262 -850 C250 -700 236 -480 226 -280 Z" fill={panel} />
      <path d="M-230 -690 C-140 -700 -40 -700 40 -730 C120 -760 190 -800 236 -870" stroke={gold} strokeWidth={16} fill="none" strokeLinecap="round" />
      <path d="M-230 -300 L226 -300" stroke={gold} strokeWidth={14} />
      <path d="M-214 -660 L-214 -320 M226 -320 L246 -820" stroke={gold} strokeWidth={6} />
      {[-150, -50, 50, 150].map((x) => (
        <g key={x} transform={`translate(${x} -500)`}>
          <circle r={44} fill="none" stroke={gold} strokeWidth={6} />
          <circle r={18} fill={gold} />
          {Array.from({ length: 8 }, (_, i) => (
            <circle key={i} cx={0} cy={-31} r={5} fill={gold} transform={`rotate(${i * 45})`} />
          ))}
        </g>
      ))}
      <circle cx={242} cy={-866} r={14} fill={gold} />
    </g>
  );
  return {
    back: (
      <g>
        <g transform={`scale(${CHARIOT_SCALE})`}>
          <g transform={`translate(0 ${-bounce})`}>
            <path d="M-196 -290 L-196 -1320" stroke={wood} strokeWidth={14} />
            <circle cx={-196} cy={-1330} r={14} fill={gold} />
            <Flag x={-189} y={-1300} w={220} h={130} color={tone('#f08c00', time)} t={t} speed={moving ? 9 : 3} />
            <g transform="translate(-80 -1240)" fill={tone('#9b2335', time)}>
              <circle r={26} />
              <circle cx={-14} cy={-24} r={9} />
              <circle cx={14} cy={-24} r={9} />
            </g>
            <path d="M-230 -690 C-120 -720 0 -740 60 -770" stroke={darken(panel, 0.3)} strokeWidth={22} fill="none" />
          </g>
        </g>
        <path d="M300 -430 L860 -470" stroke={wood} strokeWidth={18} strokeLinecap="round" />
        <g transform="translate(780 -14) scale(0.96)">
          <Horse t={t} moving={moving} time={time} far />
        </g>
        <g transform="translate(700 0)">
          <Horse t={t} moving={moving} time={time} />
        </g>
      </g>
    ),
    front: (
      <g transform={`scale(${CHARIOT_SCALE})`}>
        {side}
        {wheel}
      </g>
    ),
  };
}

export const PLACED_PROPS: Record<string, PlacedPropDef> = {
  chariot: { render: (ctx) => Chariot(ctx), seat: { y: -290 * CHARIOT_SCALE, x0: -170 * CHARIOT_SCALE, x1: 170 * CHARIOT_SCALE } },
  horse: { render: ({ t, moving, time }) => ({ back: <Horse t={t} moving={moving} time={time} /> }) },
  diya: {
    render: ({ t, time, uid }) => ({
      back: (
        <g transform="scale(1.6)">
          <Glow x={0} y={-50} r={120} color="#ffb84a" opacity={0.6} uid={uid} name="diya" />
          <path d="M-46 -20 C-40 6 40 6 46 -20 C30 -30 -30 -30 -46 -20 Z" fill={tone('#b5562a', time)} />
          <path d="M-46 -20 C-30 -12 30 -12 46 -20" stroke={tone('#7a3414', time)} strokeWidth={4} fill="none" />
          <path d="M40 -22 L58 -32" stroke={tone('#b5562a', time)} strokeWidth={10} strokeLinecap="round" />
          <Flame x={54} y={-36} s={1} t={t} />
        </g>
      ),
    }),
  },
  throne: {
    render: ({ time }) => {
      const gold = tone(GOLD, time);
      const red = tone('#9b2335', time);
      return {
        back: (
          <g>
            <path d="M-220 -40 L-220 -820 C-220 -940 -100 -1000 0 -1020 C100 -1000 220 -940 220 -820 L220 -40 Z" fill={gold} stroke={darken(gold, 0.3)} strokeWidth={8} />
            <path d="M-160 -380 L-160 -780 C-160 -860 -80 -910 0 -925 C80 -910 160 -860 160 -780 L160 -380 Z" fill={red} />
            <circle cx={0} cy={-760} r={50} fill={gold} />
            <circle cx={0} cy={-760} r={24} fill={tone('#2fa36b', time)} />
            <rect x={-260} y={-420} width={520} height={110} rx={30} fill={red} stroke={gold} strokeWidth={10} />
            <path d="M-260 -320 L-240 0 L240 0 L260 -320 Z" fill={darken(gold, 0.1)} />
            {[-1, 1].map((s) => (
              <g key={s} transform={`translate(${s * 250} -420)`}>
                <circle r={50} fill={gold} stroke={darken(gold, 0.3)} strokeWidth={6} />
                <circle cx={s * 10} cy={-6} r={8} fill={darken(gold, 0.5)} />
              </g>
            ))}
          </g>
        ),
      };
    },
  },
  havan: {
    render: ({ t, time, uid }) => {
      const brick = tone('#b5562a', time);
      return {
        back: (
          <g>
            <Glow x={0} y={-220} r={320} color="#ff9a3c" opacity={0.55} uid={uid} name="havan" />
            {Array.from({ length: 5 }, (_, i) => {
              const y = -300 - ((t * 60 + i * 70) % 350);
              const o = 0.35 * (1 - ((t * 60 + i * 70) % 350) / 350);
              return <circle key={i} cx={Math.sin(t + i) * 30} cy={y} r={40 + i * 6} fill="#d8d0c8" opacity={o} />;
            })}
            {[-80, -40, 0, 40, 80].map((x, i) => (
              <Flame key={x} x={x} y={-150} s={1.9 - Math.abs(x) / 100} t={t} seed={i} />
            ))}
            <path d="M-200 0 L-200 -90 L200 -90 L200 0 Z" fill={brick} />
            <path d="M-160 -90 L-160 -150 L160 -150 L160 -90 Z" fill={darken(brick, 0.1)} />
            {[-45, -110].map((y) => (
              <path key={y} d={`M-200 ${y} L200 ${y}`} stroke={darken(brick, 0.3)} strokeWidth={4} />
            ))}
          </g>
        ),
      };
    },
  },
  tree: {
    render: ({ t, time }) => {
      const sway = Math.sin(t * 0.9) * 2;
      return {
        back: (
          <g>
            <path d="M-40 0 C-30 -200 -50 -420 -20 -620 L30 -620 C30 -420 40 -200 50 0 Z" fill={tone('#6a4a2a', time)} />
            <g transform={`rotate(${sway} 0 -620)`}>
              {Array.from({ length: 10 }, (_, i) => {
                const a = (i / 10) * Math.PI * 2;
                return <circle key={i} cx={Math.cos(a) * 200} cy={-780 + Math.sin(a) * 140} r={140} fill={tone(i % 2 ? '#3f8f4f' : '#4c9c58', time)} />;
              })}
              <circle cx={0} cy={-800} r={170} fill={tone('#4c9c58', time)} />
              {Array.from({ length: 26 }, (_, i) => (
                <circle key={`b${i}`} cx={Math.sin(i * 12.9) * 260} cy={-790 + Math.cos(i * 7.3) * 170} r={14} fill={tone('#ffb72b', time)} />
              ))}
            </g>
          </g>
        ),
      };
    },
  },
  cow: {
    render: ({ t, time }) => {
      const coat = tone('#f6f2ea', time);
      const patch = tone('#a8704a', time);
      const swish = Math.sin(t * 2.2) * 10;
      return {
        back: (
          <g>
            <path d={`M-230 -360 C${-270 + swish} -300 ${-280 + swish} -220 ${-262 + swish} -150`} stroke={coat} strokeWidth={10} fill="none" />
            <circle cx={-262 + swish} cy={-146} r={14} fill={patch} />
            {[-190, -140, 120, 170].map((x) => (
              <path key={x} d={`M${x - 16} -230 L${x - 12} 0 L${x + 12} 0 L${x + 16} -230 Z`} fill={coat} />
            ))}
            <path d="M-240 -260 C-250 -400 -120 -430 60 -420 C180 -414 220 -360 220 -300 C220 -240 160 -220 60 -220 L-160 -220 C-220 -220 -236 -236 -240 -260 Z" fill={coat} />
            <path d="M40 -430 C60 -480 110 -480 120 -420 Z" fill={coat} />
            <ellipse cx={-90} cy={-330} rx={70} ry={50} fill={patch} />
            <path d="M200 -380 C240 -420 300 -420 320 -370 L340 -300 C344 -270 320 -256 300 -262 L240 -290 C214 -300 200 -340 200 -380 Z" fill={coat} />
            <path d="M232 -400 C220 -440 230 -460 250 -464 M286 -404 C300 -440 296 -460 280 -470" stroke={tone('#d8c8a0', time)} strokeWidth={9} strokeLinecap="round" fill="none" />
            <ellipse cx={276} cy={-360} rx={6} ry={5} fill="#20140c" />
            <ellipse cx={326} cy={-284} rx={20} ry={14} fill={tone('#e8b0a0', time)} />
            <path d="M230 -270 C240 -240 250 -232 262 -230" stroke={tone('#d6283a', time)} strokeWidth={6} fill="none" />
            <path d="M250 -232 L262 -200 L274 -232 Z" fill={tone(GOLD, time)} />
          </g>
        ),
      };
    },
  },
  banner: {
    render: ({ t, time }) => ({
      back: (
        <g>
          <path d="M0 0 L0 -1100" stroke={tone('#6a4a2a', time)} strokeWidth={16} />
          <circle cx={0} cy={-1112} r={16} fill={tone(GOLD, time)} />
          <Flag x={8} y={-1090} w={300} h={200} color={tone('#f08c00', time)} t={t} speed={3.5} />
        </g>
      ),
    }),
  },
  matka: {
    render: ({ t, time }) => {
      const a = Math.sin(t * 1.6) * 4;
      return {
        back: (
          <g transform={`rotate(${a} 0 -1700)`}>
            <path d="M0 -1700 L0 -380" stroke={tone('#8a6a4a', time)} strokeWidth={5} />
            <path d="M-60 -380 L0 -420 L60 -380" stroke={tone('#8a6a4a', time)} strokeWidth={5} fill="none" />
            <path d="M-110 -260 C-120 -340 -60 -380 0 -382 C60 -380 120 -340 110 -260 C100 -190 50 -160 0 -160 C-50 -160 -100 -190 -110 -260 Z" fill={tone('#b5562a', time)} />
            <path d="M-56 -372 L56 -372 L46 -392 L-46 -392 Z" fill={tone('#8a3a1a', time)} />
            <path d="M-100 -300 C-40 -280 40 -280 100 -300" stroke={tone('#f4efe6', time)} strokeWidth={8} fill="none" />
            <path d="M-50 -394 C-30 -420 30 -420 50 -394 Z" fill={tone('#fff6e0', time)} />
          </g>
        ),
      };
    },
  },
};

export { lighten, noise1 };
