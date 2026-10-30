// Frame-exactness check for the Rive spike: does frame N look the same however the renderer gets there?
//   pnpm --filter @moco/renderer spike:rive && cd packages/renderer && npx tsx spikes/rive/check-frames.ts
// Renders each case four ways and compares a hash of every frame against the first way:
//   in order on one tab (concurrency 1) · split over 8 tabs · as single stills (one jump from nothing) ·
//   backwards (the <name>Reversed composition, whose frame n shows frame last − n, so every frame seeks back)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderFrames, selectComposition } from "@remotion/renderer";

const here = new URL("./", import.meta.url).pathname;
const CASES = [
  { composition: "RiveFrame", props: "../../bench/scenes/rive-idle.json" },
  { composition: "RiveFrame", props: "../../bench/scenes/rive-motion.json" },
  { composition: "RiveStock", props: "../../bench/scenes/rive-idle.json" },
];
const SPOT_FRAMES = [0, 37, 90, 150, 241, 299];

const serveUrl = await bundle({ entryPoint: here + "index.tsx", publicDir: here + "public" });

for (const testCase of CASES) {
  const inputProps = JSON.parse(readFileSync(here + testCase.props, "utf8")) as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: testCase.composition, inputProps });
  const render = (options: { concurrency: number; frames?: number[] }) => hashes({ composition, serveUrl, inputProps, ...options });

  const inOrder = await render({ concurrency: 1 });
  const ways = {
    "8 tabs": await render({ concurrency: 8 }),
    "single stills": await singleStills(render),
    backwards: await reversed(testCase.composition + "Reversed", inputProps, composition.durationInFrames),
  };
  const report = Object.entries(ways).map(([way, frames]) => `${way}: ${differing(inOrder, frames).length} of ${frames.size} frames differ ${listed(differing(inOrder, frames))}`);
  console.log(`${testCase.composition} ${testCase.props.split("/").pop()}\n  ${report.join("\n  ")}`);
}

// Frame number → hash of its PNG, for whichever frames were asked for.
async function hashes(options: Omit<Parameters<typeof renderFrames>[0], "onStart" | "onFrameUpdate" | "outputDir">): Promise<Map<number, string>> {
  const byFrame = new Map<number, string>();
  await renderFrames({
    ...options,
    imageFormat: "png",
    outputDir: null,
    onStart: () => undefined,
    onFrameUpdate: () => undefined,
    onFrameBuffer: (buffer, frame) => {
      byFrame.set(frame, createHash("sha256").update(buffer).digest("hex"));
    },
  });
  return byFrame;
}

// Renders the reversed composition on one tab and maps its frame n back to the frame it shows (last − n).
async function reversed(id: string, inputProps: Record<string, unknown>, durationInFrames: number) {
  const composition = await selectComposition({ serveUrl, id, inputProps });
  const shown = await hashes({ composition, serveUrl, inputProps, concurrency: 1 });
  return new Map([...shown].map(([frame, hash]) => [durationInFrames - 1 - frame, hash]));
}

// Each spot frame in its own render, so every one starts from a freshly loaded page.
async function singleStills(render: (options: { concurrency: number; frames: number[] }) => Promise<Map<number, string>>) {
  const stills = await Promise.all(SPOT_FRAMES.map((frame) => render({ concurrency: 1, frames: [frame] })));
  return new Map(stills.flatMap((still) => [...still]));
}

function differing(reference: Map<number, string>, frames: Map<number, string>): number[] {
  return [...frames].filter(([frame, hash]) => reference.get(frame) !== hash).map(([frame]) => frame);
}

function listed(frames: number[]): string {
  return frames.length === 0 ? "" : `(${frames.slice(0, 8).join(", ")}${frames.length > 8 ? ", …" : ""})`;
}
