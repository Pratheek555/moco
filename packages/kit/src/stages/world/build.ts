// Turns the world's data into three.js geometry and materials. Everything is built once per shape and shared.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { WorldModel, WorldPart, WorldSurface } from "@moco/spec";
import { seededRandom } from "../race-circuit/textures.ts";

const radians = THREE.MathUtils.degToRad;
const TEXTURE_SIZE = 512;
const CURVE_STEPS = 48;

// A point path smoothed into a curve, so a dozen points read as a shape and not a polygon.
function smoothProfile(points: [number, number][]): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(Math.max(x, 0), y)));
  return curve.getPoints(CURVE_STEPS);
}

function extruded(part: WorldPart): THREE.BufferGeometry {
  const points = (part.outline ?? []).map(([x, y]) => new THREE.Vector2(x * part.size[0], y * part.size[1]));
  const bevel = Math.min(part.size[2] * 0.2, 0.05);
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth: part.size[2], bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 12 });
  geometry.translate(0, 0, -part.size[2] / 2); // centred, like every other shape
  return geometry;
}

function tube(part: WorldPart): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3((part.path ?? []).map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.TubeGeometry(curve, CURVE_STEPS, part.size[0], 12, false);
}

// The shape of one part, centred on its own origin.
export function geometryOf(part: WorldPart): THREE.BufferGeometry {
  const [width, height, depth] = part.size;
  if (part.shape === "box") return new RoundedBoxGeometry(width, height, depth, 4, Math.min(width, height, depth) * part.round * 0.5);
  if (part.shape === "sphere") return new THREE.SphereGeometry(0.5, 64, 48).scale(width, height, depth); // fine enough to hold a curve in a close-up
  if (part.shape === "cylinder") return new THREE.CylinderGeometry(0.5 * part.taper, 0.5, 1, 40, 1).scale(width, height, depth);
  if (part.shape === "capsule") return new THREE.CapsuleGeometry(0.5, Math.max(height / width - 1, 0), 12, 32).scale(width, width, depth);
  if (part.shape === "torus") return new THREE.TorusGeometry(0.5, height / width / 2, 18, 56).rotateX(Math.PI / 2).scale(width, width, depth);
  if (part.shape === "lathe") return new THREE.LatheGeometry(smoothProfile((part.profile ?? []) as [number, number][]), 40).scale(width, height, depth);
  if (part.shape === "extrude") return extruded(part);
  return tube(part);
}

// One model's rest pose flattened to [part, transform from the model's origin], so it can be instanced.
export function restParts(model: WorldModel): { part: WorldPart; matrix: THREE.Matrix4 }[] {
  const byId = new Map(model.parts.map((part) => [part.id, part]));
  const hinge = (part: WorldPart): THREE.Matrix4 => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...part.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.turn.map(radians) as [number, number, number])), new THREE.Vector3(1, 1, 1));
    const parent = part.parent ? byId.get(part.parent) : undefined;
    return parent ? hinge(parent).multiply(local) : local;
  };
  return model.parts.map((part) => ({ part, matrix: hinge(part).multiply(new THREE.Matrix4().makeTranslation(...part.offset)) }));
}

export interface Measure {
  bottom: number; // lowest point at rest, so feet can be stood on the ground whatever the numbers said
  height: number; // real top to bottom, not the height the model declared
  face: number; // height of the head's middle above the feet
  width: number; // side to side, capped: a long tail shouldn't push the camera to the horizon
  headWidth: number;
}

const measures = new WeakMap<WorldModel, Measure>();

// A model's real size. The AI's arithmetic is good but not exact, and a camera or a foot can't be a little off.
export function measureModel(model: WorldModel): Measure {
  const known = measures.get(model);
  if (known) return known;
  const boxes = restParts(model).map(({ part, matrix }) => {
    const geometry = geometryOf(part);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!.clone().applyMatrix4(matrix);
    geometry.dispose();
    return { id: part.id, box };
  });
  const whole = boxes.reduce((total, { box }) => total.union(box), new THREE.Box3());
  const bottom = whole.min.y;
  const height = whole.max.y - bottom;
  const head = boxes.find(({ id }) => id === "head")?.box;
  const width = Math.min(whole.max.x - whole.min.x, height * 2);
  const measure = {
    bottom,
    height,
    face: head ? head.getCenter(new THREE.Vector3()).y - bottom : height * 0.86,
    width,
    headWidth: head ? head.max.x - head.min.x : width * 0.6,
  };
  measures.set(model, measure);
  return measure;
}

type Painter = (context: CanvasRenderingContext2D, second: string, random: () => number) => void;

const SIZE = TEXTURE_SIZE;

function dots(context: CanvasRenderingContext2D, second: string, random: () => number): void {
  context.fillStyle = second;
  Array.from({ length: 5200 }, () => [random() * SIZE, random() * SIZE, 1 + random() * 7, 0.08 + random() * 0.32]).forEach(([x, y, radius, alpha]) => {
    context.globalAlpha = alpha!;
    context.beginPath();
    context.arc(x!, y!, radius!, 0, Math.PI * 2);
    context.fill();
  });
  context.globalAlpha = 1;
}

// Every cell of a `columns` × `rows` grid, with the row and column it sits in.
function grid(columns: number, rows: number): { column: number; row: number }[] {
  return Array.from({ length: columns * rows }, (_, index) => ({ column: index % columns, row: Math.floor(index / columns) }));
}

const PAINTERS: Record<string, Painter> = {
  noise: dots,
  stripes(context, second) {
    context.fillStyle = second;
    grid(1, 8).filter(({ row }) => row % 2 === 0).forEach(({ row }) => context.fillRect(0, (row * SIZE) / 8, SIZE, SIZE / 8));
  },
  checker(context, second) {
    context.fillStyle = second;
    grid(8, 8).filter(({ column, row }) => (column + row) % 2 === 0).forEach(({ column, row }) => context.fillRect((column * SIZE) / 8, (row * SIZE) / 8, SIZE / 8, SIZE / 8));
  },
  bricks(context, second, random) {
    const width = SIZE / 6;
    const height = SIZE / 12;
    context.fillStyle = second;
    grid(7, 12).forEach(({ column, row }) => {
      context.globalAlpha = 0.65 + random() * 0.35;
      context.fillRect(column * width - (row % 2) * (width / 2) + 3, row * height + 3, width - 6, height - 6);
    });
    context.globalAlpha = 1;
  },
  planks(context, second, random) {
    context.strokeStyle = second;
    context.lineWidth = 5;
    grid(1, 7).forEach(({ row }) => context.strokeRect(-10, (row * SIZE) / 7, SIZE + 20, SIZE / 7));
    context.lineWidth = 1;
    context.globalAlpha = 0.3;
    Array.from({ length: 70 }, () => [random() * SIZE, random() * SIZE, 40 + random() * 160]).forEach(([x, y, length]) => context.strokeRect(x!, y!, length!, 0.5));
    context.globalAlpha = 1;
  },
  windows(context, second, random) {
    const cell = SIZE / 8;
    grid(8, 8).filter(() => random() > 0.35).forEach(({ column, row }) => {
      context.fillStyle = second;
      context.globalAlpha = 0.45 + random() * 0.55;
      context.fillRect(column * cell + cell * 0.2, row * cell + cell * 0.2, cell * 0.6, cell * 0.62);
    });
    context.globalAlpha = 1;
  },
  scales(context, second) {
    const cell = SIZE / 10;
    context.strokeStyle = second;
    context.lineWidth = 5;
    grid(11, 21).forEach(({ column, row }) => {
      context.beginPath();
      context.arc(column * cell + (row % 2) * (cell / 2), (row * cell) / 2, cell / 2, 0, Math.PI);
      context.stroke();
    });
  },
};

const textures = new Map<string, THREE.CanvasTexture>();

// The pattern as a tiling texture, drawn once per colour pair and repeat.
export function patternTexture(surface: WorldSurface): THREE.CanvasTexture | undefined {
  const painter = PAINTERS[surface.pattern];
  if (!painter) return undefined;
  const key = `${surface.pattern}|${surface.colour}|${surface.colour2}|${surface.repeat}`;
  const known = textures.get(key);
  if (known) return known;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  context.fillStyle = surface.colour;
  context.fillRect(0, 0, SIZE, SIZE);
  const fallback = `#${new THREE.Color(surface.colour).multiplyScalar(0.72).getHexString()}`;
  painter(context, surface.colour2 ?? fallback, seededRandom(surface.pattern.length * 17 + 3));

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(surface.repeat, surface.repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  textures.set(key, texture);
  return texture;
}

export function materialOf(surface: WorldSurface): THREE.MeshStandardMaterial {
  const texture = patternTexture(surface);
  return new THREE.MeshStandardMaterial({
    color: texture ? "#ffffff" : surface.colour,
    map: texture ?? null,
    roughness: surface.rough,
    metalness: surface.metal,
    emissive: surface.glow > 0 ? surface.colour : "#000000",
    emissiveIntensity: surface.glow,
    transparent: surface.opacity < 1,
    opacity: surface.opacity,
  });
}
