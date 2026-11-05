import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SceneSpec, type Shot } from "@moco/spec";
import { reviewArtistEpisode, normalize, repairImproved, motionFrames, validateReviewScope, overviewLayout, type ArtistVerdict } from "../src/review/artist.ts";
import { generateScene, type SceneInputs } from "../src/generator/generate.ts";
import { ArtifactStore } from "../src/store/artifacts.ts";
import { Ledger } from "../src/store/ledger.ts";
import { files } from "../src/pipeline/stages.ts";
import { runRender } from "../src/pipeline/render.ts";
import { FakeRenderPort } from "../src/testing/fakes.ts";
import { Semaphore } from "../src/jobs/semaphore.ts";
import type { StageContext } from "../src/pipeline/context.ts";

vi.mock("../src/generator/generate.ts", () => ({generateScene:vi.fn()}));
const verdict = (id:string, pass=false):ArtistVerdict => ({id,score:pass?4:3,overall:"Evidence",checks:[{id:"contact",description:"Hand contacts elbow",status:pass?"pass":"fail",severity:"major",evidence:"Sample sequence",fix:"Cup elbow"}]});

it("preserves portrait evidence proportions and keeps review sheets within canvas limits",()=>{
  const portrait=overviewLayout({width:1080,height:1920});
  expect(portrait.width/portrait.height).toBe(1080/1920);
  expect(portrait.rowHeight*portrait.rows).toBeLessThanOrEqual(4096);
  expect(overviewLayout({width:1920,height:1080})).toMatchObject({width:640,height:360,rows:8});
});

async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),"moco-review-")),ledger=await Ledger.load(dir);
  const store=new ArtifactStore(dir,ledger,()=>{}),render=new FakeRenderPort();
  const shots:Shot[]=Array.from({length:4},(_,i)=>({id:`s0${i+1}`,start:i,end:i+1,lineIds:["l01"],intent:"Support elbow",characters:[],location:"lab",actionChecks:[{id:"contact",description:"Hand contacts elbow",fromWord:i,toWord:i}]}));
  const voiceover={file:"vo.wav",durationSeconds:4,fps:60,words:shots.map((s,i)=>({text:"elbow",start:i,end:i+.9,lineId:"l01"})),visemes:[]};
  await store.save(files.voiceover("ep-01"),"VoiceoverTrack",voiceover,{producedBy:"engine"});
  await store.save(files.shotList("ep-01"),"ShotList",{shots},{producedBy:"engine"});
  for(const shot of shots)await store.save(files.shotSpec("ep-01",shot.id),"SceneSpec",SceneSpec.parse({shotId:shot.id,durationFrames:60,format:{width:1920,height:1080,fps:60},background:{id:"lab"},actors:[],captions:[],canvas:{version:1,source:"// original"}}),{producedBy:"engine"});
  const generate=vi.fn(async(request:{prompt:string}):Promise<{json:unknown;backend:string}>=>{const target=JSON.parse(request.prompt).target;return {json:verdict(target.id),backend:"fake"}});
  const ctx={dir,store,ledger,render,series:{idea:"Fixed brief",production:{mode:"artist",format:{width:1920,height:1080,fps:60}}},seriesId:"test",renderSlots:new Semaphore(1),signal:new AbortController().signal,bus:{emit:async()=>{}},ai:{seesImages:true,backendId:"fake",generate}} as unknown as StageContext;
  const shared={episodeId:"ep-01",voiceover,bible:{},show:{}} as unknown as Omit<SceneInputs,"shot">;
  return {ctx,shots,shared,generate,render};
}

it("batches prompt-template reviews without dropping targets or action checks",async()=>{
  const {ctx,shots,shared,generate}=await fixture();
  ctx.series.template="batch-style";
  generate.mockImplementation(async request=>({json:{verdicts:JSON.parse(request.prompt).targets.map((target:{shot:Shot})=>verdict(target.shot.id,true))},backend:"fake"}));
  await reviewArtistEpisode(ctx,"ep-01",shots,shared,{maxRounds:0});
  expect(generate).toHaveBeenCalledTimes(2);
  const quality=(await ctx.store.read(files.critique("ep-01"),"Critique")).data.quality!;
  expect(quality.status).toBe("passed");
  expect(Object.keys(quality.sceneHashes)).toHaveLength(4);
});

it("reviews the whole cut, repairs all weak shots, and rejects equal, regressed and unproven repairs",async()=>{
  const {ctx,shots,shared,generate,render}=await fixture();
  const workspace=join(ctx.dir,"episodes/ep-01/artist/shots/s02");
  await mkdir(workspace,{recursive:true});await writeFile(join(workspace,"draw.js"),"original file");
  vi.mocked(generateScene).mockClear().mockImplementation(async(ctx,inputs)=>{
    if(inputs.shot.id==="s02"){await writeFile(join(workspace,"draw.js"),"rejected file");await writeFile(join(workspace,"new.js"),"rejected new file");}
    const spec=(await ctx.store.read(files.shotSpec("ep-01",inputs.shot.id),"SceneSpec")).data;
    await ctx.store.save(files.shotSpec("ep-01",inputs.shot.id),"SceneSpec",{...spec,canvas:{...spec.canvas,source:"// candidate"}},{producedBy:"ai"});
    return {shotId:inputs.shot.id,fallback:false,attempts:1,contentHash:ctx.store.hashOf(files.shotSpec("ep-01",inputs.shot.id))!};
  });
  generate.mockImplementation(async(request)=>{
    const p=JSON.parse(request.prompt);
    expect(p.episode.shots).toHaveLength(4);
    expect(p.evidence.overviewSheets).toBe(1);
    const v=verdict(p.target.id,Boolean(p.previous));
    if(p.target.id==="s02")return {json:verdict(p.target.id),backend:"fake"};
    if(p.target.id==="s03"&&p.previous)v.checks.push({...v.checks[0]!,id:"s03-clipping",status:"fail"});
    if(p.target.id==="s04"&&p.previous)v.checks=[{...v.checks[0]!,id:"s04-other"}];
    return {json:v,backend:"fake"};
  });
  await reviewArtistEpisode(ctx,"ep-01",shots,shared,{maxRounds:1});
  expect(generateScene).toHaveBeenCalledTimes(4);
  const critique=(await ctx.store.read(files.critique("ep-01"),"Critique")).data;
  expect(critique.quality?.status).toBe("needs_attention");
  const report=JSON.parse(await readFile(join(ctx.dir,critique.quality!.report),"utf8"));
  expect(report.history.map((h:{kept:boolean})=>h.kept)).toEqual([true,false,false,false]);
  expect((await ctx.store.read(files.shotSpec("ep-01","s02"),"SceneSpec")).data.canvas?.source).toBe("// original");
  expect(await readFile(join(workspace,"draw.js"),"utf8")).toBe("original file");
  await expect(readFile(join(workspace,"new.js"))).rejects.toThrow(/ENOENT/);
  await expect(runRender(ctx,"ep-01","final")).rejects.toThrow(/accepted artist quality/);
  await runRender(ctx,"ep-01","preview");
  expect(render.renders).toBe(1);
});

it("allows a passing cut but blocks final export after a scene or narration changes",async()=>{
  const {ctx,shots,shared,generate}=await fixture();
  generate.mockImplementation(async request=>({json:verdict(JSON.parse(request.prompt).target.id,true),backend:"fake"}));
  await reviewArtistEpisode(ctx,"ep-01",shots,shared,{maxRounds:0});
  await runRender(ctx,"ep-01","final");
  const file=files.shotSpec("ep-01","s01"),original=(await ctx.store.read(file,"SceneSpec")).data;
  await ctx.store.save(file,"SceneSpec",{...original,canvas:{...original.canvas,source:"// changed"}},{producedBy:"engine"});
  await expect(runRender(ctx,"ep-01","final")).rejects.toThrow(/stale/);
  await ctx.store.save(file,"SceneSpec",original,{producedBy:"engine"});
  await ctx.store.save(files.voiceover("ep-01"),"VoiceoverTrack",{...shared.voiceover,file:"different.wav"},{producedBy:"engine"});
  await expect(runRender(ctx,"ep-01","final")).rejects.toThrow(/stale/);
});

it("bounds unsuccessful repairs, asks for a different approach, and blocks export on reviewer failure",async()=>{
  const {ctx,shots,shared,generate}=await fixture();
  vi.mocked(generateScene).mockClear().mockImplementation(async(_ctx,inputs)=>({shotId:inputs.shot.id,fallback:false,attempts:1,contentHash:"unchanged"}));
  await reviewArtistEpisode(ctx,"ep-01",shots,shared);
  expect(generateScene).toHaveBeenCalledTimes(8);
  expect(vi.mocked(generateScene).mock.calls.slice(4).every(([,inputs])=>inputs.feedback?.includes("CHANGE THE APPROACH"))).toBe(true);
  const critique=(await ctx.store.read(files.critique("ep-01"),"Critique")).data;
  expect(critique.quality?.unresolved).toHaveLength(4);
  generate.mockImplementation(async()=>{throw Error("review offline")});
  await reviewArtistEpisode(ctx,"ep-01",shots,shared);
  const failed=(await ctx.store.read(files.critique("ep-01"),"Critique")).data;
  expect(failed.quality?.status).toBe("needs_attention");
  expect(failed.quality?.unresolved.join(" ")).toContain("review offline");
  await expect(runRender(ctx,"ep-01","final")).rejects.toThrow(/accepted artist quality/);
});

it("preserves critical severity and rejects omitted acceptance evidence",()=>{
  const before=verdict("s01");before.checks[0]!.severity="critical";
  const after=verdict("s01");after.checks[0]!.severity="minor";
  const normalized=normalize(after,{id:"s01",start:0,end:1,lineIds:[],intent:"Contact",characters:[],location:"lab",actionChecks:[{id:"contact",description:"Hand contacts elbow",fromWord:0,toWord:0}]},before);
  expect(normalized.checks[0]!.severity).toBe("critical");
  expect(repairImproved(before,normalized)).toBe(false);
  expect(repairImproved(before,{...verdict("s01",true),checks:[]})).toBe(false);
});

it("samples action motion at the scene fps and includes both sides of cuts",async()=>{
  const {ctx,shots,shared}=await fixture();
  const spec=(await ctx.store.read(files.shotSpec("ep-01","s02"),"SceneSpec")).data;
  const timed={...shared,voiceover:{...shared.voiceover,words:[{text:"prior",start:0,end:.9,lineId:"l01"},{text:"reach",start:1.2,end:1.4,lineId:"l01"},{text:"settle",start:1.6,end:1.8,lineId:"l01"}]}};
  const shot={...shots[1]!,actionChecks:[{id:"contact",description:"Hand reaches elbow and settles",fromWord:1,toWord:2}]};
  expect(motionFrames(spec,shot,timed)).toEqual([0,6,12,24,30,35,47,54,59]);
  const rewind={...spec,canvas:{version:1 as const,source:"",cast:[],assets:{},cues:[{id:"rewind",atFrame:45}]}};
  const sampled=motionFrames(rewind,shot,timed);
  expect(sampled).toContain(39);
  expect(sampled.filter(frame=>frame>=45)).toEqual(Array.from({length:15},(_,index)=>45+index));
});

it("rejects foreign-shot and episode checks while allowing target defects",async()=>{
  const {shots}=await fixture();
  shots[1]!.actionChecks![0]!.id="s02-contact";
  const v=verdict("s01");
  v.checks[0]!.id="s02-contact";
  expect(()=>validateReviewScope(v,shots[0]!,shots)).toThrow(/Out-of-scope/);
  v.checks[0]!.id="episode-exact-duration";
  expect(()=>validateReviewScope(v,shots[0]!,shots)).toThrow(/Out-of-scope/);
  v.checks[0]!.id="s01-clipping";
  expect(()=>validateReviewScope(v,shots[0]!,shots)).not.toThrow();
});

it.each(["author","review"])("restores unaccepted scene and workspace after %s interruption",async phase=>{
  const {ctx,shots,shared,generate}=await fixture();
  const workspace=join(ctx.dir,"episodes/ep-01/artist/shots/s01");
  await mkdir(workspace,{recursive:true});await writeFile(join(workspace,"draw.js"),"original file");
  vi.mocked(generateScene).mockClear().mockImplementation(async(ctx,inputs)=>{
    if(inputs.shot.id==="s01"){
      await writeFile(join(workspace,"draw.js"),"unreviewed candidate");
      const file=files.shotSpec("ep-01","s01"),spec=(await ctx.store.read(file,"SceneSpec")).data;
      await ctx.store.save(file,"SceneSpec",{...spec,canvas:{...spec.canvas,source:"// unreviewed"}},{producedBy:"ai"});
      if(phase==="author")throw Error("author interrupted");
    }
    return {shotId:inputs.shot.id,fallback:false,attempts:1,contentHash:"candidate"};
  });
  generate.mockImplementation(async request=>{
    const p=JSON.parse(request.prompt);
    if(p.previous)throw Error("review interrupted");
    return {json:verdict(p.target.id),backend:"fake"};
  });
  await reviewArtistEpisode(ctx,"ep-01",shots,shared,{maxRounds:1});
  expect((await ctx.store.read(files.shotSpec("ep-01","s01"),"SceneSpec")).data.canvas?.source).toBe("// original");
  expect(await readFile(join(workspace,"draw.js"),"utf8")).toBe("original file");
  await expect(runRender(ctx,"ep-01","final")).rejects.toThrow(/accepted artist quality/);
});
