// Hand-authored fixtures through the actual artist manifest/L2/L3/store/episode path.
// Run once to inspect six L3 stills; then --render after inspecting them to export.
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { catalog } from "@moco/kit";
import { ArtistProduction, SeriesBible, type Shot, type TimedWord } from "@moco/spec";
import { systemAudio } from "../packages/audio/src/system.ts";
import { createRemotionRenderPort } from "@moco/renderer";
import { artistWorkspace } from "../packages/engine/src/artist/workspace.ts";
import { ArtifactStore } from "../packages/engine/src/store/artifacts.ts";
import { Ledger } from "../packages/engine/src/store/ledger.ts";
import { EventBus } from "../packages/engine/src/events/bus.ts";
import { defaultConfig } from "../packages/engine/src/config.ts";
import type { StageContext } from "../packages/engine/src/pipeline/context.ts";
import { runRender } from "../packages/engine/src/pipeline/render.ts";
import { files } from "../packages/engine/src/pipeline/stages.ts";
import { Semaphore } from "../packages/engine/src/jobs/semaphore.ts";

const dir = resolve(process.argv.slice(2).find(arg=>!arg.startsWith("--")) ?? "C:/Users/prath/AppData/Local/Temp/claude/3fd6186c8caca1fe/e78eb94b-2564-4524-87ab-c2cf7fdca0df/scratchpad/freeform-proof");
await mkdir(dir,{recursive:true});
const ledger = await Ledger.load(dir), store = new ArtifactStore(dir,ledger,()=>{});
const ep="ep-01", production=ArtistProduction.parse({mode:"artist",localOnly:true,format:{width:1080,height:1920,fps:30},targetSeconds:12});
const render = createRemotionRenderPort({concurrency:2});
const bus = new EventBus(dirname(dir));
let last=-1;bus.on("render.progress",event=>{const pct=Math.floor(Number(event.data.progress)*10);if(pct!==last){last=pct;console.log(`Rendering ${pct*10}%`)}});
const ctx = {dir,store,ledger,seriesId:basename(dir),series:{idea:"Pip, an original seed scientist. Bold cel illustration, Lilita One and Montserrat. Local voice, no image generation.",production},
  config:defaultConfig(dir),catalog,render,bus,renderSlots:new Semaphore(1),signal:new AbortController().signal,
  ai:{supportsArtist:true},episodeIds:()=>[ep]} as unknown as StageContext;
const run=(cmd:string,args:string[])=>new Promise<void>((ok,fail)=>{
  const child=spawn(cmd,args,{stdio:"inherit",windowsHide:true});child.on("error",fail);child.on("exit",code=>code===0?ok():fail(Error(`${cmd} exited ${code}`)));
});
try {
  if(!process.argv.includes("--render")) {
    const lines=[
      {id:"l01",text:"A tiny seed hides a surprising machine.",beat:"Pip discovers a seed"},
      {id:"l02",text:"Roots reach down. Leaves reach for the light.",beat:"Look inside the seed"},
      {id:"l03",text:"Small beginnings can grow into something extraordinary.",beat:"Pip celebrates a flower"},
    ];
    const bible=SeriesBible.parse({cast:[{id:"pip",kitCharacterId:"pip",description:"Original teal seed scientist with orange goggles and leaf antenna"}],style:{palette:["#56b8a8","#fa9d54"],captionStyle:"word by word",mood:"curious"},narrator:{voiceId:"default",backend:"system",language:"en"}});
    const saved=await store.save(files.bible,"SeriesBible",bible,{producedBy:"engine"});
    ledger.setStage("bible",{status:"approved",artifactHash:saved.meta.contentHash});
    const script=await store.save(files.script(ep),"EpisodeScript",{targetSeconds:12,lines},{producedBy:"engine"});
    ledger.setStage(`${ep}/script`,{status:"approved",artifactHash:script.meta.contentHash});
    const words:TimedWord[]=[];
    const segments:string[]=[];
    const audioDir=join(dir,files.audioDir(ep));await mkdir(audioDir,{recursive:true});
    for(const [i,line] of lines.entries()) {
      const spoken=await systemAudio().tts([line],{voiceId:"default",backend:"system"},"en",join(audioDir,String(i)));
      const tempo=Math.max(1,spoken.durationSeconds/3.95),segment=join(audioDir,`fitted-${i}.wav`);
      await run("ffmpeg",["-v","error","-y","-i",spoken.file,"-af",`atempo=${tempo},apad=whole_dur=4,atrim=duration=4`,"-ar","24000","-ac","1",segment]);
      words.push(...spoken.words.map(w=>({...w,start:i*4+w.start/tempo,end:i*4+w.end/tempo})));segments.push(segment);
    }
    const voice=join(audioDir,"vo.wav");
    await writeFile(join(audioDir,"concat.txt"),segments.map(s=>`file '${s.replaceAll("\\","/")}'`).join("\n"));
    await run("ffmpeg",["-v","error","-y","-f","concat","-safe","0","-i",join(audioDir,"concat.txt"),"-af","loudnorm=I=-16:TP=-1.5:LRA=7","-ar","24000","-ac","1",voice]);
    const voiceover={file:relative(dir,voice),durationSeconds:12,fps:30,words,visemes:[]};
    await store.save(files.voiceover(ep),"VoiceoverTrack",voiceover,{producedBy:"engine"});
    const shots:Shot[]=lines.map((line,i)=>({id:`s0${i+1}`,start:i*4,end:(i+1)*4,lineIds:[line.id],intent:line.beat,characters:i===1?[]:["pip"],location:["seed-lab","seed-cutaway","greenhouse"][i]!,
      ...(i>0?{transition:{type:i===1?"dissolve" as const:"fade-through-black" as const,durationFrames:12}}:{})}));
    await store.save(files.shotList(ep),"ShotList",{shots},{producedBy:"engine"});
    const library=await readFile(new URL("./demo-art/freeform-library.js",import.meta.url),"utf8");
    const drawing=await readFile(new URL("./demo-art/freeform-shot.js",import.meta.url),"utf8");
    for(const [i,shot] of shots.entries()) {
      const workspace=await artistWorkspace(ctx,{episodeId:ep,shot,voiceover,bible},production);
      const call=(name:string,args:object)=>workspace.tools.find(tool=>tool.name===name)!.call(args);
      if(i===0) {
        const path=join(workspace.root,"shared/pip-v2.js");
        if(!await readFile(path).then(()=>true,()=>false))await call("write_file",{path:"shared/pip-v2.js",content:library});
      }
      await call("write_file",{path:`shots/${shot.id}/draw.js`,content:`const mode=${i};\n${drawing}`});
      await call("write_file",{path:`shots/${shot.id}/scene.json`,content:JSON.stringify({sourceFiles:["shared/pip-v2.js",`shots/${shot.id}/draw.js`],cast:shot.characters,cues:[{id:"pose",atFrame:45}]})});
      await call("render_preview",{frames:[15,75]});
      const spec=await workspace.assemble();
      if(!workspace.reviewed(spec))throw Error(`Preview failed: ${workspace.previewIssue(spec)}`);
      const checked=await render.check(spec,{frames:[15,75],outDir:join(dir,"stills",shot.id)});
      if(!checked.ok)throw Error(JSON.stringify(checked.errors));
      for(const [n,path] of checked.stills.entries())await copyFile(path,join(dir,`${shot.id}-${n+1}.png`));
      await store.save(files.shotSpec(ep,shot.id),"SceneSpec",spec,{producedBy:"engine",inputs:[store.inputRef(files.shotList(ep)),store.inputRef(files.voiceover(ep))]});
      await workspace.freezeShared();
      console.log(`${shot.id}: 2 checked stills, ${spec.durationFrames} frames, source and shared design hashes saved`);
    }
    await writeFile(join(dir,"provenance.json"),JSON.stringify({author:"Hand-written fixture by Codex",path:"artistWorkspace manifest -> validateScene -> render.check -> ArtifactStore -> runRender -> Remotion Episode",format:production.format,durationSeconds:12,
      voice:"Offline moco systemAudio/SAPI; measured line durations, estimated per-word timings (the backend's normal contract). Fitted/padded to 4 seconds per shot.",
      art:"Original procedural Canvas drawing. Shared Pip character in shots 1 and 3. Pop at frames 0-5; snap at 45; dissolve at 120; fade-through-black at 240.",
      limitations:["Hand-authored proof, no live AI generation or automated critic call. Manual visual inspection is recorded separately before final export."]},null,2));
  } else {
    // This command is deliberately separate: inspect the six stills before declaring fixture acceptance.
    const shots=(await store.read(files.shotList(ep),"ShotList")).data.shots;
    await store.save(files.critique(ep),"Critique",{episodeId:ep,shots:shots.map(s=>({shotId:s.id,score:4,problems:[],fix:""})),overall:"Manual inspection of six proof-fixture stills; no automated critic score claimed.",quality:{status:"passed",unresolved:[],sceneHashes:Object.fromEntries(shots.map(s=>[s.id,store.hashOf(files.shotSpec(ep,s.id))!])),voiceoverHash:store.hashOf(files.voiceover(ep))!,shotListHash:store.hashOf(files.shotList(ep))!,report:"manual-visual-review.txt"}},{producedBy:"engine"});
    await runRender(ctx,ep,"final");
    const movie=join(dir,files.rendersDir(ep),"final.mp4");
    await copyFile(movie,join(dir,"freeform-proof.mp4"));
    for(const [i,time] of [.5,2.5,4.166667,6.5,8.166667,10.5].entries())await run("ffmpeg",["-v","error","-y","-ss",String(time),"-i",movie,"-frames:v","1",join(dir,`encoded-${i+1}.png`)]);
    console.log(join(dir,"freeform-proof.mp4"));
  }
} finally { await render.close(); }
