// Rive spike entry: its own Remotion root, bundled separately from src/remotion so Rive never reaches the main bundle.
//   RiveFrame  – the frame-exact player in RiveFrame.tsx
//   RiveStock  – @remotion/rive's <RemotionRiveCanvas>, for comparison
//   SvgRig     – the kit's layered SVG Krishna alone on the same stage, so the costs compare like for like
//   RiveFrameReversed / RiveStockReversed – the same players fed the frames last to first, so every frame is a
//     backward seek (check-frames.ts; Remotion sorts explicit frame lists, so it can't render backwards itself)
// Props are RiveProps (see RiveFrame.tsx). The bundle's public dir must hold the .riv file and rive.wasm
// (bench/render.ts --entry spikes/rive/index.tsx --public-dir … does this; see docs/adr/rive-vs-svg-rig.md).
import { AbsoluteFill, Composition, Freeze, registerRoot, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { RemotionRiveCanvas } from "@remotion/rive";
import { registry, rigStateAt } from "@moco/kit/components";
import { RiveFrame, type RiveProps } from "./RiveFrame.tsx";

const defaults: RiveProps = { src: "centaur.riv" };
const video = { fps: 30, width: 1080, height: 1920, durationInFrames: 300 };

function Stage({ children }: { children: React.ReactNode }) {
  return <AbsoluteFill style={{ backgroundColor: "#20242c" }}>{children}</AbsoluteFill>;
}

function FrameExact(props: RiveProps) {
  return <Stage><RiveFrame {...props} /></Stage>;
}

function Stock(props: RiveProps) {
  return <Stage><RemotionRiveCanvas src={staticFile(props.src)} artboard={props.artboard} animation={props.animation} enableRiveAssetCdn={false} /></Stage>;
}

// Shows frame (last − n) at frame n.
function Reversed({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <Freeze frame={durationInFrames - 1 - frame}>{children}</Freeze>;
}
const FrameExactReversed = (props: RiveProps) => <Reversed><FrameExact {...props} /></Reversed>;
const StockReversed = (props: RiveProps) => <Reversed><Stock {...props} /></Reversed>;

type SvgRigProps = { actor: Parameters<typeof rigStateAt>[0] };
function SvgRig({ actor }: SvgRigProps) {
  const frame = useCurrentFrame();
  const krishna = registry.characters.find((character) => character.id === "krishna")!;
  return (
    <Stage>
      <svg viewBox="0 0 400 800" style={{ position: "absolute", left: 140, top: 160, width: 800, height: 1600 }} overflow="visible">
        <krishna.Component rig={rigStateAt(actor, frame, { seed: "krishna", idle: krishna.idle })} variant={krishna.variants[0] ?? "default"} />
      </svg>
    </Stage>
  );
}

function Root() {
  return (
    <>
      <Composition id="RiveFrame" component={FrameExact} defaultProps={defaults} {...video} />
      <Composition id="RiveStock" component={Stock} defaultProps={defaults} {...video} />
      <Composition id="RiveFrameReversed" component={FrameExactReversed} defaultProps={defaults} {...video} />
      <Composition id="RiveStockReversed" component={StockReversed} defaultProps={defaults} {...video} />
      <Composition id="SvgRig" component={SvgRig} defaultProps={{ actor: { actions: [], expression: [] } } as SvgRigProps} {...video} />
    </>
  );
}

registerRoot(Root);
