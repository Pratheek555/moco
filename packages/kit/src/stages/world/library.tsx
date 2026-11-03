// Draws what a world takes from the asset library (@moco/kit/library): ready-made models, fitted into the part's size,
// and real surface textures, mapped by position in metres so they never stretch over a shape's own UVs.
// Loading suspends the frame (Remotion waits), so nothing is drawn half-loaded.
import { createContext, useContext, useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { WorldModel, WorldSurface } from "@moco/spec";

// Library files are served next to the kit's other assets; the renderer says how to reach them.
let fileUrl = (path: string) => `/${path}`;
export function setLibraryUrl(resolve: (path: string) => string): void {
  fileUrl = resolve;
}

const modelUrl = (id: string) => fileUrl(`library/models/${id}/${id}.gltf`);
const textureUrl = (id: string, map: "diff" | "rough") => fileUrl(`library/textures/${id}/${map}.jpg`);

// How the world is drawn (film or toon), for everything that makes a material.
export const LookContext = createContext<"film" | "toon">("film");

// ---------- models ----------

// A copy of the library model, scaled to fit `size` without changing its proportions and centred on the part, like
// every other shape.
// In a toon world a library model's own materials are redrawn as toon, keeping their colours and textures.
let bands: THREE.DataTexture | undefined;
function toonOf(material: THREE.Material): THREE.Material {
  const source = material as THREE.MeshStandardMaterial;
  bands ??= Object.assign(new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, needsUpdate: true });
  return new THREE.MeshToonMaterial({ color: source.color, map: source.map ?? null, gradientMap: bands, transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest });
}

function fitted(scene: THREE.Object3D, size: [number, number, number], look: "film" | "toon" = "film"): THREE.Object3D {
  const copy = scene.clone(true);
  const box = new THREE.Box3().setFromObject(copy);
  const dimensions = box.getSize(new THREE.Vector3()).toArray();
  const ratios = dimensions.map((length, axis) => (length > 1e-6 && size[axis]! > 0 ? size[axis]! / length : Infinity)).filter(Number.isFinite);
  const scale = ratios.length > 0 ? Math.min(...ratios) : 1;
  const centre = box.getCenter(new THREE.Vector3());
  copy.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (look === "toon") child.material = Array.isArray(child.material) ? child.material.map(toonOf) : toonOf(child.material);
    }
  });
  const holder = new THREE.Group();
  copy.position.copy(centre).multiplyScalar(-scale);
  copy.scale.setScalar(scale);
  holder.add(copy);
  return holder;
}

export function LibraryModel({ id, size }: { id: string; size: [number, number, number] }) {
  const gltf = useLoader(GLTFLoader, modelUrl(id));
  const look = useContext(LookContext);
  const object = useMemo(() => fitted(gltf.scene, size, look), [gltf, size, look]);
  return <primitive object={object} />;
}

// Many copies of one library part, for scattered models: each spot's transform times the part's own.
export function ScatteredLibraryModel({ id, size, matrix, spots }: { id: string; size: [number, number, number]; matrix: THREE.Matrix4; spots: THREE.Matrix4[] }) {
  const gltf = useLoader(GLTFLoader, modelUrl(id));
  const look = useContext(LookContext);
  const copies = useMemo(() => {
    const model = fitted(gltf.scene, size, look);
    // Full models are heavier than instances: past this many, the far ones would not be seen anyway.
    return spots.slice(0, 120).map((spot) => {
      const copy = model.clone(true);
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(spot.clone().multiply(matrix));
      return copy;
    });
  }, [gltf, size, matrix, spots, look]);
  return (
    <>
      {copies.map((copy, index) => (
        <primitive key={index} object={copy} />
      ))}
    </>
  );
}

// ---------- materials ----------

interface Maps {
  diff: THREE.Texture;
  rough: THREE.Texture;
}
const loaded = new Map<string, Maps>();

// Every library material a world uses, loaded before its first frame draws.
export function useLibraryTextures(models: WorldModel[], ground: WorldSurface): void {
  const ids = [...new Set([ground, ...models.flatMap((model) => Object.values(model.surfaces))].flatMap((surface) => (surface.material ? [surface.material] : [])))].sort();
  const urls = ids.flatMap((id) => [textureUrl(id, "diff"), textureUrl(id, "rough")]);
  const textures = useLoader(THREE.TextureLoader, urls);
  ids.forEach((id, index) => {
    if (loaded.has(id)) return;
    const [diff, rough] = [textures[index * 2]!, textures[index * 2 + 1]!];
    diff.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [diff, rough]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
    }
    loaded.set(id, { diff, rough });
  });
}

// Samples a texture three times, from the side, the top and the front, by the point's position in the shape's own
// metres, and blends by which way the surface faces: a brick wall's bricks are brick-sized on any shape.
const TRIPLANAR = `
  uniform sampler2D triColour;
  uniform sampler2D triRough;
  uniform float triScale;
  varying vec3 vTriPosition;
  varying vec3 vTriNormal;
  vec4 triplanar(sampler2D map) {
    vec3 weights = pow(abs(normalize(vTriNormal)), vec3(4.0));
    weights /= dot(weights, vec3(1.0));
    vec3 point = vTriPosition * triScale;
    return texture2D(map, point.zy) * weights.x + texture2D(map, point.xz) * weights.y + texture2D(map, point.xy) * weights.z;
  }
`;

// Puts a library texture on a material: its colours tinted by the material's colour, its roughness mostly its own. Returns false when the texture isn't loaded (no library installed), leaving the material as it was.
export function applyLibraryTexture(material: THREE.MeshPhysicalMaterial | THREE.MeshToonMaterial, surface: WorldSurface, tileMetres = 2): boolean {
  const maps = surface.material ? loaded.get(surface.material) : undefined;
  if (!maps) return false;
  // `repeat` above 1 makes the texture finer, as it does a pattern.
  const scale = Math.max(surface.repeat, 1) / tileMetres;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { triColour: { value: maps.diff }, triRough: { value: maps.rough }, triScale: { value: scale } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTriPosition;\nvarying vec3 vTriNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTriPosition = position;\nvTriNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TRIPLANAR}`)
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= triplanar(triColour).rgb;")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, triplanar(triRough).g, 0.85);");
  };
  material.customProgramCacheKey = () => `library-${surface.material}-${scale}`;
  return true;
}
