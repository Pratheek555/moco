// Render benchmark: renders one SceneSpec N times at preview and/or final settings and records timings.
//   pnpm --filter @moco/renderer bench:render --spec <scene.json> --name baseline [--quality both] [--runs 3]
//     [--concurrency 6] [--gl angle] [--off atmosphere,grain,vignette,grade,parallax,idle,lipsync] [--date 2026-10-30]
//   Other compositions (e.g. the Rive spike): --entry spikes/rive/index.tsx --public-dir spikes/rive/public
//     --composition RiveFrame --spec <props.json>; the props file is passed as-is, not parsed as a SceneSpec.
// Results are merged into docs/benchmarks/render-<date>.json and the .md table is regenerated from it.
//   --report --date <date> only rewrites the .md from the JSON and notes (after editing notes-<date>.md).
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, type SlowFrame } from "@remotion/renderer";
import { VERSION } from "remotion";
import { KIT_ASSETS_DIR } from "@moco/kit/assets";
import { SceneSpec } from "@moco/spec";
import { applyOff } from "./variants.ts";

const QUALITY = {
  preview: { scale: 0.5, imageFormat: "jpeg" as const },
  final: { scale: 1, imageFormat: "jpeg" as const },
};
type Quality = keyof typeof QUALITY;

const { values } = parseArgs({
  options: {
    spec: { type: "string" },
    name: { type: "string" },
    quality: { type: "string", default: "both" },
    runs: { type: "string", default: "3" },
    concurrency: { type: "string" },
    gl: { type: "string" },
    off: { type: "string", default: "" },
    date: { type: "string", default: new Date().toLocaleDateString("en-CA") }, // local date, YYYY-MM-DD
    composition: { type: "string", default: "Scene" },
    entry: { type: "string", default: "src/remotion/index.ts" }, // relative to packages/renderer
    "public-dir": { type: "string" }, // relative to packages/renderer; default: the kit's assets
    report: { type: "boolean", default: false },
  },
});
const repoRoot = new URL("../../../", import.meta.url).pathname;
const jsonPath = join(repoRoot, `docs/benchmarks/render-${values.date}.json`);
if (values.report) {
  writeFileSync(jsonPath.replace(/\.json$/, ".md"), markdown(JSON.parse(readFileSync(jsonPath, "utf8"))));
  process.exit(0);
}
if (!values.spec || !values.name) throw new Error("--spec and --name are required");

// Accept a bare SceneSpec or a stored { meta, data } envelope; parsing fills defaults, as the engine's store does.
const raw = JSON.parse(readFileSync(values.spec, "utf8")) as { data?: unknown };
const inputProps = values.composition === "Scene" ? { scene: applyOff(SceneSpec.parse(raw.data ?? raw), values.off.split(",").filter(Boolean)) } : (raw as Record<string, unknown>);
const qualities: Quality[] = values.quality === "both" ? ["preview", "final"] : [values.quality as Quality];
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a whole number of 1 or more");
const concurrency = values.concurrency ? Number(values.concurrency) : null;
type Gl = NonNullable<Parameters<typeof renderMedia>[0]["chromiumOptions"]>["gl"];
const gl: Gl | null = (values.gl ?? null) as Gl | null; // null = Chrome's default (Remotion 4 default)

const packageRoot = new URL("../", import.meta.url).pathname;
const serveUrl = await bundle({
  entryPoint: join(packageRoot, values.entry),
  publicDir: values["public-dir"] ? join(packageRoot, values["public-dir"]) : KIT_ASSETS_DIR,
});
const composition = await selectComposition({ serveUrl, id: values.composition, inputProps });

interface Result {
  variant: string;
  off: string[];
  quality: Quality;
  runsMs: number[];
  medianMs: number;
  frames: number;
  secondsPerFrame: number;
  reel45sSeconds: number; // extrapolated: 45 s × 30 fps × secondsPerFrame
  resolution: string;
  fps: number;
  codec: string;
  imageFormat: string;
  concurrency: number | null;
  gl: Gl | null;
  slowestFrames: SlowFrame[];
}

const results: Result[] = [];
for (const quality of qualities) {
  const settings = QUALITY[quality];
  const runsMs: number[] = [];
  let slowest: SlowFrame[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    const output = await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: join(tmpdir(), `moco-bench-${values.name}-${quality}.mp4`),
      inputProps,
      concurrency,
      chromiumOptions: { gl },
      ...settings,
    });
    runsMs.push(performance.now() - started);
    slowest = output.slowestFrames.slice(0, 10);
  }
  const medianMs = median(runsMs);
  const secondsPerFrame = medianMs / 1000 / composition.durationInFrames;
  results.push({
    variant: values.name,
    off: values.off.split(",").filter(Boolean),
    quality,
    runsMs: runsMs.map(Math.round),
    medianMs: Math.round(medianMs),
    frames: composition.durationInFrames,
    secondsPerFrame: round(secondsPerFrame, 4),
    reel45sSeconds: round(45 * composition.fps * secondsPerFrame, 1),
    resolution: `${Math.round(composition.width * settings.scale)}x${Math.round(composition.height * settings.scale)}`,
    fps: composition.fps,
    codec: "h264",
    imageFormat: settings.imageFormat,
    concurrency,
    gl,
    slowestFrames: slowest,
  });
  console.log(`${values.name} ${quality}: median ${Math.round(medianMs)} ms (${runsMs.map(Math.round).join(", ")})`);
}

// ---------- write results ----------

const existing = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) : { date: values.date, machine: machineInfo(), results: [] };
// A re-run of the same variant + quality replaces the old row.
const kept = (existing.results as Result[]).filter((row) => !results.some((fresh) => fresh.variant === row.variant && fresh.quality === row.quality));
existing.results = [...kept, ...results];
writeFileSync(jsonPath, JSON.stringify(existing, null, 2) + "\n");
writeFileSync(jsonPath.replace(/\.json$/, ".md"), markdown(existing));
console.log(`wrote ${jsonPath}`);

function machineInfo() {
  return {
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    ramGb: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()}${platform() === "darwin" ? ` (macOS ${execSync("sw_vers -productVersion").toString().trim()})` : ""}`,
    gpu: platform() === "darwin" ? execSync("system_profiler SPDisplaysDataType | grep 'Chipset Model' | head -1").toString().trim() : "unknown",
    remotion: VERSION,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

// The table part of the report; prose sections in the .md are kept in docs/benchmarks/notes-<date>.md.
function markdown(report: { date: string; machine: ReturnType<typeof machineInfo>; results: Result[] }): string {
  const baseline = (quality: Quality) => report.results.find((row) => row.variant === "baseline" && row.quality === quality);
  const rows = report.results.map((row) => {
    const base = baseline(row.quality);
    const vsBase = base ? `${Math.round((row.secondsPerFrame / base.secondsPerFrame - 1) * 100)}%` : "–";
    const slow = row.slowestFrames.slice(0, 3).map((frame) => `${frame.frame} (${Math.round(frame.time)} ms)`).join(", ");
    return `| ${row.variant} | ${row.quality} | ${row.resolution} | ${row.frames} | ${row.medianMs} | ${row.secondsPerFrame} | ${row.reel45sSeconds} | ${vsBase} | ${row.concurrency ?? "default"} | ${row.gl ?? "default"} | ${slow} |`;
  });
  const notesPath = join(repoRoot, `docs/benchmarks/notes-${report.date}.md`);
  const notes = existsSync(notesPath) ? readFileSync(notesPath, "utf8") : "";
  return [
    `# Render benchmark ${report.date}`,
    "",
    `Machine: ${report.machine.cpu}, ${report.machine.cores} cores, ${report.machine.ramGb} GB RAM, ${report.machine.os}, ${report.machine.gpu}. Remotion ${report.machine.remotion}.`,
    "Median of the runs listed in the JSON. H.264, JPEG frames. Preview = scale 0.5. `45 s reel` is extrapolated from seconds per frame.",
    "",
    "| variant | quality | resolution | frames | median ms | s/frame | 45 s reel (s) | vs baseline | concurrency | gl | slowest frames |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    notes,
  ].join("\n");
}
