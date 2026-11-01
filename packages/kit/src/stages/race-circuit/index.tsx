// A real 3D circuit for racing stories: the AI picks a rig, a place and who leads, and these draw the shot.
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BackgroundDef, StageProps } from "../../define.ts";
import { Car, type Livery } from "./Car.tsx";
import { Circuit, SunFollowing } from "./Circuit.tsx";
import { PLACES, RIGS, shotState } from "./rigs.ts";

// Fictional teams: racer_red drives #27, racer_blue drives #4.
const LIVERIES: Record<string, Livery> = {
  red: { paint: "#c8131f", accent: "#f4efe3", number: "27", helmet: "#f4efe3" },
  blue: { paint: "#1450b8", accent: "#f2c230", number: "4", helmet: "#f2c230" },
};
const WHEEL_RADIUS = 0.36;

function PlacedCar({ colour, car, nod = 0 }: { colour: string; car: { pose: { position: THREE.Vector3; forward: THREE.Vector3 }; distance: number; steer: number }; nod?: number }) {
  return (
    <group position={car.pose.position} rotation={[0, Math.atan2(car.pose.forward.x, car.pose.forward.z), 0]}>
      <Car livery={LIVERIES[colour]!} wheelTurn={car.distance / WHEEL_RADIUS} steer={car.steer} helmetNod={nod} />
    </group>
  );
}

function Lens({ eye, target, fov }: { eye: THREE.Vector3; target: THREE.Vector3; fov: number }) {
  // Set during render, not in an effect: ThreeCanvas draws its frame before effects run.
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  camera.fov = fov;
  camera.near = 0.1;
  camera.far = 5000;
  camera.position.copy(eye);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return null;
}

function RaceShot({ stage, frame, durationFrames, timeOfDay }: StageProps) {
  const shot = shotState(stage, frame, durationFrames);
  const otherColour = stage.subject === "red" ? "blue" : "red";
  return (
    <>
      <Lens eye={shot.eye} target={shot.target} fov={shot.fov} />
      <Circuit timeOfDay={timeOfDay} />
      <SunFollowing target={shot.subject.pose.position} timeOfDay={timeOfDay} />
      <PlacedCar colour={stage.subject} car={shot.subject} nod={shot.nod} />
      <PlacedCar colour={otherColour} car={shot.other} />
    </>
  );
}

export const raceCircuit: BackgroundDef = {
  id: "race_circuit",
  timeOfDay: ["dusk", "dawn", "noon", "night"],
  hint: "A 3D motor racing circuit with grandstands and a harbour. Two cars: red #27 is driven by racer_red, blue #4 by racer_blue. Leave characters empty: drivers are seen through the cars. No flags, pit crews or people on foot exist here.",
  layers: [],
  stage: {
    cameras: Object.entries(RIGS).map(([id, rig]) => ({ id, hint: rig.hint })),
    places: Object.entries(PLACES).map(([id, place]) => ({ id, hint: place.hint })),
    subjects: Object.keys(LIVERIES),
    Component: RaceShot,
  },
};
