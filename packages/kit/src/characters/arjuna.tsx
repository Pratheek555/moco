// Arjuna: warrior prince with the Gandiva bow, bronze armour, red dhoti. Variants: default, archer (quiver on his back).
// ponytail: still drawn with the React parts, not layered art; move him to art/arjuna/front.svg when his real art arrives.
import { DEFAULT_IDLE, type CharacterDef, type CharacterProps } from "../define.ts";
import { amountOf } from "../rig.ts";
import { blendPose, mirror, type ArmPose } from "../actions.ts";
import { Arm, Dhoti, Face, HeadBase, Torso } from "./parts.tsx";

const SKIN = "#c68642";
const SHADE = "#8d5a2b";
const GOLD = "#e8b923";
const INK = "#2c1a0e";

const REST: ArmPose = { upper: 8, fore: -8 };
const BOW_ARM: ArmPose = { upper: 86, fore: 0 }; // left arm straight out, holding the bow (mirrored below)
const DRAW_ARM: ArmPose = { upper: -95, fore: -70 }; // right hand pulled back to the cheek

function Bow({ draw, armAngle }: { draw: number; armAngle: number }) {
  // Counter-rotate so the bow stays upright whatever the arm is doing.
  const pull = 46 * draw;
  return (
    <g transform={`rotate(${-armAngle})`}>
      <path d="M0 -150 Q48 0 0 150" stroke="#6e2c00" strokeWidth={9} fill="none" strokeLinecap="round" />
      <path d={`M0 -150 L${-pull} 0 L0 150`} stroke="#f5f5dc" strokeWidth={2} fill="none" />
      {draw > 0.3 ? <path d={`M${-pull} 0 L120 0`} stroke="#4a3520" strokeWidth={4} /> : null}
      {draw > 0.3 ? <path d="M120 -8 L138 0 L120 8 Z" fill="#7f8c8d" /> : null}
    </g>
  );
}

function Arjuna({ rig, variant }: CharacterProps) {
  const draw = amountOf(rig, "draw_bow");
  const turn = amountOf(rig, "turn_head");
  const lower = amountOf(rig, "lower_head");
  const bodyLift = rig.breath * 1.5;
  const left = mirror(blendPose(REST, BOW_ARM, draw));
  const right = blendPose(REST, DRAW_ARM, draw);

  return (
    <g>
      {variant === "archer" ? <rect x={238} y={230} width={34} height={170} rx={10} fill="#784212" transform="rotate(18 255 300)" /> : null}
      <Dhoti cloth="#a93226" fold="#7b241c" border={GOLD} skin={SKIN} metal={GOLD} />
      <g transform={`translate(0 ${bodyLift})`}>
        <Arm side="left" pose={left} skin={SKIN} skinShade={SHADE} metal={GOLD} inHand={<Bow draw={draw} armAngle={left.upper + left.fore} />} />
        <Torso skin={SKIN} skinShade={SHADE} />
        {/* armour */}
        <path d="M140 285 Q200 268 260 285 L250 440 Q200 452 150 440 Z" fill="#9c6b30" stroke={GOLD} strokeWidth={4} />
        <circle cx={200} cy={340} r={22} fill={GOLD} stroke="#9c6b30" strokeWidth={4} />
        <path d="M150 285 L262 430" stroke="#2471a3" strokeWidth={14} opacity={0.9} />

        <g transform={`rotate(${-4 * turn + rig.sway} 200 240) translate(0 ${10 * lower})`}>
          <path d="M140 170 Q132 100 200 96 Q268 100 260 170 Q248 126 200 124 Q152 126 140 170 Z" fill="#0b0b0b" />
          <HeadBase skin={SKIN} skinShade={SHADE} metal={GOLD} />
          <g transform={`translate(${10 * turn} 0)`}>
            <Face expression={rig.expression} blink={rig.blink} lookX={turn} lookY={lower} ink={INK} iris="#1b120a" />
            {/* moustache */}
            <path d="M182 205 Q200 198 218 205 Q200 210 182 205 Z" fill="#0b0b0b" />
          </g>
          {/* kirita crown */}
          <path d="M152 126 L158 80 L200 40 L242 80 L248 126 Q200 112 152 126 Z" fill={GOLD} stroke="#b8860b" strokeWidth={2} />
          <circle cx={200} cy={96} r={9} fill="#2471a3" />
        </g>

        <Arm side="right" pose={right} skin={SKIN} skinShade={SHADE} metal={GOLD} />
      </g>
    </g>
  );
}

export const arjuna: CharacterDef = {
  id: "arjuna",
  packs: ["mahabharat"],
  variants: ["default", "archer"],
  actions: [
    { name: "blink", minFrames: 4 },
    { name: "draw_bow", minFrames: 18 },
    { name: "lower_head", minFrames: 10 },
    { name: "turn_head", minFrames: 8 },
  ],
  expressions: ["neutral", "sad", "determined"],
  defaultScale: 0.6,
  idle: DEFAULT_IDLE,
  Component: Arjuna,
};
