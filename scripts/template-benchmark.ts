// Actual application pipeline: imported prompt -> planner -> local voice ->
// measured word alignment -> authored canvas -> independent review -> MP4.
// No fixture AI, hand-authored scene replacement, or paid generation endpoint.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { codexCli } from "@moco/ai";
import { alignedAudio } from "@moco/audio";
import { kokoroAudio } from "../packages/audio/src/kokoro.ts";
import { chatterboxAudio } from "../packages/audio/src/chatterbox.ts";
import { createEngine, defaultConfig } from "@moco/engine";
import { importPromptTemplate } from "../packages/engine/src/templates/import.ts";
import { createRemotionRenderPort } from "@moco/renderer";
import { Ledger } from "../packages/engine/src/store/ledger.ts";

const kind = process.argv[2] ?? "roblox";
if (!["roblox", "infographic"].includes(kind)) throw Error("Use roblox or infographic");
const root=resolve("artifacts/template-validation",kind), stylesDir=join(root,"styles");
await mkdir(root,{recursive:true});
const portrait=kind==="roblox", seconds=portrait?42:60;
const prompt=await readFile(resolve("examples/templates",portrait?"roblox-what-if.txt":"infographic-explainer.txt"),"utf8");
const template=await importPromptTemplate(stylesDir,{name:portrait?"2D Roblox what if":"Flat vector explainer",prompt,production:{mode:"artist",localOnly:true,format:{width:portrait?1080:1920,height:portrait?1920:1080,fps:60},targetSeconds:seconds}});
const idea=(portrait?"What if your mom owned Roblox?":"Why would Earth keep orbiting for eight minutes if the Sun vanished? A hypothetical explaining that gravitational changes travel at light speed, not instantly. Do not claim the Sun can actually vanish.") +
  "\nLocal benchmark override: use the configured local Kokoro voice only, without audio tags in spoken text. Draw all art procedurally in canvas, including the explainer's plates and character rig; no image model is available. Use bundled Lilita One or Montserrat fonts from availableFonts in the workspace brief. No paid providers, external downloads, stock music, SFX search or automatic uploading. Record these substitutions as partial capabilities. Keep every other achievable visual/story requirement. The topic and tool choices are already supplied; do not ask questions. Preserve the template's aspect ratio, shot cadence, staging and typography rules. For this automated benchmark the runner records and approves planning gates; ordinary app users review them themselves.";
const config=defaultConfig(root); config.wordsPerMinute.en=portrait?145:190;
config.limits.maxAiCallsPerEpisode=110; config.limits.aiConcurrency=1;
config.limits.aiTimeoutMs=15*60_000;
config.voice={voiceId:"default",backend:process.env.MOCO_LOCAL_VOICE==="chatterbox"?"chatterbox":"kokoro"};
const ai=codexCli(); const available=await ai.available();
if(!available.ok)throw Error(available.reason);
const localVoice=process.env.MOCO_LOCAL_VOICE==="chatterbox" ? chatterboxAudio({python:join(process.env.APPDATA!,"Moco/voice/runtime/Scripts/python.exe"),modelDir:join(process.env.APPDATA!,"Moco/voice/models/english"),device:"cpu",seed:42}) : kokoroAudio({python:resolve(".venv-learn/Scripts/python.exe"),modelDir:resolve(".models/kokoro")});
const audio=alignedAudio(localVoice,{python:resolve(".venv-learn/Scripts/python.exe")});
const render=createRemotionRenderPort({concurrency:2});
if(process.env.MOCO_SERIES && process.env.MOCO_ART_FEEDBACK) {
  const ledger=await Ledger.load(join(root,process.env.MOCO_SERIES));
  ledger.setStage("ep-01/scenes",{status:"pending",feedback:process.env.MOCO_ART_FEEDBACK});
  ledger.decide("feedback","ep-01/scenes",process.env.MOCO_ART_FEEDBACK);
  await ledger.save();
}
const engine=createEngine({projectsDir:root,stylesDir,config,ai,audio,render});
engine.on("*",event=>{if(event.type!=="render.progress") console.log(event.type,JSON.stringify(event.data).slice(0,900));});
const seriesId=process.env.MOCO_SERIES ?? await engine.createSeries({idea,language:"en",episodes:1,template:template.id});
await writeFile(join(root,"latest-run.json"),JSON.stringify({seriesId,dir:join(root,seriesId),template:(await engine.status(seriesId)).series.template,voiceBackend:config.voice.backend,startedAt:new Date().toISOString()},null,2));
console.log("SERIES",seriesId);
try {
  if(process.env.MOCO_SHOT) {
    const feedback=process.env.MOCO_SHOT_FEEDBACK;
    if(!feedback)throw Error("MOCO_SHOT_FEEDBACK is required for a targeted visual repair");
    const job=await engine.waitForJob(await engine.regenerateShot({seriesId,episodeId:"ep-01",shotId:process.env.MOCO_SHOT},feedback));
    if(job.status!=="succeeded")throw Error(JSON.stringify(job.error));
  }
  if(process.env.MOCO_REVIEW_ONLY) {
    const job=await engine.waitForJob(await engine.reviewEpisode({seriesId,episodeId:"ep-01"}));
    if(job.status!=="succeeded")throw Error(JSON.stringify(job.error));
  }
  if(process.env.MOCO_REFIT) {
    const job=await engine.waitForJob(await engine.runStage({seriesId,key:"ep-01/voiceover"}));
    if(job.status!=="succeeded")throw Error(JSON.stringify(job.error));
  }
  for(let n=0;n<35;n++) {
    const status=await engine.status(seriesId);
    if(status.next.kind==="finished")break;
    if(status.next.kind==="waiting" && status.next.status==="awaiting_approval") {
      const key=status.next.key;
      const stage=status.stages.find(s=>s.key===key)!;
      // Preserve the exact review material before approving in the benchmark.
      await writeFile(join(root,`gate-${status.next.key.replaceAll("/","-")}.json`),JSON.stringify(status,null,2));
      console.log("BENCHMARK APPROVAL",stage.key);
      await engine.approve({seriesId,key:stage.key},stage.artifactHash!); continue;
    }
    const job=await engine.waitForJob(await engine.runStage({seriesId}));
    if(job.status!=="succeeded")throw Error(JSON.stringify(job.error));
  }
  const status=await engine.status(seriesId);
  await writeFile(join(root,"result.json"),JSON.stringify(status,null,2));
  if(status.next.kind!=="finished")throw Error("Benchmark did not finish");
  console.log("FINAL",join(root,seriesId,"episodes/ep-01/renders/final.mp4"));
} finally { await render.close(); }
