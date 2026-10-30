# Kit asset spec: character art

What an illustrator delivers for one moco character so it can be swapped in **without code changes**.
The loader (`packages/kit/src/art/load.ts`) checks every rule marked **(checked)** and refuses the file with a typed
error (`MissingLayerError`, `ArtError`) that names the problem. The machine-readable version of the layer list is
`packages/kit/src/art/template.ts`. Keep this document and that file in step.

Reference: `packages/kit/art/krishna/front.svg` is the current placeholder. It follows every rule below.

## 1. File and canvas

| Rule | Value |
|---|---|
| Format | One **SVG** file per angle, named `<angle>.svg`, in `packages/kit/art/<character-id>/`. `front.svg` is required (checked). A 3/4 angle (`three_quarter.svg`) is optional and uses the same layer list. A Rive (`.riv`) version may follow later; see `docs/adr/rive-vs-svg-rig.md`. |
| Canvas | `viewBox="0 0 400 800"` exactly (checked). 1 unit = 1 px at the reference size. |
| Placement | The character stands centred, feet touching the bottom edge at (200, 800). Head top around y = 70–100; the crown or hair may reach y ≈ 0. |
| Pose | Neutral front pose, **arms hanging straight down** beside the body, palms facing inward. The rig rotates from this pose. Arms drawn already bent will come out wrong. |
| Sides | `_R` = the **character's** right = the viewer's **left** (x < 200). `_L` = the character's left = the viewer's right. |

## 2. Layers

Each layer is a `<g id="…">` group (Illustrator: a layer or group with that exact name; Inkscape: a group whose id is
that name). Layers may sit at any depth in the file, but **a layer must not contain another layer** (checked). Inside
a layer, use as many unnamed sub-groups as you like. Unknown ids are ignored. Draw order in the file doesn't matter;
the renderer stacks layers in the order shown in §2.4.

Every layer is drawn **in place**, in canvas coordinates and in the rest pose. Don't move parts to the origin.

### 2.1 Required (checked)

| Layer | What's in it | Moves with |
|---|---|---|
| `hair_back` | Hair that falls behind the shoulders | body (breathing), delayed sway |
| `legs` | Legs and feet below the garment, anklets | nothing (planted) |
| `garment_lower` | Dhoti or skirt, waistband | nothing |
| `torso` | Chest, belly, neck | body (breathing) |
| `head` | Face shape, ears, earrings, the hair cap behind the face | neck pivot |
| `eye_L`, `eye_R` | Eye whites with their outline | face |
| `iris_L`, `iris_R` | Iris, pupil and catch-light, centred in the open eye | slide for gaze (±4 px) |
| `eyeline_L`, `eyeline_R` | Upper lash/lid line, drawn **over** the iris | face |
| `eyelid_L`, `eyelid_R` | The **closed** eye (lid curve and lashes), shown during blinks instead of the four layers above | face |
| `brow_L`, `brow_R` | Eyebrows | rotate at their inner end per expression |
| `nose` | Nose | face |
| `mouth_neutral` | Resting mouth | face |
| `viseme_X`, `viseme_A` … `viseme_F` | Lip-sync mouth shapes, see §2.2 | face |
| `arm_upper_L`, `arm_upper_R` | Shoulder to elbow, including armlets | shoulder pivot |
| `arm_lower_L`, `arm_lower_R` | Elbow to wrist, including bangles | elbow pivot |
| `hand_L_open`, `hand_L_fist`, `hand_L_point` | Left hand in three poses, each drawn hanging from the wrist | elbow pivot |
| `hand_R_open`, `hand_R_fist`, `hand_R_point` | Right hand, same three poses | elbow pivot |

**Expression mouths.** Add one `mouth_<expression>` per expression the character can show, for example
`mouth_smile` and `mouth_serious`. The kit offers the AI exactly the expressions that have a mouth layer, so adding
`mouth_sad` adds the "sad" expression.

### 2.2 Visemes (mouth shapes for lip sync)

The shapes follow Rhubarb Lip Sync's names, so a phoneme-based track can replace the v0 amplitude track later. Draw
all of them at the same position as `mouth_neutral`.

| Layer | Sound | Shape |
|---|---|---|
| `viseme_X` | silence | relaxed, closed |
| `viseme_A` | M, B, P | lips pressed together |
| `viseme_B` | most consonants (K, S, T, EE) | slightly open, teeth visible |
| `viseme_C` | EH, AE | open |
| `viseme_D` | AA | wide open, tongue visible |
| `viseme_E` | AO, ER | slightly rounded |
| `viseme_F` | UW, OW, W | puckered |

### 2.3 Optional

| Layer | What's in it | Notes |
|---|---|---|
| `jewellery_neck` | Necklaces, garlands | delayed secondary motion |
| `garment_upper` | Sash or uttariya over the torso | delayed secondary motion |
| `prop_waist` | Something tucked in the waist (a flute) | actions can hide it |
| `face_marks` | Tilak, bindi | face |
| `hair_front` | Hair in front of the face or crown | head |
| `headwear` | Crown, turban, helmet | head |
| `headwear_flex` | The part of the headwear that sways (a peacock feather) | needs `pivot_headwear_flex` (checked) |
| `prop_<name>` | A prop an action shows, e.g. `prop_flute` | required if a character action uses it (checked) |

### 2.4 Stacking order (back to front)

`legs`, `garment_lower`, then inside the breathing body: `hair_back`, left arm (`arm_upper_L`, `arm_lower_L`,
`hand_L_*`), `torso`, `jewellery_neck`, `garment_upper`, `prop_waist`, then the head group (`head`, eyes, brows,
`nose`, `face_marks`, mouth, `hair_front`, `headwear`, `headwear_flex`), then the right arm, then any shown `prop_*`.

### 2.5 Costume variants

A variant overrides a layer with `<layer>--<variant>`, for example `garment_upper--charioteer`. An empty
`<g id="prop_waist--charioteer"/>` hides that layer for the variant. The base layer must exist (checked), and the
variant must be one the character declares (checked).

## 3. Pivots (checked)

Pivots are rig joints, marked with `<circle id="pivot_<name>" cx=… cy=… r="3"/>`. Put them all in a hidden group
(`<g id="pivots" display="none">`). Circles must have **no transform** (checked).

| Pivot | Where |
|---|---|
| `pivot_neck` | Base of the neck, centre. The head turns and sways here. |
| `pivot_waist` | Centre of the waistband. Breathing scales the body from here. |
| `pivot_shoulder_L`, `pivot_shoulder_R` | Centre of the shoulder joint |
| `pivot_elbow_L`, `pivot_elbow_R` | Centre of the elbow |
| `pivot_wrist_L`, `pivot_wrist_R` | Centre of the wrist |
| `pivot_brow_L`, `pivot_brow_R` | Inner end of each eyebrow |
| `pivot_headwear_flex` | Where the swaying piece attaches (only if `headwear_flex` exists) |

## 4. Colour and line rules

- **Flat fills and strokes only.** Show shading as separate flat shapes in a darker tone of the base colour.
- **Not allowed (checked):** gradients, filters (blur, drop shadow), masks, clip paths, patterns, embedded images,
  `<use>` or links, CSS (`<style>` or `style=`), scripts, event handlers. They're slow to draw on every frame, or they
  break when two copies of a character are on screen. Glows and soft shadows belong in baked background or
  atmosphere images, not in the character.
- Use presentation attributes (`fill="#3f72c6"`, `stroke-width="2"`). Hex colours.
- Line weights at the reference size: outer contour 2–2.5 px, inner detail 1.5–2 px, features (lashes, brows)
  3.5–4 px. Use round caps on feature lines.
- Keep each character's palette small (skin, skin shade, line, two or three costume colours, metal). List it in the
  hand-off note.
- Keep the file under about 300 KB and use simple paths. Every layer is redrawn on every frame.

## 5. Delivery checklist

- [ ] `front.svg`, `viewBox="0 0 400 800"`, feet at (200, 800), arms hanging straight down
- [ ] Every required layer from §2.1, named exactly, and no layer nested inside another
- [ ] `mouth_neutral` plus one `mouth_<expression>` per expression
- [ ] All 7 visemes (`X`, `A`–`F`) at the mouth position
- [ ] Hands in `open`, `fist` and `point` for both sides, drawn hanging from the wrist
- [ ] Closed-eye `eyelid_*` layers that cover the eye area
- [ ] Every pivot from §3, hidden, with no transforms
- [ ] Variant overrides named `<layer>--<variant>`
- [ ] Flat colours only: no gradients, filters, masks, images or CSS
- [ ] Opens cleanly in a browser and in Inkscape
- [ ] Hand off: drop the file into `packages/kit/art/<id>/` and run `pnpm --filter @moco/kit catalog`. The loader
      either accepts it or names every problem. Then run `pnpm test`.
