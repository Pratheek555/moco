// The humanoid layer template: which named SVG groups and pivots a character's art must contain.
// docs/kit-asset-spec.md is the illustrator-facing version of this file; keep the two in step.
// "_R" is the character's right (the viewer's left), "_L" the character's left.

// The art canvas. Feet at the bottom centre (200, 800).
export const CANVAS = { width: 400, height: 800 };

// Hand shapes every arm must have. Actions pick one per frame.
export const HAND_POSES = ["open", "fist", "point"] as const;
export type HandPose = (typeof HAND_POSES)[number];

// Mouth shapes for lip sync, named as in Rhubarb Lip Sync so a phoneme-based track can drop in later:
// X rest, A closed (M B P), B slightly open (most consonants), C open (EH AE), D wide (AA),
// E rounded (AO ER), F puckered (UW OW W).
export const VISEMES = ["X", "A", "B", "C", "D", "E", "F"] as const;

// Layers every character needs. The expression mouths (mouth_<expression>) come on top of these,
// and mouth_neutral is always required.
export const REQUIRED_LAYERS = [
  "hair_back",
  "legs",
  "garment_lower",
  "torso",
  "head",
  "eye_L", "eye_R",
  "iris_L", "iris_R",
  "eyeline_L", "eyeline_R",
  "eyelid_L", "eyelid_R",
  "brow_L", "brow_R",
  "nose",
  "mouth_neutral",
  ...VISEMES.map((viseme) => `viseme_${viseme}`),
  "arm_upper_L", "arm_upper_R",
  "arm_lower_L", "arm_lower_R",
  ...HAND_POSES.map((pose) => `hand_L_${pose}`),
  ...HAND_POSES.map((pose) => `hand_R_${pose}`),
];

// Layers a character may have. Actions that need one (e.g. play_flute → prop_flute) list it in their def.
export const OPTIONAL_LAYERS = [
  "jewellery_neck", // necklaces, garlands: secondary motion
  "garment_upper", // sash, uttariya: secondary motion
  "prop_waist", // something tucked in the waist
  "face_marks", // tilak, bindi
  "hair_front",
  "headwear",
  "headwear_flex", // the part of the headwear that sways (a feather): secondary motion around its own pivot
  "prop_flute",
];

// Rig joints, as hidden <circle id="pivot_<name>"> markers.
export const REQUIRED_PIVOTS = [
  "neck", // head turn and sway; secondary motion of hair, jewellery and upper garment
  "waist", // breathing
  "shoulder_L", "shoulder_R",
  "elbow_L", "elbow_R",
  "wrist_L", "wrist_R",
  "brow_L", "brow_R", // the inner end of each brow
];
// Needed only when the layer of the same name exists.
export const OPTIONAL_PIVOTS = ["headwear_flex"];

// Layers whose names follow a pattern rather than a fixed list.
const PATTERN_LAYERS = [/^mouth_[a-z][a-z_]*$/, /^viseme_[A-Z]$/];

// A layer id is "<name>" or "<name>--<variant>" (an override used for that costume variant).
export function splitLayerId(id: string): { name: string; variant?: string } {
  const [name, variant] = id.split("--");
  return { name: name!, variant };
}

// True if `name` (without a variant suffix) is a layer of this template.
export function isLayerName(name: string): boolean {
  if (REQUIRED_LAYERS.includes(name) || OPTIONAL_LAYERS.includes(name)) return true;
  return PATTERN_LAYERS.some((pattern) => pattern.test(name));
}
