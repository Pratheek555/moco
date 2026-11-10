import * as z from "zod";

const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Number3 = z.tuple([z.number().min(-1000).max(1000), z.number().min(-1000).max(1000), z.number().min(-1000).max(1000)]);
const Scale3 = z.tuple([z.number().positive().max(1000), z.number().positive().max(1000), z.number().positive().max(1000)]);
const Frame = z.number().int().nonnegative();
const Point2 = z.tuple([z.number().min(-1000).max(1000), z.number().min(-1000).max(1000)]);

// Blender receives data only. No Python, expressions, file paths, or external assets are accepted.
// Coordinates are Blender-native: metres, Z up; rotations are Euler XYZ in degrees.
export const BlenderScene = z.object({
  version: z.literal(1),
  background: Colour.default("#101827"),
  ambient: z.number().min(0).max(2).default(0.25),
  // Illustration scenes use native curve cutouts and an orthographic camera.
  renderStyle: z.enum(["lit", "illustration"]).optional(),
  rasterizer: z.enum(["eevee", "workbench"]).optional(),
  animationStep: z.number().int().min(1).max(4).optional(),
  assets: z.array(z.object({id:Id,sha256:z.string().regex(/^[a-f0-9]{64}$/)})).max(80).optional(),
  cast: z.array(z.string()).max(20).default([]),
  materials: z.array(z.object({
    id: Id, color: Colour,
    metallic: z.number().min(0).max(1).default(0),
    roughness: z.number().min(0).max(1).default(0.45),
    emission: z.number().min(0).max(20).default(0),
  })).min(1).max(40),
  objects: z.array(z.object({
    id: Id,
    kind: z.enum(["empty", "cube", "sphere", "ico_sphere", "cylinder", "cone", "torus", "plane", "text", "path", "image"]),
    parent: Id.optional(),
    material: Id.optional(),
    position: Number3.default([0, 0, 0]),
    rotation: Number3.default([0, 0, 0]),
    scale: Scale3.default([1, 1, 1]),
    text: z.string().max(180).optional(),
    font: z.enum(["default", "headline", "hand"]).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    image: Id.optional(), // an id in the caller-owned asset registry, never a model-authored path
    path: z.object({
      points: z.array(Point2).min(2).max(2048),
      closed: z.boolean().default(true),
      smooth: z.boolean().default(false),
      fill: z.boolean().default(true),
      strokeMaterial: Id.optional(),
      strokeWidth: z.number().positive().max(1).default(0.025),
    }).optional(),
    bevel: z.number().min(0).max(0.2).default(0),
    keys: z.array(z.object({
      atFrame: Frame,
      position: Number3.optional(), rotation: Number3.optional(), scale: Scale3.optional(),
      easing: z.enum(["linear", "smooth", "hold"]).default("smooth"),
    })).max(64).default([]),
  })).min(1).max(800),
  lights: z.array(z.object({
    id: Id, type: z.enum(["area", "point", "sun"]).default("area"),
    color: Colour.default("#ffffff"), energy: z.number().min(0).max(10000),
    position: Number3, target: Number3.default([0, 0, 0]),
    size: z.number().min(0.1).max(100).default(5),
  })).min(1).max(12),
  camera: z.object({
    lens: z.number().min(12).max(150).default(50),
    projection: z.enum(["perspective", "orthographic"]).optional(),
    orthoScale: z.number().positive().max(1000).optional(),
    keys: z.array(z.object({ atFrame: Frame, eye: Number3, target: Number3, orthoScale: z.number().positive().max(1000).optional(), easing:z.enum(["smooth","linear","hold"]).optional() })).min(1).max(32),
  }),
});
export type BlenderScene = z.infer<typeof BlenderScene>;

export function blenderSceneIssues(scene: BlenderScene, durationFrames: number): { path: string; problem: string }[] {
  const issues: { path: string; problem: string }[] = [];
  const add = (path: string, problem: string) => issues.push({ path: `blender.${path}`, problem });
  for (const group of ["materials", "objects", "lights"] as const) {
    const seen = new Set<string>();
    scene[group].forEach((item, i) => { if (seen.has(item.id)) add(`${group}[${i}].id`, "duplicate id"); seen.add(item.id); });
  }
  const objects = new Map(scene.objects.map(item => [item.id, item]));
  const materials = new Set(scene.materials.map(item => item.id));
  const assetIds = new Set(scene.assets?.map(item=>item.id));
  const keys = (list: { atFrame: number }[], path: string) => list.forEach((key, i) => {
    if (key.atFrame >= durationFrames || (i > 0 && key.atFrame <= list[i - 1]!.atFrame)) add(`${path}[${i}].atFrame`, "keys must be strictly increasing and inside the shot");
  });
  scene.objects.forEach((item, i) => {
    const path = `objects[${i}]`;
    if (item.material && !materials.has(item.material)) add(`${path}.material`, "unknown material");
    if (item.kind !== "empty" && !item.material) add(`${path}.material`, "visible objects need a material");
    if (item.kind === "text" && !item.text?.trim()) add(`${path}.text`, "text object needs text");
    if (item.kind === "image" && !item.image) add(`${path}.image`, "image object needs a registered asset id");
    if (item.kind === "image" && item.image && !assetIds.has(item.image)) add(`${path}.image`, "image asset needs its SHA-256 in blender.assets");
    if (item.kind === "path") {
      if (!item.path) add(`${path}.path`, "path object needs curve points");
      else {
        if (item.path.fill && (!item.path.closed || item.path.points.length < 3)) add(`${path}.path`, "filled paths need a closed contour with at least three points");
        if (item.path.strokeMaterial && !materials.has(item.path.strokeMaterial)) add(`${path}.path.strokeMaterial`, "unknown stroke material");
      }
    }
    if (item.parent && !objects.has(item.parent)) add(`${path}.parent`, "unknown parent");
    let parent: typeof item | undefined = item;
    const seen = new Set<string>();
    while (parent) {
      if (seen.has(parent.id)) { add(`${path}.parent`, "parent cycle"); break; }
      seen.add(parent.id); parent = parent.parent ? objects.get(parent.parent) : undefined;
    }
    keys(item.keys, `${path}.keys`);
  });
  keys(scene.camera.keys, "camera.keys");
  if (scene.camera.projection === "orthographic" && !scene.camera.orthoScale) add("camera.orthoScale", "orthographic cameras need a positive scale");
  if (scene.camera.keys[0]?.atFrame !== 0) add("camera.keys", "camera must start at frame 0");
  scene.camera.keys.forEach((key, i) => {
    if (key.eye.every((n, axis) => Math.abs(n - key.target[axis]!) < 0.001)) add(`camera.keys[${i}]`, "camera eye and target coincide");
  });
  return issues;
}
