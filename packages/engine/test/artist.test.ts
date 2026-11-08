import { mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ArtistProduction, EpisodeScript } from "@moco/spec";
import type { AiRequest } from "@moco/ai";
import { createEngine } from "../src/index.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import { advance, approveNext, section, validAnswer } from "./helpers.ts";
import { workspacePath } from "../src/artist/workspace.ts";
import { shotBrief, shotSpeech, shotVisemes } from "../src/generator/context.ts";

it("rejects traversal, Windows streams, and junction escapes in artist file access", async () => {
  const root=await mkdtemp(join(tmpdir(),"moco-artist-path-"));
  for(const path of ["../secret","/etc/passwd","C:/secret","x:stream","a\\b","a/../b"]){await expect(workspacePath(root,path)).rejects.toThrow();}
  const outside=await mkdtemp(join(tmpdir(),"moco-outside-"));
  await symlink(outside,join(root,"escape"),process.platform==="win32"?"junction":"dir");
  await expect(workspacePath(root,"escape/private.txt")).rejects.toThrow(/links/);
});

it("uses track fps for shot words, durations, lip sync and speaker intervals", () => {
  const shot={id:"s01",start:1,end:2,lineIds:["l01"],intent:"Point",characters:["viewer"],location:"lab"};
  const track={file:"v.wav",durationSeconds:2,fps:60,words:[{text:"hello",start:1.25,end:1.5,lineId:"l01"}],visemes:[{frame:60,viseme:"X"},{frame:75,viseme:"A"}],speakers:[{speaker:"viewer",start:1.25,end:1.5}]};
  expect(shotBrief(shot,track)).toMatchObject({durationFrames:60,words:[{startFrame:15,endFrame:30}]});
  expect(shotVisemes(shot,track)).toEqual([{frame:0,viseme:"X"},{frame:15,viseme:"A"}]);
  expect(shotSpeech(shot,track)?.[0]?.visemes).toEqual([{frame:0,viseme:"X"},{frame:15,viseme:"A"},{frame:30,viseme:"X"}]);
});

it("runs artist tools through ordinary planning/generation, skips world building and retains 60fps", async () => {
  const dir=await mkdtemp(join(tmpdir(),"moco-artist-engine-"));
  let authorCalls=0;
  const artist = async (request: AiRequest) => {
    request.onActivity?.("Drawing the character silhouette.");
    const tools=request.artistTools!;
    const call=async(name:string,args:object)=>tools.find(tool=>tool.name===name)!.call(args);
    const files=JSON.parse((await call("list_files",{})).content.filter(block=>block.type==="text").map(block=>block.text).join("")) as string[];
    const briefPath=files.filter(path=>path.endsWith("/brief.json")).at(-1)!;
    // The requested path is supplied in the artist prompt, not inferred from another shot.
    const id=/Create shot (s\d+)/.exec(request.prompt)![1]!;
    const brief=JSON.parse((await call("read_file",{path:`shots/${id}/brief.json`})).content.filter(block=>block.type==="text").map(block=>block.text).join(""));
    expect(briefPath).toContain("brief.json");
    expect(brief.originalBrief).toContain("FULL-BRIEF-SENTINEL");
    expect(brief.permissions).toMatchObject({authoringAuthorized:true,script:{status:"approved"},images:{enabled:false}});
    expect(request.system).toContain("override historical approval");
    await expect(call("write_file",{path:`shots/${id}/production-state.json`,content:"{}"})).rejects.toThrow(/read-only/);
    if(!files.includes("shared/characters.js"))await call("write_file",{path:"shared/characters.js",content:"function character(){helpers.circle(100,100,50,'#48767a')}"});
    await call("write_file",{path:`shots/${id}/draw.js`,content:"ctx.fillStyle='#e9dfcf';ctx.fillRect(0,0,scene.width,scene.height);character();"});
    await call("write_file",{path:`shots/${id}/scene.json`,content:JSON.stringify({sourceFiles:["shared/characters.js",`shots/${id}/draw.js`],cast:brief.shot.characters,cues:[]})});
    await call("render_preview",{});
    if(++authorCalls===1) await call("write_file",{path:`shots/${id}/draw.js`,content:"ctx.fillStyle='#e9dfcf';ctx.fillRect(0,0,scene.width,scene.height);character(); // edited after preview"});
    return {finished:true};
  };
  const ai=Object.assign(new FakeAi((request,task)=>{
    if(task==="artist")return artist(request);
    if(task==="artist_review") {
      const parsed=JSON.parse(request.prompt), targets=parsed.targets?.map((target:{shot:unknown})=>target.shot) ?? [parsed.target];
      const verdicts=targets.map((shot:{id:string;actionChecks:{id:string;description:string}[]})=>({id:shot.id,score:4,overall:"Rendered test sequence",checks:shot.actionChecks.map(action=>({...action,status:"pass",severity:"major",evidence:"Frames checked",fix:""}))}));
      return parsed.targets ? {verdicts} : verdicts[0];
    }
    if(task==="world"||task==="bible")throw Error("Artist mode must skip 3D construction and kit casting");
    const answer=validAnswer(request,task);
    if(task==="shots")return {...answer as object,shots:(answer as {shots:{fromWord:number}[]}).shots.map(shot=>({...shot,actionChecks:[{id:"point",description:"Hand points to the board",fromWord:shot.fromWord,toWord:shot.fromWord}]}))};
    if(task==="show")return {...answer as object,requirements:[{id:"flat",text:"Flat illustrations",support:"available",reason:"Canvas"}]};
    return answer;
  }),{supportsArtist:true,seesImages:true});
  const render=new FakeRenderPort();
  const engine=createEngine({projectsDir:dir,ai,render,audio:new FakeAudio(0.4)});
  const id=await engine.createSeries({idea:"FULL-BRIEF-SENTINEL flat vector episode. No approval has been granted.",language:"en",episodes:1,production:{mode:"artist",format:{width:1920,height:1080,fps:60},targetSeconds:45}});
  for(let gate=0;gate<4;gate++){await advance(engine,id);await approveNext(engine,id);}
  const saved=JSON.parse(await readFile(join(dir,id,"episodes/ep-01/shots/s01/spec.json"),"utf8"));
  const activityLog = await readFile(join(dir,id,"events.jsonl"),"utf8");
  expect(activityLog).toContain("Drawing the character silhouette.");
  expect(activityLog).toContain("Checking the saved artwork and motion");
  const sampleReviewUpdates = activityLog.trim().split("\n").map(line => JSON.parse(line)).filter(event => event.type === "ai.activity" && String(event.data.message).startsWith("Preparing visual review frames"));
  expect(sampleReviewUpdates.length).toBeGreaterThan(0);
  expect(sampleReviewUpdates.every(event => event.data.key === "ep-01/sample")).toBe(true);
  expect(saved.data.format).toEqual({width:1920,height:1080,fps:60});
  expect(saved.data.durationFrames).toBeGreaterThan(150);
  expect(saved.data.canvas.source).toContain("function character");
  expect(saved.data.fallback).toBe(false);
  expect(ai.requests.some(request=>request.system.includes("prompt: artist_review"))).toBe(true);
  await expect(readFile(join(dir,id,"episodes/ep-01/shots/s01/stills/0.png"))).resolves.toBeInstanceOf(Buffer);
  const firstAttempt=JSON.parse(await readFile(join(dir,id,"episodes/ep-01/shots/s01/attempts/artist-1.json"),"utf8"));
  expect(firstAttempt.issues[0].problem).toContain("FINAL saved source/assets");
  expect(authorCalls).toBe(2);
  await advance(engine,id);
  const subsequent=ai.requests.filter(request=>request.artistTools)[2]!;
  await expect(subsequent.artistTools!.find(tool=>tool.name==="write_file")!.call({path:"shared/characters.js",content:"overwrite approved design"})).rejects.toThrow(/read-only/);
  const write=subsequent.artistTools!.find(tool=>tool.name==="write_file")!;
  await write.call({path:"shared/versions/character-v2.js",content:"function improvedCharacter(){}"});
  await expect(write.call({path:"shared/versions/character-v2.js",content:"overwrite"})).rejects.toThrow(/read-only/);
  for(const request of ai.requests.filter(request=>!request.artistTools))expect(request.prompt).toContain("FULL-BRIEF-SENTINEL");
  expect(ai.requests.some(request=>request.artistTools?.some(tool=>tool.name==="report_blocker"))).toBe(true);
  const repairJob=await engine.waitForJob(await engine.regenerateShot({seriesId:id,episodeId:"ep-01",shotId:"s01"},"Improve the pose"));
  expect(repairJob.status).toBe("succeeded");
  const archived=JSON.parse(await readFile(join(dir,id,`episodes/ep-01/shots/s01/attempts/artist-${firstAttempt.invocationId}-1.json`),"utf8"));
  expect(archived).toEqual(firstAttempt);
  const latest=JSON.parse(await readFile(join(dir,id,"episodes/ep-01/shots/s01/attempts/artist-1.json"),"utf8"));
  expect(latest.invocationId).not.toBe(firstAttempt.invocationId);
  const authorsBeforeReview=authorCalls;
  const review=await engine.waitForJob(await engine.reviewEpisode({seriesId:id,episodeId:"ep-01"}));
  expect(review.status).toBe("succeeded");
  expect(authorCalls).toBe(authorsBeforeReview);
},20_000);

it("recalibrates an artist script's word budget from measured speech instead of rejecting the needed cut", async () => {
  const dir=await mkdtemp(join(tmpdir(),"moco-artist-budget-"));
  const ai=Object.assign(new FakeAi((request,task)=>{
    if(task==="show")return {...validAnswer(request,task) as object,requirements:[{id:"flat",text:"Flat art",support:"available",reason:"Canvas"}]};
    if(task==="script"){
      const episode=section<{wordBudget:number;targetSeconds:number}>(request.prompt,"Episode");
      return {targetSeconds:episode.targetSeconds,lines:[{id:"l01",text:Array.from({length:episode.wordBudget},()=>"word").join(" "),beat:"Explain",speaker:"narrator"}]};
    }
    return validAnswer(request,task);
  }),{supportsArtist:true});
  const engine=createEngine({projectsDir:dir,ai,render:new FakeRenderPort(),audio:new FakeAudio(0.6)});
  const id=await engine.createSeries({idea:"Flat art",language:"en",episodes:1,production:{mode:"artist",format:{width:1920,height:1080,fps:60},targetSeconds:45}});
  for(let i=0;i<3;i++){await advance(engine,id);await approveNext(engine,id);}
  await advance(engine,id);
  const scripts=ai.requests.filter(request=>request.system.includes("<!-- prompt: script"));
  const last=section<{wordBudget:number}>(scripts.at(-1)!.prompt,"Episode");
  expect(last.wordBudget).toBeLessThan(90);
  const saved=JSON.parse(await readFile(join(dir,id,"episodes/ep-01/artifacts/script.json"),"utf8"));
  expect(saved.data.lines[0].text.split(" ")).toHaveLength(last.wordBudget);
  expect((await engine.status(id)).next).toMatchObject({kind:"waiting",key:"ep-01/script"});
},20_000);

it.each([
  { field: undefined, requested: 20 },
  { field: undefined, requested: 120 },
  { field: 12.5, requested: 12.5 },
  { field: 120, requested: 120 },
])("preserves user duration through planning and script: $requested seconds, field $field", async ({ field, requested }) => {
  const dir=await mkdtemp(join(tmpdir(),"moco-user-duration-"));
  const ai=Object.assign(new FakeAi((request,task)=>{
    if(task==="show"){
      const show=validAnswer(request,task) as ReturnType<typeof import("./helpers.ts").showData>;
      expect(request.system).toContain("Duration is user-controlled");
      const settings=section<{targetSeconds?:number}>(request.prompt,"Production settings");
      expect(settings.targetSeconds).toBe(field);
      if(field===undefined){
        expect(section<Record<string,unknown>>(request.prompt,"Engine limits")).not.toHaveProperty("episodeSeconds");
      }
      return {...show,format:{...show.format,targetSeconds:requested},requirements:[{id:"duration",text:`${requested} second video`,support:"available",reason:"User-requested length"}]};
    }
    if(task==="script"){
      const episode=section<{wordBudget:number;targetSeconds:number}>(request.prompt,"Episode");
      expect(episode.targetSeconds).toBe(requested);
      return {targetSeconds:requested,lines:[{id:"l01",text:Array.from({length:episode.wordBudget},()=>"word").join(" "),beat:"Explain",speaker:"narrator"}]};
    }
    return validAnswer(request,task);
  }),{supportsArtist:true});
  const engine=createEngine({projectsDir:dir,ai,render:new FakeRenderPort(),audio:new FakeAudio(.4)});
  // A supplied field explicitly overrides an older length reference in the prompt.
  const id=await engine.createSeries({idea:`Make a ${field===undefined?requested:20}-second explainer`,language:"en",episodes:1,production:{mode:"artist",format:{width:1920,height:1080,fps:60},...(field===undefined?{}:{targetSeconds:field})}});
  for(let i=0;i<2;i++){await advance(engine,id);await approveNext(engine,id);}
  await advance(engine,id);
  const saved=JSON.parse(await readFile(join(dir,id,"episodes/ep-01/artifacts/script.json"),"utf8"));
  expect(saved.data.targetSeconds).toBe(requested);
});

it("accepts positive custom durations and rejects invalid values",()=>{
  for(const targetSeconds of [0,-1,NaN,Infinity]){
    expect(ArtistProduction.safeParse({mode:"artist",format:{width:1920,height:1080,fps:60},targetSeconds}).success).toBe(false);
    expect(EpisodeScript.safeParse({targetSeconds,lines:[{id:"l01",text:"Hello",beat:"Hook"}]}).success).toBe(false);
  }
});
