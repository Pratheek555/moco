// Turns one line of direction (camera, place, subject, lead) into where the cars and the lens are on any frame.
// Pure maths with no React in it, so it can be tested and every frame renders the same however Remotion orders them.
import * as THREE from "three";
import type { SceneStage } from "@moco/spec";
import { poseAt, type TrackPose } from "./track.ts";

const FPS = 30;
const LANE = 2.4; // metres either side of the centre line; the subject takes the right, the inside of the hairpin

// `anchor` is where the subject is halfway through the shot, so a finish shot crosses the line mid-shot.
export const PLACES: Record<string, { anchor: number; speed: number; hint: string }> = {
  start_straight: { anchor: 240, speed: 82, hint: "Flat out past the grandstands." },
  finish_line: { anchor: 500, speed: 84, hint: "The subject crosses the start and finish line halfway through the shot." },
  harbour: { anchor: 2150, speed: 66, hint: "Fast sweeping corners along the water, with the skyline behind." },
  hairpin: { anchor: 1200, speed: 34, hint: "The slowest corner, under braking. The right place for a pass." },
  parc_ferme: { anchor: 320, speed: 0, hint: "After the race: cars parked side by side, engines off. The subject's driver nods once in the shot's last third." },
};

// One camera rig: `eye` and `target` from the subject's pose, the other car's pose and the shot's middle pose.
interface Rig {
  hint: string;
  fov: number;
  eye: (subject: TrackPose, middle: TrackPose) => THREE.Vector3;
  target: (subject: TrackPose, other: TrackPose) => THREE.Vector3;
}

// A point relative to a car: metres forward, up and to its right.
function near(pose: TrackPose, forward: number, up: number, right = 0): THREE.Vector3 {
  return pose.position.clone().addScaledVector(pose.forward, forward).addScaledVector(pose.right, right).setY(up);
}

const smooth = (value: number) => {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
};

// Aims between the cars when they're running together, so both fit the narrow frame; otherwise at the subject.
function framingBoth(subject: TrackPose, other: TrackPose): THREE.Vector3 {
  const together = 1 - smooth((subject.position.distanceTo(other.position) - 12) / 12);
  return subject.position.clone().lerp(other.position, together / 2).setY(0.7);
}

export const RIGS: Record<string, Rig> = {
  chase: { hint: "Behind the subject, looking up the road. Shows the car and whatever is ahead of it.", fov: 56, eye: (subject) => near(subject, -6.5, 2.1), target: (subject) => near(subject, 12, 2.6) },
  onboard: { hint: "Mounted above the subject's airbox: the driver's eye view, halo and road rushing in.", fov: 74, eye: (subject) => near(subject, -1.7, 1.55), target: (subject) => near(subject, 18, 1.1) },
  front: { hint: "Nose-on, flying ahead of the subject and looking back at it. Shows who is behind it.", fov: 58, eye: (subject) => near(subject, 13, 1.1), target: (subject, other) => framingBoth(subject, other) },
  wheel: { hint: "Low beside the subject's rear tyre, for speed and for tyres that are dying.", fov: 72, eye: (subject) => near(subject, -3.1, 0.5, 2.3), target: (subject) => near(subject, 4, 0.6, 0.4) },
  cockpit: { hint: "Tight on the subject's helmet through the halo: the nearest thing to a face. Use for a driver's decision or a nod.", fov: 34, eye: (subject) => near(subject, 1.7, 1.12, 0.85), target: (subject) => near(subject, 0, 0.84) },
  alongside: { hint: "Tracking level with the subject from the side, the world streaking past. Best for two cars wheel to wheel.", fov: 44, eye: (subject) => near(subject, 0, 1.3, 9), target: (subject) => near(subject, 0, 0.8) },
  trackside: { hint: "A fixed camera at the barrier; the subject flashes past it halfway through the shot.", fov: 32, eye: (_subject, middle) => near(middle, 0, 0.8, 8), target: (subject) => near(subject, 0, 0.8) },
  helicopter: { hint: "High and behind, showing both cars and the shape of the track.", fov: 46, eye: (subject) => near(subject, -34, 26, -10), target: (subject, other) => subject.position.clone().add(other.position).multiplyScalar(0.5) },
};

export interface ShotState {
  subject: { pose: TrackPose; distance: number; steer: number };
  other: { pose: TrackPose; distance: number; steer: number };
  eye: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  nod: number; // radians the subject's helmet is tipped forward
}

// The front wheels' angle: how sharply the track bends just ahead.
function steerAt(distance: number): number {
  const now = poseAt(distance).forward;
  const ahead = poseAt(distance + 6).forward;
  return THREE.MathUtils.clamp(now.x * ahead.z - now.z * ahead.x, -0.4, 0.4) * 1.6;
}

function carAt(distance: number, lane: number) {
  return { pose: poseAt(distance, lane), distance, steer: steerAt(distance) };
}

// One tip of the head and back, across the last third of the shot.
function nodAt(progress: number): number {
  const stroke = THREE.MathUtils.clamp((progress - 0.66) / 0.3, 0, 1);
  return Math.sin(stroke * Math.PI) * 0.42;
}

export function shotState(stage: SceneStage, frame: number, durationFrames: number): ShotState {
  const place = PLACES[stage.place]!;
  const rig = RIGS[stage.camera]!;
  const progress = frame / durationFrames;
  const fromMiddle = (frame - durationFrames / 2) / FPS;
  const lead = THREE.MathUtils.lerp(stage.leadStart, stage.leadEnd, smooth(progress));
  const subjectDistance = place.anchor + place.speed * fromMiddle;
  const subject = carAt(subjectDistance, LANE);
  const other = carAt(subjectDistance - lead, -LANE);

  // A little road rumble in the lens, in proportion to speed.
  const rumble = place.speed / 80;
  const eye = rig.eye(subject.pose, poseAt(place.anchor, LANE));
  eye.x += Math.sin(frame * 1.9) * 0.025 * rumble;
  eye.y += Math.sin(frame * 2.7) * 0.03 * rumble;
  // Parked shots creep sideways so they never sit dead still.
  if (place.speed === 0) eye.addScaledVector(subject.pose.right, progress * 1.4);

  return { subject, other, eye, target: rig.target(subject.pose, other.pose), fov: rig.fov, nod: place.speed === 0 ? nodAt(progress) : 0 };
}
