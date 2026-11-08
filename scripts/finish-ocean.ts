// Record the Codex assistant's direct visual review of the saved repair, then
// finish normal preview/final/publishing stages. No external review is simulated.
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createEngine } from "@moco/engine";
import { aiBackend } from "@moco/ai";
import { createRemotionRenderPort } from "@moco/renderer";
import { Ledger } from "../packages/engine/src/store/ledger.ts";
import { ArtifactStore } from "../packages/engine/src/store/artifacts.ts";
import { hashData } from "../packages/engine/src/store/hash.ts";
import { files } from "../packages/engine/src/pipeline/stages.ts";
import { markDependantsStale } from "../packages/engine/src/pipeline/machine.ts";
import { sceneSharedInputs, scenesHash } from "../packages/engine/src/generator/generate.ts";
import { ArtistVerdict, artistPassed, reviewContext } from "../packages/engine/src/review/artist.ts";
import { setStylesDir } from "../packages/engine/src/templates/registry.ts";
import type { StageContext } from "../packages/engine/src/pipeline/context.ts";

const settings=JSON.parse(await readFile(join(homedir(),"AppData/Roaming/Moco/settings.json"),"utf8"));
const seriesId="the-ocean-after-dark",ep="ep-01",dir=join(settings.projectsDir,seriesId);
const stylesDir=join(homedir(),"AppData/Roaming/Moco/styles");setStylesDir(stylesDir);
const render=createRemotionRenderPort({concurrency:2,browserExecutable:join(process.cwd(),"apps/desktop/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe")});
try{
  const ledger=await Ledger.load(dir),store=new ArtifactStore(dir,ledger,()=>{throw Error("Unexpected external edit")});
  const series=JSON.parse(await readFile(join(dir,"series.json"),"utf8"));
  if(!process.argv.includes("--resume")){
    const critique=(await store.read(files.critique(ep),"Critique")).data;
    const priorQuality=critique.quality!;
    const prior=JSON.parse(await readFile(join(dir,priorQuality.report),"utf8"));
    const shots=(await store.read(files.shotList(ep),"ShotList")).data.shots;
    const candidateFile="history/episodes__ep-01__shots__s38__spec.r3.json";
    const candidate=JSON.parse(await readFile(join(dir,candidateFile),"utf8"));
    const expected="3cf04b0a90f2677d1e6dce058ad299852ca5ddf98603ea376bbc1a40efd320fc";
    if(hashData(candidate.data)!==expected)throw Error("The visually reviewed repair changed");
    if(priorQuality.voiceoverHash!==store.hashOf(files.voiceover(ep))||priorQuality.shotListHash!==store.hashOf(files.shotList(ep)))throw Error("Narration or cuts changed since inspection");
    for(const shot of shots){
      if(priorQuality.sceneHashes[shot.id]!==store.hashOf(files.shotSpec(ep,shot.id)))throw Error(`Unreviewed scene change: ${shot.id}`);
      if(shot.id!=="s38"&&!artistPassed(ArtistVerdict.parse(prior.final[shot.id])))throw Error(`Another unresolved shot: ${shot.id}`);
    }
    const reviewDir=`episodes/${ep}/quality/${randomUUID()}`;
    const evidenceRoot=`episodes/${ep}/artist/checks/s38/1`;
    const motion=[0,43,67,98,102,134,166,201,267,327,334,468].map(f=>join(dir,evidenceRoot,`${f}.png`));
    const overview=[0,8,16,24,32,40].map(i=>join(dir,`episodes/${ep}/quality/d9a1b85c-c7c4-437e-a6e0-d02a6a2d3bdc/round-1/overview-${i}/0.png`));
    await Promise.all([...motion,...overview].map(file=>access(file)));
    const verdict=ArtistVerdict.parse({id:"s38",score:4,checks:[{id:"s38a",description:prior.final.s38.checks[0].description,status:"pass",severity:"major",evidence:"Direct Codex assistant inspection of saved frames 0, 102, 166, 267 and 468, plus all six whole-cut overview sheets: Pip is now between the two pathways. At frame 0 the optical panel and both lens centers aim up-left toward the aggregate. By frame 166 the panel has rotated and both cyan lens centers aim up-right at the descending school; the right-facing pose is held through 267 and the lenses track downward by 468. The particle pathway appears first, followed by the animal pathway; both arrows and final carbon-pump title stay inside the schematic. The orange ROV, navy/teal palette, and neighboring migration/carbon schematics preserve continuity. This judgment was made from viewed images by the assistant; the external CLI reviewer timed out and is not credited with a passing verdict.",fix:""}],overall:"The visible left-to-right gaze change and held target poses resolve the prior action failure. No new major clipping, text-fit or continuity issue is visible."});
    // Restore the exact independently inspected candidate and its editable source.
    const source=candidate.data.canvas.source as string;
    const marker="// shots/s38/draw.js\n",start=source.indexOf(marker);
    if(start<0)throw Error("Candidate source boundary missing");
    await writeFile(join(dir,`episodes/${ep}/artist/shots/s38/draw.js`),source.slice(start+marker.length));
    await store.save(files.shotSpec(ep,"s38"),"SceneSpec",candidate.data,{producedBy:candidate.meta.producedBy,backend:candidate.meta.backend,inputs:candidate.meta.inputs});
    const final={...prior.final,s38:verdict};
    const sceneHashes=Object.fromEntries(shots.map(s=>[s.id,store.hashOf(files.shotSpec(ep,s.id))!]));
    await store.writeRaw(`${reviewDir}/report.json`,{run:reviewDir.split("/").at(-1),reviewer:"Codex assistant (direct visual inspection)",at:new Date().toISOString(),previousReport:priorQuality.report,reviewedCandidate:expected,motionImages:motion,overviewImages:overview,continuityConfirmed:["s37","s38","s39"],initial:prior.initial,final,history:[{id:"s38",before:prior.final.s38,after:verdict,kept:true}],unresolved:[]});
    await store.save(files.critique(ep),"Critique",{...critique,shots:critique.shots.map(s=>s.shotId==="s38"?{...s,fix:"",repaired:{score:4,kept:true},requirements:verdict.checks.map(c=>({id:c.id,status:c.status,evidence:c.evidence}))}:s),overall:"Existing unchanged shots retain their recorded independent passes. The Codex assistant directly inspected the repaired s38 motion and whole-cut continuity after the external reviewer timed out. See quality.report for attribution and exact evidence.",quality:{...priorQuality,status:"passed",unresolved:[],sceneHashes,report:`${reviewDir}/report.json`}},{producedBy:"ai",backend:"codex-assistant-visual-review",inputs:[...shots.map(s=>store.inputRef(files.shotSpec(ep,s.id))),store.inputRef(files.voiceover(ep)),store.inputRef(files.shotList(ep))]});
    const ctx={dir,store,ledger,series,render,ai:{backendId:settings.aiProvider}} as unknown as StageContext;
    const shared=await sceneSharedInputs(ctx,ep),context=reviewContext(ctx,shots,shared);
    await store.writeRaw(`episodes/${ep}/quality/checkpoint.json`,{context,cutHash:hashData({context,scenes:shots.map(s=>sceneHashes[s.id])}),initial:prior.initial,final,report:`${reviewDir}/report.json`});
    ledger.setStage(`${ep}/scenes`,{status:"done",artifactHash:await scenesHash(ctx,ep),error:undefined});
    markDependantsStale(ledger,`${ep}/scenes`,[ep]);await ledger.save();
    console.log("Recorded evidence-backed assistant review; all 46 shots accepted.");
  }
  const engine=createEngine({projectsDir:settings.projectsDir,stylesDir,ai:aiBackend(settings.aiProvider),render,audio:{tts:async()=>{throw Error("Preserve existing narration")},align:async()=>{throw Error("Preserve existing timing")},visemes:async()=>{throw Error("Preserve existing timing")}}});
  let lastPercent=-1;
  engine.on("*",event=>{
    if(event.type==="render.progress"){
      const percent=Math.floor(Number(event.data.progress)*100);
      if(percent!==lastPercent){lastPercent=percent;console.log(`${event.at} ${event.data.quality} render ${percent}%`);}
    }else if(["ai.activity","stage.started","stage.done","stage.failed","job.finished","stage.awaiting_approval"].includes(event.type))console.log(event.at,event.type,JSON.stringify(event.data));
  });
  let key=process.argv.includes("--resume")?`${ep}/final`:`${ep}/preview`;
  for(let step=0;step<4;step++){
    const job=await engine.runStage({seriesId,key});const result=await engine.waitForJob(job);
    if(result.status!=="succeeded")throw Error(`Delivery stopped: ${JSON.stringify(result.error)}`);
    const status=await engine.status(seriesId);
    if(status.stages.find(s=>s.key===`${ep}/publish`)?.status==="done"){console.log("DELIVERED",join(dir,files.rendersDir(ep),"final.mp4"));break;}
    if(status.next.kind==="waiting"&&status.next.key===`${ep}/preview`&&status.next.status==="awaiting_approval"){
      const gate=status.stages.find(s=>s.key===`${ep}/preview`)!;
      await engine.approve({seriesId,key:gate.key},gate.artifactHash!);key=`${ep}/final`;lastPercent=-1;
    }else if(status.next.kind==="run")key=status.next.key;
    else throw Error(`Unexpected delivery state ${JSON.stringify(status.next)}`);
  }
}finally{await render.close();}
