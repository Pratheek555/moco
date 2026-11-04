// Codex repairs a COPY of a saved artist episode. Narration bytes and cut boundaries stay fixed.
import { copyFile, mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import * as z from "zod";
import { codexCli } from "@moco/ai";
import { systemAudio } from "@moco/audio";
import { defaultConfig } from "@moco/engine";
import { createRemotionRenderPort } from "@moco/renderer";
import { ActionCheck, ShotList, toAiJsonSchema } from "@moco/spec";
import { catalog } from "../packages/kit/src/index.ts";
import { reviewArtistEpisode } from "../packages/engine/src/review/artist.ts";
import { runRender } from "../packages/engine/src/pipeline/render.ts";
import { ArtifactStore } from "../packages/engine/src/store/artifacts.ts";
import { Ledger } from "../packages/engine/src/store/ledger.ts";
import { files } from "../packages/engine/src/pipeline/stages.ts";
import { meteredAi } from "../packages/engine/src/usage/meter.ts";
import { EventBus } from "../packages/engine/src/events/bus.ts";
import { Semaphore } from "../packages/engine/src/jobs/semaphore.ts";
import type { StageContext, SeriesInfo } from "../packages/engine/src/pipeline/context.ts";

const original=resolve(process.argv[2]??"artifacts/autonomous-codex/make-one-15-second-english-explainer-about");
const dir=resolve(process.env.MOCO_REPAIR_DIR??`artifacts/artist-repair-${new Date().toISOString().replace(/[:.]/g,"-")}`),ep="ep-01";
if(dir===original)throw Error("Repair must use a separate directory");
await mkdir(dir,{recursive:true});
const first=!await lstat(join(dir,"ledger.json")).then(()=>true,()=>false);
const ledger=await Ledger.load(dir),store=new ArtifactStore(dir,ledger,()=>{}),bus=new EventBus(dirname(dir));
const info=JSON.parse(await readFile(join(original,"series.json"),"utf8")) as SeriesInfo;
const load=async(path:string)=>JSON.parse(await readFile(join(original,path),"utf8")).data;
const show=await load(files.show),bible=await load(files.bible),voice=await load(files.voiceover(ep));
const copyTree=async(from:string,to:string):Promise<void>=>{
  await mkdir(to,{recursive:true});
  for(const item of await readdir(from,{withFileTypes:true}).catch(()=>[])){
    if(item.isSymbolicLink())throw Error("Linked artist files are not accepted");
    if(item.isDirectory())await copyTree(join(from,item.name),join(to,item.name));
    else await copyFile(join(from,item.name),join(to,item.name));
  }
};
if(first){
  await writeFile(join(dir,"series.json"),JSON.stringify({...info,id:"artist-repair"},null,2));
  for(const path of ["shared","assets","shots"])await copyTree(join(original,"episodes",ep,"artist",path),join(dir,"episodes",ep,"artist",path));
  await writeFile(join(dir,"episodes",ep,"artist/shared.lock.json"),JSON.stringify({inherited:original}));
  await mkdir(join(dir,files.audioDir(ep)),{recursive:true});await copyFile(join(original,voice.file),join(dir,files.audioDir(ep),"vo.wav"));
  ledger.data.episodeIds=[ep];ledger.setStage(`${ep}/sample`,{status:"approved"});await ledger.save();
  await store.save(files.show,"ShowBible",show,{producedBy:"engine"});
  await store.save(files.bible,"SeriesBible",bible,{producedBy:"engine"});
  await store.save(files.voiceover(ep),"VoiceoverTrack",{...voice,file:`${files.audioDir(ep)}/vo.wav`},{producedBy:"engine"});
  const list=await load(files.shotList(ep));await store.save(files.shotList(ep),"ShotList",list,{producedBy:"engine"});
  for(const shot of list.shots)await store.save(files.shotSpec(ep,shot.id),"SceneSpec",await load(files.shotSpec(ep,shot.id)),{producedBy:"engine"});
}
await writeFile(resolve("artifacts/latest-artist-repair.json"),JSON.stringify({original,dir},null,2));
const config=defaultConfig(dirname(dir));config.limits.aiConcurrency=1;config.limits.aiTimeoutMs=12*60_000;
const render=createRemotionRenderPort({concurrency:2}),backend=codexCli();
const availability=await backend.available();if(!availability.ok)throw Error(availability.reason);
const ctx:StageContext={seriesId:"artist-repair",series:{...info,id:"artist-repair"},dir,config,catalog,useWorld:()=>{throw Error("No 3D world")},store,ledger,bus,ai:meteredAi(backend,new Semaphore(1),ledger,bus,"artist-repair",config),render,audio:systemAudio(),renderSlots:new Semaphore(1),ttsSlots:new Semaphore(1),signal:new AbortController().signal,episodeIds:()=>[ep]};
bus.on("*",event=>{if(event.type!=="render.progress"||Math.round(Number(event.data.progress)*100)%10===0)console.log(event.type,JSON.stringify(event.data).slice(0,600))});
console.log("REPAIR",dir);
try{
  let list=(await store.read(files.shotList(ep),"ShotList")).data;
  const track=(await store.read(files.voiceover(ep),"VoiceoverTrack")).data;
  if(list.shots.some(s=>!s.actionChecks?.length)){
    const schema=z.object({shots:z.array(z.object({id:z.string(),actionChecks:z.array(ActionCheck).min(1).max(3)}))});
    const result=await ctx.ai.generate({system:"You write observable animation acceptance checks. Keep the supplied shots, narration and times unchanged. Use 1-3 important actions per shot, each tied to whole-track word indices within that shot. Specify contact, hand shape, gaze and expression as visible movements. Avoid vague feelings and avoid minor polish checks.",prompt:JSON.stringify({brief:info.idea,shots:list.shots,words:track.words.map((w,index)=>({...w,index})),priorCritique:await load(files.critique(ep))}),jsonSchema:toAiJsonSchema(schema)},ep);
    const plan=schema.parse(result.json);
    if(plan.shots.length!==list.shots.length||new Set(plan.shots.map(s=>s.id)).size!==list.shots.length)throw Error("Action plan changed shot identities");
    list=ShotList.parse({shots:list.shots.map(shot=>{
      const actions=plan.shots.find(s=>s.id===shot.id)?.actionChecks;if(!actions)throw Error(`Missing ${shot.id}`);
      if(new Set(actions.map(a=>a.id)).size!==actions.length)throw Error("Duplicate action ids");
      for(const a of actions)if(a.toWord<a.fromWord||!track.words[a.toWord]||track.words[a.fromWord]!.start<shot.start||track.words[a.toWord]!.start>=shot.end)throw Error(`Action outside shot ${shot.id}`);
      return {...shot,actionChecks:actions};
    })});
    await store.save(files.shotList(ep),"ShotList",list,{producedBy:"ai",backend:backend.id,inputs:[store.inputRef(files.voiceover(ep))]});
  }
  await reviewArtistEpisode(ctx,ep,list.shots,{episodeId:ep,voiceover:track,bible,show},{maxRounds:process.argv.includes("--review-only")?0:2});
  const critique=(await store.read(files.critique(ep),"Critique")).data;
  await runRender(ctx,ep,"preview");
  if(critique.quality?.status==="passed")await runRender(ctx,ep,"final");
  const digest=async(path:string)=>createHash("sha256").update(await readFile(path)).digest("hex");
  const unchanged=await digest(join(original,voice.file))===await digest(join(dir,track.file));
  if(!unchanged)throw Error("Narration changed during repair");
  await store.writeRaw("repair-report.json",{original,dir,provider:backend.id,manualSceneEdits:0,narrationUnchanged:unchanged,quality:critique.quality,usage:ledger.data.usage,output:critique.quality?.status==="passed"?"episodes/ep-01/renders/final.mp4":"episodes/ep-01/renders/preview.mp4"});
  console.log("RESULT",critique.quality?.status,dir);
}finally{await render.close();}
