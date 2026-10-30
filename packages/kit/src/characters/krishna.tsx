// Krishna: blue skin, peacock-feather crown, yellow pitambara. Variants: default (flute tucked in his waist),
// charioteer (red sash, no flute — he's holding the reins).
// The art is art/krishna/*.svg (placeholder layers); `pnpm --filter @moco/kit catalog` turns it into krishna.art.json.
import { ARM_POSES, blendPose, mirror, type ArmPose } from "../actions.ts";
import { DEFAULT_IDLE } from "../define.ts";
import { amountOf, type RigState } from "../rig.ts";
import art from "./krishna.art.json" with { type: "json" };
import { humanoidLimb, layeredCharacter, type LimbPose } from "./layered.tsx";

// Both hands at the lips, the flute held out to his right.
const FLUTE_RIGHT: ArmPose = { upper: -30, fore: 200 };
const FLUTE_LEFT: ArmPose = { upper: 20, fore: -190 };

function pose(rig: RigState, side: "left" | "right"): LimbPose {
  if (!rig.actions.play_flute) return humanoidLimb(rig, side);
  const flute = amountOf(rig, "play_flute");
  const arm = side === "right" ? blendPose(ARM_POSES.rest, FLUTE_RIGHT, flute) : blendPose(mirror(ARM_POSES.rest), FLUTE_LEFT, flute);
  return { arm, hand: "fist" };
}

const sides = { side: ["left", "right"] };

export const krishna = layeredCharacter({
  id: "krishna",
  packs: ["mahabharat"],
  variants: ["default", "charioteer"],
  actions: [
    { name: "blink", minFrames: 4 },
    { name: "raise_hand", minFrames: 12, params: sides },
    { name: "bless", minFrames: 16, params: sides },
    { name: "point", minFrames: 10, params: sides },
    { name: "turn_head", minFrames: 8 },
    { name: "smile", minFrames: 8 },
    { name: "speak", minFrames: 6 },
    { name: "play_flute", minFrames: 30, shows: "prop_flute", hides: "prop_waist" },
  ],
  defaultScale: 0.6,
  idle: DEFAULT_IDLE,
  art,
  pose,
});
