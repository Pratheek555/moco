import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { imageGenerationCapability, artistPermissions } from "../src/artist/permissions.ts";
import { createEngine } from "../src/index.ts";
import { Ledger } from "../src/store/ledger.ts";
import { ArtifactStore } from "../src/store/artifacts.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import { defaultConfig } from "../src/config.ts";
import { advance, approveNext, scriptData, section, validAnswer } from "./helpers.ts";

const production={mode:"artist" as const,format:{width:1920,height:1080,fps:60},targetSeconds:45};

it("allows requested GPT Image 2, but never enables it for unrelated or local-only projects",()=>{
  const ai={supportsImageGeneration:true};
  expect(imageGenerationCapability({idea:"Use GPT Image 2",production},ai)).toMatchObject({enabled:true,model:"gpt-image-2"});
  expect(imageGenerationCapability({idea:"Generate images of a forest",production},ai).enabled).toBe(true);
  expect(imageGenerationCapability({idea:"Draw a forest",production},ai).enabled).toBe(false);
  expect(imageGenerationCapability({idea:"No image generation",production},ai).enabled).toBe(false);
  expect(imageGenerationCapability({idea:"GPT Image 2",production:{...production,localOnly:true}},ai).enabled).toBe(false);
  expect(imageGenerationCapability({idea:"GPT Image 2",production},{})).toMatchObject({requested:true,available:false});
});

async function setup(artist:(request:import("@moco/ai").AiRequest)=>Promise<unknown>,idea="An illustrated science story",shotCount?:number) {
  const dir=await mkdtemp(join(tmpdir(),"moco-artist-permissions-"));
  const ai=Object.assign(new FakeAi((request,task)=>{
    if(task==="artist")return artist(request);
    if(task==="artist_review"){
      const parsed=JSON.parse(request.prompt),targets=parsed.targets?.map((target:{shot:unknown})=>target.shot)??[parsed.target];
      const verdicts=targets.map((shot:{id:string;actionChecks:{id:string;description:string}[]})=>({id:shot.id,score:4,overall:"Frames inspected",checks:shot.actionChecks.map(action=>({...action,status:"pass",severity:"major",evidence:"Frames inspected",fix:""}))}));
      return parsed.targets?{verdicts}:verdicts[0];
    }
    if(task==="show"){
      const show=validAnswer(request,task) as {format:object};
      return {...show,...(shotCount&&{format:{...show.format,targetSeconds:60,shotSeconds:{min:.8,max:6}}}),requirements:[{id:"art",text:"Art",support:"available",reason:"Canvas"}]};
    }
    if(task==="script"){
      const answer=(shotCount?{...scriptData(10),targetSeconds:60}:validAnswer(request,task)) as {lines:{id:string}[]};
      return {...answer,shotPlan:answer.lines.map(line=>({lineId:line.id,seconds:(shotCount?60:45)/answer.lines.length,picture:"A layered forest reveal"}))};
    }
    if(task==="shots"){
      let answer=validAnswer(request,task) as {shots:{fromWord:number}[]};
      if(shotCount){
        const words=section<unknown[]>(request.prompt,"Words");
        answer={shots:Array.from({length:shotCount},(_,i)=>({...answer.shots[0]!,id:`s${String(i+1).padStart(2,"0")}`,fromWord:Math.floor(i*words.length/shotCount)}))};
      }
      return {...answer,shots:answer.shots.map(shot=>({...shot,actionChecks:[{id:"reveal",description:"Reveal the background",fromWord:shot.fromWord,toWord:shot.fromWord}]}))};
    }
    return validAnswer(request,task);
  }),{supportsArtist:true,supportsImageGeneration:true,seesImages:true});
  const engine=createEngine({projectsDir:dir,ai,audio:new FakeAudio(.4),render:new FakeRenderPort(),config:{limits:{...defaultConfig(dir).limits,aiConcurrency:1}}});
  const id=await engine.createSeries({idea,language:"en",episodes:1,production:shotCount?{...production,targetSeconds:60}:production});
  for(let i=0;i<3;i++){await advance(engine,id);await approveNext(engine,id);}
  return {dir,id,ai,engine};
}

it("keeps current approval hash authoritative and refuses a changed or unapproved script",async()=>{
  const {dir,id,engine}=await setup(async()=>({}));
  const seriesDir=join(dir,id),ledger=await Ledger.load(seriesDir);
  const store=new ArtifactStore(seriesDir,ledger,()=>{});
  const ctx={ledger,store,series:(await engine.status(id)).series,ai:{supportsImageGeneration:true}};
  const permissions=await artistPermissions(ctx as never,"ep-01");
  expect(permissions.script.contentHash).toBe(ledger.stage("ep-01/script").artifactHash);
  expect(permissions.storyboard).toMatchObject({...permissions.script,includedInScript:true});
  ledger.setStage("ep-01/script",{status:"awaiting_approval"});
  await expect(artistPermissions(ctx as never,"ep-01")).rejects.toThrow("Review and approve");
  ledger.setStage("ep-01/script",{status:"approved",artifactHash:"old-hash"});
  await expect(artistPermissions(ctx as never,"ep-01")).rejects.toThrow("Review and approve");
});

it("stops before authoring when the requested image provider is unavailable",async()=>{
  let calls=0;
  const {engine,id,ai}=await setup(async()=>{calls++;return {};},"Use GPT Image 2");
  ai.supportsImageGeneration=false;
  const job=await engine.waitForJob(await engine.runStage({seriesId:id}));
  expect(job.error).toMatchObject({code:"stage_blocked"});
  expect(job.error?.message).toContain("Select Codex in Settings");
  expect(calls).toBe(0);
});

it("reports a missing capability once instead of burning three scene repairs",async()=>{
  let calls=0;
  const {engine,id}=await setup(async request=>{
    calls++;
    await request.artistTools!.find(t=>t.name==="report_blocker")!.call({reason:"The required reference image is missing."});
    return {blocked:true};
  });
  const job=await engine.waitForJob(await engine.runStage({seriesId:id}));
  expect(job.error).toMatchObject({code:"stage_blocked"});
  expect(job.error?.message).toContain("required reference image is missing");
  expect(job.error?.message).not.toContain("ENOENT");
  expect(calls).toBe(1);
});

it("generates and embeds a requested PNG without deadlocking a one-slot artist",async()=>{
  let imageCalls=0;
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCWQAAAAASUVORK5CYII=","base64");
  const {engine,id,ai}=await setup(async request=>{
    const call=(name:string,args:object)=>request.artistTools!.find(t=>t.name===name)!.call(args);
    const shot=/Create shot (s\d+)/.exec(request.prompt)![1]!;
    const brief=JSON.parse((await call("read_file",{path:`shots/${shot}/brief.json`})).content.filter(c=>c.type==="text").map(c=>c.text).join(""));
    expect(brief.permissions.images).toMatchObject({enabled:true,model:"gpt-image-2"});
    await expect(call("generate_image",{path:"../escape.png",prompt:"A forest"})).rejects.toThrow();
    await call("generate_image",{path:`shots/${shot}/plate.png`,prompt:"A layered forest background"});
    await expect(call("generate_image",{path:`shots/${shot}/plate.png`,prompt:"Repeat"})).rejects.toThrow("already exists");
    await call("write_file",{path:"shared/design.js",content:"function design(){}"});
    await call("write_file",{path:`shots/${shot}/draw.js`,content:"ctx.drawImage(scene.assets.plate,0,0,scene.width,scene.height);"});
    await call("write_file",{path:`shots/${shot}/scene.json`,content:JSON.stringify({sourceFiles:["shared/design.js",`shots/${shot}/draw.js`],cast:brief.shot.characters,assets:{plate:`shots/${shot}/plate.png`},cues:[]})});
    await call("render_preview",{});
    return {done:true};
  },"Use GPT Image 2. No approval has been granted.");
  const generate=ai.generate.bind(ai);
  ai.generate=async request=>{
    if(!request.imageGeneration)return generate(request);
    imageCalls++;
    return {text:"Generated",backend:"fake",generatedImages:[{data:png,mimeType:"image/png"}],usage:{inputTokens:5,outputTokens:10}};
  };
  const job=await engine.waitForJob(await engine.runStage({seriesId:id}));
  expect(job.status,job.error?.message).toBe("succeeded");
  expect(imageCalls).toBe(1);
  const artifact=await engine.readArtifact({seriesId:id,file:"episodes/ep-01/shots/s01/spec.json"}) as {data:{canvas:{assets:Record<string,string>}}};
  expect(artifact.data.canvas.assets.plate).toBe(`data:image/png;base64,${png.toString("base64")}`);
  expect((await engine.status(id)).next).toMatchObject({kind:"waiting",key:"ep-01/sample"});
},15000);

it("finishes a 40-shot image episode past 60 calls and 180 files, reusing saved scenes on retry",async()=>{
  let authors=0,images=0;
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCWQAAAAASUVORK5CYII=","base64");
  const {engine,id,ai,dir}=await setup(async request=>{
    authors++;
    const call=(name:string,args:object)=>request.artistTools!.find(t=>t.name===name)!.call(args);
    const shot=/Create shot (s\d+)/.exec(request.prompt)![1]!;
    const read=await call("read_file",{path:`shots/${shot}/brief.json`});
    const brief=JSON.parse(read.content.filter(c=>c.type==="text").map(c=>c.text).join(""));
    const list=JSON.parse((await call("list_files",{})).content.filter(c=>c.type==="text").map(c=>c.text).join("")) as string[];
    if(!list.includes("shared/design.js"))await call("write_file",{path:"shared/design.js",content:"function design(){}"});
    await call("generate_image",{path:`shots/${shot}/plate.png`,prompt:"Ocean plate"});
    await call("write_file",{path:`shots/${shot}/draw.js`,content:"ctx.drawImage(scene.assets.plate,0,0,scene.width,scene.height);"});
    await call("write_file",{path:`shots/${shot}/scene.json`,content:JSON.stringify({sourceFiles:["shared/design.js",`shots/${shot}/draw.js`],cast:brief.shot.characters,assets:{plate:`shots/${shot}/plate.png`},cues:[]})});
    await call("render_preview",{});
    return {done:true};
  },"Use GPT Image 2",40);
  const generate=ai.generate.bind(ai);
  ai.generate=async request=>{
    if(!request.imageGeneration)return generate(request);
    images++;
    return {text:"Generated",backend:"fake",generatedImages:[{data:png,mimeType:"image/png"}]};
  };
  await advance(engine,id); // shot list, sample and sample review
  await approveNext(engine,id);
  const saved=await readFile(join(dir,id,"episodes/ep-01/shots/s01/spec.json"),"utf8");
  const events:import("../src/events/bus.ts").EngineEvent[]=[];
  engine.on("*",event=>events.push(event));
  await advance(engine,id); // 39 authors + 39 images + 40 review calls, one job
  expect(authors).toBe(40);
  expect(images).toBe(40);
  expect(events.filter(e=>e.type==="usage.updated")).toHaveLength(118);
  expect((await engine.status(id)).next).toMatchObject({kind:"waiting",key:"ep-01/preview"});
  expect(await readFile(join(dir,id,"episodes/ep-01/shots/s01/spec.json"),"utf8")).toBe(saved);
  const usage=(await engine.status(id)).usage.aiCalls["ep-01"]!;
  await advance(engine,id,"ep-01/scenes");
  expect(authors).toBe(40);
  expect(images).toBe(40);
  expect((await engine.status(id)).usage.aiCalls["ep-01"]).toBe(usage+40); // review only
},60_000);

it("bounds new scene files and generated images while allowing repairs at the file cap",async()=>{
  let imageCalls=0;
  const {engine,id,dir,ai}=await setup(async request=>{
    const call=(name:string,args:object)=>request.artistTools!.find(t=>t.name===name)!.call(args);
    await call("write_file",{path:"shots/s01/existing-0.js",content:"// repaired"});
    await expect(call("write_file",{path:"shots/s01/overflow.js",content:"// new"})).rejects.toThrow("file limit reached for scene s01");
    await expect(call("generate_image",{path:"shots/s01/overflow.png",prompt:"Ocean"})).rejects.toThrow("file limit reached for scene s01");
    await call("report_blocker",{reason:"File capacity checked"});
    return {};
  },"Use GPT Image 2");
  const root=join(dir,id,"episodes/ep-01/artist/shots/s01");
  await mkdir(root,{recursive:true});
  // brief.json and production-state.json consume the remaining two entries.
  await Promise.all(Array.from({length:178},(_,i)=>writeFile(join(root,`existing-${i}.js`),"// existing")));
  const generate=ai.generate.bind(ai);
  ai.generate=async request=>{if(request.imageGeneration)imageCalls++;return generate(request);};
  const job=await engine.waitForJob(await engine.runStage({seriesId:id}));
  expect(job.error?.message).toContain("File capacity checked");
  expect(imageCalls).toBe(0);
  expect(await readFile(join(root,"existing-0.js"),"utf8")).toBe("// repaired");
},15_000);
