// Where a player is and where the lens is on one frame of a shot in a generated world. Pure maths, like moves.ts.
import * as THREE from "three";
import type { ScenePlayer, SceneStage, WorldLocation, WorldModel } from "@moco/spec";
import { sampleKeys, blendVector } from "./timeline.ts";
import { isSubject } from "./options.ts";

const smooth = (value: number) => THREE.MathUtils.smoothstep(value, 0, 1);
const radians = THREE.MathUtils.degToRad;

export interface Placed {
  player: ScenePlayer;
  model: WorldModel;
  position: THREE.Vector3; // world metres, feet
  facing: number; // degrees
  face: number; // metres from the feet to the middle of the head
  width: number; // metres side to side
  headWidth: number;
  flat?: boolean;
  span?: number;
}

type Size = Pick<Placed, "face" | "width" | "headWidth" | "flat" | "span">;
const sizeFrom = (model: WorldModel): Size => ({ face: model.height * 0.86, width: model.height * 0.5, headWidth: model.height * 0.3 });

// `at` and `to` are metres from the mark; a moving player turns to face its way, unless it's only drifting.
export function placePlayer(player: ScenePlayer, model: WorldModel, mark: WorldLocation["marks"][number], frame: number, durationFrames: number, size: Size = sizeFrom(model)): Placed {
  const origin = new THREE.Vector3(...mark.at);
  if (player.motionKeys) {
    const { previous, next, amount } = sampleKeys(player.motionKeys, frame);
    const delta = (((next.facing - previous.facing + 180) % 360 + 360) % 360) - 180;
    return { player, model, position: new THREE.Vector3(...blendVector(previous.at, next.at, amount)).add(origin), facing: previous.facing + delta * amount, ...size };
  }
  const start = new THREE.Vector3(...player.at).add(origin);
  if (!player.to) return { player, model, position: start, facing: player.facing, ...size };
  const end = new THREE.Vector3(...player.to).add(origin);
  const progress = THREE.MathUtils.clamp(frame / (player.arriveFrame ?? durationFrames), 0, 1);
  const way = end.clone().sub(start);
  const heading = way.lengthSq() > 0.25 ? THREE.MathUtils.radToDeg(Math.atan2(way.x, way.z)) : player.facing;
  return { player, model, position: start.lerp(end, progress), facing: heading, ...size };
}

// Distance at which something `span` metres tall fills the frame's height through this lens.
const distanceFor = (span: number, fov: number) => span / (2 * Math.tan(radians(fov) / 2));

export interface Lens {
  eye: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

// Eye `distance` metres from `centre`, `side` degrees round from the subject's front, at `height` above its feet.
function around(centre: THREE.Vector3, facing: number, side: number, distance: number, height: number): THREE.Vector3 {
  const angle = radians(facing + side);
  return new THREE.Vector3(centre.x + Math.sin(angle) * distance, centre.y + height, centre.z + Math.cos(angle) * distance);
}

// Portrait frames are narrow, so a shot has to fit the subject's width as well as its height: a robot's round head
// is wider than it is tall. `width` is what must fit side to side.
const PORTRAIT = 16 / 9;
const MARGIN = 1.2;
const spanFor = (height: number, width: number) => Math.max(height, width * MARGIN * PORTRAIT);

// A close shot is framed on the head, wherever it is: stylised heads are big and sit lower than real ones.
function closeUp({ position, facing, model, face, headWidth }: Placed, side = 26): Lens {
  const span = spanFor(Math.max(model.height * 0.42, (model.height - face) * 2.8), headWidth);
  return { fov: 30, eye: around(position, facing, side, distanceFor(span, 30), face + span * 0.06), target: position.clone().setY(position.y + face - span * 0.04) };
}
function wideShot({ position, facing, model, width }: Placed, side = 22, room = 1): Lens {
  const span = spanFor(model.height * 1.9, width) * room;
  return { fov: 38, eye: around(position, facing, side, distanceFor(span, 38), model.height * 0.75), target: position.clone().setY(position.y + model.height * 0.6) };
}

function lerpLens(from: Lens, to: Lens, amount: number): Lens {
  return { eye: from.eye.clone().lerp(to.eye, amount), target: from.target.clone().lerp(to.target, amount), fov: THREE.MathUtils.lerp(from.fov, to.fov, amount) };
}

type Rig = (subject: Placed, other: Placed | undefined, progress: number) => Lens;

export const RIGS: Record<string, Rig> = {
  establishing: ({ position, facing, model }, _other, progress) => {
    // Low and level, so the sky and the horizon are in the frame and not just the ground.
    const reach = Math.max(34, model.height * 14);
    return { fov: 46, eye: around(position, facing, 30 + progress * 10, reach, Math.max(3, reach * 0.12)), target: position.clone().setY(position.y + reach * 0.16) };
  },
  wide: (subject, _other, progress) => wideShot(subject, 18 + progress * 8),
  medium: ({ position, facing, model, width }, _other, progress) => ({ fov: 34, eye: around(position, facing, 20 + progress * 6, distanceFor(spanFor(model.height * 0.8, width), 34), model.height * 0.8), target: position.clone().setY(position.y + model.height * 0.72) }),
  close: (subject, _other, progress) => closeUp(subject, 22 + progress * 5),
  push_in: (subject, _other, progress) => lerpLens(wideShot(subject), closeUp(subject), smooth(progress)),
  pull_back: (subject, _other, progress) => lerpLens(closeUp(subject), wideShot(subject, 22, 2.2), smooth(progress)),
  orbit: ({ position, facing, model, width }, _other, progress) => ({ fov: 36, eye: around(position, facing, -40 + smooth(progress) * 100, distanceFor(spanFor(model.height * 1.3, width), 36), model.height * 0.7), target: position.clone().setY(position.y + model.height * 0.68) }),
  low_hero: ({ position, facing, model }, _other, progress) => ({ fov: 44, eye: around(position, facing, 18, distanceFor(model.height * 1.15, 44) * (1 - progress * 0.08), model.height * 0.1), target: position.clone().setY(position.y + model.height * 0.82) }),
  high_down: ({ position, facing, model }, _other, progress) => ({ fov: 40, eye: around(position, facing, 16 + progress * 8, distanceFor(model.height * 1.1, 40), model.height * 2.6), target: position.clone().setY(position.y + model.height * 0.3) }),
  over_shoulder: (subject, other) => {
    if (!other) return closeUp(subject);
    const towardsOther = other.position.clone().sub(subject.position).setY(0).normalize();
    const side = new THREE.Vector3(towardsOther.z, 0, -towardsOther.x).multiplyScalar(other.model.height * 0.2);
    const eye = other.position.clone().addScaledVector(towardsOther, other.model.height * 0.55).add(side).setY(other.position.y + other.model.height * 0.95);
    return { fov: 32, eye, target: subject.position.clone().setY(subject.position.y + subject.face) };
  },
  tracking: ({ position, facing, model, width }) => ({ fov: 36, eye: around(position, facing, 86, distanceFor(spanFor(model.height * 1.3, width), 36), model.height * 0.6), target: position.clone().setY(position.y + model.height * 0.6) }),
  behind: ({ position, facing, model }) => ({ fov: 44, eye: around(position, facing, 176, distanceFor(model.height * 1.2, 44), model.height * 1.15), target: around(position, facing, 0, model.height * 4, model.height * 0.75) }),
};

export const subjectOf = (stage: SceneStage, placed: Placed[]): Placed => placed.find((item) => isSubject(item.player, stage.subject)) ?? placed[0]!;

// The rigs put the lens at a share of the subject's height, which for something flat (a dish, a map, a pond) is
// edge-on and far too close: a thin line. A flat subject is looked down on instead, from at least this high, and
// framed by its width (a close shot crops in a little).
const LOOK_DOWN = radians(38);
const CLOSE_RIGS = new Set(["close", "push_in", "low_hero"]);
function overFlat(lens: Lens, subject: Placed, camera: string): Lens {
  if (!subject.flat) return lens;
  const from = lens.eye.clone().sub(lens.target);
  const fits = distanceFor(spanFor(0, subject.span ?? subject.width), lens.fov) * (CLOSE_RIGS.has(camera) ? 0.62 : 1);
  const distance = Math.max(from.length(), fits);
  const level = Math.hypot(from.x, from.z);
  if (Math.atan2(from.y, level) >= LOOK_DOWN || level < 1e-6) return lens;
  const along = from.setY(0).normalize().multiplyScalar(distance * Math.cos(LOOK_DOWN));
  return { ...lens, eye: lens.target.clone().add(along).setY(lens.target.y + distance * Math.sin(LOOK_DOWN)) };
}

export function lensFor(stage: SceneStage, placed: Placed[], frame: number, durationFrames: number): Lens {
  const subject = subjectOf(stage, placed);
  const other = placed.find((item) => item !== subject);
  const rig = RIGS[stage.camera] ?? RIGS.medium!;
  return overFlat(rig(subject, other, frame / durationFrames), subject, stage.camera);
}
