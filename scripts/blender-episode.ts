// A real Moco production: subscription AI → approved story → OS narration → Blender → final MP4.
// Auto-approves gates for this CLI demo; the desktop keeps normal user review.
import { join, resolve } from "node:path";
import { aiBackend } from "@moco/ai";
import { systemAudio } from "@moco/audio";
import { createEngine } from "@moco/engine";
import { createMocoRenderPort } from "@moco/renderer/backend";
import { blenderStatus } from "@moco/renderer/blender";

const status = await blenderStatus();
if (!status.ok) throw new Error(status.reason);
const ai = aiBackend();
const available = await ai.available();
if (!available.ok) throw new Error(available.reason);
const projectsDir = resolve(process.argv[3] ?? "projects");
const idea = process.argv[2] || "A tiny teal robot called Pip finds the last golden seed on a dusty violet moon. In four cinematic 3D shots, Pip notices its glow, rolls closer and gently lifts it with a small arm, plants it in a crater, and watches a luminous golden sprout grow. A warm miniature sci-fi film with an uplifting ending. Only one recurring character. Rounded teal metal body, cream face panel, two dark eyes, copper antenna, two dark wheels and one articulated arm. Use the same design across all shots. A simple beautiful set with soft shadows, violet rocks and warm rim light. Purposeful character motion in every shot. English narrator, around 18 seconds, concise poetic narration and readable captions. Native Blender 3D animation, no 2D illustration.";
const render = createMocoRenderPort({ backend: "blender", blender: { samples: Number(process.env.MOCO_BLENDER_SAMPLES ?? 32) } });
const engine = createEngine({ projectsDir, ai, render, audio: systemAudio(), config: {
  voice: { voiceId: "default", backend: "system" },
  targetSeconds: { min: 16, max: 22 }, shotSeconds: { min: 2, max: 7 },
} });
engine.on("*", event => console.log(`[${event.type}] ${JSON.stringify(event.data).slice(0,500)}`));
try {
  const seriesId = process.env.MOCO_SERIES ?? await engine.createSeries({ idea, language: "en", episodes: 1 });
  console.log(`MOCO_SERIES=${seriesId}\nProject: ${join(projectsDir, seriesId)}`);
  if (process.env.MOCO_REPLAN_BIBLE === "1") {
    const job = await engine.waitForJob(await engine.runStage({ seriesId, key: "bible" }));
    if (job.status !== "succeeded") throw new Error(JSON.stringify(job.error));
  } else if ((await engine.status(seriesId)).next.kind === "finished") {
    const fresh = await engine.renderFreshness({ seriesId, episodeId: "ep-01" });
    if (!fresh.preview || !fresh.final) {
      console.log("Refreshing saved renders with the current Blender bridge.");
      const job = await engine.waitForJob(await engine.renderPreview({ seriesId, episodeId: "ep-01" }));
      if (job.status !== "succeeded") throw new Error(JSON.stringify(job.error));
    }
  }
  let finished = false;
  for (let round = 0; round < 24; round++) {
    const job = await engine.waitForJob(await engine.runStage({ seriesId }));
    if (job.status !== "succeeded") throw new Error(`Moco job ${job.status}: ${JSON.stringify(job.error)}`);
    const current = await engine.status(seriesId);
    if (current.next.kind === "finished") { finished = true; break; }
    if (current.next.kind === "waiting") {
      const stage = current.stages.find(stage => current.next.kind === "waiting" && stage.key === current.next.key);
      if (!stage?.artifactHash) throw new Error("Review gate has no artifact hash");
      console.log(`Auto-approving demo gate: ${stage.key}`);
      await engine.approve({ seriesId, key: stage.key }, stage.artifactHash);
    }
  }
  if (!finished) throw new Error("The episode did not finish; resume with MOCO_SERIES to continue");
  console.log(`Final video: ${join(projectsDir, seriesId, "episodes", "ep-01", "renders", "final.mp4")}`);
} finally { await render.close(); }
