// The world around the cars at dusk: sky, sun, lights, tarmac, kerbs, barriers, grandstands, harbour and skyline.
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { poseAt, ribbon, TRACK_WIDTH } from "./track.ts";
import { asphalt, banners, chequers, grass, kerb, seededRandom, windows } from "./textures.ts";

// Everything the time of day changes. Colours are linear-ish RGB for the sky shader.
interface Light {
  haze: string;
  horizon: [number, number, number];
  middle: [number, number, number];
  top: [number, number, number];
  sun: [number, number, number];
  sunColour: string;
  sunStrength: number;
  fillSky: string;
  fillGround: string;
  fill: number;
  lamps: number; // how hard the floodlights and windows glow
}
const LIGHTS: Record<string, Light> = {
  dawn: { haze: "#e8b7a0", horizon: [1.0, 0.72, 0.5], middle: [0.74, 0.62, 0.72], top: [0.3, 0.42, 0.68], sun: [0.7, 0.3, 0.62], sunColour: "#ffd2ac", sunStrength: 3.6, fillSky: "#ffe6d4", fillGround: "#7a6a5c", fill: 1.5, lamps: 0.6 },
  noon: { haze: "#c6d8e8", horizon: [0.82, 0.9, 0.96], middle: [0.5, 0.72, 0.94], top: [0.2, 0.45, 0.82], sun: [-0.3, 0.86, 0.4], sunColour: "#fff4e0", sunStrength: 4.6, fillSky: "#e4f0ff", fillGround: "#857c6c", fill: 1.5, lamps: 0.1 },
  dusk: { haze: "#d98a5e", horizon: [1.0, 0.55, 0.28], middle: [0.72, 0.36, 0.42], top: [0.12, 0.13, 0.3], sun: [-0.62, 0.38, 0.68], sunColour: "#ffc48a", sunStrength: 4.2, fillSky: "#ffe2ca", fillGround: "#7a6a5c", fill: 1.4, lamps: 1 },
  night: { haze: "#141a2c", horizon: [0.1, 0.13, 0.24], middle: [0.05, 0.07, 0.16], top: [0.015, 0.02, 0.06], sun: [-0.3, 0.8, 0.5], sunColour: "#dfe8ff", sunStrength: 2.8, fillSky: "#8ea4d8", fillGround: "#39405a", fill: 1.2, lamps: 2 },
};
const lightOf = (timeOfDay: string) => LIGHTS[timeOfDay] ?? LIGHTS.dusk!;

// Image-based light, so the paint picks up reflections.
export function Reflections() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const target = generator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.55;
    return () => {
      target.dispose();
      generator.dispose();
    };
  }, [gl, scene]);
  return null;
}

const SKY_VERTEX = `varying vec3 direction; void main() { direction = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAGMENT = `
  varying vec3 direction;
  uniform vec3 sun, horizon, middle, top;
  void main() {
    vec3 ray = normalize(direction);
    float height = max(ray.y, 0.0);
    vec3 colour = mix(horizon, middle, smoothstep(0.0, 0.16, height));
    colour = mix(colour, top, smoothstep(0.12, 0.62, height));
    float towards = max(dot(ray, sun), 0.0);
    colour += vec3(1.0, 0.62, 0.3) * pow(towards, 14.0) * 0.5;  // the glow round the sun
    colour += vec3(1.0, 0.9, 0.7) * smoothstep(0.9993, 0.9997, towards);  // the sun's disc
    colour += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 180.0;  // dither away the banding
    gl_FragColor = vec4(colour, 1.0);
    #include <colorspace_fragment>
  }`;

export function Sky({ light }: { light: Pick<Light, "sun" | "horizon" | "middle" | "top"> }) {
  const uniforms = useMemo(
    () => ({
      sun: { value: new THREE.Vector3(...light.sun).normalize() },
      horizon: { value: new THREE.Vector3(...light.horizon) },
      middle: { value: new THREE.Vector3(...light.middle) },
      top: { value: new THREE.Vector3(...light.top) },
    }),
    [light],
  );
  return (
    <mesh>
      <sphereGeometry args={[2600, 32, 24]} />
      <shaderMaterial vertexShader={SKY_VERTEX} fragmentShader={SKY_FRAGMENT} uniforms={uniforms} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}

// One instanced mesh from a list of [x, y, z, scaleX, scaleY, scaleZ] placements, with optional colours.
function Instances({ placements, colours, children }: { placements: number[][]; colours?: string[]; children: React.ReactNode }) {
  const mesh = useMemo(() => new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial(), placements.length), [placements.length]);
  useEffect(() => {
    const matrix = new THREE.Matrix4();
    placements.forEach(([x, y, z, scaleX, scaleY, scaleZ], index) => {
      matrix.makeScale(scaleX!, scaleY!, scaleZ!).setPosition(x!, y!, z!);
      mesh.setMatrixAt(index, matrix);
      if (colours) mesh.setColorAt(index, new THREE.Color(colours[index % colours.length]!));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [mesh, placements, colours]);
  return <primitive object={mesh}>{children}</primitive>;
}

// Stepped stands along the north side of the main straight, full of people.
const SEATS_PER_ROW = 900;
const ROWS = 18;
function Grandstands() {
  const crowd = useMemo(() => {
    const random = seededRandom(23);
    return Array.from({ length: SEATS_PER_ROW * ROWS }, (_, index) => {
      const row = Math.floor(index / SEATS_PER_ROW);
      const seat = index % SEATS_PER_ROW;
      return [-440 + seat * 1.0 + random() * 0.3, 2.4 + row * 0.85, -34 - row * 1.1, 0.42, 0.7, 0.42];
    });
  }, []);
  const shirts = useMemo(() => ["#c9352f", "#f2efe6", "#2a5fb0", "#e8b52c", "#1d2a44", "#d9d4c5", "#c9352f", "#3a7d52"], []);
  const steps = useMemo(() => Array.from({ length: ROWS }, (_, row) => row), []);
  return (
    <group>
      {steps.map((row) => (
        <mesh key={row} position={[10, 0.95 + row * 0.42, -34 - row * 1.1]} receiveShadow>
          <boxGeometry args={[920, 1.9 + row * 0.85, 1.1]} />
          <meshStandardMaterial color="#6d7079" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[10, 22, -44]} rotation={[-0.14, 0, 0]}>
        <boxGeometry args={[930, 0.6, 30]} />
        <meshStandardMaterial color="#d7d9de" metalness={0.5} roughness={0.4} />
      </mesh>
      <Instances placements={crowd} colours={shirts}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.8} />
      </Instances>
    </group>
  );
}

// The start and finish line gantry, over the straight at x = 0.
function Gantry() {
  return (
    <group position={[0, 0, 0]}>
      {[-10, 10].map((z) => (
        <mesh key={z} position={[0, 5, z]} castShadow>
          <boxGeometry args={[0.5, 10, 0.5]} />
          <meshStandardMaterial color="#1c1e24" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 9.5, 0]} castShadow>
        <boxGeometry args={[1, 1.4, 20.5]} />
        <meshStandardMaterial color="#14181f" metalness={0.4} roughness={0.5} />
      </mesh>
    </group>
  );
}

// Floodlight towers along both sides of the lap, with lamps bright enough to read at dusk.
function Floodlights({ lamps }: { lamps: number }) {
  const towers = useMemo(() => Array.from({ length: 14 }, (_, index) => -480 + index * 74), []);
  return (
    <group>
      {towers.map((x) => (
        <group key={x} position={[x, 0, 27]}>
          <mesh position={[0, 16, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.34, 32, 10]} />
            <meshStandardMaterial color="#2b2e36" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[0, 32, 0]}>
            <boxGeometry args={[5, 2, 0.5]} />
            <meshStandardMaterial color="#fff4d6" emissive="#fff0c8" emissiveIntensity={3 * lamps} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Water to the south, and a skyline behind it with lit windows.
function Harbour({ lamps }: { lamps: number }) {
  const windowTexture = useMemo(() => windows(), []);
  const towers = useMemo(() => {
    const random = seededRandom(41);
    return Array.from({ length: 70 }, (_, index) => ({ x: -1100 + index * 34 + random() * 12, z: 620 + random() * 160, width: 18 + random() * 22, height: 30 + random() * random() * 150 }));
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 855]}>
        <planeGeometry args={[4000, 1200]} />
        <meshPhysicalMaterial color="#3d5f78" metalness={0.75} roughness={0.22} />
      </mesh>
      {towers.map((tower) => (
        <mesh key={tower.x} position={[tower.x, tower.height / 2, tower.z]}>
          <boxGeometry args={[tower.width, tower.height, tower.width]} />
          <meshStandardMaterial color="#3a3440" roughness={0.6} emissive="#ffffff" emissiveMap={windowTexture} emissiveIntensity={0.55 * lamps} />
        </mesh>
      ))}
    </group>
  );
}

// Pines scattered behind the barriers, so the infield isn't an empty lawn.
function Trees() {
  const placements = useMemo(() => {
    const random = seededRandom(97);
    return Array.from({ length: 900 }, (_, index) => {
      const side = index % 2 === 0 ? 1 : -1;
      const { position } = poseAt(index * 3.4, side * (30 + random() * 70));
      const height = 7 + random() * 9;
      return [position.x, height / 2, position.z, height * 0.34, height, height * 0.34];
    }).filter(([, , z]) => z! > -30 && z! < 245); // keep the stands and the water clear
  }, []);
  return (
    <Instances placements={placements} colours={["#2c4a2b", "#35562f", "#27432d"]}>
      <coneGeometry args={[1, 1, 7]} />
      <meshStandardMaterial roughness={0.9} />
    </Instances>
  );
}

function Surface() {
  const road = useMemo(() => ribbon(-TRACK_WIDTH / 2, TRACK_WIDTH / 2, 0.02), []);
  const kerbs = useMemo(() => [ribbon(-TRACK_WIDTH / 2 - 1.6, -TRACK_WIDTH / 2, 0.08, 0.03), ribbon(TRACK_WIDTH / 2, TRACK_WIDTH / 2 + 1.6, 0.03, 0.08)], []);
  const runoff = useMemo(() => [ribbon(-16, -TRACK_WIDTH / 2 - 1.6, 0.01), ribbon(TRACK_WIDTH / 2 + 1.6, 16, 0.01)], []);
  const textures = useMemo(() => ({ road: asphalt(), kerb: kerb(), grass: grass(), banner: banners(), line: chequers() }), []);
  const barriers = useMemo(() => [wall(-24, 0.01, true), wall(-24.3, -0.01, false), wall(24, -0.01, false), wall(24.3, 0.01, true)], []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[6000, 6000]} />
        <meshStandardMaterial map={textures.grass} roughness={1} />
      </mesh>
      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial map={textures.road} roughness={0.55} side={THREE.DoubleSide} />
      </mesh>
      {kerbs.map((geometry) => (
        <mesh key={geometry.uuid} geometry={geometry} receiveShadow>
          <meshStandardMaterial map={textures.kerb} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {runoff.map((geometry) => (
        <mesh key={geometry.uuid} geometry={geometry} receiveShadow>
          <meshStandardMaterial color="#7b7d80" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {barriers.map((geometry) => (
        <mesh key={geometry.uuid} geometry={geometry}>
          <meshStandardMaterial map={textures.banner} roughness={0.7} />
        </mesh>
      ))}
      {/* The chequered start and finish line. */}
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.6, TRACK_WIDTH]} />
        <meshStandardMaterial map={textures.line} roughness={0.6} />
      </mesh>
    </group>
  );
}

// A barrier is a vertical ribbon: the same strip stood on edge.
function wall(offset: number, width: number, reversed: boolean): THREE.BufferGeometry {
  return ribbon(offset, offset + width, 0, 2.2, reversed);
}

export function Circuit({ timeOfDay }: { timeOfDay: string }) {
  const light = lightOf(timeOfDay);
  return (
    <>
      <Reflections />
      <color attach="background" args={[light.haze]} />
      <fog attach="fog" args={[light.haze, 180, 1500]} />
      <Sky light={light} />
      <hemisphereLight args={[light.fillSky, light.fillGround, light.fill]} />
      <Surface />
      <Trees />
      <Grandstands />
      <Gantry />
      <Floodlights lamps={light.lamps} />
      <Harbour lamps={light.lamps} />
    </>
  );
}

// Warm low sun that follows the action, so shadows stay sharp near the cars wherever they are on the lap.
export function SunFollowing({ target, timeOfDay }: { target: THREE.Vector3; timeOfDay: string }) {
  const settings = lightOf(timeOfDay);
  const light = useMemo(() => {
    const sun = new THREE.DirectionalLight(settings.sunColour, settings.sunStrength);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    return sun;
  }, [settings]);
  light.position.copy(target).addScaledVector(new THREE.Vector3(...settings.sun).normalize(), 420);
  light.target.position.copy(target);
  light.target.updateMatrixWorld();
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}
