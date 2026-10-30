// Draws a character from layered art (see art/template.ts): each named layer is static SVG markup,
// and the rig only moves layers around their pivots. New art for a character needs no code change.
import { ARM_POSES, blendPose, clamp01, mirror, type ArmPose } from "../actions.ts";
import type { CharacterArt, Point } from "../art/load.ts";
import { ArtError, expressionsOf, requireLayers, variantsOf } from "../art/load.ts";
import type { HandPose } from "../art/template.ts";
import type { ActionDef, CharacterDef, CharacterProps } from "../define.ts";
import type { IdleProfile } from "../index.ts";
import { amountOf, sideOf, type RigState } from "../rig.ts";
import { BROW_TILT } from "./parts.tsx";

// What one arm does at one frame.
export interface LimbPose {
  arm: ArmPose;
  hand: HandPose;
}

// The standard arm actions: raise_hand, bless and point, each on the side its `side` param names.
// Actions never overlap (the engine checks), so blending them one after another is safe.
export function humanoidLimb(rig: RigState, side: "left" | "right"): LimbPose {
  const on = (action: string) => (sideOf(rig, action) === side ? amountOf(rig, action) : 0);
  const point = on("point");
  const raised = blendPose(ARM_POSES.rest, ARM_POSES.raise, on("raise_hand"));
  const blessed = blendPose(raised, ARM_POSES.bless, on("bless"));
  const arm = blendPose(blessed, ARM_POSES.point, point);
  return { arm: side === "right" ? arm : mirror(arm), hand: point > 0.3 ? "point" : "open" };
}

export interface LayeredOptions {
  id: string;
  packs: string[];
  variants: string[]; // the first is the default
  actions: ActionDef[];
  defaultScale: number;
  idle: IdleProfile;
  art: Record<string, CharacterArt>; // angle → art; "front" is required
  pose?: (rig: RigState, side: "left" | "right") => LimbPose; // default: humanoidLimb
}

// Checks the art against the character's actions and variants, then builds its kit entry.
// Throws ArtError / MissingLayerError at import time, so broken art fails the build and the tests, not a render.
export function layeredCharacter(options: LayeredOptions): CharacterDef {
  const front = options.art.front;
  if (!front) throw new ArtError(options.id, `needs "front" art`);

  for (const [angle, art] of Object.entries(options.art)) checkAngle(options, angle, art);

  const Component = ({ rig, variant }: CharacterProps) => <LayeredBody art={front} rig={rig} variant={variant} options={options} />;
  return {
    id: options.id,
    packs: options.packs,
    variants: options.variants,
    actions: options.actions,
    expressions: expressionsOf(front),
    defaultScale: options.defaultScale,
    idle: options.idle,
    art: options.art,
    Component,
  };
}

// One angle's art must have the layers the actions show or hide, and only overrides for declared variants.
function checkAngle(options: LayeredOptions, angle: string, art: CharacterArt): void {
  const source = `${options.id}/${angle}.svg`;
  const actionLayers = options.actions.flatMap((action) => [action.shows, action.hides]).filter((name) => name !== undefined);
  requireLayers(art, actionLayers, source);
  const declared = new Set(options.variants);
  const unknown = variantsOf(art).find((variant) => !declared.has(variant));
  if (unknown) throw new ArtError(source, `has layers for variant "${unknown}", which ${options.id} doesn't declare`);
}

interface BodyProps {
  art: CharacterArt;
  rig: RigState;
  variant: string;
  options: LayeredOptions;
}

function LayeredBody({ art, rig, variant, options }: BodyProps) {
  // The variant's override wins over the base layer; undefined = this character doesn't have the layer.
  const pick = (name: string): string | undefined => art.layers[`${name}--${variant}`] ?? art.layers[name];
  const pivot = (name: string): Point => art.pivots[name]!; // requireLayers() guaranteed it

  // Layers that running actions show or hide.
  const running = options.actions.filter((action) => action.name in rig.actions);
  const hidden = new Set(running.map((action) => action.hides));
  const shown = running.filter((action) => action.shows !== undefined);
  const visible = (name: string): string | undefined => (hidden.has(name) ? undefined : pick(name));
  const pose = options.pose ?? humanoidLimb;

  const turn = amountOf(rig, "turn_head");
  const nod = 3 * amountOf(rig, "bless"); // a small, kind tilt of the head while blessing
  const neck = pivot("neck");
  const waist = pivot("waist");
  const flex = art.pivots.headwear_flex; // only if the art has a headwear_flex layer
  const browTilt = BROW_TILT[rig.expression] ?? 0;
  const eyesClosed = rig.blink > 0.4;
  const look = { x: turn * 4, y: 0 };
  const expressionMouth = pick(`mouth_${rig.expression}`) ?? pick("mouth_neutral");
  const mouth = (rig.viseme ? pick(`viseme_${rig.viseme}`) : undefined) ?? expressionMouth;
  // Breathing: the body lifts a little and the chest scales up from the waist.
  const breathing = `translate(0 ${rig.breath * 1.5}) translate(${waist.x} ${waist.y}) scale(1 ${rig.breathScale}) translate(${-waist.x} ${-waist.y})`;

  return (
    <g>
      <Layer html={pick("legs")} />
      <Layer html={pick("garment_lower")} />
      <g transform={breathing}>
        <Rotated html={pick("hair_back")} degrees={rig.secondary} around={neck} />
        <Arm art={art} pick={pick} side="left" pose={pose(rig, "left")} />
        <Layer html={pick("torso")} />
        <Rotated html={pick("jewellery_neck")} degrees={rig.secondary} around={neck} />
        <Rotated html={pick("garment_upper")} degrees={rig.secondary * 0.5} around={neck} />
        <Layer html={visible("prop_waist")} />

        <g transform={`rotate(${-4 * turn + rig.sway + nod} ${neck.x} ${neck.y})`}>
          <Layer html={pick("head")} />
          {/* face features slide towards the turn, so the head reads as turning */}
          <g transform={`translate(${10 * turn} 0)`}>
            {eyesClosed ? (
              <>
                <Layer html={pick("eyelid_L")} />
                <Layer html={pick("eyelid_R")} />
              </>
            ) : (
              <>
                <Eye pick={pick} side="L" look={look} />
                <Eye pick={pick} side="R" look={look} />
              </>
            )}
            <Rotated html={pick("brow_R")} degrees={browTilt} around={pivot("brow_R")} />
            <Rotated html={pick("brow_L")} degrees={-browTilt} around={pivot("brow_L")} />
            <Layer html={pick("nose")} />
            <Layer html={pick("face_marks")} />
            <Layer html={mouth} />
          </g>
          <Layer html={pick("hair_front")} />
          <Layer html={pick("headwear")} />
          {flex ? <Rotated html={pick("headwear_flex")} degrees={rig.flex} around={flex} /> : null}
        </g>

        <Arm art={art} pick={pick} side="right" pose={pose(rig, "right")} />
        {shown.map((action) => (
          <g key={action.name} opacity={clamp01(amountOf(rig, action.name))}>
            <Layer html={pick(action.shows!)} />
          </g>
        ))}
      </g>
    </g>
  );
}

// Static layer markup. React only rewrites it if the markup changes, so per-frame work is just the transforms above it.
function Layer({ html }: { html: string | undefined }) {
  if (html === undefined) return null;
  return <g dangerouslySetInnerHTML={{ __html: html }} />;
}

function Rotated({ html, degrees, around }: { html: string | undefined; degrees: number; around: Point }) {
  return (
    <g transform={`rotate(${degrees} ${around.x} ${around.y})`}>
      <Layer html={html} />
    </g>
  );
}

function Eye({ pick, side, look }: { pick: (name: string) => string | undefined; side: "L" | "R"; look: Point }) {
  return (
    <>
      <Layer html={pick(`eye_${side}`)} />
      <g transform={`translate(${look.x} ${look.y})`}>
        <Layer html={pick(`iris_${side}`)} />
      </g>
      <Layer html={pick(`eyeline_${side}`)} />
    </>
  );
}

// Upper arm turns at the shoulder; forearm and hand turn at the elbow, inside it.
function Arm({ art, pick, side, pose }: { art: CharacterArt; pick: (name: string) => string | undefined; side: "left" | "right"; pose: LimbPose }) {
  const suffix = side === "left" ? "L" : "R";
  const shoulder = art.pivots[`shoulder_${suffix}`]!;
  const elbow = art.pivots[`elbow_${suffix}`]!;
  return (
    <g transform={`rotate(${pose.arm.upper} ${shoulder.x} ${shoulder.y})`}>
      <Layer html={pick(`arm_upper_${suffix}`)} />
      <g transform={`rotate(${pose.arm.fore} ${elbow.x} ${elbow.y})`}>
        <Layer html={pick(`arm_lower_${suffix}`)} />
        <Layer html={pick(`hand_${suffix}_${pose.hand}`)} />
      </g>
    </g>
  );
}
