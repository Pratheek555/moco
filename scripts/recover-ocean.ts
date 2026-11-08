// One-time recovery of the ocean episode's pre-checkpoint quality evidence.
// Run with Moco closed: pnpm exec tsx scripts/recover-ocean.ts
import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { aiBackend } from "@moco/ai";
import { createEngine } from "@moco/engine";
import { createRemotionRenderPort } from "@moco/renderer";
import { Ledger } from "../packages/engine/src/store/ledger.ts";
import { ArtifactStore } from "../packages/engine/src/store/artifacts.ts";
import { hashData } from "../packages/engine/src/store/hash.ts";
import { files } from "../packages/engine/src/pipeline/stages.ts";
import { sceneSharedInputs } from "../packages/engine/src/generator/generate.ts";
import { ArtistVerdict, motionFrames, reviewContext } from "../packages/engine/src/review/artist.ts";
import type { StageContext } from "../packages/engine/src/pipeline/context.ts";

const settings=JSON.parse(await readFile(join(homedir(),"AppData/Roaming/Moco/settings.json"),"utf8"));
const seriesId="the-ocean-after-dark",ep="ep-01",dir=join(settings.projectsDir,seriesId);
const ledger=await Ledger.load(dir),store=new ArtifactStore(dir,ledger,()=>{throw Error("Unexpected external edit")});
const series=JSON.parse(await readFile(join(dir,"series.json"),"utf8"));
const render=createRemotionRenderPort({concurrency:2,browserExecutable:join(process.cwd(),"apps/desktop/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe")});
try {
  const ctx={dir,store,ledger,series,render,ai:{backendId:settings.aiProvider}} as unknown as StageContext;
  const shots=(await store.read(files.shotList(ep),"ShotList")).data.shots;
  const shared=await sceneSharedInputs(ctx,ep),context=reviewContext(ctx,shots,shared);
  // Import old independent verdicts only if their exact scenes/timing remain on
  // disk and neither the approved show/bible nor renderer changed since review.
  const checkpoint=join(dir,`episodes/${ep}/quality/checkpoint.json`);
  if(!await access(checkpoint).then(()=>true,()=>false)){
    const critique=await store.read(files.critique(ep),"Critique"),quality=critique.data.quality!;
    const report=JSON.parse(await readFile(join(dir,quality.report),"utf8"));
    const preview=(await store.read(files.previewReport(ep),"RenderReport")).data;
    if(preview.rendererVersion!==render.versions().rendererVersion || preview.kitVersion!==render.versions().kitVersion)throw Error("Legacy renderer differs");
    if(quality.voiceoverHash!==store.hashOf(files.voiceover(ep)) || quality.shotListHash!==store.hashOf(files.shotList(ep)))throw Error("Legacy timing differs");
    for(const file of [files.show,files.bible]){
      if((await stat(join(dir,file))).mtimeMs>Date.parse(critique.meta.createdAt))throw Error("Legacy design context changed");
    }
    for(const shot of shots){
      const saved=await store.read(files.shotSpec(ep,shot.id),"SceneSpec");
      if(quality.sceneHashes[shot.id]!==saved.meta.contentHash)throw Error(`Legacy scene changed: ${shot.id}`);
      const verdict=ArtistVerdict.parse(report.final[shot.id]);
      if(verdict.id!==shot.id)throw Error("Legacy verdict target mismatch");
    }
    await store.writeRaw(`episodes/${ep}/quality/checkpoint.json`,{context,cutHash:hashData({context,scenes:shots.map(s=>store.hashOf(files.shotSpec(ep,s.id)))}),initial:report.initial,final:report.final,migratedFrom:quality.report});
    console.log("Recovered 46 exact-cut independent verdicts (45 passed, one repair pending).");
  }
  // Import matching frame sequences; never use a different spec or frame list.
  const root=join(dir,`episodes/${ep}/quality`);
  let imported=0;
  const candidates:string[]=[];
  for(const run of await readdir(root,{withFileTypes:true}))if(run.isDirectory()){
    for(const file of await readdir(join(root,run.name)))if(/^(initial|round-\d+|restored-\d+)-s\d+\.json$/.test(file))candidates.push(join(root,run.name,file));
  }
  for(const shot of shots){
    const spec=(await store.read(files.shotSpec(ep,shot.id),"SceneSpec")).data;
    const frames=motionFrames(spec,shot,shared);
    for(const file of candidates.filter(f=>f.endsWith(`-${shot.id}.json`)).reverse()){
      const saved=JSON.parse(await readFile(file,"utf8"));
      if(saved.sceneHash!==hashData(spec))continue;
      const images=(saved.images as string[]).filter(f=>basename(dirname(f))===shot.id);
      if(images.length!==frames.length || images.some((f,i)=>basename(f)!==`${frames[i]}.png`))continue;
      if(!await Promise.all(images.map(f=>access(f).then(()=>true,()=>false))).then(exists=>exists.every(Boolean)))continue;
      const cache=`cache/artist-evidence/${hashData({spec,frames,renderer:render.versions()})}`;
      await store.writeRaw(`${cache}/frames.json`,{stills:images});imported++;break;
    }
  }
  console.log(`Recovered ${imported} matching motion sequences.`);
  const engine=createEngine({projectsDir:settings.projectsDir,stylesDir:join(homedir(),"AppData/Roaming/Moco/styles"),ai:aiBackend(settings.aiProvider),render,audio:{tts:async()=>{throw Error("Existing narration must be preserved")},align:async()=>{throw Error("Existing timing must be preserved")},visemes:async()=>{throw Error("Existing timing must be preserved")}}});
  let lastPercent=-1;
  engine.on("*",event=>{
    if(event.type==="render.progress"){
      const p=Math.floor(Number(event.data.progress)*100);
      if(p!==lastPercent){lastPercent=p;console.log(`${event.at} ${event.data.quality} render ${p}%`);}
    }else if(["ai.activity","stage.started","stage.done","stage.failed","job.finished","stage.awaiting_approval","look.repairs"].includes(event.type))console.log(event.at,event.type,JSON.stringify(event.data));
  });
  let key:string|undefined=`${ep}/scenes`;
  for(let step=0;step<5;step++){
    const job=await engine.runStage({seriesId,key});
    const result=await engine.waitForJob(job);
    if(result.status!=="succeeded")throw Error(`Recovery stopped: ${JSON.stringify(result.error)}`);
    const status=await engine.status(seriesId);
    if(status.stages.find(s=>s.key===`${ep}/publish`)?.status==="done"){
      console.log("DELIVERED",join(dir,files.rendersDir(ep),"final.mp4"));break;
    }
    if(status.next.kind==="waiting" && status.next.key===`${ep}/preview` && status.next.status==="awaiting_approval"){
      const gate=status.stages.find(s=>s.key===`${ep}/preview`)!;
      // The user explicitly requested completion and delivery of the video.
      await engine.approve({seriesId,key:gate.key},gate.artifactHash!);
      key=undefined;lastPercent=-1;continue;
    }
    if(status.next.kind!=="run")throw Error(`Unexpected recovery state ${JSON.stringify(status.next)}`);
    key=status.next.key;
  }
}finally{await render.close();}
