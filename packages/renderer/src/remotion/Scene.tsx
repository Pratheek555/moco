// One shot, back to front: parallax background (with any atmosphere placed between its layers), atmosphere behind
// the actors, props and actors under the camera, fx, atmosphere in front, then the time-of-day tint, grade, vignette
// and grain, and finally the captions, which stay crisp on top.
// Unknown kit ids throw errors tagged with the spec path, so the engine can feed them back to the AI.
import { Fragment } from "react";
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { IMAGE_LAYER_BOX, registry, rigStateAt, type AtmosphereDef, type BackgroundDef, type BackgroundLayerDef, type CharacterDef } from "@moco/kit/components";
import { FRAME_HEIGHT, FRAME_WIDTH, type Caption, type SceneActor, type SceneSpec } from "@moco/spec";
import { cameraAt, layerTransform, type CameraState, type Point } from "../camera.ts";
import { Atmosphere, Finish, Grade, TimeOfDayTint } from "./Look.tsx";

// Thrown errors carry "[moco:path=…]" so the RenderPort can map them to a JSON path.
export function specError(path: string, message: string): Error {
  return new Error(`[moco:path=${path}] ${message}`);
}

// On-screen sizes. A character at scale 1 is 75% of the frame height; a prop at scale 1 is 80% of its width.
const CHARACTER_HEIGHT = FRAME_HEIGHT * 0.75;
const PROP_WIDTH = FRAME_WIDTH * 0.8;
const FACE_FROM_TOP = 175 / 800; // where the face sits in the character's 400×800 art

// Atmosphere placed behind actors (no `layer`) sits at this parallax depth.
const BACK_ATMOSPHERE_DEPTH = 0.75;

interface PlacedAtmosphere {
  def: AtmosphereDef;
  entry: SceneSpec["atmosphere"][number];
  key: string;
}

export function Scene({ scene }: { scene: SceneSpec }) {
  const frame = useCurrentFrame();
  const background = registry.backgrounds.find((candidate) => candidate.id === scene.background.id);
  if (!background) throw specError("background.id", `unknown background "${scene.background.id}"`);
  const timeOfDay = scene.timeOfDay ?? background.timeOfDay[0]!;
  if (!background.timeOfDay.includes(timeOfDay)) throw specError("timeOfDay", `"${timeOfDay}" is not a time of day for ${background.id}`);
  if (!registry.grades.some((grade) => grade.id === scene.grade)) throw specError("grade", `unknown grade "${scene.grade}"`);

  const camera = cameraAt(scene.camera, frame, facePositions(scene));
  const atmosphere = placeAtmosphere(scene, background);
  const onLayer = groupByLayer(atmosphere); // looked up per background layer below
  const depthOf = (layer: BackgroundLayerDef) => (scene.background.parallax ? layer.depth : 1);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {background.layers.map((layer) => (
        <Fragment key={layer.id}>
          <AbsoluteFill style={{ transform: layerTransform(camera, depthOf(layer)) }}>
            <BackgroundLayer layer={layer} frame={frame} timeOfDay={timeOfDay} />
          </AbsoluteFill>
          <AtmosphereGroup placed={onLayer.get(layer.id) ?? []} frame={frame} transform={layerTransform(camera, depthOf(layer))} />
        </Fragment>
      ))}
      <AtmosphereGroup placed={atmosphere.filter((item) => !item.entry.layer && item.def.placement === "back")} frame={frame} transform={layerTransform(camera, BACK_ATMOSPHERE_DEPTH)} />
      <World scene={scene} frame={frame} camera={camera} />
      {scene.fx.map((fx, index) => (
        <Sequence key={index} from={fx.startFrame} durationInFrames={fx.endFrame - fx.startFrame} layout="none">
          <FxLayer id={fx.id} path={`fx[${index}].id`} durationFrames={fx.endFrame - fx.startFrame} />
        </Sequence>
      ))}
      <AtmosphereGroup placed={atmosphere.filter((item) => !item.entry.layer && item.def.placement === "front")} frame={frame} />
      <TimeOfDayTint timeOfDay={timeOfDay} />
      <Grade id={scene.grade} />
      <Finish settings={scene.finish} frame={frame} />
      <Captions captions={scene.captions} frame={frame} />
    </AbsoluteFill>
  );
}

function BackgroundLayer({ layer, frame, timeOfDay }: { layer: BackgroundLayerDef; frame: number; timeOfDay: string }) {
  const image = layer.image?.[timeOfDay];
  if (image) return <Img src={staticFile(image)} style={{ position: "absolute", ...IMAGE_LAYER_BOX }} />;
  return layer.Component ? <layer.Component frame={frame} timeOfDay={timeOfDay} /> : null;
}

function AtmosphereGroup({ placed, frame, transform }: { placed: PlacedAtmosphere[]; frame: number; transform?: string }) {
  if (placed.length === 0) return null;
  return (
    <AbsoluteFill style={{ transform }}>
      {placed.map((item) => (
        <Atmosphere key={item.key} def={item.def} entry={item.entry} frame={frame} />
      ))}
    </AbsoluteFill>
  );
}

// Looks up every atmosphere entry, rejecting unknown ids and layers.
function placeAtmosphere(scene: SceneSpec, background: BackgroundDef): PlacedAtmosphere[] {
  const layerIds = background.layers.map((layer) => layer.id);
  return scene.atmosphere.map((entry, index) => {
    const def = registry.atmospheres.find((candidate) => candidate.id === entry.id);
    if (!def) throw specError(`atmosphere[${index}].id`, `unknown atmosphere "${entry.id}"`);
    if (entry.layer && !layerIds.includes(entry.layer)) throw specError(`atmosphere[${index}].layer`, `${background.id} has no layer "${entry.layer}"`);
    return { def, entry, key: `${index}` };
  });
}

// Atmosphere entries that sit in front of a named background layer, by layer id.
function groupByLayer(placed: PlacedAtmosphere[]): Map<string, PlacedAtmosphere[]> {
  const byLayer = new Map<string, PlacedAtmosphere[]>();
  for (const item of placed) {
    if (item.entry.layer) byLayer.set(item.entry.layer, [...(byLayer.get(item.entry.layer) ?? []), item]);
  }
  return byLayer;
}

// Where each actor's face is on screen before the camera moves, for focus_on. Unknown cast ids are rejected.
function facePositions(scene: SceneSpec): Record<string, Point> {
  const faces = Object.fromEntries(
    scene.actors.map((actor) => {
      const height = CHARACTER_HEIGHT * actor.position.scale;
      return [actor.castId, { x: actor.position.x * FRAME_WIDTH, y: actor.position.y * FRAME_HEIGHT - height * (1 - FACE_FROM_TOP) }];
    }),
  );
  const unknown = scene.camera.findIndex((move) => move.move === "focus_on" && !(move.castId && move.castId in faces));
  if (unknown >= 0) throw specError(`camera[${unknown}].castId`, `focus_on needs the castId of an actor in this shot`);
  return faces;
}

// Props and actors share the nearest layer's camera transform.
function World({ scene, frame, camera }: { scene: SceneSpec; frame: number; camera: CameraState }) {
  return (
    <AbsoluteFill style={{ transform: layerTransform(camera, 1) }}>
      {scene.props.map((prop, index) => (
        <PropView key={`p${index}`} prop={prop} path={`props[${index}]`} frame={frame} />
      ))}
      {scene.actors.map((actor, index) => (
        <ActorView key={`a${index}`} actor={actor} path={`actors[${index}]`} frame={frame} visemes={scene.visemes} />
      ))}
    </AbsoluteFill>
  );
}

function PropView({ prop, path, frame }: { prop: SceneSpec["props"][number]; path: string; frame: number }) {
  const def = registry.props.find((candidate) => candidate.id === prop.id);
  if (!def) throw specError(`${path}.id`, `unknown prop "${prop.id}"`);
  const width = PROP_WIDTH * prop.position.scale;
  const height = (width * def.height) / def.width;
  const style = { position: "absolute" as const, left: prop.position.x * FRAME_WIDTH - width / 2, top: prop.position.y * FRAME_HEIGHT - height, width, height };
  return (
    <svg viewBox={`0 0 ${def.width} ${def.height}`} style={style} overflow="visible">
      <def.Component frame={frame} />
    </svg>
  );
}

function ActorView({ actor, path, frame, visemes }: { actor: SceneActor; path: string; frame: number; visemes: SceneSpec["visemes"] }) {
  const def = registry.characters.find((candidate) => candidate.id === actor.kitCharacterId);
  if (!def) throw specError(`${path}.kitCharacterId`, `character "${actor.kitCharacterId}" is not installed`);
  assertRigActions(def, actor, path);

  const height = CHARACTER_HEIGHT * actor.position.scale;
  const width = height / 2;
  const style = {
    position: "absolute" as const,
    left: actor.position.x * FRAME_WIDTH - width / 2,
    top: actor.position.y * FRAME_HEIGHT - height,
    width,
    height,
    transform: actor.facing === "left" ? "scaleX(-1)" : undefined,
  };
  return (
    <svg viewBox="0 0 400 800" style={style} overflow="visible">
      <def.Component rig={rigStateAt(actor, frame, { seed: actor.castId, idle: actor.idle ? def.idle : undefined, visemes })} variant={actor.variant ?? def.variants[0] ?? "default"} />
    </svg>
  );
}

// The kit's equivalent of a typed UnknownAction error.
function assertRigActions(def: CharacterDef, actor: SceneActor, path: string): void {
  const known = def.actions.map((action) => action.name);
  const unknown = actor.actions.findIndex((action) => !known.includes(action.name));
  if (unknown >= 0) throw specError(`${path}.actions[${unknown}].name`, `UnknownAction(${def.id}, ${actor.actions[unknown]!.name})`);
}

function FxLayer({ id, path, durationFrames }: { id: string; path: string; durationFrames: number }) {
  const frame = useCurrentFrame(); // relative to the Sequence start
  const def = registry.fx.find((candidate) => candidate.id === id);
  if (!def) throw specError(path, `unknown fx "${id}"`);
  return (
    <AbsoluteFill>
      <def.Component frame={frame} durationFrames={durationFrames} />
    </AbsoluteFill>
  );
}

// Captions sit at 64% of the frame height: clear of Instagram's buttons and caption overlay at the bottom.
function Captions({ captions, frame }: { captions: Caption[]; frame: number }) {
  const caption = captions.find((candidate) => frame >= candidate.startFrame && frame < candidate.endFrame);
  if (!caption) return null;
  const pop = interpolate(frame - caption.startFrame, [0, 4], [0.82, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: FRAME_HEIGHT * 0.64 }}>
      <div
        style={{
          maxWidth: FRAME_WIDTH * 0.84,
          textAlign: "center",
          fontFamily: "'Arial Black', 'Noto Sans Devanagari', Arial, sans-serif",
          fontWeight: 900,
          fontSize: 92,
          lineHeight: 1.1,
          color: caption.emphasis ? "#ffd54f" : "#ffffff",
          WebkitTextStroke: "14px #111",
          paintOrder: "stroke fill",
          transform: `scale(${pop})`,
        }}
      >
        {caption.text}
      </div>
    </AbsoluteFill>
  );
}
