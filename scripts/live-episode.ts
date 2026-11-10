// Live end-to-end run: the user's configured AI backend + real Remotion + placeholder (silent) voiceover,
// or Supertonic if MOCO_SUPERTONIC_DIR points at its model folder (MOCO_SUPERTONIC_VOICE picks a preset, default M1).
// Auto-approves every gate. Uses the selected provider's quota (roughly 20–40 calls for one episode).
//   pnpm live "Krishna explains duty to Arjuna on the battlefield" [projectsDir]
//   MOCO_SERIES=<series-id> pnpm live "" [projectsDir]   (resume)
import { join } from "node:path";
import { aiBackend } from "@moco/ai";
import { placeholderAudio } from "@moco/audio";
import { supertonicAudio } from "@moco/audio/supertonic";
import { createEngine } from "@moco/engine";
import { createMocoRenderPort } from "@moco/renderer/backend";

const idea = process.argv[2] ?? "Krishna calms Arjuna before the battle of Kurukshetra";
const projectsDir = process.argv[3] ?? join(process.cwd(), "projects");

// MOCO_RENDER_CONCURRENCY=1 renders one frame at a time (lowest memory).
const concurrency = process.env.MOCO_RENDER_CONCURRENCY ? Number(process.env.MOCO_RENDER_CONCURRENCY) : undefined;
const render = createMocoRenderPort({ backend: process.env.MOCO_RENDER_BACKEND === "blender" ? "blender" : "remotion", remotion: { concurrency } });
const modelDir = process.env.MOCO_SUPERTONIC_DIR;
const audio = modelDir ? supertonicAudio({ modelDir, voice: process.env.MOCO_SUPERTONIC_VOICE, speed: 0.92 }) : placeholderAudio(); // 0.92 ≈ the engine's 150 wpm budget
const engine = createEngine({ projectsDir, ai: aiBackend(), render, audio });
engine.on("*", (event) => console.log(`[${event.type}]`, JSON.stringify(event.data).slice(0, 160)));

// MOCO_SERIES=<id> resumes an existing series (up-to-date shots are reused) instead of starting a new one.
const seriesId = process.env.MOCO_SERIES ?? (await engine.createSeries({ idea, language: "en", episodes: 1 }));
console.log(`series: ${join(projectsDir, seriesId)}`);

// Run → approve whatever is waiting → run again, until the episode is finished.
for (let round = 0; round < 12; round += 1) {
  const job = await engine.waitForJob(await engine.runStage({ seriesId }));
  if (job.status !== "succeeded") throw new Error(`job ${job.status}: ${JSON.stringify(job.error)}`);
  const status = await engine.status(seriesId);
  if (status.next.kind === "finished") break;
  if (status.next.kind !== "waiting") continue;
  const stage = status.stages.find((candidate) => candidate.key === (status.next as { key: string }).key)!;
  console.log(`auto-approving ${stage.key}`);
  await engine.approve({ seriesId, key: stage.key }, stage.artifactHash!);
}

const status = await engine.status(seriesId);
console.log("usage:", status.usage, "decisions:", status.decisions);
console.log(`final video: ${join(projectsDir, seriesId, "episodes/ep-01/renders/final.mp4")}`);
await render.close();
