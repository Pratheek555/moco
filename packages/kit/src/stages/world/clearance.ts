import { sampleKeys, blendVector } from "./timeline.ts";
// Keeps the lens where it can see the subject. The rigs in shots.ts place the camera as if the subject stood in open
// air, but a place the AI builds is often closed in (a duct, a room, a cave), and a camera outside its walls sees only
// their unlit backs: a black frame. So each shot's camera path is worked out once, from the set itself: turned towards
// the open side if the rig's own angle is walled in, then pulled in, smoothly, wherever a surface still hides the
// subject. Pure maths on the set's shapes, like shots.ts, so any frame comes out the same in any order.
import * as THREE from "three";
import type { SceneStage, WorldLocation, WorldModel } from "@moco/spec";
import { geometryOf, restParts } from "./build.ts";
import { lensFor, subjectOf, type Lens, type Placed } from "./shots.ts";

const radians = THREE.MathUtils.degToRad;
const UP = new THREE.Vector3(0, 1, 0);

// ---------- the set as something to see past ----------

// Both sides, so a subject inside something open (a bucket, a boat) still finds its walls.
const SOLID = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const SEE_THROUGH = 0.5; // glass and water below this opacity don't hide anything
const blockerCache = new WeakMap<WorldLocation, THREE.Mesh[]>();

// Every part of the location's set at rest, in world metres. Built once per location.
export function blockersOf(location: WorldLocation, models: WorldModel[]): THREE.Mesh[] {
  const known = blockerCache.get(location);
  if (known) return known;
  const meshes = location.set.flatMap((item) => {
    const model = models.find((candidate) => candidate.id === item.model);
    if (!model) return [];
    const placement = new THREE.Matrix4().compose(new THREE.Vector3(...item.at), new THREE.Quaternion().setFromAxisAngle(UP, radians(item.turn)), new THREE.Vector3().setScalar(item.scale));
    return restParts(model)
      .filter(({ part }) => (model.surfaces[part.surface]?.opacity ?? 1) >= SEE_THROUGH)
      .map(({ part, matrix }) => {
        const mesh = new THREE.Mesh(geometryOf(part), SOLID);
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorld.multiplyMatrices(placement, matrix);
        return mesh;
      });
  });
  blockerCache.set(location, meshes);
  return meshes;
}

const raycaster = new THREE.Raycaster();
const normal = new THREE.Vector3();

// How far along the line from `from` to `eye` the lens can stand, as a share of the way: in front of the first
// surface on the line, with room to spare so it can't clip it. A lens inside a wall is no better than one behind it:
// the set is drawn one-sided, so from in there the wall's faces turn away and vanish, and the outside shows through.
export function clearShare(from: THREE.Vector3, eye: THREE.Vector3, blockers: THREE.Object3D[]): number {
  const way = eye.clone().sub(from);
  const length = way.length();
  if (length < 1e-6 || blockers.length === 0) return 1;
  const direction = way.divideScalar(length);
  raycaster.set(from, direction);
  raycaster.far = length;
  const first = raycaster.intersectObjects(blockers, false)[0];
  if (!first) return 1;
  // Backing off along a slanting line leaves less room from the surface itself, so a slant backs off further.
  const slant = Math.abs(normal.copy(first.face!.normal).transformDirection(first.object.matrixWorld).dot(direction));
  const room = THREE.MathUtils.clamp(length * 0.06, 0.08, 0.3) / Math.max(slant, 0.35);
  return THREE.MathUtils.clamp((first.distance - room) / length, 0, 1);
}

// ---------- the shot's camera path ----------

// Who is where on a frame of the shot.
export type Framing = (frame: number) => Placed[];

// Tried in this order, so the nearest of equally open angles wins.
const TURNS = [25, -25, 50, -50, 75, -75, 100, -100, 130, -130, 160, -160, 180];
// For these the angle is the shot: whose shoulder it's over, where the subject is going.
const FIXED_ANGLE = new Set(["over_shoulder", "behind"]);
const SMOOTH_FRAMES = 12; // a wall coming into the way eases the lens in over about a second
const MAX_FOV = 75;

interface Path {
  blockers: THREE.Object3D[];
  durationFrames: number;
  turn: number; // degrees round the subject, for the whole shot
  share: number[]; // per frame: how much of the rig's distance the lens keeps
}

// A shot's stage object lives as long as the shot's page, so the path is worked out once, not per frame.
const paths = new WeakMap<SceneStage, Path>();

// The rig's lens turned `turn` degrees round the subject, and the point on the subject it has to see: its face for a
// close shot, its middle for a wide one.
function aimed(stage: SceneStage, framing: Framing, frame: number, durationFrames: number, turn: number) {
  const placed = framing(frame);
  const lens = lensFor(stage, placed, frame, durationFrames);
  const subject = subjectOf(stage, placed);
  const height = subject.model.height;
  const seen = subject.position.clone().setY(subject.position.y + THREE.MathUtils.clamp(lens.target.y - subject.position.y, height * 0.25, height * 0.9));
  const spin = new THREE.Quaternion().setFromAxisAngle(UP, radians(turn));
  const around = (point: THREE.Vector3) => point.clone().sub(seen).applyQuaternion(spin).add(seen);
  return { lens: { ...lens, eye: around(lens.eye), target: around(lens.target) }, seen, subject };
}

function pathFor(stage: SceneStage, framing: Framing, durationFrames: number, blockers: THREE.Object3D[]): Path {
  const known = paths.get(stage);
  if (known && known.blockers === blockers && known.durationFrames === durationFrames) return known;
  const shareAt = (frame: number, turn: number) => {
    const { lens, seen } = aimed(stage, framing, frame, durationFrames, turn);
    return clearShare(seen, lens.eye, blockers);
  };
  const frames = Array.from({ length: durationFrames }, (_, frame) => frame);
  const samples = frames.filter((frame) => frame % 6 === 0 || frame === durationFrames - 1);
  const openness = (turn: number) => samples.reduce((total, frame) => total + shareAt(frame, turn), 0) / samples.length;
  const turn = FIXED_ANGLE.has(stage.camera) ? 0 : chooseTurn(openness);
  const path = { blockers, durationFrames, turn, share: smooth(frames.map((frame) => shareAt(frame, turn)), SMOOTH_FRAMES) };
  paths.set(stage, path);
  return path;
}

// The rig's own angle, unless it's walled in and another angle is clearly more open.
function chooseTurn(openness: (turn: number) => number): number {
  const straight = openness(0);
  if (straight > 0.9) return 0;
  const best = TURNS.map((turn) => ({ turn, open: openness(turn) })).reduce((most, option) => (option.open > most.open + 0.02 ? option : most));
  return best.open > straight + 0.1 ? best.turn : 0;
}

// Never further out than any frame near it allows (the lowest over a window), then evened out (the mean over the same
// window). Each value in that mean is at most this frame's own share, so smoothing never backs the lens into a wall.
export function smooth(values: number[], window: number): number[] {
  const near = (list: number[], index: number) => list.slice(Math.max(0, index - window), index + window + 1);
  const lowest = values.map((_, index) => Math.min(...near(values, index)));
  return lowest.map((_, index) => {
    const around = near(lowest, index);
    return around.reduce((total, value) => total + value, 0) / around.length;
  });
}

// The lens for one frame of a shot in a generated world: the rig's, kept where it can see the subject.
// `strict` (a render check): a camera key the set blocks is an error for the AI to fix. Otherwise (an episode render) the
// eye is pulled in along its line toward the target until it can see, as the rigs do.
export function steadyLens(stage: SceneStage, framing: Framing, frame: number, durationFrames: number, blockers: THREE.Object3D[], markAt: [number, number, number] = [0,0,0], strict = true): Lens {
  if (stage.cameraKeys) {
    const { previous, next, amount } = sampleKeys(stage.cameraKeys, frame);
    const origin = new THREE.Vector3(...markAt);
    const eye = new THREE.Vector3(...blendVector(previous.eye, next.eye, amount)).add(origin);
    const target = new THREE.Vector3(...blendVector(previous.target, next.target, amount)).add(origin);
    if (eye.distanceTo(target) < 0.01) throw new Error(`stage.cameraKeys: eye and target coincide at frame ${frame}`);
    const fov = previous.fov + (next.fov - previous.fov) * amount;
    const share = clearShare(target, eye, blockers);
    if (share >= 0.98) return { eye, target, fov };
    if (strict) throw new Error(`stage.cameraKeys: set blocks the camera at frame ${frame}; move the eye or target inside the open set`);
    return { eye: eye.clone().sub(target).multiplyScalar(Math.max(0.05, share * 0.95)).add(target), target, fov };
  }
  if (blockers.length === 0) return lensFor(stage, framing(frame), frame, durationFrames);
  const path = pathFor(stage, framing, durationFrames, blockers);
  const { lens, seen, subject } = aimed(stage, framing, frame, durationFrames, path.turn);
  // Motion blur asks for frames in between, and a little before the first.
  const at = THREE.MathUtils.clamp(frame, 0, durationFrames - 1);
  const below = Math.floor(at);
  const share = THREE.MathUtils.lerp(path.share[below]!, path.share[Math.min(below + 1, durationFrames - 1)]!, at - below);
  // Never inside the subject: a place too tight for any angle gets its tightest shot instead.
  const scale = Math.max(share, Math.min(1, (subject.model.height * 0.3) / lens.eye.distanceTo(seen)));
  if (scale > 0.999) return lens;
  const toward = (point: THREE.Vector3) => point.clone().sub(seen).multiplyScalar(scale).add(seen);
  // A wider lens from closer in keeps the framing the rig meant.
  const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(radians(lens.fov) / 2) / scale)), lens.fov, Math.max(lens.fov, MAX_FOV));
  return { eye: toward(lens.eye), target: toward(lens.target), fov };
}
