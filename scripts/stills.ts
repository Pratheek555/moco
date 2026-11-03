// Renders one still per shot of an episode, plus a contact sheet, with the renderer as it is now.
// For comparing looks before and after a renderer change on the same specs (no AI involved).
//   pnpm stills <series dir> <out dir> [episode=ep-01] [at=0.5]
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SceneSpec } from "@moco/spec";
import { createRemotionRenderPort } from "@moco/renderer";

const [seriesDir, outDir, episode = "ep-01", at = "0.5"] = process.argv.slice(2);
if (!seriesDir || !outDir) throw new Error("usage: pnpm stills <series dir> <out dir> [episode] [at 0..1]");

const shotsDir = join(seriesDir, "episodes", episode, "shots");
const shots = (await readdir(shotsDir)).filter((name) => /^s\d+$/.test(name)).sort();
const render = createRemotionRenderPort();
const stills: string[] = [];
try {
  for (const shot of shots) {
    const spec = (JSON.parse(await readFile(join(shotsDir, shot, "spec.json"), "utf8")) as { data: SceneSpec }).data;
    const frame = Math.min(spec.durationFrames - 1, Math.round(spec.durationFrames * Number(at)));
    const result = await render.check(spec, { frames: [frame], outDir: join(outDir, shot) });
    if (!result.ok) console.warn(`${shot}: ${result.errors.map((error) => error.message).join("; ")}`);
    stills.push(join(outDir, shot, `${frame}.png`));
    console.log(`${shot} frame ${frame}`);
  }
} finally {
  await render.close();
}

// Contact sheet: 7 across, each still at 180 px wide.
const columns = 7;
const inputs = stills.flatMap((file) => ["-i", file]);
const scaled = stills.map((_, index) => `[${index}]scale=180:-1[s${index}]`).join(";");
const layout = stills.map((_, index) => `${(index % columns) * 180}_${Math.floor(index / columns) * 320}`).join("|");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...inputs, "-filter_complex", `${scaled};${stills.map((_, index) => `[s${index}]`).join("")}xstack=inputs=${stills.length}:layout=${layout}:fill=black`, join(outDir, "sheet.png")]);
console.log(`sheet: ${join(outDir, "sheet.png")}`);
