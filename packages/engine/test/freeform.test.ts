import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { catalog } from "@moco/kit";
import { ArtistProduction, SceneSpec, SeriesBible, type Shot } from "@moco/spec";
import { createEngine } from "../src/index.ts";
import { artistWorkspace } from "../src/artist/workspace.ts";
import { generateArtistScene } from "../src/artist/generate.ts";
import { libraryFile } from "../src/artist/library.ts";
import { ArtifactStore } from "../src/store/artifacts.ts";
import { Ledger } from "../src/store/ledger.ts";
import { defaultConfig } from "../src/config.ts";
import { Semaphore } from "../src/jobs/semaphore.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import type { StageContext } from "../src/pipeline/context.ts";
import type { SceneInputs } from "../src/generator/generate.ts";
import { checkShotDrafts } from "../src/planner/shots.ts";
import { checkShow } from "../src/planner/show.ts";
import { showData } from "./helpers.ts";
import { files } from "../src/pipeline/stages.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(),"moco-freeform-"));
  const ledger = await Ledger.load(dir), store = new ArtifactStore(dir,ledger,()=>{});
  const production = ArtistProduction.parse({mode:"artist",localOnly:true,format:{width:1080,height:1920,fps:30}});
  const bible = SeriesBible.parse({cast:[],style:{palette:["#abc"],captionStyle:"bold",mood:"curious"},narrator:{voiceId:"default",backend:"placeholder",language:"en"}});
  const saved = await store.save(files.bible,"SeriesBible",bible,{producedBy:"engine"});
  ledger.setStage("bible",{status:"approved",artifactHash:saved.meta.contentHash});
  const shot: Shot = {id:"s01",start:0,end:12,lineIds:["l01"],intent:"An original shape grows",characters:[],location:"unlisted-place",transition:{type:"dissolve",durationFrames:12}};
  const voiceover = {file:"vo.wav",durationSeconds:12,fps:30,words:[{text:"grow",start:1,end:2,lineId:"l01"}],visemes:[]};
  for (const ep of ["ep-01","ep-02","ep-05"]) {
    const script = await store.save(files.script(ep),"EpisodeScript",{targetSeconds:12,lines:[{id:"l01",text:"grow",beat:"Reveal"}]},{producedBy:"engine"});
    ledger.setStage(`${ep}/script`,{status:"approved",artifactHash:script.meta.contentHash});
  }
  const ctx = {dir,ledger,store,seriesId:"test",series:{idea:"Original local drawing",production},config:defaultConfig(dir),catalog,
    ai:Object.assign(new FakeAi(()=>({})),{supportsArtist:true}),render:new FakeRenderPort(),renderSlots:new Semaphore(1),
    signal:new AbortController().signal,bus:{emit:async()=>{}},episodeIds:()=>["ep-01","ep-02","ep-05"]} as unknown as StageContext;
  const inputs: SceneInputs = {episodeId:"ep-01",shot,voiceover,bible};
  return {ctx,inputs,production};
}

it("defaults new stories to freeform and keeps explicit kit/world and saved legacy routes",async()=>{
  const dir = await mkdtemp(join(tmpdir(),"moco-route-"));
  const ai = Object.assign(new FakeAi(()=>({})),{supportsArtist:true});
  const engine = createEngine({projectsDir:dir,ai,render:new FakeRenderPort(),audio:new FakeAudio()});
  const id = await engine.createSeries({idea:"An original space tale",language:"en"});
  const legacy = await engine.createSeries({idea:"Kit story",language:"en",production:null});
  const series = await engine.listSeries();
  expect(series.find(s=>s.id===id)?.production).toMatchObject({mode:"artist",localOnly:true,format:{width:1080,height:1920,fps:30}});
  expect(series.find(s=>s.id===legacy)?.production).toBeUndefined();
  const reopened = createEngine({projectsDir:dir,ai,render:new FakeRenderPort(),audio:new FakeAudio()});
  expect((await reopened.listSeries()).find(s=>s.id===legacy)?.production).toBeUndefined();
});

it("publishes reusable code/data/assets once, reuses across shots and episode 5, and pins old source bytes",async()=>{
  const {ctx,inputs,production} = await fixture();
  const first = await artistWorkspace(ctx,inputs,production);
  const call = (w: typeof first, name:string, args:object) => w.tools.find(t=>t.name===name)!.call(args);
  const character = "function hero(pose){helpers.circle(100,100,40,scene.data.palette.ink)}";
  await call(first,"write_file",{path:"shared/hero.js",content:character});
  await call(first,"write_file",{path:"shared/palette.json",content:'{"ink":"#123456"}'});
  await call(first,"write_file",{path:"assets/mark.svg",content:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="red"/></svg>'});
  const manifest = (id:string) => ({sourceFiles:["shared/hero.js",`shots/${id}/draw.js`],cast:[],assets:{mark:"assets/mark.svg"},dataFiles:{palette:"shared/palette.json"}});
  await call(first,"write_file",{path:"shots/s01/draw.js",content:"hero('point');"});
  await call(first,"write_file",{path:"shots/s01/scene.json",content:JSON.stringify(manifest("s01"))});
  const original = await first.assemble();
  expect(original.canvas).toMatchObject({words:[{text:"grow",startFrame:30,endFrame:60,wordIndex:0}],data:{palette:{ink:"#123456"}}});
  expect(original.canvas!.assets.mark).toContain("data:image/svg+xml;base64,");
  expect(original.transition).toEqual(inputs.shot.transition);
  await first.freezeShared();
  const revision = (await ctx.store.read(libraryFile,"AuthoredLibrary")).meta.revision;
  for (const [ep,id] of [["ep-01","s02"],["ep-05","s01"]] as const) {
    // Episode 2 has no artist directory; reuse must come from series memory.
    const w = await artistWorkspace(ctx,{...inputs,episodeId:ep,shot:{...inputs.shot,id}},production);
    expect((await call(w,"read_file",{path:"shared/hero.js"})).content).toEqual([{type:"text",text:character}]);
    await expect(call(w,"write_file",{path:"shared/hero.js",content:"drift"})).rejects.toThrow(/read-only/);
    await call(w,"write_file",{path:`shots/${id}/draw.js`,content:"hero('wave');"});
    await call(w,"write_file",{path:`shots/${id}/scene.json`,content:JSON.stringify(manifest(id))});
    expect((await w.assemble()).canvas!.designSources).toEqual(original.canvas!.designSources);
  }
  const later = await artistWorkspace(ctx,{...inputs,episodeId:"ep-05"},production);
  await call(later,"write_file",{path:"shared/versions/hero-v2.js",content:"function hero2(){}"});
  await later.freezeShared();
  expect((await ctx.store.read(libraryFile,"AuthoredLibrary")).meta.revision).toBeGreaterThan(revision);
  expect(original.canvas!.source).toContain(character);
  expect(original.canvas!.source).not.toContain("hero2");
  await rm(join(ctx.dir,"episodes","ep-05","artist"),{recursive:true});
  const restored = await artistWorkspace(ctx,{...inputs,episodeId:"ep-05"},production);
  expect((await call(restored,"list_files",{})).content[0]).toMatchObject({type:"text",text:expect.stringContaining("hero-v2.js")});
});

it("accepts graphics-only shows, new places/cast, long shots and arbitrary code complexity on the freeform route",async()=>{
  const {ctx,inputs,production} = await fixture();
  ctx.series.idea = "Generate illustrations of an original space tale";
  const show = {...showData(),cast:[]};
  expect(checkShow(show,ctx.config,true)).toEqual([]);
  const draft = {shots:[{id:"s01",fromWord:0,intent:"Shapes",characters:["new-original"],location:"new-world"}]};
  expect(checkShotDrafts(draft,inputs.voiceover,inputs.bible,catalog,{min:0,max:Infinity},[],true)).toEqual([]);
  const workspace = await artistWorkspace(ctx,inputs,production);
  expect(workspace.permissions.images).toMatchObject({requested:false,enabled:false});
  expect(workspace.tools.some(tool=>tool.name==="generate_image")).toBe(false);
  const write = (path:string,content:string) => workspace.tools.find(t=>t.name==="write_file")!.call({path,content});
  // Former 12-file manifest and 100 KB source / 150 KB read limits must not truncate artwork.
  const sourceFiles = Array.from({length:14},(_,i)=>`shots/s01/part-${i}.js`);
  await Promise.all(sourceFiles.map(path=>write(path,"// arbitrary artwork\n".repeat(1000))));
  await write("shots/s01/scene.json",JSON.stringify({sourceFiles,cast:[]}));
  const scene = await workspace.assemble();
  expect(scene.canvas!.source.length).toBeGreaterThan(150_000);
  expect(scene.durationFrames).toBe(360);
  expect(SceneSpec.safeParse({...scene,format:{width:8192,height:4096,fps:120}}).success).toBe(true);
});

it("sends authored runtime errors back to the artist and accepts the repaired preview",async()=>{
  const {ctx,inputs} = await fixture();
  ctx.render = new FakeRenderPort(spec=>spec.canvas!.source.includes("throw Error")?[{shotId:spec.shotId,frame:0,path:"canvas.source",message:"broken original pose"}]:[]);
  let attempts=0;
  const ai = Object.assign(new FakeAi(async request=>{
    const call = (name:string,args:object) => request.artistTools!.find(t=>t.name===name)!.call(args);
    if (++attempts===2) expect(request.prompt).toContain("broken original pose");
    await call("write_file",{path:"shots/s01/draw.js",content:attempts===1?"throw Error('broken original pose')":"ctx.fillRect(0,0,20,20);"});
    await call("write_file",{path:"shots/s01/scene.json",content:JSON.stringify({sourceFiles:["shots/s01/draw.js"],cast:[]})});
    const preview = await call("render_preview",{});
    if(attempts===1) expect(preview.content[0]).toMatchObject({text:expect.stringContaining("broken original pose")});
    return {};
  }),{supportsArtist:true});
  ctx.ai = ai as unknown as StageContext["ai"];
  const result = await generateArtistScene(ctx,inputs);
  expect(result.attempts).toBe(2);
  const record = JSON.parse(await readFile(join(ctx.dir,"episodes/ep-01/shots/s01/attempts/artist-1.json"),"utf8"));
  // Even when a failed preview is returned as a tool result, the final L3 retry includes its error.
  expect(record.issues[0].problem).toContain("broken original pose");
});
