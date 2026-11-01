// Racing drivers: fireproof suit and team cap, helmet off so the face reads. One drawing, two teams.
// Drawn with the React parts, like Arjuna. No `speak`: reels are narrated, so these mouths don't lip-sync.
import { ARM_POSES, blendPose, mirror, type ArmPose } from "../actions.ts";
import { DEFAULT_IDLE, type CharacterDef, type CharacterProps } from "../define.ts";
import { amountOf } from "../rig.ts";
import { Arm, Face, HeadBase } from "./parts.tsx";

interface Team {
  id: string;
  skin: string;
  skinShade: string;
  hair: string;
  suit: string;
  suitShade: string;
  stripe: string;
  number: string;
  longHair: boolean;
}

const INK = "#20160f";
const GLOVE = "#17181c";
const FIST_PUMP: ArmPose = { upper: 165, fore: 12 }; // straight up, celebrating

function Suit({ team }: { team: Team }) {
  return (
    <g>
      {/* legs and boots */}
      <path d="M146 462 L254 462 L250 770 L208 770 L200 540 L192 770 L150 770 Z" fill={team.suit} stroke={team.suitShade} strokeWidth={3} />
      <path d="M163 480 L166 770 M237 480 L234 770" stroke={team.stripe} strokeWidth={10} />
      <path d="M144 766 L196 766 L198 798 L132 798 Q130 780 144 766 Z" fill={GLOVE} />
      <path d="M204 766 L256 766 Q270 780 268 798 L202 798 Z" fill={GLOVE} />
      {/* body */}
      <rect x={185} y={232} width={30} height={36} fill={team.skin} />
      <path d="M130 282 Q200 258 270 282 L258 470 Q200 482 142 470 Z" fill={team.suit} stroke={team.suitShade} strokeWidth={3} />
      <path d="M176 256 Q200 270 224 256 L224 274 Q200 286 176 274 Z" fill={team.suitShade} />
      <path d="M200 272 L200 470" stroke={team.suitShade} strokeWidth={3} />
      <rect x={137} y={440} width={126} height={16} rx={6} fill={team.stripe} />
      {/* racing number */}
      <circle cx={234} cy={340} r={26} fill="#ffffff" />
      <text x={234} y={352} fontSize={34} fontWeight={900} fontFamily="Arial, sans-serif" textAnchor="middle" fill={team.suitShade}>{team.number}</text>
      <rect x={150} y={330} width={50} height={18} rx={4} fill={team.stripe} />
    </g>
  );
}

function Head({ team, rig, turn, lower }: { team: Team; rig: CharacterProps["rig"]; turn: number; lower: number }) {
  return (
    <g>
      <HeadBase skin={team.skin} skinShade={team.skinShade} metal={team.skin} />
      <g transform={`translate(${10 * turn} 0)`}>
        <Face expression={rig.expression} blink={rig.blink} lookX={turn} lookY={lower} ink={INK} iris="#2a1a10" />
      </g>
      {/* hair at the temples, under the cap */}
      <path d="M142 170 Q136 122 158 110 L150 174 Z M258 170 Q264 122 242 110 L250 174 Z" fill={team.hair} />
      {/* team cap */}
      <path d="M140 134 Q142 84 200 82 Q258 84 260 134 Q200 112 140 134 Z" fill={team.suit} stroke={team.suitShade} strokeWidth={3} />
      <path d="M136 136 Q200 114 264 136 Q272 148 262 150 Q200 130 138 150 Q128 148 136 136 Z" fill={team.stripe} />
    </g>
  );
}

function racerDrawing(team: Team) {
  return function Racer({ rig }: CharacterProps) {
    const turn = amountOf(rig, "turn_head");
    const lower = amountOf(rig, "lower_head");
    const lift = rig.breath * 1.5;
    const side = rig.actions.point?.params.side ?? rig.actions.raise_hand?.params.side ?? rig.actions.celebrate?.params.side ?? "right";
    const target = rig.actions.celebrate ? FIST_PUMP : rig.actions.raise_hand ? ARM_POSES.raise : ARM_POSES.point;
    const moved = amountOf(rig, "point") + amountOf(rig, "raise_hand") + amountOf(rig, "celebrate");
    const raised = blendPose(ARM_POSES.rest, target, moved);
    const right = side === "right" ? raised : ARM_POSES.rest;
    const left = side === "left" ? mirror(raised) : mirror(ARM_POSES.rest);
    const sleeve = { skin: team.suit, skinShade: team.suitShade, metal: team.stripe };
    return (
      <g>
        {/* behind the suit, so it falls over the shoulders and not across the neck */}
        {team.longHair ? <path d="M132 150 Q104 300 138 372 L262 372 Q296 300 268 150 Z" fill={team.hair} /> : null}
        <Suit team={team} />
        <g transform={`translate(0 ${lift})`}>
          <Arm side="left" pose={left} {...sleeve} />
          <g transform={`rotate(${-4 * turn + rig.sway} 200 240) translate(0 ${10 * lower})`}>
            <Head team={team} rig={rig} turn={turn} lower={lower} />
          </g>
          <Arm side="right" pose={right} {...sleeve} />
        </g>
      </g>
    );
  };
}

function racer(team: Team): CharacterDef {
  const sides = { side: ["left", "right"] };
  return {
    id: team.id,
    packs: ["motorsport"],
    variants: ["default"],
    actions: [
      { name: "blink", minFrames: 4 },
      { name: "raise_hand", minFrames: 12, params: sides },
      { name: "celebrate", minFrames: 16, params: sides },
      { name: "point", minFrames: 10, params: sides },
      { name: "turn_head", minFrames: 8 },
      { name: "lower_head", minFrames: 10 },
    ],
    expressions: ["neutral", "smile", "serious", "sad", "determined"],
    defaultScale: 0.6,
    idle: DEFAULT_IDLE,
    Component: racerDrawing(team),
  };
}

// A rookie in red and a veteran in blue. Fictional teams, no real liveries.
export const racerRed = racer({ id: "racer_red", skin: "#b9764a", skinShade: "#8a5230", hair: "#1c1410", suit: "#d0202e", suitShade: "#7e0f19", stripe: "#f6f1e4", number: "27", longHair: true });
export const racerBlue = racer({ id: "racer_blue", skin: "#e6b98f", skinShade: "#b98a60", hair: "#6b5b4d", suit: "#1f5fbf", suitShade: "#0f3370", stripe: "#f2c230", number: "4", longHair: false });

