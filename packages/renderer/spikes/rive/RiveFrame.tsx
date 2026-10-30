// Rive spike (Phase 5): a frame-exact Rive player for Remotion. Findings in docs/adr/rive-vs-svg-rig.md.
// Kept out of the main bundle on purpose: nothing in src/ imports this folder.
//
// Why not just @remotion/rive's <RemotionRiveCanvas>? It advances the animation by "this frame minus the last
// frame it drew", so the picture depends on what that browser tab rendered before. It can't play a state machine,
// and it downloads rive.wasm from unpkg while rendering. This player instead works out frame N from frame 0 every
// time it has to go backwards, always in steps of exactly 1/fps, and loads the wasm from the bundle's public dir.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { staticFile, useCurrentFrame, useDelayRender, useVideoConfig } from "remotion";
import loadRive, {
  type Artboard,
  type CanvasRenderer,
  type File,
  type LinearAnimationInstance,
  type RiveCanvas,
  type SMIInput,
  type StateMachineInstance,
} from "@rive-app/canvas-advanced";

// The package ships its ESM types as rive_advanced.mjs.d.ts without "type": "module", so TypeScript reads the
// default export as a CommonJS namespace. The bundler gives the function itself; this cast says so.
const startRive = loadRive as unknown as (options: { locateFile: (file: string) => string }) => Promise<RiveCanvas>;

export type RiveProps = {
  src: string; // .riv file in the public dir
  artboard?: string; // default artboard when left out
  animation?: string; // play one timeline animation…
  stateMachine?: string; // …or a state machine (not both); neither = the artboard's first animation
  inputs?: RiveInput[]; // state machine inputs to set at given frames
};

// A state machine input change at a frame. Booleans and numbers are set; a trigger fires when value is true.
export interface RiveInput {
  frame: number;
  name: string;
  value: boolean | number;
}

// What is on screen right now: a fresh artboard instance and the animation or state machine that drives it.
interface Player {
  artboard: Artboard;
  animation: LinearAnimationInstance | null;
  machine: StateMachineInstance | null;
  frame: number; // the frame the artboard currently shows
  made: string; // the props it was made from
  file: File; // and the file
}

export function RiveFrame(props: RiveProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [loaded, setLoaded] = useState<{ rive: RiveCanvas; file: File } | null>(null);
  const player = useRef<Player | null>(null);
  const renderer = useRef<CanvasRenderer | null>(null);

  if (props.animation && props.stateMachine) throw new Error("RiveFrame: give an animation or a state machine, not both");

  // Load the runtime and the file once. The render waits until both are ready.
  useEffect(() => {
    const handle = delayRender(`Loading ${props.src}`);
    const load = async () => {
      const rive = await startRive({ locateFile: () => staticFile("rive.wasm") });
      const bytes = await fetch(staticFile(props.src)).then((response) => response.arrayBuffer());
      const file = await rive.load(new Uint8Array(bytes), undefined, false); // false: never fetch assets from Rive's CDN
      setLoaded({ rive, file });
      continueRender(handle);
    };
    load().catch((error: unknown) => cancelRender(error));
  }, [props.src, delayRender, continueRender, cancelRender]);

  // Draw this frame. Runs before the frame is captured, so no delayRender is needed per frame.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!loaded || !canvas) return;
    const { rive, file } = loaded;

    // Going backwards, starting, or new props (e.g. edited in the Studio): start again from frame 0.
    const made = JSON.stringify(props);
    if (!player.current || player.current.frame > frame || player.current.made !== made || player.current.file !== file) {
      deletePlayer(player.current);
      player.current = { ...startPlayer(file, props, rive), made, file };
    }
    stepTo(player.current, frame, fps, inputsByFrame(props.inputs ?? []), rive.SMIInput.trigger);

    renderer.current ??= rive.makeRenderer(canvas) as CanvasRenderer;
    renderer.current.clear();
    renderer.current.save();
    renderer.current.align(rive.Fit.contain, rive.Alignment.center, { minX: 0, minY: 0, maxX: width, maxY: height }, player.current.artboard.bounds);
    player.current.artboard.draw(renderer.current);
    renderer.current.restore();
    rive.resolveAnimationFrame(); // flush the queued draw calls onto the canvas now
  }, [loaded, frame, fps, width, height, props]);

  // Free the wasm objects when the component goes away.
  useEffect(() => () => deletePlayer(player.current), []);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width, height }} />;
}

// A new artboard instance, showing frame 0.
// Unknown names fail with the list of names that do exist, so a wrong spec is easy to fix.
function startPlayer(file: File, props: RiveProps, rive: RiveCanvas): Omit<Player, "made" | "file"> {
  const boards = Array.from({ length: file.artboardCount() }, (_, index) => file.artboardByIndex(index).name);
  if (props.artboard && !boards.includes(props.artboard)) throw new Error(`RiveFrame: no artboard "${props.artboard}" in ${props.src}; it has ${boards.join(", ")}`);
  const artboard = props.artboard ? file.artboardByName(props.artboard) : file.defaultArtboard();

  if (props.stateMachine) {
    const machines = Array.from({ length: artboard.stateMachineCount() }, (_, index) => artboard.stateMachineByIndex(index).name);
    if (!machines.includes(props.stateMachine)) throw new Error(`RiveFrame: no state machine "${props.stateMachine}" on ${artboard.name}; it has ${machines.join(", ") || "none"}`);
    const machine = new rive.StateMachineInstance(artboard.stateMachineByName(props.stateMachine), artboard);
    return { artboard, animation: null, machine, frame: -1 };
  }

  const animations = Array.from({ length: artboard.animationCount() }, (_, index) => artboard.animationByIndex(index).name);
  if (props.animation && !animations.includes(props.animation)) throw new Error(`RiveFrame: no animation "${props.animation}" on ${artboard.name}; it has ${animations.join(", ")}`);
  const timeline = props.animation ? artboard.animationByName(props.animation) : artboard.animationByIndex(0);
  return { artboard, animation: new rive.LinearAnimationInstance(timeline, artboard), machine: null, frame: -1 };
}

// Moves the player forward one frame at a time until it shows `target`.
// Timeline animations could jump straight there, but stepping keeps one code path for both kinds.
function stepTo(player: Player, target: number, fps: number, inputs: Map<number, RiveInput[]>, triggerType: number) {
  while (player.frame < target) {
    player.frame += 1;
    const seconds = player.frame === 0 ? 0 : 1 / fps;
    if (player.animation) {
      player.animation.advance(seconds);
      player.animation.apply(1);
    }
    if (player.machine) {
      setInputs(player.machine, inputs.get(player.frame) ?? [], triggerType);
      player.machine.advanceAndApply(seconds);
    }
    player.artboard.advance(seconds);
  }
}

// Input changes grouped by the frame they happen at, so each step looks its frame up instead of searching.
function inputsByFrame(inputs: RiveInput[]): Map<number, RiveInput[]> {
  const byFrame = new Map<number, RiveInput[]>();
  for (const input of inputs) byFrame.set(input.frame, [...(byFrame.get(input.frame) ?? []), input]);
  return byFrame;
}

function setInputs(machine: StateMachineInstance, changes: RiveInput[], triggerType: number) {
  if (changes.length === 0) return;
  // Each input by name, so a change can find its input without searching.
  const byName = new Map<string, SMIInput>(Array.from({ length: machine.inputCount() }, (_, index) => [machine.input(index).name, machine.input(index)]));
  changes.forEach((change) => {
    const input = byName.get(change.name);
    if (!input) throw new Error(`RiveFrame: the state machine has no input "${change.name}"; it has ${[...byName.keys()].join(", ") || "none"}`);
    if (input.type === triggerType && change.value === true) input.asTrigger().fire();
    else input.value = change.value;
  });
}

function deletePlayer(player: Player | null) {
  player?.animation?.delete();
  player?.machine?.delete();
  player?.artboard.delete();
}
