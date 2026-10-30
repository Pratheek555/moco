// Shared body parts for kit characters. Every character is drawn in a 400×800 box, feet at (200, 800).
// Landmarks: head centre (200, 175), shoulders (135, 275) and (265, 275), waist y≈460.
// "Right" always means the character's right, which is the viewer's left.
import type { ReactNode } from "react";
import type { ArmPose } from "../actions.ts";

export const SHOULDER = { right: { x: 135, y: 275 }, left: { x: 265, y: 275 } };
export const UPPER_ARM = 118;
export const FOREARM = 112;

// ---------- arms ----------

interface ArmProps {
  side: "left" | "right";
  pose: ArmPose;
  skin: string;
  skinShade: string;
  metal: string; // armlet and bangle colour
  inHand?: ReactNode; // drawn at the hand, in the forearm's frame
}

export function Arm({ side, pose, skin, skinShade, metal, inHand }: ArmProps) {
  const shoulder = SHOULDER[side];
  return (
    <g transform={`translate(${shoulder.x} ${shoulder.y}) rotate(${pose.upper})`}>
      <rect x={-15} y={-6} width={30} height={UPPER_ARM + 10} rx={15} fill={skin} stroke={skinShade} strokeWidth={2} />
      <rect x={-16} y={38} width={32} height={9} rx={4} fill={metal} />
      <g transform={`translate(0 ${UPPER_ARM}) rotate(${pose.fore})`}>
        <rect x={-13} y={-6} width={26} height={FOREARM + 6} rx={13} fill={skin} stroke={skinShade} strokeWidth={2} />
        <rect x={-14} y={FOREARM - 22} width={28} height={8} rx={4} fill={metal} />
        <ellipse cx={0} cy={FOREARM + 8} rx={16} ry={19} fill={skin} stroke={skinShade} strokeWidth={2} />
        {inHand ? <g transform={`translate(0 ${FOREARM + 8})`}>{inHand}</g> : null}
      </g>
    </g>
  );
}

// ---------- face ----------

const MOUTHS: Record<string, string> = {
  neutral: "M186 214 Q200 221 214 214",
  smile: "M181 209 Q200 230 219 209",
  serious: "M188 216 L212 216",
  sad: "M186 221 Q200 210 214 221",
  determined: "M188 217 Q200 213 212 217",
};

// Brow angle per expression (degrees; positive tilts the inner end down).
export const BROW_TILT: Record<string, number> = { neutral: 0, smile: -4, serious: 10, sad: -12, determined: 14 };

interface FaceProps {
  expression: string;
  blink: number;
  lookX: number; // -1..1, where the eyes look
  lookY: number;
  ink: string; // line colour
  iris: string;
}

export function Face({ expression, blink, lookX, lookY, ink, iris }: FaceProps) {
  const browTilt = BROW_TILT[expression] ?? 0;
  const eyesClosed = blink > 0.4;
  return (
    <g>
      <Eye cx={178} cy={172} closed={eyesClosed} lookX={lookX} lookY={lookY} ink={ink} iris={iris} />
      <Eye cx={222} cy={172} closed={eyesClosed} lookX={lookX} lookY={lookY} ink={ink} iris={iris} />
      <path d="M163 152 Q178 145 192 151" transform={`rotate(${browTilt} 192 151)`} stroke={ink} strokeWidth={4} fill="none" strokeLinecap="round" />
      <path d="M208 151 Q222 145 237 152" transform={`rotate(${-browTilt} 208 151)`} stroke={ink} strokeWidth={4} fill="none" strokeLinecap="round" />
      <path d="M200 178 Q196 194 201 198" stroke={ink} strokeOpacity={0.45} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <path d={MOUTHS[expression] ?? MOUTHS.neutral} stroke="#7a2232" strokeWidth={4} fill="none" strokeLinecap="round" />
    </g>
  );
}

function Eye({ cx, cy, closed, lookX, lookY, ink, iris }: { cx: number; cy: number; closed: boolean; lookX: number; lookY: number; ink: string; iris: string }) {
  if (closed) {
    return <path d={`M${cx - 13} ${cy} Q${cx} ${cy + 7} ${cx + 13} ${cy}`} stroke={ink} strokeWidth={3.5} fill="none" strokeLinecap="round" />;
  }
  return (
    <g>
      <path d={`M${cx - 14} ${cy} Q${cx} ${cy - 13} ${cx + 14} ${cy} Q${cx} ${cy + 10} ${cx - 14} ${cy} Z`} fill="#fdfaf3" stroke={ink} strokeWidth={2.5} />
      <circle cx={cx + lookX * 4} cy={cy + lookY * 3} r={6.5} fill={iris} />
      <circle cx={cx + lookX * 4 + 2} cy={cy + lookY * 3 - 2} r={2} fill="#ffffff" />
      <path d={`M${cx - 15} ${cy - 1} Q${cx} ${cy - 15} ${cx + 15} ${cy - 1}`} stroke={ink} strokeWidth={3.5} fill="none" strokeLinecap="round" />
    </g>
  );
}

// ---------- body ----------

export function Torso({ skin, skinShade }: { skin: string; skinShade: string }) {
  return (
    <g>
      <rect x={185} y={232} width={30} height={40} fill={skin} />
      <path d="M130 282 Q200 258 270 282 L258 470 Q200 482 142 470 Z" fill={skin} stroke={skinShade} strokeWidth={2} />
      <path d="M170 330 Q200 345 230 330" stroke={skinShade} strokeWidth={2} fill="none" strokeOpacity={0.6} />
    </g>
  );
}

// Dhoti (lower garment) with folds, legs and feet.
export function Dhoti({ cloth, fold, border, skin, metal }: { cloth: string; fold: string; border: string; skin: string; metal: string }) {
  return (
    <g>
      <rect x={160} y={720} width={30} height={60} rx={12} fill={skin} />
      <rect x={210} y={720} width={30} height={60} rx={12} fill={skin} />
      <ellipse cx={172} cy={790} rx={26} ry={11} fill={skin} />
      <ellipse cx={228} cy={790} rx={26} ry={11} fill={skin} />
      <rect x={158} y={756} width={34} height={7} rx={3} fill={metal} />
      <rect x={208} y={756} width={34} height={7} rx={3} fill={metal} />
      <path d="M140 462 L260 462 L290 735 Q200 750 110 735 Z" fill={cloth} />
      <path d="M200 470 L196 740 M170 480 L150 735 M230 480 L250 735" stroke={fold} strokeWidth={3} fill="none" />
      <path d="M112 722 Q200 740 288 722 L290 735 Q200 752 110 735 Z" fill={border} />
      <rect x={136} y={452} width={128} height={18} rx={6} fill={metal} />
    </g>
  );
}

// Head base: face shape and ears, with slots for hair behind and headgear in front.
export function HeadBase({ skin, skinShade, metal }: { skin: string; skinShade: string; metal: string }) {
  return (
    <g>
      <ellipse cx={142} cy={182} rx={11} ry={17} fill={skin} stroke={skinShade} strokeWidth={2} />
      <ellipse cx={258} cy={182} rx={11} ry={17} fill={skin} stroke={skinShade} strokeWidth={2} />
      <circle cx={142} cy={204} r={8} fill={metal} />
      <circle cx={258} cy={204} r={8} fill={metal} />
      <ellipse cx={200} cy={175} rx={58} ry={66} fill={skin} stroke={skinShade} strokeWidth={2.5} />
    </g>
  );
}
