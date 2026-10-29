import React from 'react';
import { darken, lighten, mix, noise1, rng } from '../util.ts';
import {
  BLEED,
  type BgContext,
  type BgLayer,
  Clouds,
  Flag,
  Glow,
  Ground,
  H,
  Haze,
  Rect,
  SKY,
  SkyGradient,
  Stars,
  Sun,
  W,
  ridge,
  tone,
} from './common.tsx';

const sunPos = (time: BgContext['time'], dx = 0): [number, number, number] =>
  ({ dawn: [300 + dx, 1110, 92], day: [800 + dx, 360, 66], dusk: [760 + dx, 1080, 100], night: [790 + dx, 380, 58] })[time] as [number, number, number];

function Soldiers({ seed, y, count, scale, color, t }: { seed: string; y: number; count: number; scale: number; color: string; t: number }) {
  const r = rng(seed);
  const items: React.ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const x = r() * (W + BLEED * 2) - BLEED;
    const yy = y + r() * 26 * scale;
    const k = scale * (0.8 + r() * 0.4);
    const bob = Math.sin(t * 3 + i) * 1.2;
    items.push(
      <g key={i} transform={`translate(${x} ${yy + bob}) scale(${k})`}>
        <circle cx={0} cy={-34} r={5.5} />
        <path d="M-6 -28 L6 -28 L8 -6 L-8 -6 Z" />
        <path d="M-5 -6 L-6 0 M5 -6 L6 0" stroke={color} strokeWidth={3} />
        {r() < 0.6 && <path d={`M${7} -20 L${10} -66`} stroke={color} strokeWidth={1.6} />}
      </g>,
    );
    if (r() < 0.12) {
      const fx = x + 12;
      items.push(
        <g key={`f${i}`}>
          <path d={`M${fx} ${yy} L${fx} ${yy - 120 * scale}`} stroke={color} strokeWidth={2.4 * scale} />
          <Flag x={fx} y={yy - 120 * scale} w={34 * scale} h={22 * scale} color={i % 3 ? color : mix(color, '#c2410c', 0.5)} t={t + i} />
        </g>,
      );
    }
    if (r() < 0.05) {
      items.push(
        <g key={`e${i}`} transform={`translate(${x} ${yy}) scale(${scale * 1.3})`}>
          <ellipse cx={0} cy={-40} rx={40} ry={26} />
          <circle cx={36} cy={-46} r={18} />
          <path d="M48 -40 C58 -24 54 -8 50 0" stroke={color} strokeWidth={6} fill="none" />
          <path d="M-28 -18 L-28 0 M-10 -18 L-10 0 M12 -18 L12 0 M28 -18 L28 0" stroke={color} strokeWidth={9} />
          <path d="M-20 -64 L10 -64 L10 -84 L-20 -84 Z" />
        </g>,
      );
    }
  }
  return <g fill={color}>{items}</g>;
}

export function kurukshetra({ t, time, uid }: BgContext): BgLayer[] {
  const pal = SKY[time];
  const [sx, sy, sr] = sunPos(time);
  const ground = tone('#c9955a', time);
  const groundDark = tone('#8a5a32', time);
  const armyFar = mix(pal.far, pal.haze, 0.35);
  const armyMid = darken(mix(pal.mid, '#3a2416', 0.35), 0.1);
  const r = rng(`${uid}kk`);
  return [
    {
      depth: 0,
      node: (
        <g>
          <SkyGradient pal={pal} uid={uid} horizon={1320} />
          {time === 'night' && <Stars seed="kk" count={160} t={t} maxY={1050} />}
          <Sun x={sx} y={sy} r={sr} pal={pal} uid={uid} time={time} />
          <Clouds seed="kk-c" y0={200} y1={900} count={7} fill={time === 'night' ? '#2e3a6e' : lighten(pal.skyMid, 0.35)} opacity={time === 'day' ? 0.85 : 0.45} t={t} speed={5} />
        </g>
      ),
    },
    {
      depth: 0.15,
      node: (
        <g>
          <path d={ridge(11, 1250, 70, 0.004)} fill={mix(pal.far, pal.haze, 0.45)} />
          <Haze y={1290} h={180} color={pal.haze} opacity={0.75} uid={uid} name="far" />
        </g>
      ),
    },
    {
      depth: 0.3,
      node: (
        <g>
          <Ground y={1300} top={mix(ground, pal.haze, 0.55)} bottom={ground} uid={uid} name="plain" />
          <Soldiers seed="kk-army-far" y={1306} count={150} scale={0.7} color={armyFar} t={t} />
          <Haze y={1320} h={70} color={pal.haze} opacity={0.5} uid={uid} name="dust1" />
        </g>
      ),
    },
    {
      depth: 0.55,
      node: (
        <g>
          <Soldiers seed="kk-army-mid" y={1360} count={70} scale={1.5} color={armyMid} t={t} />
          <Haze y={1400} h={120} color={mix(pal.haze, ground, 0.4)} opacity={0.55} uid={uid} name="dust2" />
        </g>
      ),
    },
    {
      depth: 0.85,
      node: (
        <g>
          <path d={`M${-BLEED} 1440 C300 1420 700 1450 ${W + BLEED} 1430 L${W + BLEED} ${H + BLEED} L${-BLEED} ${H + BLEED} Z`} fill={ground} />
          <Ground y={1560} top={ground} bottom={groundDark} uid={uid} name="near" />
          {Array.from({ length: 50 }, (_, i) => {
            const x = r() * (W + BLEED * 2) - BLEED;
            const y = 1460 + r() * 460;
            return <ellipse key={i} cx={x} cy={y} rx={4 + r() * 14} ry={2 + r() * 4} fill={darken(ground, 0.18 + r() * 0.1)} opacity={0.6} />;
          })}
          {Array.from({ length: 14 }, (_, i) => {
            const x = r() * (W + BLEED) - BLEED / 2;
            const y = 1480 + r() * 300;
            const a = -20 + r() * 40;
            return (
              <g key={`a${i}`} transform={`translate(${x} ${y}) rotate(${a})`}>
                <path d="M0 0 L0 -60" stroke={tone('#5a3a1e', time)} strokeWidth={3} />
                <path d="M0 -60 l-6 -14 l6 4 l6 -4 Z" fill={tone('#eee4d0', time)} />
              </g>
            );
          })}
        </g>
      ),
    },
    {
      depth: 1.3,
      node: (
        <g>
          <g transform="translate(-80 1960) rotate(-14)" fill={tone('#3e2717', time)}>
            <circle r={150} fill="none" stroke={tone('#3e2717', time)} strokeWidth={22} />
            {Array.from({ length: 8 }, (_, i) => (
              <rect key={i} x={-6} y={-150} width={12} height={150} transform={`rotate(${i * 45})`} />
            ))}
          </g>
          {[[1010, 2000, 12], [960, 2030, -8], [70, 1880, 18]].map(([x, y, a], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${a})`}>
              <path d="M0 0 L0 -260" stroke={tone('#4a2e18', time)} strokeWidth={9} />
              <path d="M0 -260 l-16 -40 l16 10 l16 -10 Z" fill={tone('#d8cdb8', time)} />
            </g>
          ))}
        </g>
      ),
    },
  ];
}

function TreeCanopy({ x, y, s, color, seed }: { x: number; y: number; s: number; color: string; seed: number }) {
  const r = rng(seed);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-10 0 L-14 220 L14 220 L10 0 Z" fill={darken(color, 0.35)} />
      {Array.from({ length: 7 }, (_, i) => (
        <circle key={i} cx={(r() - 0.5) * 160} cy={-20 - r() * 130} r={50 + r() * 40} fill={i % 2 ? color : lighten(color, 0.08)} />
      ))}
    </g>
  );
}

export function forest({ t, time, uid }: BgContext): BgLayer[] {
  const pal = SKY[time];
  const leaf = tone('#3f8f4f', time);
  const leafFar = mix(tone('#6fae7c', time), pal.haze, 0.45);
  const leafMid = tone('#2f7a45', time);
  const r = rng(`${uid}fo`);
  return [
    {
      depth: 0,
      node: (
        <g>
          <SkyGradient pal={{ ...pal, skyBottom: lighten(pal.skyBottom, 0.1) }} uid={uid} horizon={1200} />
          {time === 'night' && <Stars seed="fo" count={90} t={t} maxY={700} />}
          <Sun x={540} y={time === 'day' ? 420 : 900} r={70} pal={pal} uid={uid} time={time} />
        </g>
      ),
    },
    {
      depth: 0.2,
      node: (
        <g>
          {Array.from({ length: 14 }, (_, i) => (
            <TreeCanopy key={i} x={-200 + i * 110} y={1080 + (i % 3) * 30} s={1.2 + (i % 2) * 0.3} color={leafFar} seed={i + 3} />
          ))}
          <Haze y={1250} h={260} color={pal.haze} opacity={0.6} uid={uid} name="forest" />
        </g>
      ),
    },
    {
      depth: 0.5,
      node: (
        <g>
          <Ground y={1380} top={tone('#7aa35a', time)} bottom={tone('#4f7a3a', time)} uid={uid} name="glade" />
          {Array.from({ length: 6 }, (_, i) => (
            <TreeCanopy key={i} x={-120 + i * 260 + (i % 2) * 60} y={1200} s={2} color={leafMid} seed={i + 30} />
          ))}
          <g transform="translate(150 1400)">
            <path d="M-130 0 L-130 -150 L130 -150 L130 0 Z" fill={tone('#a0784a', time)} />
            <path d="M-170 -140 L0 -280 L170 -140 Z" fill={tone('#c9a25a', time)} />
            <path d="M-170 -140 L0 -280 L170 -140" stroke={tone('#8a6a3a', time)} strokeWidth={8} fill="none" />
            <path d="M-36 0 L-36 -100 L36 -100 L36 0 Z" fill={tone('#3a2614', time)} />
          </g>
        </g>
      ),
    },
    {
      depth: 0.85,
      node: (
        <g>
          <path d={`M${-BLEED} 1500 C300 1470 700 1490 ${W + BLEED} 1480 L${W + BLEED} ${H + BLEED} L${-BLEED} ${H + BLEED} Z`} fill={tone('#6a9a4a', time)} />
          <Ground y={1640} top={tone('#6a9a4a', time)} bottom={tone('#3f6a2e', time)} uid={uid} name="grass" />
          {Array.from({ length: 70 }, (_, i) => {
            const x = r() * (W + BLEED * 2) - BLEED;
            const y = 1500 + r() * 420;
            const h = 18 + r() * 26;
            const sw = Math.sin(t * 2 + i) * 3;
            return <path key={i} d={`M${x} ${y} q${-4 + sw} ${-h * 0.6} ${sw * 2} ${-h} M${x + 5} ${y} q${4 + sw} ${-h * 0.5} ${8 + sw * 2} ${-h * 0.8}`} stroke={tone(i % 2 ? '#4f8a3a' : '#5f9a44', time)} strokeWidth={3} fill="none" />;
          })}
          {Array.from({ length: 18 }, (_, i) => (
            <circle key={`f${i}`} cx={r() * W} cy={1520 + r() * 380} r={5 + r() * 4} fill={tone(['#ffd43b', '#ff8fab', '#ffffff'][i % 3]!, time)} />
          ))}
        </g>
      ),
    },
    {
      depth: 1.3,
      node: (
        <g>
          <path d="M-60 -200 L40 -200 L60 2200 L-80 2200 Z" fill={tone('#3a2a1a', time)} />
          <TreeCanopy x={0} y={80} s={3.2} color={leaf} seed={91} />
          {[-30, 1100].map((x, i) => (
            <g key={i} transform={`translate(${x} 2000) scale(${i ? -1 : 1} 1)`} fill={tone('#2f6a35', time)}>
              {[0, 1, 2, 3, 4].map((k) => (
                <path key={k} d={`M0 0 C${60 + k * 30} ${-120 - k * 30} ${160 + k * 20} ${-160 - k * 40} ${220 + k * 10} ${-150 - k * 60} C${150} ${-100 - k * 20} ${80} ${-40} 0 0 Z`} transform={`rotate(${-10 + k * 6 + Math.sin(t * 1.5 + k) * 2})`} />
              ))}
            </g>
          ))}
        </g>
      ),
    },
  ];
}

function Shikhara({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={color}>
      <path d="M-60 0 L-60 -60 L-44 -60 C-44 -140 -20 -200 0 -230 C20 -200 44 -140 44 -60 L60 -60 L60 0 Z" />
      <circle cx={0} cy={-238} r={10} />
      <path d="M0 -248 L0 -290" stroke={color} strokeWidth={3} />
      <path d="M0 -290 L24 -282 L0 -274 Z" />
    </g>
  );
}

export function river({ t, time, uid }: BgContext): BgLayer[] {
  const pal = SKY[time];
  const [sx, sy, sr] = sunPos(time, -60);
  const water = time === 'night' ? '#16224a' : mix(pal.skyMid, '#2f6f8f', 0.45);
  const stone = tone('#b99a74', time);
  const r = rng(`${uid}rv`);
  const dusky = time === 'dusk' || time === 'night';
  return [
    {
      depth: 0,
      node: (
        <g>
          <SkyGradient pal={pal} uid={uid} horizon={1120} />
          {time === 'night' && <Stars seed="rv" count={140} t={t} maxY={900} />}
          <Sun x={sx} y={Math.min(sy, 1000)} r={sr} pal={pal} uid={uid} time={time} />
          <Clouds seed="rv-c" y0={160} y1={700} count={6} fill={time === 'night' ? '#26305e' : lighten(pal.skyMid, 0.4)} opacity={0.6} t={t} speed={4} />
        </g>
      ),
    },
    {
      depth: 0.2,
      node: (
        <g>
          <path d={ridge(5, 1060, 22, 0.006)} fill={mix(pal.far, pal.haze, 0.3)} />
          {[[120, 1060, 0.9], [260, 1062, 1.3], [420, 1060, 0.8], [700, 1064, 1.1], [880, 1060, 1.5], [1000, 1062, 0.7]].map(([x, y, s], i) => (
            <Shikhara key={i} x={x!} y={y!} s={s! * 0.75} color={mix(pal.far, pal.mid, 0.4)} />
          ))}
          {dusky && Array.from({ length: 20 }, (_, i) => <circle key={i} cx={r() * W} cy={1040 + r() * 20} r={2.5} fill="#ffd27a" opacity={0.8} />)}
        </g>
      ),
    },
    {
      depth: 0.4,
      node: (
        <g>
          <Rect fill={water} y={1080} h={900} />
          <Haze y={1090} h={60} color={pal.haze} opacity={0.6} uid={uid} name="water" />
          <rect x={sx - 60} y={1090} width={120} height={500} fill={pal.sun} opacity={0.18} />
          {Array.from({ length: 46 }, (_, i) => {
            const y = 1100 + (i % 23) * 24 + (i > 22 ? 12 : 0);
            const x = ((r() * (W + 400) + t * (10 + (i % 5) * 4)) % (W + 400)) - 200;
            const w = 40 + r() * 120;
            const near = Math.abs(x - sx) < 160;
            return <path key={i} d={`M${x} ${y} L${x + w} ${y}`} stroke={near ? pal.sun : lighten(water, 0.25)} strokeWidth={near ? 4 : 3} opacity={near ? 0.75 : 0.45} strokeLinecap="round" />;
          })}
          {dusky &&
            Array.from({ length: 9 }, (_, i) => {
              const x = ((i * 137 + t * 14) % (W + 200)) - 100;
              const y = 1240 + (i % 3) * 70 + Math.sin(t * 1.4 + i) * 4;
              return (
                <g key={`d${i}`} transform={`translate(${x} ${y})`}>
                  <Glow x={0} y={-6} r={36} color="#ffb84a" opacity={0.5} uid={uid} name={`diya${i}`} />
                  <path d="M-14 0 C-12 8 12 8 14 0 Z" fill="#a0522d" />
                  <ellipse cx={0} cy={-6} rx={3} ry={7} fill="#ffd84a" />
                </g>
              );
            })}
        </g>
      ),
    },
    {
      depth: 0.9,
      node: (
        <g>
          {Array.from({ length: 7 }, (_, i) => {
            const y = 1600 + i * 52;
            return (
              <g key={i}>
                <rect x={-BLEED} y={y} width={W + BLEED * 2} height={52} fill={i % 2 ? stone : lighten(stone, 0.08)} />
                <rect x={-BLEED} y={y} width={W + BLEED * 2} height={8} fill={lighten(stone, 0.22)} />
              </g>
            );
          })}
          <rect x={-BLEED} y={1560} width={W + BLEED * 2} height={44} fill={darken(stone, 0.1)} />
          {[[150, 1600], [930, 1600]].map(([x, y], i) => (
            <g key={i}>
              <rect x={x! - 10} y={y! - 210} width={20} height={210} fill={tone('#7a5a3a', time)} />
              <path d={`M${x! - 70} ${y! - 210} C${x! - 30} ${y! - 250} ${x! + 30} ${y! - 250} ${x! + 70} ${y! - 210} Z`} fill={tone('#d9480f', time)} />
              {dusky && <Glow x={x!} y={y! - 120} r={70} color="#ffb84a" opacity={0.45} uid={uid} name={`lamp${i}`} />}
            </g>
          ))}
        </g>
      ),
    },
  ];
}

export function kailash({ t, time, uid }: BgContext): BgLayer[] {
  const pal = SKY[time];
  const snow = tone('#f4f7fb', time, 0.8);
  const rock = tone('#6b7a96', time, 0.8);
  return [
    {
      depth: 0,
      node: (
        <g>
          <SkyGradient pal={pal} uid={uid} horizon={1250} />
          {(time === 'night' || time === 'dawn') && <Stars seed="kl" count={220} t={t} maxY={1000} opacity={time === 'dawn' ? 0.4 : 1} />}
          <Sun x={760} y={time === 'night' ? 330 : 420} r={60} pal={pal} uid={uid} time={time} />
        </g>
      ),
    },
    {
      depth: 0.12,
      node: (
        <g>
          <path d={ridge(21, 1120, 140, 0.0035, 30)} fill={mix(rock, pal.haze, 0.45)} />
          <g transform="translate(540 1180)">
            <path d="M-420 0 L-120 -560 C-60 -640 60 -640 120 -560 L420 0 Z" fill={rock} />
            <path d="M-170 -470 L-120 -560 C-60 -640 60 -640 120 -560 L170 -470 C100 -500 40 -440 0 -470 C-40 -440 -100 -500 -170 -470 Z" fill={snow} />
            {[-380, -300, -220].map((y, i) => (
              <path key={y} d={`M${-150 - i * 40} ${y} C-60 ${y - 20} 60 ${y - 20} ${150 + i * 40} ${y}`} stroke={snow} strokeWidth={14 - i * 3} fill="none" opacity={0.85} />
            ))}
            <path d="M0 -600 L0 -100" stroke={snow} strokeWidth={10} opacity={0.6} />
          </g>
          <Haze y={1150} h={220} color={pal.haze} opacity={0.65} uid={uid} name="mist" />
        </g>
      ),
    },
    {
      depth: 0.45,
      node: (
        <g>
          <path d={ridge(33, 1380, 90, 0.005, 20)} fill={mix(rock, pal.mid, 0.4)} />
          <path d={ridge(33, 1372, 90, 0.005, 20)} fill="none" stroke={snow} strokeWidth={10} opacity={0.7} />
          <Clouds seed="kl-c" y0={1280} y1={1420} count={8} fill={lighten(pal.haze, 0.3)} opacity={0.55} t={t} speed={8} />
        </g>
      ),
    },
    {
      depth: 0.85,
      node: (
        <g>
          <path d={`M${-BLEED} 1560 C200 1520 600 1540 ${W + BLEED} 1530 L${W + BLEED} ${H + BLEED} L${-BLEED} ${H + BLEED} Z`} fill={snow} />
          <path d={`M${-BLEED} 1700 C300 1680 800 1720 ${W + BLEED} 1690`} stroke={tone('#d6e2f0', time)} strokeWidth={30} fill="none" opacity={0.7} />
          {[[120, 1620], [880, 1640], [600, 1700]].map(([x, y], i) => (
            <path key={i} d={`M${x! - 60} ${y} C${x! - 40} ${y! - 50} ${x! + 30} ${y! - 60} ${x! + 70} ${y}`} fill={tone('#8a97ad', time)} />
          ))}
        </g>
      ),
    },
    {
      depth: 1.3,
      node: <Clouds seed="kl-front" y0={1880} y1={2050} count={5} fill={lighten(pal.haze, 0.5)} opacity={0.5} t={t} speed={14} />,
    },
  ];
}

function Hut({ x, y, s, time }: { x: number; y: number; s: number; time: BgContext['time'] }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-70 0 L-70 -80 L70 -80 L70 0 Z" fill={tone('#e0b98a', time)} />
      <path d="M-95 -72 C-60 -150 60 -150 95 -72 Z" fill={tone('#b08a4a', time)} />
      <path d="M-18 0 L-18 -48 L18 -48 L18 0 Z" fill={tone('#6a4422', time)} />
    </g>
  );
}

export function vrindavan({ t, time, uid }: BgContext): BgLayer[] {
  const pal = SKY[time];
  const meadow = tone('#8cc06a', time);
  const meadowDark = tone('#5f9a48', time);
  const r = rng(`${uid}vr`);
  return [
    {
      depth: 0,
      node: (
        <g>
          <SkyGradient pal={pal} uid={uid} horizon={1200} />
          {time === 'night' && <Stars seed="vr" count={150} t={t} maxY={950} />}
          <Sun x={260} y={time === 'day' ? 380 : 960} r={70} pal={pal} uid={uid} time={time} />
          <Clouds seed="vr-c" y0={180} y1={760} count={7} fill={time === 'night' ? '#26305e' : '#ffffff'} opacity={time === 'day' ? 0.95 : 0.5} t={t} speed={5} />
        </g>
      ),
    },
    {
      depth: 0.15,
      node: (
        <g>
          <path d={ridge(9, 1150, 60, 0.004)} fill={mix(tone('#7fae86', time), pal.haze, 0.5)} />
          {[[140, 1150], [230, 1158], [800, 1152], [930, 1160]].map(([x, y], i) => (
            <Hut key={i} x={x!} y={y!} s={0.55} time={time} />
          ))}
        </g>
      ),
    },
    {
      depth: 0.35,
      node: (
        <g>
          <Ground y={1180} top={mix(meadow, pal.haze, 0.35)} bottom={meadow} uid={uid} name="meadow" />
          <path d={`M${-BLEED} 1260 C200 1230 500 1300 ${W + BLEED} 1250 L${W + BLEED} 1330 C600 1370 300 1310 ${-BLEED} 1340 Z`} fill={time === 'night' ? '#1c2a5a' : mix('#4aa3c8', pal.skyMid, 0.35)} />
          {Array.from({ length: 16 }, (_, i) => {
            const x = ((r() * (W + 300) + t * 18) % (W + 300)) - 150;
            const y = 1268 + r() * 60;
            return <path key={i} d={`M${x} ${y} l${30 + r() * 40} 0`} stroke="#ffffff" strokeWidth={3} opacity={0.45} strokeLinecap="round" />;
          })}
        </g>
      ),
    },
    {
      depth: 0.7,
      node: (
        <g>
          <path d={`M${-BLEED} 1420 C300 1390 700 1430 ${W + BLEED} 1400 L${W + BLEED} ${H + BLEED} L${-BLEED} ${H + BLEED} Z`} fill={meadow} />
          <g transform="translate(860 1440)">
            <path d="M-26 0 C-20 -120 -30 -240 -10 -340 L24 -340 C20 -240 30 -120 34 0 Z" fill={tone('#6a4a2a', time)} />
            {Array.from({ length: 9 }, (_, i) => {
              const a = (i / 9) * Math.PI * 2;
              return <circle key={i} cx={Math.cos(a) * 140} cy={-420 + Math.sin(a) * 90} r={90} fill={i % 2 ? tone('#3f8f4f', time) : tone('#4c9c58', time)} />;
            })}
            <circle cx={0} cy={-430} r={110} fill={tone('#4c9c58', time)} />
            {Array.from({ length: 22 }, (_, i) => (
              <circle key={`b${i}`} cx={(r() - 0.5) * 360} cy={-430 + (r() - 0.5) * 220} r={9} fill={tone('#ffb72b', time)} />
            ))}
          </g>
        </g>
      ),
    },
    {
      depth: 0.9,
      node: (
        <g>
          <Ground y={1640} top={meadow} bottom={meadowDark} uid={uid} name="near" />
          {Array.from({ length: 60 }, (_, i) => {
            const x = r() * (W + BLEED * 2) - BLEED;
            const y = 1460 + r() * 460;
            const sw = Math.sin(t * 2.2 + i) * 3;
            return <path key={i} d={`M${x} ${y} q${-3 + sw} -14 ${sw * 2} -26 M${x + 5} ${y} q${3 + sw} -12 ${7 + sw * 2} -22`} stroke={meadowDark} strokeWidth={3} fill="none" />;
          })}
          {Array.from({ length: 26 }, (_, i) => (
            <circle key={`f${i}`} cx={r() * W} cy={1480 + r() * 420} r={5 + r() * 4} fill={tone(['#ffd43b', '#ff8fab', '#ffffff', '#ff922b'][i % 4]!, time)} />
          ))}
        </g>
      ),
    },
  ];
}

export { noise1 };
