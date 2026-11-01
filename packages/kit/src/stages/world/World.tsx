// One generic 3D stage: draws any world the AI wrote as data. It has no idea what story it's in.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { SceneAction, ScenePlayer, WorldLocation, WorldModel, WorldPart } from "@moco/spec";
import type { BackgroundDef, StageProps } from "../../define.ts";
import { Reflections, Sky } from "../race-circuit/Circuit.tsx";
import { Lens } from "../race-circuit/index.tsx";
import { seededRandom } from "../race-circuit/textures.ts";
import { geometryOf, materialOf, measureModel, patternTexture, restParts } from "./build.ts";
import { isBlinking, poseAt, seedOf, spinAt, type Pose } from "./moves.ts";
import { WORLD_CAMERAS, isSubject } from "./options.ts";
import { lensFor, placePlayer, type Placed } from "./shots.ts";

const radians = THREE.MathUtils.degToRad;
const NO_ACTIONS: SceneAction[] = [];

// ---------- models ----------

interface Built {
  children: Map<string | undefined, WorldPart[]>;
  geometry: Map<string, THREE.BufferGeometry>;
  materials: Map<string, THREE.Material>;
}

// Everything about a model that never changes from frame to frame.
function buildModel(model: WorldModel): Built {
  const children = new Map<string | undefined, WorldPart[]>();
  model.parts.forEach((part) => children.set(part.parent, [...(children.get(part.parent) ?? []), part]));
  const geometry = new Map(model.parts.map((part) => [part.id, geometryOf(part)]));
  const materials = new Map(Object.entries(model.surfaces).map(([id, surface]) => [id, materialOf(surface) as THREE.Material]));
  return { children, geometry, materials };
}

interface PartProps {
  part: WorldPart;
  built: Built;
  pose: Pose;
  frame: number;
  blinking: boolean;
}

// A part hinges on its parent at `at`; its children hang off the same hinge, so they move with it.
function PartNode({ part, built, pose, frame, blinking }: PartProps) {
  const added = pose[part.id] ?? [0, 0, 0];
  const spin = part.spin ?? [0, 0, 0];
  const rotation = [0, 1, 2].map((axis) => radians(part.turn[axis]! + added[axis]! + spinAt(spin[axis]!, frame))) as [number, number, number];
  return (
    <group position={part.at} rotation={rotation}>
      <mesh geometry={built.geometry.get(part.id)} material={built.materials.get(part.surface)} position={part.offset} scale={[1, blinking && part.blinks ? 0.08 : 1, 1]} castShadow receiveShadow />
      {(built.children.get(part.id) ?? []).map((child) => (
        <PartNode key={child.id} part={child} built={built} pose={pose} frame={frame} blinking={blinking} />
      ))}
    </group>
  );
}

function ModelView({ model, actions, frame, seed }: { model: WorldModel; actions: SceneAction[]; frame: number; seed: number }) {
  const built = useMemo(() => buildModel(model), [model]);
  const pose = poseAt(model, actions, frame, seed);
  const blinking = isBlinking(seed, frame);
  return (
    <>
      {(built.children.get(undefined) ?? []).map((part) => (
        <PartNode key={part.id} part={part} built={built} pose={pose} frame={frame} blinking={blinking} />
      ))}
    </>
  );
}

// ---------- ground ----------

// The land's height at a point: flat around the middle, where the action is, rolling further out.
export function heightAt(x: number, z: number, hills: number): number {
  const distance = Math.hypot(x, z);
  const edge = THREE.MathUtils.smoothstep(distance, 50, 170);
  const swell = Math.sin(x * 0.013) * Math.cos(z * 0.011) + 0.5 * Math.sin(x * 0.031 + 1.7) * Math.sin(z * 0.027 + 0.6) + 0.22 * Math.sin(x * 0.083) * Math.cos(z * 0.071);
  return hills * edge * (swell + 0.6);
}

const GROUND_SIZE = 3200;
const GROUND_STEPS = 260;

function landGeometry(hills: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_STEPS, GROUND_STEPS).rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position!;
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, heightAt(positions.getX(index), positions.getZ(index), hills));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function Ground({ ground, frame }: { ground: WorldLocation["ground"]; frame: number }) {
  const geometry = useMemo(() => landGeometry(ground.kind === "land" ? ground.hills : 0), [ground]);
  const material = useMemo(() => materialOf(ground.surface), [ground]);
  const ripples = useMemo(() => patternTexture({ ...ground.surface, pattern: "noise", repeat: 90 }), [ground]);
  if (ground.kind === "none") return null;
  if (ground.kind === "water" && ripples) {
    // Water is the same plane with a moving bump, polished so it catches the sky.
    ripples.offset.set(frame * 0.0009, frame * 0.0006);
    material.bumpMap = ripples;
    material.bumpScale = 1.6;
    material.roughness = Math.min(ground.surface.rough, 0.22);
    material.metalness = 0.35;
  }
  return <mesh geometry={geometry} material={material} receiveShadow />;
}

// ---------- scattered things ----------

// Spots in a ring around the middle: never inside `near`, so nothing lands on the action.
function scatterSpots(entry: WorldLocation["scatter"][number], hills: number, seed: number): THREE.Matrix4[] {
  const random = seededRandom(seed);
  return Array.from({ length: entry.count }, () => {
    const angle = random() * Math.PI * 2;
    // The square root spreads them evenly by area, not bunched towards the middle.
    const distance = Math.sqrt(THREE.MathUtils.lerp(entry.near ** 2, entry.far ** 2, random()));
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    const size = THREE.MathUtils.lerp(entry.scaleMin, entry.scaleMax, random());
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
    return new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z, hills), z), turn, new THREE.Vector3(size, size, size));
  });
}

function ScatteredPart({ part, matrix, spots, material }: { part: WorldPart; matrix: THREE.Matrix4; spots: THREE.Matrix4[]; material: THREE.Material }) {
  const mesh = useMemo(() => new THREE.InstancedMesh(geometryOf(part), material, spots.length), [part, material, spots.length]);
  useEffect(() => {
    spots.forEach((spot, index) => mesh.setMatrixAt(index, spot.clone().multiply(matrix)));
    mesh.instanceMatrix.needsUpdate = true;
  }, [mesh, spots, matrix]);
  mesh.castShadow = true;
  return <primitive object={mesh} />;
}

function Scattered({ entry, model, hills, seed }: { entry: WorldLocation["scatter"][number]; model: WorldModel; hills: number; seed: number }) {
  const parts = useMemo(() => restParts(model), [model]);
  const spots = useMemo(() => scatterSpots(entry, hills, seed), [entry, hills, seed]);
  const materials = useMemo(() => new Map(Object.entries(model.surfaces).map(([id, surface]) => [id, materialOf(surface)])), [model]);
  return (
    <>
      {parts.map(({ part, matrix }) => (
        <ScatteredPart key={part.id} part={part} matrix={matrix} spots={spots} material={materials.get(part.surface)!} />
      ))}
    </>
  );
}

// ---------- sky, light and weather ----------

function skyLight(sky: WorldLocation["sky"]) {
  const azimuth = radians(sky.sunAzimuth);
  const elevation = radians(sky.sunElevation);
  const sun: [number, number, number] = [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
  const colour = (hex: string) => new THREE.Color(hex).convertLinearToSRGB().toArray() as [number, number, number];
  return { sun, horizon: colour(sky.horizon), middle: colour(sky.middle), top: colour(sky.top) };
}

// The sun's shadows are only sharp close up, so they travel with the subject.
function Sun({ sky, around, reach }: { sky: WorldLocation["sky"]; around: THREE.Vector3; reach: number }) {
  const light = useMemo(() => {
    const sun = new THREE.DirectionalLight(sky.sunColour, sky.sunStrength);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: 1200 });
    // Curved shapes ring with shadow acne unless the bias follows the size of a shadow texel.
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = (reach / 2048) * 3;
    return sun;
  }, [sky, reach]);
  light.position.copy(around).addScaledVector(new THREE.Vector3(...skyLight(sky).sun), 500);
  light.target.position.copy(around);
  light.target.updateMatrixWorld();
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}

function Stars() {
  const positions = useMemo(() => {
    const random = seededRandom(41);
    return new Float32Array(Array.from({ length: 6000 }, () => (random() - 0.5) * 2).map((value) => value * 1400));
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={2.2} sizeAttenuation={false} fog={false} depthWrite={false} />
    </points>
  );
}

// How each weather moves, in metres per second, and how it looks.
const WEATHER: Record<string, { colour: string; size: number; fall: number; drift: number; glow?: boolean }> = {
  rain: { colour: "#b9cce0", size: 0.05, fall: 14, drift: 0.6 },
  snow: { colour: "#ffffff", size: 0.09, fall: 1.1, drift: 0.9 },
  dust: { colour: "#d7bd93", size: 0.05, fall: -0.1, drift: 1.2 },
  embers: { colour: "#ff8a3c", size: 0.07, fall: -1.4, drift: 1.1, glow: true },
  fireflies: { colour: "#d8ff7a", size: 0.09, fall: -0.1, drift: 0.7, glow: true },
  bubbles: { colour: "#d6f3ff", size: 0.1, fall: -1, drift: 0.4 },
};
const WEATHER_BOX = 26; // metres of air around the subject that has weather in it
const WEATHER_COUNT = 1500;

// Particles are worked out from the frame alone and wrap inside a box, so any frame renders the same.
function Weather({ kind, around, frame }: { kind: string; around: THREE.Vector3; frame: number }) {
  const weather = WEATHER[kind];
  const starts = useMemo(() => {
    const random = seededRandom(77);
    return Array.from({ length: WEATHER_COUNT }, () => [random(), random(), random(), random() * 6]);
  }, []);
  const positions = useMemo(() => new Float32Array(WEATHER_COUNT * 3), []);
  if (!weather) return null;
  const seconds = frame / 30;
  const wrap = (value: number) => ((value % 1) + 1) % 1 - 0.5;
  starts.forEach(([x, y, z, phase], index) => {
    positions[index * 3] = around.x + WEATHER_BOX * wrap(x! + (Math.sin(seconds + phase!) * weather.drift) / WEATHER_BOX);
    positions[index * 3 + 1] = around.y + WEATHER_BOX * 0.42 + (WEATHER_BOX / 2) * wrap(y! - (seconds * weather.fall) / (WEATHER_BOX / 2));
    positions[index * 3 + 2] = around.z + WEATHER_BOX * wrap(z! + (Math.cos(seconds * 0.8 + phase!) * weather.drift) / WEATHER_BOX);
  });
  return (
    <points key={frame}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={weather.colour} size={weather.size} transparent opacity={0.85} depthWrite={false} blending={weather.glow ? THREE.AdditiveBlending : THREE.NormalBlending} toneMapped={!weather.glow} />
    </points>
  );
}

// A low sun throws shadows sideways and leaves nothing under the feet, which reads as floating. This soft dark patch
// is what animated films use to pin a character to the ground.
function contactTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, "rgba(0,0,0,0.75)");
  glow.addColorStop(0.45, "rgba(0,0,0,0.42)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function ContactShadow({ width }: { width: number }) {
  const texture = useMemo(contactTexture, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} renderOrder={1}>
      <planeGeometry args={[width, width]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

// ---------- the shot ----------

// Nothing to frame? Look at the mark as if a person stood on it.
const STAND_IN: WorldModel = { id: "mark", rig: "none", height: 2, surfaces: {}, parts: [], moves: [] };
const STAND_IN_PLAYER: ScenePlayer = { id: "mark", model: "mark", at: [0, 0, 0], facing: 0, actions: [] };

function WorldShot({ stage, frame, durationFrames, world }: StageProps) {
  if (!world) throw new Error("the generated world is missing from this shot");
  const { location, models } = world;
  const modelOf = (id: string) => models.find((model) => model.id === id);
  const mark = location.marks.find((candidate) => candidate.id === stage.place) ?? location.marks[0]!;

  const players = stage.players.filter((player) => modelOf(player.model));
  // The camera frames what was really built, so it goes by the measured size.
  const placed: Placed[] = players.map((player) => {
    const model = modelOf(player.model)!;
    const { height, ...size } = measureModel(model);
    return placePlayer(player, { ...model, height }, mark, frame, durationFrames, size);
  });
  const framed = placed.length > 0 ? placed : [placePlayer(STAND_IN_PLAYER, STAND_IN, mark, frame, durationFrames)];
  const lens = lensFor(stage, framed, frame, durationFrames);
  const focus = (framed.find((item) => isSubject(item.player, stage.subject)) ?? framed[0]!).position;
  const light = useMemo(() => skyLight(location.sky), [location]);
  const shadowReach = Math.max(36, Math.max(...framed.map((item) => item.model.height)) * 6);

  return (
    <>
      <Lens eye={lens.eye} target={lens.target} fov={lens.fov} />
      <Reflections />
      <fogExp2 attach="fog" args={[location.sky.fog, location.sky.fogDensity]} />
      <Sky light={light} />
      {location.sky.stars ? <Stars /> : null}
      <hemisphereLight args={[location.sky.middle, location.ground.surface.colour, location.sky.fill]} />
      <Sun sky={location.sky} around={focus} reach={shadowReach} />
      {location.lamps.map((lamp, index) => (
        <pointLight key={index} position={lamp.at} color={lamp.colour} intensity={lamp.strength} distance={lamp.reach} decay={2} />
      ))}
      <Ground ground={location.ground} frame={frame} />
      {location.set.map((item, index) => {
        const model = modelOf(item.model);
        if (!model) return null;
        return (
          <group key={index} position={item.at} rotation={[0, radians(item.turn), 0]} scale={item.scale}>
            <ModelView model={model} actions={NO_ACTIONS} frame={frame} seed={index} />
          </group>
        );
      })}
      {location.scatter.map((entry, index) => {
        const model = modelOf(entry.model);
        return model ? <Scattered key={index} entry={entry} model={model} hills={location.ground.kind === "land" ? location.ground.hills : 0} seed={index + 5} /> : null;
      })}
      {placed.map(({ player, position, facing }) => {
        const model = modelOf(player.model)!;
        return (
          <group key={player.id} position={position} rotation={[0, radians(facing), 0]}>
            {/* Anything held up in the air has no ground to be pinned to. */}
            {player.at[1] < 0.05 ? <ContactShadow width={measureModel(model).height * 0.72} /> : null}
            {/* Lifted by its lowest point, so feet meet the ground whatever the model's own numbers said. */}
            <group position={[0, -measureModel(model).bottom, 0]}>
              <ModelView model={model} actions={player.actions} frame={frame} seed={seedOf(player.id)} />
            </group>
          </group>
        );
      })}
      <Weather kind={location.weather} around={focus} frame={frame} />
    </>
  );
}

// The stage every generated location runs on. Its real options come from the world, per series (see the engine).
export const worldStage: BackgroundDef = {
  id: "generated_world",
  timeOfDay: ["set"], // a location's sky is its time of day
  layers: [],
  stage: { cameras: WORLD_CAMERAS, places: [], subjects: [], Component: WorldShot },
};
