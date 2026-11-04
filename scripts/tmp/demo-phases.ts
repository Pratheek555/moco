// One-off demo of v2 phases 4 and 5 on a real series: finish episode 1 (critic + retro write the playbook), extend the
// series with an episode that needs someone new (the canon grows), make episode 2 with the lessons, then print the
// evidence. Uses your app settings and Claude plan, like `pnpm bench run`.
//   npx tsx scripts/tmp/demo-phases.ts <projectsDir> <seriesId> "<episode 2 direction>"
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeCli } from "@moco/ai";
import { chatterboxAudio } from "@moco/audio/chatterbox";
import { createEngine, type Engine } from "@moco/engine";
import { createRemotionRenderPort } from "@moco/renderer";

const [projectsDir, seriesId, direction] = process.argv.slice(2) as [string, string, string];
const userData = join(process.env.APPDATA ?? join(homedir(), ".config"), "Moco");
const settings = JSON.parse(readFileSync(join(userData, "settings.json"), "utf8"));
const audio = chatterboxAudio({ rate: settings.voice.rate, python: join(userData, "voice/runtime/Scripts/python.exe"), worker: join(process.cwd(), "packages/audio/python/narrate.py"), modelDir: join(userData, "voice/models/english"), expressiveness: settings.voice.expressiveness ?? 0.65 });
const render = createRemotionRenderPort({});
const engine = createEngine({ projectsDir, ai: claudeCli(), render, audio, config: { voice: { voiceId: "narrator", backend: "chatterbox" } } });
engine.on("*", (event) => {
  if (/stage\.(done|approved|failed)|look\.|learn\.|canon\.|shot\.fallback|job\.finished/.test(event.type)) console.log(new Date().toISOString().slice(11, 19), `[${event.type}]`, JSON.stringify(event.data).slice(0, 220));
});

async function runToEnd(engine: Engine) {
  for (let round = 0; round < 24; round += 1) {
    const job = await engine.waitForJob(await engine.runStage({ seriesId }));
    if (job.status !== "succeeded") throw new Error(`job ${job.status}: ${JSON.stringify(job.error)}`);
    const status = await engine.status(seriesId);
    if (status.next.kind === "finished") return;
    if (status.next.kind !== "waiting") continue;
    const stage = status.stages.find((candidate) => candidate.key === (status.next as { key: string }).key)!;
    console.log(`approving ${stage.key}`);
    await engine.approve({ seriesId, key: stage.key }, stage.artifactHash!);
  }
}

const dir = join(projectsDir, seriesId);
const read = (file: string) => (existsSync(join(dir, file)) ? JSON.parse(readFileSync(join(dir, file), "utf8")).data : undefined);

// DEMO_EXTEND=1 adds one more episode to a finished series (how episode 3 was made).
const status = await engine.status(seriesId);
if (status.series.episodes < 2 || process.env.DEMO_EXTEND === "1") {
  await runToEnd(engine); // finish what's there
  console.log(`=== extending with episode ${status.series.episodes + 1}`);
  const job = await engine.waitForJob(await engine.extendSeries(seriesId, { episodes: 1, note: direction }));
  if (job.status !== "succeeded") throw new Error(`extend ${job.status}: ${JSON.stringify(job.error)}`);
}
await runToEnd(engine); // the extended plan's gate, then episode 2
await render.close();

// The evidence: what the critic scored in each episode, what the series learned, and what the canon grew by.
for (const episodeId of (await engine.status(seriesId)).stages.filter((stage) => stage.key.endsWith("/script")).map((stage) => stage.key.split("/")[0]!)) {
  const critique = read(`episodes/${episodeId}/artifacts/critique.json`);
  if (critique) {
    const scores = critique.shots.map((shot: { score: number }) => shot.score);
    console.log(`${episodeId} first-pass scores: ${scores.join(" ")} (mean ${(scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(2)}); repairs: ${JSON.stringify(critique.shots.filter((shot: { repaired?: unknown }) => shot.repaired).map((shot: { shotId: string; score: number; repaired: unknown }) => ({ shot: shot.shotId, from: shot.score, ...(shot.repaired as object) })))}`);
  }
  const video = join(dir, "episodes", episodeId, "renders/final.mp4");
  if (existsSync(video)) {
    await mkdir(join(dir, "benchmark"), { recursive: true });
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" }));
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=12/${seconds.toFixed(3)},scale=270:480,tile=6x2`, "-frames:v", "1", "-q:v", "3", join(dir, "benchmark", `sheet-${episodeId}.jpg`)]);
    console.log(`${episodeId} video: ${video} (${seconds.toFixed(1)} s)`);
  }
}
console.log("playbook:", JSON.stringify(read("artifacts/playbook.json"), null, 2));
for (const episodeId of ["ep-02", "ep-03"]) {
  const addition = read(`artifacts/canon/${episodeId}.json`);
  console.log(`canon added by ${episodeId}:`, addition ? JSON.stringify({ reason: addition.reason, cast: addition.cast.map((member: { id: string }) => member.id), places: addition.places.map((place: { id: string }) => place.id), models: addition.world.models.map((model: { id: string }) => model.id) }) : "nothing");
}
console.log("DONE");
