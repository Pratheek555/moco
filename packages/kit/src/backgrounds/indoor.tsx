import React from 'react';
import { darken, lighten, mix, rng } from '../util.ts';
import { BLEED, type BgContext, type BgLayer, Flame, Glow, Ground, H, Rect, SKY, SkyGradient, Stars, Sun, W, tone } from './common.tsx';

/** A multi-foil (cusped) arch opening, centred on x, springing at y. */
function archPath(x: number, y: number, w: number, h: number) {
  const r = w / 2;
  const top = y - h;
  return `M${x - r} ${y} L${x - r} ${top + r * 0.9} C${x - r} ${top + r * 0.2} ${x - r * 0.45} ${top + r * 0.15} ${x - r * 0.35} ${top + r * 0.05} C${x - r * 0.25} ${top - r * 0.25} ${x + r * 0.25} ${top - r * 0.25} ${x + r * 0.35} ${top + r * 0.05} C${x + r * 0.45} ${top + r * 0.15} ${x + r} ${top + r * 0.2} ${x + r} ${top + r * 0.9} L${x + r} ${y} Z`;
}

function Pillar({ x, y, h, w, color, time }: { x: number; y: number; h: number; w: number; color: string; time: BgContext['time'] }) {
  const gold = tone('#d4a23a', time);
  return (
    <g>
      <rect x={x - w / 2} y={y - h} width={w} height={h} fill={color} />
      <rect x={x - w / 2} y={y - h} width={w * 0.22} height={h} fill={lighten(color, 0.12)} />
      <rect x={x + w * 0.3} y={y - h} width={w * 0.2} height={h} fill={darken(color, 0.12)} />
      <rect x={x - w * 0.7} y={y - h - 30} width={w * 1.4} height={34} rx={6} fill={gold} />
      <rect x={x - w * 0.62} y={y - 40} width={w * 1.24} height={40} rx={4} fill={darken(color, 0.1)} />
      {[0.3, 0.55].map((f) => (
        <rect key={f} x={x - w / 2 - 4} y={y - h * f} width={w + 8} height={12} fill={gold} />
      ))}
    </g>
  );
}

function Lamp({ x, y, len, t, uid, name, time }: { x: number; y: number; len: number; t: number; uid: string; name: string; time: BgContext['time'] }) {
  const swing = Math.sin(t * 1.3 + x) * 2;
  return (
    <g transform={`rotate(${swing} ${x} ${y})`}>
      <path d={`M${x} ${y} L${x} ${y + len}`} stroke={tone('#a8741c', time)} strokeWidth={3} />
      <Glow x={x} y={y + len} r={150} color="#ffb84a" opacity={time === 'day' ? 0.25 : 0.55} uid={uid} name={name} />
      <path d={`M${x - 34} ${y + len} C${x - 30} ${y + len + 30} ${x + 30} ${y + len + 30} ${x + 34} ${y + len} Z`} fill={tone('#d4a23a', time)} />
      <Flame x={x} y={y + len - 2} s={0.8} t={t} seed={x} />
    </g>
  );
}

export function palace({ t, time, uid }: BgContext): BgLayer[] {
  const pal = SKY[time];
  const wall = tone('#e8c9a0', time);
  const wallDark = tone('#c99f6e', time);
  const red = tone('#9b2335', time);
  const gold = tone('#d4a23a', time);
  return [
    {
      depth: 0,
      node: (
        <g>
          <SkyGradient pal={pal} uid={uid} horizon={1100} />
          {time === 'night' && <Stars seed="pl" count={80} t={t} maxY={1100} />}
          <Sun x={540} y={time === 'night' ? 520 : 760} r={60} pal={pal} uid={uid} time={time} />
        </g>
      ),
    },
    {
      depth: 0.4,
      node: (
        <g>
          <defs>
            <mask id={`${uid}-arches`}>
              <rect x={-BLEED} y={-BLEED} width={W + BLEED * 2} height={H + BLEED * 2} fill="white" />
              {[-160, 180, 540, 900, 1240].map((x) => (
                <path key={x} d={archPath(x, 1360, 250, 640)} fill="black" />
              ))}
            </mask>
          </defs>
          <Rect fill={wall} />
          <g mask={`url(#${uid}-arches)`}>
            <Rect fill={wall} />
            {Array.from({ length: 12 }, (_, i) => (
              <rect key={i} x={-BLEED} y={i * 160 - 100} width={W + BLEED * 2} height={4} fill={wallDark} opacity={0.35} />
            ))}
          </g>
          {[-160, 180, 540, 900, 1240].map((x) => (
            <path key={x} d={archPath(x, 1360, 250, 640)} fill="none" stroke={gold} strokeWidth={14} />
          ))}
          {[0, 360, 720, 1080].map((x) => (
            <Pillar key={x} x={x} y={1400} h={760} w={70} color={wallDark} time={time} />
          ))}
          <rect x={-BLEED} y={560} width={W + BLEED * 2} height={40} fill={gold} />
          <rect x={-BLEED} y={600} width={W + BLEED * 2} height={18} fill={red} />
        </g>
      ),
    },
    {
      depth: 0.7,
      node: (
        <g>
          <defs>
            <linearGradient id={`${uid}-floor`} x1="0" y1="1380" x2="0" y2={H + BLEED} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={tone('#d9c2a4', time)} />
              <stop offset="1" stopColor={tone('#a8865e', time)} />
            </linearGradient>
          </defs>
          <rect x={-BLEED} y={1390} width={W + BLEED * 2} height={H + BLEED - 1390} fill={`url(#${uid}-floor)`} />
          {Array.from({ length: 9 }, (_, i) => {
            const y = 1390 + Math.pow(i / 8, 1.7) * 560;
            return <path key={i} d={`M${-BLEED} ${y} L${W + BLEED} ${y}`} stroke={darken(wall, 0.22)} strokeWidth={2 + i * 0.4} opacity={0.5} />;
          })}
          {Array.from({ length: 15 }, (_, i) => {
            const x = 540 + (i - 7) * 90;
            return <path key={`v${i}`} d={`M${x} 1390 L${540 + (i - 7) * 330} ${H + BLEED}`} stroke={darken(wall, 0.22)} strokeWidth={2} opacity={0.4} />;
          })}
          <path d={`M380 1390 L700 1390 L940 ${H + BLEED} L140 ${H + BLEED} Z`} fill={red} opacity={0.85} />
          <path d={`M380 1390 L700 1390 L940 ${H + BLEED} L140 ${H + BLEED} Z`} fill="none" stroke={gold} strokeWidth={10} />
          {[180, 900].map((x, i) => (
            <Lamp key={x} x={x} y={-BLEED} len={BLEED + 420} t={t} uid={uid} name={`l${i}`} time={time} />
          ))}
        </g>
      ),
    },
    {
      depth: 1.3,
      node: (
        <g>
          {[-1, 1].map((s) => (
            <g key={s} transform={s > 0 ? `translate(${W} 0) scale(-1 1)` : undefined}>
              <path d={`M${-BLEED} ${-BLEED} L260 ${-BLEED} C200 200 120 360 ${-BLEED} 520 Z`} fill={red} />
              <path d={`M260 ${-BLEED} C200 200 120 360 ${-BLEED} 520`} stroke={gold} strokeWidth={10} fill="none" />
              <path d={`M-40 ${-BLEED} L-40 2200`} stroke={tone('#8a6a4a', time)} strokeWidth={70} />
              <path d={`M-40 ${-BLEED} L-40 2200`} stroke={gold} strokeWidth={10} strokeDasharray="40 120" />
            </g>
          ))}
        </g>
      ),
    },
  ];
}

function Bell({ x, y, len, t, time }: { x: number; y: number; len: number; t: number; time: BgContext['time'] }) {
  const a = Math.sin(t * 2.4 + x * 0.01) * 6;
  const brass = tone('#c8962e', time);
  return (
    <g transform={`rotate(${a} ${x} ${y})`}>
      <path d={`M${x} ${y} L${x} ${y + len}`} stroke={darken(brass, 0.3)} strokeWidth={4} />
      <path d={`M${x - 26} ${y + len + 50} C${x - 26} ${y + len} ${x + 26} ${y + len} ${x + 26} ${y + len + 50} L${x + 32} ${y + len + 56} L${x - 32} ${y + len + 56} Z`} fill={brass} />
      <circle cx={x} cy={y + len + 62} r={7} fill={darken(brass, 0.25)} />
    </g>
  );
}

export function temple({ t, time, uid }: BgContext): BgLayer[] {
  const stone = tone('#b8a48a', time, 0.7);
  const stoneDark = darken(stone, 0.2);
  const inner = time === 'day' ? '#ffd88a' : '#ffbf5a';
  const r = rng(`${uid}tp`);
  return [
    {
      depth: 0.2,
      node: (
        <g>
          <Rect fill={darken(stone, 0.12)} />
          {Array.from({ length: 22 }, (_, i) =>
            Array.from({ length: 8 }, (_, j) => (
              <rect key={`${i}-${j}`} x={-BLEED + j * 220 + (i % 2) * 110} y={-BLEED + i * 110} width={216} height={106} fill={i % 3 === j % 3 ? stone : darken(stone, 0.06)} opacity={0.55} />
            )),
          )}
          <g transform="translate(540 1420)">
            <path d="M-260 0 L-260 -640 C-260 -760 -150 -840 0 -880 C150 -840 260 -760 260 -640 L260 0 Z" fill={stoneDark} />
            <path d="M-180 0 L-180 -560 C-180 -650 -100 -710 0 -740 C100 -710 180 -650 180 -560 L180 0 Z" fill={inner} />
            <Glow x={0} y={-380} r={420} color="#ffe2a0" opacity={0.75} uid={uid} name="sanctum" />
            {Array.from({ length: 10 }, (_, i) => (
              <path key={i} d="M0 -380 L-30 -900 L30 -900 Z" fill="#fff4cf" opacity={0.08 + 0.04 * Math.sin(t * 1.5 + i)} transform={`rotate(${-60 + i * 13} 0 -380)`} />
            ))}
            <path d="M-180 -560 C-180 -650 -100 -710 0 -740 C100 -710 180 -650 180 -560" stroke={tone('#d4a23a', time)} strokeWidth={14} fill="none" />
            {Array.from({ length: 13 }, (_, i) => (
              <circle key={i} cx={-240 + i * 40} cy={-30} r={14} fill={['#ff922b', '#ffd43b'][i % 2]} />
            ))}
          </g>
        </g>
      ),
    },
    {
      depth: 0.55,
      node: (
        <g>
          <Ground y={1400} top={tone('#8f7c66', time)} bottom={tone('#5e4f40', time)} uid={uid} name="floor" />
          {Array.from({ length: 6 }, (_, i) => (
            <path key={i} d={`M${-BLEED} ${1400 + i * i * 14} L${W + BLEED} ${1400 + i * i * 14}`} stroke={stoneDark} strokeWidth={2} opacity={0.5} />
          ))}
          {[130, 950].map((x, i) => (
            <g key={x}>
              <rect x={x - 60} y={500} width={120} height={900} fill={stone} />
              {Array.from({ length: 7 }, (_, k) => (
                <rect key={k} x={x - 70} y={560 + k * 130} width={140} height={22} fill={stoneDark} />
              ))}
              <rect x={x - 80} y={460} width={160} height={50} fill={stoneDark} />
              <g transform={`translate(${x} 1400)`}>
                <rect x={-8} y={-260} width={16} height={260} fill={tone('#a8741c', time)} />
                {[0, 1, 2].map((k) => (
                  <g key={k}>
                    <rect x={-50 + k * 8} y={-260 + k * 70} width={100 - k * 16} height={10} fill={tone('#c8962e', time)} />
                    <Flame x={-40 + k * 8} y={-262 + k * 70} s={0.45} t={t} seed={i * 10 + k} />
                    <Flame x={40 - k * 8} y={-262 + k * 70} s={0.45} t={t} seed={i * 10 + k + 5} />
                  </g>
                ))}
                <Glow x={0} y={-180} r={200} color="#ffb84a" opacity={0.4} uid={uid} name={`stand${i}`} />
              </g>
            </g>
          ))}
        </g>
      ),
    },
    {
      depth: 1.25,
      node: (
        <g>
          {[[-60, 0], [W + 60, 1]].map(([x, flip]) => (
            <g key={x}>
              <rect x={x! - 90} y={-BLEED} width={180} height={H + BLEED * 2} fill={darken(stone, 0.35)} />
              {Array.from({ length: 10 }, (_, k) => (
                <rect key={k} x={x! - 100} y={k * 220 - 100} width={200} height={26} fill={darken(stone, 0.45)} />
              ))}
              <Bell x={flip ? x! - 170 : x! + 170} y={-BLEED} len={BLEED + 180 + r() * 60} t={t} time={time} />
            </g>
          ))}
        </g>
      ),
    },
  ];
}

export function cosmos({ t, uid }: BgContext): BgLayer[] {
  const turn = t * 4;
  return [
    {
      depth: 0,
      node: (
        <g>
          <defs>
            <radialGradient id={`${uid}-space`} cx="0.5" cy="0.45" r="0.8">
              <stop offset="0" stopColor="#2a1b5e" />
              <stop offset="0.5" stopColor="#120c33" />
              <stop offset="1" stopColor="#05030f" />
            </radialGradient>
          </defs>
          <Rect fill={`url(#${uid}-space)`} />
          <Glow x={260} y={520} r={520} color="#7b2cbf" opacity={0.45} uid={uid} name="neb1" />
          <Glow x={860} y={1100} r={600} color="#1c7ed6" opacity={0.4} uid={uid} name="neb2" />
          <Glow x={500} y={1500} r={420} color="#e64980" opacity={0.3} uid={uid} name="neb3" />
          <Stars seed="cs" count={320} t={t} maxY={H + BLEED} />
        </g>
      ),
    },
    {
      depth: 0.3,
      node: (
        <g transform={`translate(540 880) rotate(${turn})`} opacity={0.5}>
          {[160, 260, 380, 520].map((rad, i) => (
            <circle key={rad} r={rad} fill="none" stroke="#ffd36b" strokeWidth={i === 3 ? 3 : 2} opacity={0.6 - i * 0.1} />
          ))}
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} d="M0 -160 C40 -240 40 -320 0 -380 C-40 -320 -40 -240 0 -160 Z" fill="none" stroke="#ffd36b" strokeWidth={2} transform={`rotate(${i * 22.5})`} opacity={0.7} />
          ))}
          {Array.from({ length: 32 }, (_, i) => (
            <circle key={`d${i}`} cx={0} cy={-520} r={5} fill="#ffe8a8" transform={`rotate(${i * 11.25})`} />
          ))}
        </g>
      ),
    },
    {
      depth: 0.8,
      node: (
        <g>
          <Glow x={540} y={1585} r={520} color="#ffd36b" opacity={0.35} uid={uid} name="floor" />
          <ellipse cx={540} cy={1590} rx={380} ry={60} fill="none" stroke="#ffe8a8" strokeWidth={3} opacity={0.5} />
        </g>
      ),
    },
  ];
}

export function studio({ time, uid }: BgContext): BgLayer[] {
  const pal = SKY[time];
  const base = { dawn: '#f6d6c8', day: '#f2ead9', dusk: '#f0b48a', night: '#1d2552' }[time];
  return [
    {
      depth: 0,
      node: (
        <g>
          <defs>
            <radialGradient id={`${uid}-studio`} cx="0.5" cy="0.42" r="0.75">
              <stop offset="0" stopColor={lighten(base, 0.25)} />
              <stop offset="1" stopColor={darken(base, 0.18)} />
            </radialGradient>
          </defs>
          <Rect fill={`url(#${uid}-studio)`} />
          <Glow x={540} y={760} r={700} color={pal.glow} opacity={0.25} uid={uid} name="key" />
        </g>
      ),
    },
    {
      depth: 0.9,
      node: <ellipse cx={540} cy={1730} rx={420} ry={60} fill={darken(base, 0.35)} opacity={0.35} />,
    },
  ];
}

export { mix };
