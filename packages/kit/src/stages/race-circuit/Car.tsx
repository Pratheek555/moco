// An open-wheel race car modelled from primitives, 5.5 m long, nose towards +z, sitting on y = 0.
// Liveries are fictional. `wheelTurn` is the wheel rotation in radians and `steer` the front wheels' angle.
import { useMemo } from "react";
import * as THREE from "three";
import { raceNumber } from "./textures.ts";

export interface Livery {
  paint: string;
  accent: string;
  number: string;
  helmet: string;
}

const CARBON = "#101115";

// The fuselage: a lathe from the rear crash structure to the nose tip. Points are [radius, z].
const FUSELAGE: Array<[number, number]> = [[0.02, -2.45], [0.2, -2.3], [0.34, -1.5], [0.46, -0.6], [0.47, 0.2], [0.36, 0.9], [0.22, 1.7], [0.14, 2.4], [0.1, 2.85], [0.02, 2.95]];

// A round bar between two points, for suspension arms.
function Rod({ from, to, radius = 0.018 }: { from: [number, number, number]; to: [number, number, number]; radius?: number }) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    return {
      position: start.clone().add(end).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
      length: direction.length(),
    };
  }, [from, to]);
  return (
    <mesh position={position} quaternion={quaternion} castShadow>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshStandardMaterial color={CARBON} roughness={0.5} />
    </mesh>
  );
}

function Wheel({ side, z, radius, width, turn, steer = 0, accent }: { side: 1 | -1; z: number; radius: number; width: number; turn: number; steer?: number; accent: string }) {
  const spokes = [0, 1, 2, 3, 4];
  return (
    <group position={[side * 0.86, radius, z]} rotation={[0, steer, 0]}>
      <group rotation={[turn, 0, 0]}>
        <group rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow>
            <cylinderGeometry args={[radius, radius, width, 40]} />
            <meshStandardMaterial color="#141417" roughness={0.82} />
          </mesh>
          {/* The rim, its spokes and the coloured sidewall stripe, on the outer face. */}
          <mesh position={[0, (side * width) / 2 + side * 0.002, 0]}>
            <cylinderGeometry args={[radius * 0.62, radius * 0.62, 0.012, 32]} />
            <meshStandardMaterial color="#2b2d33" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position={[0, (side * width) / 2 + side * 0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius * 0.78, 0.012, 8, 48]} />
            <meshStandardMaterial color={accent} roughness={0.5} />
          </mesh>
          {spokes.map((spoke) => (
            <mesh key={spoke} position={[0, (side * width) / 2 + side * 0.012, 0]} rotation={[0, (spoke * Math.PI * 2) / spokes.length, 0]}>
              <boxGeometry args={[0.04, 0.012, radius * 1.2]} />
              <meshStandardMaterial color="#c9ccd4" metalness={0.9} roughness={0.3} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

export function Car({ livery, wheelTurn, steer = 0, helmetNod = 0 }: { livery: Livery; wheelTurn: number; steer?: number; helmetNod?: number }) {
  const fuselage = useMemo(() => new THREE.LatheGeometry(FUSELAGE.map(([radius, z]) => new THREE.Vector2(radius, z)), 40), []);
  const fin = useMemo(() => {
    // The engine cover seen from the side: rises behind the cockpit, sweeps down to the rear wing.
    const outline = new THREE.Shape();
    outline.moveTo(0.1, 0.42);
    outline.lineTo(0.05, 1.0);
    outline.lineTo(-0.3, 1.02);
    outline.lineTo(-2.3, 0.62);
    outline.lineTo(-2.3, 0.42);
    return new THREE.ExtrudeGeometry(outline, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.04, bevelSegments: 3 });
  }, []);
  const halo = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.27, 0.72, -0.2), new THREE.Vector3(-0.25, 0.94, 0.15), new THREE.Vector3(0, 1.0, 0.62), new THREE.Vector3(0.25, 0.94, 0.15), new THREE.Vector3(0.27, 0.72, -0.2)]), 40, 0.024, 8), []);
  const numberTexture = useMemo(() => raceNumber(livery.number, "#ffffff"), [livery.number]);
  const paint = <meshPhysicalMaterial color={livery.paint} metalness={0.1} roughness={0.32} clearcoat={1} clearcoatRoughness={0.06} />;
  const accent = <meshPhysicalMaterial color={livery.accent} metalness={0.25} roughness={0.3} clearcoat={1} />;
  const carbon = <meshStandardMaterial color={CARBON} roughness={0.42} metalness={0.3} />;

  return (
    <group>
      {/* Fuselage, flattened into an oval section. */}
      <mesh geometry={fuselage} position={[0, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.68]} castShadow>{paint}</mesh>
      <mesh geometry={fin} position={[0.05, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>{paint}</mesh>
      {/* Floor plank. */}
      <mesh position={[0, 0.11, -0.3]} castShadow><boxGeometry args={[1.5, 0.05, 3.7]} />{carbon}</mesh>
      {/* Sidepods. */}
      {([1, -1] as const).map((side) => (
        <group key={side}>
          <mesh position={[side * 0.56, 0.36, -0.55]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.72]} castShadow>
            <capsuleGeometry args={[0.27, 1.5, 8, 24]} />{paint}
          </mesh>
          <mesh position={[side * 0.56, 0.38, 0.47]} scale={[1, 0.7, 0.1]}><sphereGeometry args={[0.24, 20, 12]} />{carbon}</mesh>
          {/* Front wing endplate and rear wing endplate. */}
          <mesh position={[side * 0.97, 0.2, 2.83]} castShadow><boxGeometry args={[0.03, 0.3, 0.58]} />{accent}</mesh>
          <mesh position={[side * 0.52, 0.87, -2.56]} castShadow><boxGeometry args={[0.03, 0.56, 0.68]} />{accent}</mesh>
          {/* Suspension arms. */}
          <Rod from={[side * 0.25, 0.46, 1.8]} to={[side * 0.74, 0.34, 1.75]} />
          <Rod from={[side * 0.2, 0.3, 1.9]} to={[side * 0.74, 0.3, 1.7]} />
          <Rod from={[side * 0.3, 0.44, -1.5]} to={[side * 0.68, 0.36, -1.6]} />
          <Wheel side={side} z={1.75} radius={0.36} width={0.34} turn={wheelTurn} steer={steer} accent={livery.accent} />
          <Wheel side={side} z={-1.6} radius={0.36} width={0.44} turn={wheelTurn} accent={livery.accent} />
          {/* The race number on the engine cover, both flanks. */}
          <mesh position={[side * 0.13, 0.72, -0.8]} rotation={[0, (side * Math.PI) / 2, 0]}>
            <planeGeometry args={[0.42, 0.42]} />
            <meshBasicMaterial map={numberTexture} transparent />
          </mesh>
        </group>
      ))}
      {/* Front wing: main plane and two raked flaps. */}
      <mesh position={[0, 0.1, 2.85]} castShadow><boxGeometry args={[1.92, 0.025, 0.44]} />{carbon}</mesh>
      <mesh position={[0, 0.16, 2.72]} rotation={[-0.32, 0, 0]} castShadow><boxGeometry args={[1.92, 0.02, 0.2]} />{accent}</mesh>
      <mesh position={[0, 0.22, 2.58]} rotation={[-0.5, 0, 0]} castShadow><boxGeometry args={[1.92, 0.02, 0.15]} />{accent}</mesh>
      {/* Rear wing: two elements on a central pylon. */}
      <mesh position={[0, 1.08, -2.56]} rotation={[0.22, 0, 0]} castShadow><boxGeometry args={[1.04, 0.025, 0.3]} />{accent}</mesh>
      <mesh position={[0, 0.96, -2.7]} rotation={[0.1, 0, 0]} castShadow><boxGeometry args={[1.04, 0.025, 0.34]} />{carbon}</mesh>
      <mesh position={[0, 0.72, -2.45]} castShadow><boxGeometry args={[0.04, 0.52, 0.2]} />{carbon}</mesh>
      {/* Cockpit opening, halo and the driver's helmet. */}
      <mesh position={[0, 0.72, 0.1]} scale={[0.3, 0.04, 0.62]}><sphereGeometry args={[1, 24, 12]} /><meshStandardMaterial color="#060608" roughness={0.9} /></mesh>
      <mesh geometry={halo} castShadow><meshStandardMaterial color="#17181c" metalness={0.5} roughness={0.35} /></mesh>
      <group position={[0, 0.82, -0.05]} rotation={[helmetNod, 0, 0]}>
        <mesh castShadow><sphereGeometry args={[0.145, 28, 20]} /><meshPhysicalMaterial color={livery.helmet} roughness={0.2} clearcoat={1} /></mesh>
        <mesh position={[0, 0.02, 0.06]} scale={[0.92, 0.42, 0.95]}><sphereGeometry args={[0.145, 28, 16]} /><meshPhysicalMaterial color="#0b0d12" metalness={0.9} roughness={0.08} /></mesh>
      </group>
    </group>
  );
}
