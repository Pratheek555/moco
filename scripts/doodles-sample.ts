// Live Codex planning/drawing through the normal engine, using the built-in Doodles template.
// No fixture artwork or scene edits. Offline SAPI narration supplies measured line / estimated word timings.
// Usage: pnpm exec tsx scripts/doodles-sample.ts <output-root> [attempt-name]
// MOCO_SERIES resumes an interrupted series in the same attempt directory.
// MOCO_IDEA_FILE and MOCO_TARGET_SECONDS override the default eight-second water-clock brief.
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { codexCli } from "@moco/ai";
import { systemAudio } from "@moco/audio";
import { createEngine, defaultConfig, findTemplate } from "@moco/engine";
import { createRemotionRenderPort } from "@moco/renderer";

const outputRoot = resolve(process.argv[2] ?? "C:/Users/prath/AppData/Local/Temp/claude/3fd6186c8caca1fe/e78eb94b-2564-4524-87ab-c2cf7fdca0df/scratchpad/doodles-sample");
const attempt = process.argv[3] ?? "attempt-1";
if (!/^[a-z0-9-]+$/.test(attempt)) throw Error("Use a simple attempt directory name");
const projectsDir = join(outputRoot, attempt);
const targetSeconds = Number(process.env.MOCO_TARGET_SECONDS ?? 8);
if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) throw Error("MOCO_TARGET_SECONDS must be positive");
const idea = process.env.MOCO_IDEA_FILE ? await readFile(resolve(process.env.MOCO_IDEA_FILE), "utf8") : `Make one ORIGINAL 8-second English mini-explainer: a fictional museum keeper demonstrates a water clock, where accumulating drips mark passing time. No dates, invented historical claims or borrowed characters. The keeper and the dry visual joke are fictional; the simple mechanism is real.
Use the Doodles template's style and vertical composition. Invent one pale, huge egg-headed doodle keeper with a distinctive costume, tiny dot eyes, thick slightly uneven black outlines and cel shadows. Give the workshop a bespoke painted, softly lit background with depth.
Choose your own concise narration and visual joke, about 18-22 spoken words in two short off-screen narration lines. Plan TWO shots, about four seconds each, with a hard cut or dissolve between a medium/wide demonstration and a closer deadpan reaction. Let the second shot contain the same recognisable keeper at a new framing.
The clip must visibly include a five-frame scale-overshoot pop entrance and a later one-frame whole-pose AND face swap with contrasting silhouettes, held long enough to read. The drips and collecting vessel should make the timekeeping mechanism legible. One or two sparse labels on intentional surfaces may arrive with the corresponding narration; avoid continuous subtitles and dashboard layouts. Keep text, faces and action inside the template's portrait safe areas.
Use only original procedural Canvas drawings in the artist workspace and the configured local system voice. No image-generation models, paid APIs, web research, downloads, new dependencies, music, stock art or SFX. Reuse shared character source, save manifests, inspect temporal previews and fix your own artwork before finishing. Choose the story, narration, shot timings and all drawings yourself.`;

await mkdir(projectsDir, { recursive: true });
await writeFile(join(outputRoot, "idea.txt"), idea + "\n");
await writeFile(join(projectsDir, "idea.txt"), idea + "\n");
await writeFile(join(projectsDir, "template-prompt.txt"), findTemplate("doodles")!.creativePrompt! + "\n");
await writeFile(join(outputRoot, "template-prompt.txt"), findTemplate("doodles")!.creativePrompt! + "\n");
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const environment = ["MOCO_SERIES", "MOCO_IDEA_FILE", "MOCO_TARGET_SECONDS"].filter(key => process.env[key]).map(key => `$env:${key}=${psQuote(process.env[key]!)}; `).join("");
const command = `${environment}pnpm exec tsx scripts/doodles-sample.ts ${psQuote(outputRoot)} ${psQuote(attempt)}`;
await writeFile(join(outputRoot, "command.txt"), `Working directory: ${process.cwd()}\n${command}\n`);
await writeFile(join(projectsDir, "command.txt"), command + "\n");
const config = defaultConfig(projectsDir);
config.wordsPerMinute.en = 150;
config.limits.aiConcurrency = 1;
config.limits.maxAiCallsPerEpisode = 24;
config.limits.aiTimeoutMs = 12 * 60_000;
config.voice = { voiceId: "default", backend: "system" };
const ai = codexCli();
const availability = await ai.available();
await writeFile(join(projectsDir, "backend.json"), JSON.stringify(availability, null, 2));
if (!availability.ok) throw Error(availability.reason);
console.log("LIVE BACKEND", availability);
const render = createRemotionRenderPort({ concurrency: 2 });
const engine = createEngine({ projectsDir, config, ai, audio: systemAudio(), render });
let lastProgress = -1;
engine.on("*", event => {
  if (event.type === "render.progress") {
    const progress = Math.floor(Number(event.data.progress) * 10);
    if (progress === lastProgress) return;
    lastProgress = progress;
  }
  console.log(new Date().toISOString(), `[${event.type}]`, JSON.stringify(event.data).slice(0, 900));
});
const run = (bin: string, args: string[]) => new Promise<string>((ok, fail) => {
  const child = spawn(bin, args, { windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  child.on("error", fail);
  child.on("exit", code => code === 0 ? ok(stdout) : fail(Error(`${bin} exited ${code}: ${stderr}`)));
});
let dir: string | undefined;
const started = Date.now();
try {
  // Inherit format/local-only defaults from the actual template; the sample only adds its duration target.
  const seriesId = process.env.MOCO_SERIES ?? await engine.createSeries({ idea, language: "en", template: "doodles", production: { ...findTemplate("doodles")!.production!, targetSeconds } });
  dir = join(projectsDir, seriesId);
  await writeFile(join(projectsDir, "latest-run.json"), JSON.stringify({ seriesId, dir, startedAt: new Date().toISOString(), idea, command }, null, 2));
  console.log("SERIES", seriesId, "DIRECTORY", dir);
  for (let round = 0; round < 30; round++) {
    const status = await engine.status(seriesId);
    if (status.next.kind === "finished") break;
    if (status.next.kind === "waiting") {
      const key = status.next.key;
      const stage = status.stages.find(s => s.key === key)!;
      console.log("Sample generation authorized by task: approving", key);
      await engine.approve({ seriesId, key }, stage.artifactHash!);
      continue;
    }
    const job = await engine.waitForJob(await engine.runStage({ seriesId }));
    if (job.status !== "succeeded") throw Error(JSON.stringify(job.error));
  }
  const status = await engine.status(seriesId);
  if (status.next.kind !== "finished") throw Error(`Run did not finish: ${JSON.stringify(status.next)}`);
  const artifact = JSON.parse(await readFile(join(dir, "episodes/ep-01/artifacts/render_report.json"), "utf8"));
  const mp4 = join(dir, artifact.data.file);
  const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", mp4]));
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const seconds = Number(video.duration ?? probe.format.duration);
  if (video.width !== 1080 || video.height !== 1920 || seconds < Math.max(1,targetSeconds-3) || seconds > targetSeconds+2) throw Error(`Sample dimensions/duration failed: ${JSON.stringify(video)}`);
  const final = join(outputRoot, "doodles.mp4");
  await copyFile(mp4, final);
  const stillsDir = join(outputRoot, "stills");
  await mkdir(stillsDir, { recursive: true });
  // Include entrance/reaction times as well as even coverage of the encoded result.
  const times = [0.067, 0.267, seconds * 0.2, seconds * 0.35, seconds * 0.48, seconds * 0.65, seconds * 0.82, seconds - 0.3];
  const stills: { file: string; seconds: number }[] = [];
  for (const [i, time] of times.entries()) {
    const file = join(stillsDir, `still-${i + 1}.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", time.toFixed(3), "-i", final, "-frames:v", "1", file]);
    stills.push({ file, seconds: time });
  }
  const scriptFile = join(dir, "episodes/ep-01/artifacts/script.json");
  await copyFile(scriptFile, join(outputRoot, "narration-script.json"));
  const script = JSON.parse(await readFile(scriptFile, "utf8"));
  await writeFile(join(outputRoot, "narration-script.txt"), script.data.lines.map((line: {text: string}) => line.text).join("\n") + "\n");
  const report = { seriesId, dir, attempt, command, backend: availability, manualSceneEdits: 0, secondsThisInvocation: (Date.now() - started) / 1000, usage: status.usage, decisions: status.decisions, render: artifact.data, probe, final, stills, voiceTiming: "Offline systemAudio/SAPI: measured line durations, estimated per-word timings; no external aligner" };
  await writeFile(join(projectsDir, "generation-report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(outputRoot, "generation-report.json"), JSON.stringify(report, null, 2));
  console.log("FINAL", final);
} catch (error) {
  await writeFile(join(projectsDir, "failure.json"), JSON.stringify({ dir, error: error instanceof Error ? error.stack : String(error) }, null, 2));
  throw error;
} finally {
  await render.close();
}
