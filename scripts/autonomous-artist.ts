// Real Codex -> normal moco planning, local speech/alignment, artist tools, review/repair and final render.
// No prewritten shot artwork or manual scene modifications. MOCO_SERIES resumes the same saved run.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { codexCli } from "@moco/ai";
import { alignedAudio } from "@moco/audio";
import { chatterboxAudio } from "../packages/audio/src/chatterbox.ts";
import { createEngine, defaultConfig } from "@moco/engine";
import { createRemotionRenderPort } from "@moco/renderer";

const projectsDir=resolve(process.argv[2] ?? "artifacts/autonomous-codex");
const idea = `Make one 15-second English explainer about the placebo effect. This is a visual-production benchmark, not a medical advice video.
Write the script and choose the shots yourself. A pill with no active medicine can still change how pain feels through expectation; make that idea understandable. Do not claim it cures disease or invent historical/statistical claims.
Use about 45-50 spoken words, entirely off-screen narration. Aim for four shots of 2-4 seconds, cut on a real word.
Art: 1920x1080, 60fps, flat outline-free vector illustration, muted slate teal, navy, warm beige, soft purple and salmon-pink skin. Big heads and dot eyes. Full illustrated places, purposeful character acting, consistent recurring viewer character. Camera drifts slowly with all text and scenery moving together.
Show a pharmacy with IT DOES NOTHING typed on its physical sign and an animated red X on the denial. Then illustrate expectation changing a pain signal on a physical teaching board. Reveal PLACEBO EFFECT typed on a hanging stage sign. End with a viewer-facing question on an actual sign while the same character reacts.
Use bold Arial text at a readable size; text must stay inside its physical surface. No burned-in subtitles, floating interface cards, emoji, outlines, logos, black edges, cropped faces or characters standing motionless.
Use only the artist workspace's procedural vector tools and the configured local voice. No paid image model, music, SFX, external fonts or stock-media search is required. Prioritize clearly acted ideas and readable signs. Save reusable character art, render previews, inspect them and repair your own work before finishing.`;

await mkdir(projectsDir,{recursive:true});
const config=defaultConfig(projectsDir);
config.wordsPerMinute.en=190;
config.limits.aiConcurrency=1;
config.limits.maxAiCallsPerEpisode=24;
config.limits.aiTimeoutMs=12*60_000;
config.shotSecondsBounds={min:1,max:6};
config.voice={voiceId:"default",backend:"chatterbox"};
const ai=codexCli();
const availability=await ai.available();
if(!availability.ok)throw Error(availability.reason);
console.log("Codex",availability.version,availability.authMethod);
const audio=alignedAudio(chatterboxAudio({
  python:process.env.MOCO_VOICE_PYTHON ?? join(process.env.APPDATA!,"Moco/voice/runtime/Scripts/python.exe"),
  modelDir:process.env.MOCO_VOICE_MODEL_DIR ?? join(process.env.APPDATA!,"Moco/voice/models/english"),rate:0.9,seed:42,
}),{python:process.env.MOCO_ALIGN_PYTHON ?? resolve(".venv-learn/Scripts/python.exe")});
const render=createRemotionRenderPort({concurrency:2});
const engine=createEngine({projectsDir,config,ai,audio,render});
engine.on("*",event=>{if(event.type!=="render.progress"||Math.round(Number(event.data.progress)*100)%10===0) console.log(`[${event.type}]`,JSON.stringify(event.data).slice(0,600));});
const seriesId=process.env.MOCO_SERIES ?? await engine.createSeries({idea,language:"en",episodes:1,production:{mode:"artist",format:{width:1920,height:1080,fps:60},targetSeconds:15}});
const dir=join(projectsDir,seriesId);
await writeFile(join(projectsDir,"latest-run.json"),JSON.stringify({seriesId,dir,startedAt:new Date().toISOString(),brief:idea},null,2));
console.log("SERIES",seriesId,"DIRECTORY",dir);
const started=Date.now();
try{
  for(let round=0;round<20;round++){
    const status=await engine.status(seriesId);
    if(status.next.kind==="finished")break;
    if(status.next.kind==="waiting"){
      const key=status.next.key,stage=status.stages.find(stage=>stage.key===key)!;
      console.log("Benchmark auto-approving",key);
      await engine.approve({seriesId,key},stage.artifactHash!);
      continue;
    }
    const job=await engine.waitForJob(await engine.runStage({seriesId}));
    if(job.status!=="succeeded")throw Error(JSON.stringify(job.error));
  }
  const status=await engine.status(seriesId);
  if(status.next.kind!=="finished")throw Error(`Run did not finish: ${JSON.stringify(status.next)}`);
  const artifact=JSON.parse(await readFile(join(dir,"episodes/ep-01/artifacts/render_report.json"),"utf8"));
  await writeFile(join(dir,"autonomy-report.json"),JSON.stringify({author:"Codex through moco's real CLI adapter",manualSceneEdits:0,baselineComparison:"No unstructured baseline run yet; this measures autonomous moco generation, not parity",secondsThisInvocation:(Date.now()-started)/1000,usage:status.usage,decisions:status.decisions,render:artifact.data,cliVersion:availability.version},null,2));
  console.log("FINAL",join(dir,artifact.data.file));
}finally{await render.close();}


