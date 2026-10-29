import type { Pose } from '@moco/spec';
import React from 'react';
import { Arm, solveArm } from './Arms.tsx';
import { BackLayer, HEAD_Y, LowerBody, NECK_Y, SHOULDER_Y, Torso, WAIST_Y, shoulderX } from './Body.tsx';
import { HairBack, Head } from './Head.tsx';
import type { CharacterDef, RigState } from './types.ts';

/** Hands that put their prop away (they're busy). */
const BUSY_SHAPES = new Set(['pray']);
const POSE_FORCES: Partial<Record<Pose, { right?: string; left?: string }>> = {
  flute: { right: 'flute' },
  'draw-bow': { left: 'bow-drawn' },
};

export interface CharacterProps {
  def: CharacterDef;
  rig: RigState;
  /** The dominant pose this frame (for pose-specific extras like a bowstring). */
  pose: Pose;
  /** Explicit holds from the spec; `none` empties the hand. */
  holdRight?: string;
  holdLeft?: string;
  /** Unique per instance (clip-path ids). */
  uid: string;
}

function resolveHold(explicit: string | undefined, forced: string | undefined, fallback: string | undefined) {
  if (explicit === 'none') return undefined;
  return explicit ?? forced ?? fallback;
}

/**
 * A layered, rigged character. Local coordinates: feet at (0, 0), ~1000 units tall,
 * facing the viewer. Mirror the parent group to face left.
 */
export function Character({ def, rig, pose, holdRight, holdLeft, uid }: CharacterProps) {
  const p = rig.pose;
  const t = rig.time;
  const breath = Math.sin((t * Math.PI * 2) / 3.4);
  const walking = p.legs === 'walk';
  const bob = walking ? -Math.abs(Math.sin(rig.walk)) * 10 : 0;
  const sx = shoulderX(def);
  const sy = SHOULDER_Y + p.shoulderDrop - breath * 2.5;

  const forced = POSE_FORCES[pose] ?? {};
  let right = resolveHold(holdRight, forced.right, def.holdRight);
  let left = resolveHold(holdLeft, forced.left, def.holdLeft);
  if (left === 'bow' && pose === 'draw-bow') left = 'bow-drawn';
  if (BUSY_SHAPES.has(p.shapeR)) right = undefined;
  if (BUSY_SHAPES.has(p.shapeL)) left = undefined;

  const swing = walking ? Math.sin(rig.walk) : 0;
  const handR: [number, number] = [p.handR[0] + swing * 12, p.handR[1] - Math.abs(swing) * 14];
  const handL: [number, number] = [p.handL[0] - swing * 12, p.handL[1] - Math.abs(swing) * 14];
  const armR = solveArm({ x: sx, y: sy }, handR, p.bendR, p.twistR, p.aimR);
  const armL = solveArm({ x: sx, y: sy }, handL, p.bendL, p.twistL, p.aimL);

  const childLift = (def.headScale - 1) * 46;
  const headY = HEAD_Y + p.headDrop + rig.nod - breath * 2 + childLift;
  const headTransform = `translate(0 ${headY}) rotate(${p.headTilt + Math.sin(t * 0.9) * 0.8} 0 ${NECK_Y - HEAD_Y}) scale(${def.headScale})`;
  const sway = Math.sin(t * 0.8) * 0.5;

  // Bowstring + arrow when drawing a bow with the left hand.
  let bowString: React.ReactNode = null;
  if (left === 'bow-drawn') {
    const dirL = (armL.dir * Math.PI) / 180;
    const grip = { x: -(armL.h.x + Math.cos(dirL) * 28), y: armL.h.y + Math.sin(dirL) * 28 };
    const hand = { x: armR.h.x, y: armR.h.y + 24 };
    const dx = grip.x - hand.x;
    const dy = grip.y - hand.y;
    const len = Math.hypot(dx, dy) || 1;
    const tip = { x: grip.x + (dx / len) * 90, y: grip.y + (dy / len) * 90 };
    bowString = (
      <g>
        <path d={`M${grip.x} ${grip.y - 270} L${hand.x} ${hand.y} L${grip.x} ${grip.y + 270}`} stroke="#efe6d2" strokeWidth={2.5} fill="none" />
        <path d={`M${hand.x} ${hand.y} L${tip.x} ${tip.y}`} stroke="#7a5530" strokeWidth={6} />
        <path d={`M${tip.x} ${tip.y} l${(-dy / len) * 10 + (dx / len) * 6} ${(dx / len) * 10 + (dy / len) * 6}`} stroke="#cfd6de" strokeWidth={8} strokeLinecap="round" />
      </g>
    );
  }

  const reins =
    pose === 'reins' ? (
      <g stroke="#8a5a2b" strokeWidth={5} fill="none" strokeLinecap="round">
        <path d={`M${armR.h.x} ${armR.h.y + 30} Q${armR.h.x + 220} ${armR.h.y + 90} ${armR.h.x + 470} ${armR.h.y + 40}`} />
        <path d={`M${-armL.h.x} ${armL.h.y + 30} Q${-armL.h.x + 260} ${armL.h.y + 110} ${-armL.h.x + 520} ${armL.h.y + 60}`} />
      </g>
    ) : null;

  return (
    <g transform={`scale(${def.height})`}>
      <g transform={`translate(0 ${bob})`}>
        <g transform={`translate(0 ${p.crouch}) rotate(${p.lean + sway} 0 ${WAIST_Y})`}>
          <BackLayer def={def} t={t} />
          <g transform={headTransform}>
            <HairBack def={def} t={t} />
          </g>
        </g>
        <LowerBody def={def} legs={p.legs} walk={rig.walk} />
        <g transform={`translate(0 ${p.crouch}) rotate(${p.lean + sway} 0 ${WAIST_Y})`}>
          <Torso def={def} t={t} breath={breath} />
          <g transform={headTransform}>
            <Head def={def} rig={rig} id={uid} />
          </g>
          <g transform="scale(-1 1)">
            <Arm def={def} solve={armL} shape={p.shapeL} hold={left} t={t} />
          </g>
          <Arm def={def} solve={armR} shape={p.shapeR} hold={right} t={t} />
          {bowString}
          {reins}
        </g>
      </g>
    </g>
  );
}
