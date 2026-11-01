// The fictional Port Sabine circuit as data: a closed centre line (metres, y up) that everything else hangs off.
// A position on track is a distance along that line plus a sideways offset, so cars, kerbs and cameras all agree.
import * as THREE from "three";

export const TRACK_WIDTH = 14;

// Main straight along +x with the grandstands to the north, a hairpin at the east end, the harbour to the south.
const CORNERS: Array<[number, number]> = [
  [-500, 0], [0, 0], [500, 0], [600, 25], [640, 90], [600, 150], [500, 165],
  [200, 190], [-100, 160], [-300, 230], [-520, 200], [-640, 110], [-620, 30],
];

const centreLine = new THREE.CatmullRomCurve3(CORNERS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "centripetal");
centreLine.arcLengthDivisions = 2000;
export const TRACK_LENGTH = centreLine.getLength();

export interface TrackPose {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
}

// Where `distance` metres round the lap is, `offset` metres to the right of the centre line.
export function poseAt(distance: number, offset = 0): TrackPose {
  const lapFraction = THREE.MathUtils.euclideanModulo(distance / TRACK_LENGTH, 1);
  const forward = centreLine.getTangentAt(lapFraction).setY(0).normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  return { position: centreLine.getPointAt(lapFraction).addScaledVector(right, offset), forward, right };
}

// A flat strip following the track between two sideways offsets; v along the strip runs in metres, for tiling.
export function ribbon(from: number, to: number, height: number, top = height, reversed = false, segments = 1600): THREE.BufferGeometry {
  const rows = Array.from({ length: segments + 1 }, (_, index) => (index / segments) * TRACK_LENGTH);
  const positions = rows.flatMap((distance) => {
    const inner = poseAt(distance, from).position;
    const outer = poseAt(distance, to).position;
    return [inner.x, height, inner.z, outer.x, top, outer.z];
  });
  const along = reversed ? -1 : 1; // barrier text reads left to right on both faces
  const uvs = rows.flatMap((distance) => [0, along * distance, 1, along * distance]);
  const quads = Array.from({ length: segments }, (_, index) => index * 2);
  const triangles = quads.flatMap((a) => [a, a + 2, a + 1, a + 1, a + 2, a + 3]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}
