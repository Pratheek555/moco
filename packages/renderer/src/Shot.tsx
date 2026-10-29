import {
  BACKGROUND_LAYERS,
  CHARACTER_DEFS,
  Character,
  PLACED_PROPS,
  findBackground,
  type BgLayer,
} from '@moco/kit';
import type { Actor, Shot, TimeOfDay } from '@moco/spec';
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Aura, FireFx, ScreenFx, fxEnvelope } from './fx/Fx.tsx';
import { Overlay } from './Overlay.tsx';
import { actorFrame, propPlacement, type ActorFrame, type Placement } from './timeline/actors.ts';
import { cameraFrame, layerTransform } from './timeline/camera.ts';

const W = 1080;
const H = 1920;

/** Colour grade for actors/props so they sit in the scene's light. */
const STAGE_GRADE: Record<TimeOfDay, string | undefined> = {
  dawn: 'brightness(0.98) sepia(0.12) saturate(1.06) hue-rotate(-6deg)',
  day: undefined,
  dusk: 'brightness(0.9) sepia(0.22) saturate(1.12) hue-rotate(-10deg)',
  night: 'brightness(0.62) sepia(0.3) hue-rotate(178deg) saturate(1.15)',
};

export interface ShotViewProps {
  shot: Shot;
  /** Seconds since the shot started. */
  t: number;
  frame: number;
  /** Total on-screen seconds for this shot. */
  duration: number;
  uid: string;
}

function MissingArt({ label, x, y }: { label: string; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-160} y={-520} width={320} height={520} rx={24} fill="rgba(255,255,255,0.35)" stroke="#ff4d4f" strokeWidth={6} strokeDasharray="18 12" />
      <text x={0} y={-250} textAnchor="middle" fontSize={36} fontFamily="Poppins, sans-serif" fill="#ff4d4f">
        {label}
      </text>
    </g>
  );
}

interface Drawable {
  z: number;
  node: React.ReactNode;
}

export const ShotView: React.FC<ShotViewProps> = ({ shot, t, frame, duration, uid }) => {
  const bgDef = findBackground(shot.background.id);
  const ground = bgDef?.ground ?? 0.88;
  const time = shot.background.time;
  const layers: BgLayer[] = (BACKGROUND_LAYERS[shot.background.id] ?? BACKGROUND_LAYERS.studio!)({ t, time, uid: `${uid}-bg` });
  const cam = cameraFrame(shot, t, duration);

  // Speech: the speaker's mouth moves with the narration (word-accurate if we have timings).
  const speech = shot.voice ? { words: shot.voice.words, start: 0, end: shot.voice.duration } : { words: [], start: 0.15, end: Math.min(duration - 0.2, 0.15 + shot.narration.split(/\s+/).filter(Boolean).length / 2.6) };

  const props = new Map(shot.props.map((p) => [p.id, { prop: p, place: propPlacement(p, t, ground) }]));
  const drawables: Drawable[] = [];
  const auras: React.ReactNode[] = [];
  const frames = new Map<string, { frame: ActorFrame; px: number; py: number; scale: number }>();

  const placeActor = (actor: Actor) => {
    const f = actorFrame(actor, t, ground, shot.speaker === actor.id && shot.narration ? speech : null);
    const vehicle = actor.ride ? props.get(actor.ride) : undefined;
    const seat = vehicle ? PLACED_PROPS[vehicle.prop.prop]?.seat : undefined;
    let px: number;
    let py: number;
    let scale: number;
    let opacity = f.placement.opacity;
    if (vehicle && seat) {
      const vp = vehicle.place;
      const vs = vp.scale * vp.pop;
      const vFace = vehicle.prop.facing === 'left' ? -1 : 1;
      const local = seat.x0 + ((f.placement.x + 1) / 2) * (seat.x1 - seat.x0);
      px = (vp.x + vp.dx) * W + local * vs * vFace;
      py = (vp.y + vp.dy) * H + seat.y * vs;
      scale = f.placement.scale * vs;
      opacity = Math.min(opacity, vp.opacity);
    } else {
      px = (f.placement.x + f.placement.dx) * W;
      py = (f.placement.y + f.placement.dy) * H;
      scale = f.placement.scale * f.placement.pop;
    }
    frames.set(actor.id, { frame: f, px, py, scale });
    return { f, px, py, scale, opacity, vehicle };
  };

  for (const actor of shot.actors) {
    const { f, px, py, scale, opacity, vehicle } = placeActor(actor);
    const def = CHARACTER_DEFS[actor.character];
    const baseZ = actor.z ?? (vehicle ? (vehicle.prop.z ?? vehicle.place.y) + 0.0005 : f.placement.y);
    const node =
      opacity <= 0 ? null : (
        <g key={`a-${actor.id}`} opacity={opacity} transform={`translate(${px} ${py}) scale(${scale * f.facing} ${scale})`}>
          {!vehicle && <ellipse cx={0} cy={4} rx={150} ry={26} fill="rgba(0,0,0,0.22)" />}
          {def ? (
            <Character
              def={def}
              rig={{ pose: f.pose, expression: f.expression, blink: f.blink, talk: f.talk, round: f.round, look: f.look, time: f.time, walk: f.walk, nod: f.nod }}
              pose={f.poseName}
              holdRight={actor.holdRight}
              holdLeft={actor.holdLeft}
              uid={`${uid}-${actor.id}`}
            />
          ) : (
            <MissingArt label={actor.character} x={0} y={0} />
          )}
        </g>
      );
    drawables.push({ z: baseZ, node });
  }

  for (const { prop, place } of props.values()) {
    const def = PLACED_PROPS[prop.prop];
    const z = prop.z ?? place.y;
    const transform = `translate(${(place.x + place.dx) * W} ${(place.y + place.dy) * H}) scale(${place.scale * place.pop * (prop.facing === 'left' ? -1 : 1)} ${place.scale * place.pop})`;
    if (place.opacity <= 0) continue;
    if (!def) {
      drawables.push({ z, node: <MissingArt key={`p-${prop.id}`} label={prop.prop} x={(place.x + place.dx) * W} y={(place.y + place.dy) * H} /> });
      continue;
    }
    const art = def.render({ t, moving: prop.moving, time, uid: `${uid}-${prop.id}` });
    drawables.push({ z, node: <g key={`pb-${prop.id}`} transform={transform} opacity={place.opacity}>{art.back}</g> });
    if (art.front) drawables.push({ z: z + 0.001, node: <g key={`pf-${prop.id}`} transform={transform} opacity={place.opacity}>{art.front}</g> });
  }

  // World-space effects that belong to the stage.
  shot.fx.forEach((fx, i) => {
    const env = fxEnvelope(fx, t, duration, 0.4);
    if (env <= 0) return;
    if (fx.type === 'aura') {
      const target = frames.get(fx.target);
      if (!target) return;
      const headY = target.py - 880 * target.scale * (CHARACTER_DEFS[shot.actors.find((a) => a.id === fx.target)?.character ?? '']?.height ?? 1);
      auras.push(<Aura key={`aura${i}`} x={target.px} y={headY + 120 * target.scale} r={420 * target.scale} color={fx.color} intensity={fx.intensity * env} t={t} uid={`${uid}-aura${i}`} />);
    } else if (fx.type === 'fire') {
      drawables.push({ z: fx.y, node: <g key={`fire${i}`} opacity={env}><FireFx x={fx.x * W} y={fx.y * H} scale={fx.scale} t={t} uid={`${uid}-fire${i}`} /></g> });
    }
  });

  drawables.sort((a, b) => a.z - b.z);

  const svg = (children: React.ReactNode, depth: number, key: string, style?: React.CSSProperties) => (
    <AbsoluteFill key={key} style={{ transform: layerTransform(cam, depth), transformOrigin: '0 0', ...style }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ overflow: 'visible', position: 'absolute', inset: 0 }}>
        {children}
      </svg>
    </AbsoluteFill>
  );

  const back = layers.filter((l) => l.depth <= 1);
  const front = layers.filter((l) => l.depth > 1);

  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      {back.map((l, i) => svg(l.node, l.depth, `bg${i}`))}
      {svg(
        <>
          {auras}
          {drawables.map((d) => d.node)}
        </>,
        1,
        'stage',
        STAGE_GRADE[time] ? { filter: STAGE_GRADE[time] } : undefined,
      )}
      {front.map((l, i) => svg(l.node, l.depth, `fg${i}`))}
      <ScreenFx fx={shot.fx} t={t} frame={frame} shotDuration={duration} uid={uid} />
      {shot.overlay && <Overlay overlay={shot.overlay} t={t} shotDuration={duration} />}
    </AbsoluteFill>
  );
};

export type { Placement };
