// Benchmark: generate one episode the way the desktop app does, record how it went, and compare two runs blind.
// Uses your Claude plan's quota and your app settings (voice from %APPDATA%/Moco/settings.json).
//   pnpm bench run "<idea>" <label> [projectsDir]     generate, auto-approving every gate; writes benchmark/run.json
//   pnpm bench sheet <seriesDir>                      contact sheet of the final video (benchmark/sheet.jpg)
//   pnpm bench judge <seriesDirA> <seriesDirB>        blind side-by-side scoring on a fixed rubric (both orders)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { claudeCli } from "@moco/ai";
import { chatterboxAudio } from "@moco/audio/chatterbox";
import { createEngine } from "@moco/engine";
import { createRemotionRenderPort } from "@moco/renderer";

const userData = join(process.env.APPDATA ?? join(homedir(), ".config"), "Moco");
const root = resolve(import.meta.dirname, "..");
const [command, ...args] = process.argv.slice(2);

// ---------- run ----------

async function run(idea: string, label: string, projectsDir: string) {
  const settings = JSON.parse(await readFile(join(userData, "settings.json"), "utf8")) as { voice: { rate?: number; reference?: string; expressiveness?: number; characterVoices?: { id: string; reference: string }[] } };
  const python = join(userData, "voice", "runtime", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const audio = chatterboxAudio({
    rate: settings.voice.rate, reference: settings.voice.reference || undefined, python,
    voices: Object.fromEntries((settings.voice.characterVoices ?? []).map(({ id, reference }: { id: string; reference: string }) => [id, reference])),
    worker: join(root, "packages/audio/python/narrate.py"), modelDir: join(userData, "voice", "models", "english"),
    expressiveness: settings.voice.expressiveness ?? 0.65,
  });
  const render = createRemotionRenderPort({});
  const engine = createEngine({ projectsDir, stylesDir: join(root, "styles"), ai: claudeCli(), render, audio, config: { voice: { voiceId: "narrator", backend: "chatterbox" } } });
  const counts: Record<string, number> = {};
  engine.on("*", (event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    console.log(new Date().toISOString().slice(11, 19), `[${event.type}]`, JSON.stringify(event.data).slice(0, 160));
  });

  const startedAt = new Date();
  const seriesId = process.env.MOCO_SERIES ?? (await engine.createSeries({ idea, language: "en", episodes: 1 }));
  console.log(`series: ${join(projectsDir, seriesId)}`);
  const stages: { key: string; approvedAt: string }[] = [];
  for (let round = 0; round < 16; round += 1) {
    const job = await engine.waitForJob(await engine.runStage({ seriesId }));
    if (job.status !== "succeeded") throw new Error(`job ${job.status}: ${JSON.stringify(job.error)}`);
    const status = await engine.status(seriesId);
    if (status.next.kind === "finished") break;
    if (status.next.kind !== "waiting") continue;
    const stage = status.stages.find((candidate) => candidate.key === (status.next as { key: string }).key)!;
    console.log(`auto-approving ${stage.key}`);
    stages.push({ key: stage.key, approvedAt: new Date().toISOString() });
    await engine.approve({ seriesId, key: stage.key }, stage.artifactHash!);
  }
  await render.close();

  const dir = join(projectsDir, seriesId);
  const status = await engine.status(seriesId);
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
  const finishedAt = new Date();
  const record = {
    label, idea, commit, dirty, seriesId,
    startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
    minutes: Math.round((finishedAt.getTime() - startedAt.getTime()) / 6000) / 10,
    stages, events: counts, usage: status.usage, decisions: status.decisions,
    video: join(dir, "episodes/ep-01/renders/final.mp4"),
  };
  await mkdir(join(dir, "benchmark"), { recursive: true });
  await writeFile(join(dir, "benchmark/run.json"), JSON.stringify(record, null, 2));
  await sheet(dir);
  console.log(`done in ${record.minutes} min: ${record.video}`);
}

// ---------- contact sheet ----------

const SHEET_FRAMES = 12;

async function sheet(dir: string): Promise<string> {
  const video = join(dir, "episodes/ep-01/renders/final.mp4");
  if (!existsSync(video)) throw new Error(`no final video at ${video}`);
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" }));
  const out = join(dir, "benchmark/sheet.jpg");
  await mkdir(join(dir, "benchmark"), { recursive: true });
  // Evenly spaced frames, 6 across, each 270×480 (a quarter of 1080×1920).
  const fps = `${SHEET_FRAMES}/${seconds.toFixed(3)}`;
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=${fps},scale=270:480,tile=6x2`, "-frames:v", "1", "-q:v", "3", out]);
  return out;
}

// ---------- blind judge ----------

const JUDGE_SYSTEM = `You judge animated vertical short videos (9:16 Instagram reels) for a studio comparing two versions of its pipeline.
You see two contact sheets, each 12 evenly spaced frames of one video (left to right, top to bottom), and each video's narration.
Score each video 1–10 on each criterion, judging only what you can see and read:
- character_appeal: characters read clearly, look designed and appealing, fit the story, and stay consistent across frames.
- world: places look like real, dressed locations with depth, not empty stages.
- cinematography: framing, variety of shot size and angle, subjects well placed in a 9:16 frame.
- storytelling: the frames and narration tell a clear, gripping story with a hook and a payoff.
- tone_fit: look, colour and words suit the subject.
- overall: would this hold a viewer on a reel feed.
Then name the better video overall and say why in two sentences. Be strict and specific.`;

async function judge(a: string, b: string) {
  const sides = await Promise.all([a, b].map(async (dir) => ({ dir, sheet: await sheet(dir), narration: await narration(dir) })));
  const criteria = ["character_appeal", "world", "cinematography", "storytelling", "tone_fit", "overall"] as const;
  const score = { type: "object", properties: Object.fromEntries(criteria.map((name) => [name, { type: "integer", minimum: 1, maximum: 10 }])), required: [...criteria] };
  const schema = { type: "object", properties: { video1: score, video2: score, better: { enum: ["video1", "video2"] }, why: { type: "string" } }, required: ["video1", "video2", "better", "why"] };
  const ai = claudeCli();
  // Both orders, so a preference for whichever comes first cancels out.
  const rounds: { order: string[]; scores: Record<string, Record<string, number>>; better: string; why: string }[] = [];
  for (const order of [[0, 1], [1, 0]] as const) {
    const [first, second] = order.map((index) => sides[index]!);
    const result = await ai.generate({
      system: JUDGE_SYSTEM,
      prompt: `The first image is video 1's contact sheet, the second is video 2's.\n\n## Video 1 narration\n${first!.narration}\n\n## Video 2 narration\n${second!.narration}`,
      images: [first!.sheet, second!.sheet], jsonSchema: schema, timeoutMs: 300_000,
    });
    const verdict = result.json as { video1: Record<string, number>; video2: Record<string, number>; better: string; why: string };
    const byDir = { [first!.dir]: verdict.video1, [second!.dir]: verdict.video2 };
    rounds.push({ order: order.map((index) => sides[index]!.dir), scores: byDir, better: verdict.better === "video1" ? first!.dir : second!.dir, why: verdict.why });
  }
  const average = (dir: string) => Object.fromEntries(criteria.map((name) => [name, rounds.reduce((total, round) => total + round.scores[dir]![name]!, 0) / rounds.length]));
  const report = { a: { dir: a, scores: average(a) }, b: { dir: b, scores: average(b) }, rounds };
  await writeFile(join(b, "benchmark/judge.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function narration(dir: string): Promise<string> {
  const script = JSON.parse(await readFile(join(dir, "episodes/ep-01/artifacts/script.json"), "utf8")) as { data?: { lines: { text: string }[] }; lines?: { text: string }[] };
  return (script.data ?? script).lines!.map((line) => line.text).join(" ");
}

// Dispatched last: the constants above must exist before any command runs.
if (command === "run") await run(args[0]!, args[1]!, args[2] ?? join(root, "projects"));
else if (command === "sheet") await sheet(resolve(args[0]!));
else if (command === "judge") await judge(resolve(args[0]!), resolve(args[1]!));
else throw new Error("usage: bench run <idea> <label> [projectsDir] | bench sheet <seriesDir> | bench judge <a> <b>");
