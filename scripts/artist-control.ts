// Controlled comparison: same Codex, narration, approved designs, tools and renderer; one unrestricted sequence
// instead of moco's per-shot planner. This is an internal control, NOT a claim to reproduce the user's raw video.
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { codexCli } from "@moco/ai";
import { systemAudio } from "@moco/audio";
import { defaultConfig } from "@moco/engine";
import { createRemotionRenderPort } from "@moco/renderer";
import { catalog } from "../packages/kit/src/index.ts";
import { generateArtistScene } from "../packages/engine/src/artist/generate.ts";
import { ArtistProduction } from "@moco/spec";
import type { StageContext, SeriesInfo } from "../packages/engine/src/pipeline/context.ts";
import { ArtifactStore } from "../packages/engine/src/store/artifacts.ts";
import { Ledger } from "../packages/engine/src/store/ledger.ts";
import { files } from "../packages/engine/src/pipeline/stages.ts";
import { meteredAi } from "../packages/engine/src/usage/meter.ts";
import { EventBus } from "../packages/engine/src/events/bus.ts";
import { Semaphore } from "../packages/engine/src/jobs/semaphore.ts";
import { runRender } from "../packages/engine/src/pipeline/render.ts";

const latest=JSON.parse(await readFile(resolve("artifacts/autonomous-codex/latest-run.json"),"utf8"));
const positional=process.argv.slice(2).filter(arg=>!arg.startsWith("--"));
const original=resolve(positional[0] ?? latest.dir),dir=resolve(positional[1] ?? "artifacts/codex-control"),ep="ep-01";
const data=async(path:string)=>JSON.parse(await readFile(join(original,path),"utf8")).data;
const info=JSON.parse(await readFile(join(original,"series.json"),"utf8")) as SeriesInfo;
const production=ArtistProduction.parse(info.production);
const show=await data(files.show),bible=await data(files.bible),voiceover=await data(files.voiceover(ep));
const originalAttempt=JSON.parse(await readFile(join(original,files.shotDir(ep,"s01"),"attempts/artist-1.json"),"utf8"));
// Keep the same Codex CLI default as the original run; no provider fallback or inferred model pin.
const reportedModel=originalAttempt.model as string|undefined;
await mkdir(join(dir,files.audioDir(ep)),{recursive:true});
await copyFile(join(original,voiceover.file),join(dir,files.audioDir(ep),"vo.wav"));
const controlVoice={...voiceover,file:`${files.audioDir(ep)}/vo.wav`};
const artistRoot=join(dir,"episodes",ep,"artist");
const seed=async(name:string)=>{
  const from=join(original,"episodes",ep,"artist",name);
  const entries=await readdir(from,{withFileTypes:true}).catch(()=>[]);
  if(!entries.length)return;
  await mkdir(join(artistRoot,name),{recursive:true});
  for(const item of entries){if(item.isSymbolicLink())throw Error("Cannot seed linked assets");if(item.isDirectory())await seed(`${name}/${item.name}`);else await copyFile(join(from,item.name),join(artistRoot,name,item.name));}
};
await seed("shared");await seed("assets");
const ledger=await Ledger.load(dir),store=new ArtifactStore(dir,ledger,()=>{}),bus=new EventBus(dirname(dir));
ledger.data.episodeIds=[ep];ledger.setStage(`${ep}/sample`,{status:"approved"});await ledger.save();
await writeFile(join(artistRoot,"shared.lock.json"),JSON.stringify({inherited:original}));
await store.save(files.show,"ShowBible",show,{producedBy:"engine"});
await store.save(files.bible,"SeriesBible",bible,{producedBy:"engine"});
await store.save(files.voiceover(ep),"VoiceoverTrack",controlVoice,{producedBy:"engine"});
const shot={id:"s01",start:0,end:voiceover.durationSeconds,lineIds:voiceover.words.map((word:{lineId:string})=>word.lineId).filter((value:string,index:number,all:string[])=>all.indexOf(value)===index),characters:show.cast.map((member:{id:string})=>member.id),location:"complete-sequence",intent:"Create the COMPLETE narrated short. Choose all internal cuts, scene layouts, acting and transitions yourself. Fulfil the full original creative brief, synchronized to every word. You receive the same approved shared character source, voice and style as the shot-planned version; inspect and reuse them. You are not limited to one place or one camera in this single canvas module."};
await store.save(files.shotList(ep),"ShotList",{shots:[shot]},{producedBy:"engine"});
const render=createRemotionRenderPort({concurrency:2}),ai=codexCli();
const config=defaultConfig(dirname(dir));config.limits.aiConcurrency=1;
bus.on("*",event=>console.log(event.type,JSON.stringify(event.data).slice(0,300)));
const ctx:StageContext={seriesId:"artist-control",series:{...info,id:"artist-control",production},dir,config,catalog,useWorld:()=>{throw Error("Control uses no 3D world")},store,ledger,bus,ai:meteredAi(ai,new Semaphore(1),ledger,bus,"artist-control",config),render,audio:systemAudio(),renderSlots:new Semaphore(1),ttsSlots:new Semaphore(1),signal:new AbortController().signal,episodeIds:()=>[ep]};
const start=Date.now();
try{
  if(!process.argv.includes("--render-only")){
    const result=await generateArtistScene(ctx,{episodeId:ep,shot,voiceover:controlVoice,bible,show});
    await store.save(files.shotSpec(ep,"s01"),"SceneSpec",result.data,{producedBy:"ai",backend:ai.id,inputs:[store.inputRef(files.voiceover(ep))]});
  }
  await runRender(ctx,ep,"final");
  await writeFile(join(dir,"control-report.json"),JSON.stringify({original,reportedModel,modelPolicy:"Both runs use the Codex CLI default; exact primary-model identity was not reported by the adapter.",manualSceneEdits:0,comparison:"Single whole-sequence artist control versus per-shot planning. Same script/voice, approved shared character art, brief, tools and renderer. Control inherits designs created in the planned run, so this is not an independent baseline or the unavailable original raw-Claude video.",secondsThisInvocation:(Date.now()-start)/1000,usage:ledger.data.usage},null,2));
  console.log("CONTROL",join(dir,files.rendersDir(ep),"final.mp4"));
}finally{await render.close();}


