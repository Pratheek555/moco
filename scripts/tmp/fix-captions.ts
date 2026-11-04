// One-off: regenerate shots whose captions were written before the markup check, then re-render the episode.
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { aiBackend } from "@moco/ai";
import { chatterboxAudio } from "@moco/audio/chatterbox";
import { createEngine } from "@moco/engine";
import { createRemotionRenderPort } from "@moco/renderer";
const [projectsDir, seriesId, ...shots] = process.argv.slice(2);
const userData = join(process.env.APPDATA ?? join(homedir(), ".config"), "Moco");
const settings = JSON.parse(readFileSync(join(userData, "settings.json"), "utf8"));
const audio = chatterboxAudio({ rate: settings.voice.rate, python: join(userData, "voice/runtime/Scripts/python.exe"), worker: join(process.cwd(), "packages/audio/python/narrate.py"), modelDir: join(userData, "voice/models/english"), expressiveness: settings.voice.expressiveness ?? 0.65 });
const render = createRemotionRenderPort({});
const engine = createEngine({ projectsDir: projectsDir!, ai: aiBackend(), render, audio, config: { voice: { voiceId: "narrator", backend: "chatterbox" } } });
engine.on("*", (e) => { if (/shot\.|stage\.(done|failed|approved)|job\.finished/.test(e.type)) console.log(e.type, JSON.stringify(e.data).slice(0, 140)); });
const feedback = "Captions are burned into the video exactly as typed. Remove the ** markers; stress a word with emphasis: true instead.";
for (const shotId of shots) {
  const job = await engine.waitForJob(await engine.regenerateShot({ seriesId: seriesId!, episodeId: "ep-01", shotId }, feedback));
  console.log(shotId, job.status, JSON.stringify(job.error ?? ""));
}
for (let round = 0; round < 6; round += 1) {
  const job = await engine.waitForJob(await engine.runStage({ seriesId: seriesId! }));
  if (job.status !== "succeeded") throw new Error(JSON.stringify(job.error));
  const status = await engine.status(seriesId!);
  if (status.next.kind === "finished") break;
  if (status.next.kind !== "waiting") continue;
  const stage = status.stages.find((s) => s.key === (status.next as { key: string }).key)!;
  console.log("approving", stage.key);
  await engine.approve({ seriesId: seriesId!, key: stage.key }, stage.artifactHash!);
}
await render.close();
console.log("DONE");
