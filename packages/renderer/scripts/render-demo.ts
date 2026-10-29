import {
  ensureBrowser,
  selectComposition,
  renderMedia,
} from "@remotion/renderer";
import { DEMO_EPISODE } from "@moco/spec";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serveUrl = path.join(root, "build");
const inputProps = { episode: DEMO_EPISODE };
const output = path.resolve(
  process.argv[2] || path.join(root, "out", "demo.mp4"),
);
await ensureBrowser();
const composition = await selectComposition({
  serveUrl,
  id: "Episode",
  inputProps,
});
await renderMedia({
  composition,
  serveUrl,
  inputProps,
  outputLocation: output,
  codec: "h264",
  scale: 0.5,
  concurrency: 2,
  overwrite: true,
});
console.log(`Demo rendered to ${output}`);
