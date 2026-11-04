// AI-authored vector scene -> normal moco artifacts -> engine runRender -> Remotion MP4.
// No mock AI, mock renderer, standalone HTML exporter or paid generation services.
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve, relative, dirname, basename } from "node:path";
import { chatterboxAudio } from "../packages/audio/src/chatterbox.ts";
import { parseWav } from "@moco/audio";
import { SceneSpec, type TimedWord } from "@moco/spec";
import { createRemotionRenderPort } from "@moco/renderer";
import { ArtifactStore } from "../packages/engine/src/store/artifacts.ts";
import { Ledger } from "../packages/engine/src/store/ledger.ts";
import { files } from "../packages/engine/src/pipeline/stages.ts";
import { runRender } from "../packages/engine/src/pipeline/render.ts";
import { EventBus } from "../packages/engine/src/events/bus.ts";
import { Semaphore } from "../packages/engine/src/jobs/semaphore.ts";

const dir=resolve(process.argv.slice(2).find(arg=>!arg.startsWith("--")) ?? "artifacts/authored-pharmacy");
const ep="ep-01", audioDir=join(dir,files.audioDir(ep));
await mkdir(audioDir,{recursive:true});
const run=(cmd:string,args:string[])=>new Promise<void>((ok,fail)=>{
  const child=spawn(cmd,args,{stdio:"inherit",windowsHide:true});
  child.on("error",fail);child.on("exit",code=>code===0?ok():fail(Error(`${cmd} exited ${code}`)));
});
const lines=[{id:"narration",text:"You think a pill with no medicine does nothing. But expectation can change how pain feels. That's the placebo effect."}];
const voice=join(audioDir,"vo.wav");
if(!await readFile(voice).then(()=>true,()=>false)){
  console.log("Generating local neural narration...");
  await chatterboxAudio({python:process.env.MOCO_VOICE_PYTHON ?? join(process.env.APPDATA!,"Moco/voice/runtime/Scripts/python.exe"),modelDir:process.env.MOCO_VOICE_MODEL_DIR ?? join(process.env.APPDATA!,"Moco/voice/models/english"),rate:1.08,seed:42}).tts(lines,{voiceId:"default",backend:"chatterbox"},"en",audioDir);
}
const alignment=join(audioDir,"words.json");
const original=join(audioDir,"narration-original.wav");
if(!await readFile(original).then(()=>true,()=>false)) await copyFile(voice,original);
// Keep speech clear; give the final reveal its own hold instead of excessively stretching the voice.
const tempo=0.8;
await run("ffmpeg",["-v","error","-y","-i",original,"-af",`atempo=${tempo},loudnorm=I=-14:TP=-1:LRA=7,apad=whole_dur=10`,"-ar","24000","-ac","1","-c:a","pcm_s16le",voice]);
const originalAlignment=join(audioDir,"words-original.json");
if(!await readFile(originalAlignment).then(()=>true,()=>false)){
  console.log("Aligning actual spoken words with cached faster-whisper small...");
  await run(process.env.MOCO_ALIGN_PYTHON ?? resolve(".venv-learn/Scripts/python.exe"),[resolve("scripts/align-demo.py"),original,originalAlignment]);
}
const words:TimedWord[]=(JSON.parse(await readFile(originalAlignment,"utf8")) as TimedWord[]).map(w=>({...w,start:w.start/tempo,end:w.end/tempo}));
await writeFile(alignment,JSON.stringify(words,null,2));
const find=(token:string,occurrence=1)=>{
  const match=words.filter(w=>w.text.toLowerCase().replace(/[^a-z]/g,"")===token)[occurrence-1];
  if(!match)throw Error(`Missing aligned word ${token} #${occurrence}`);
  return match.start;
};
const pcm=parseWav(await readFile(voice)),duration=pcm.samples.length/pcm.sampleRate;
const fps=60,format={width:1920,height:1080,fps};
const cuts=[0,Math.round(find("but")*fps),Math.round(find("that's".replace("'",""))*fps),Math.ceil(duration*fps)];
const source=await readFile(new URL("./demo-art/pharmacy.js",import.meta.url),"utf8");
const ledger=await Ledger.load(dir), store=new ArtifactStore(dir,ledger,()=>{});
const produced={producedBy:"ai" as const,backend:"codex-authored"};
await store.save(files.voiceover(ep),"VoiceoverTrack",{file:relative(dir,voice),durationSeconds:duration,words}, {producedBy:"engine"});
const shots=cuts.slice(0,-1).map((from,i)=>({id:`s0${i+1}`,start:from/fps,end:cuts[i+1]!/fps,lineIds:["narration"],intent:["Pharmacy: a person points at IT DOES NOTHING; red X on nothing.","Teaching board: expectation changes the experience of pain.","Theatre: PLACEBO EFFECT types onto a hanging physical sign."][i]!,characters:["viewer"],location:["pharmacy","clinic","stage"][i]!}));
await store.save(files.shotList(ep),"ShotList",{shots},produced);
const render=createRemotionRenderPort({concurrency:2});
const bus=new EventBus(dirname(dir));bus.on("render.progress",e=>console.log("render",e.data));
try{
  for(const [i,shot] of shots.entries()){
    const start=cuts[i]!, count=cuts[i+1]!-start;
    const cue=(id:string,seconds:number)=>({id,atFrame:Math.max(0,Math.min(count-1,Math.round(seconds*fps)-start))});
    const canvas={version:1,source:`const mode=${i};\n${source}`,cast:["viewer"],cues:[cue("sign",i===0?words[0]!.start:i===1?find("expectation"):find("the",1)),cue("deny",find("nothing")),cue("explain",find("change"))]};
    const scene=SceneSpec.parse({shotId:shot.id,durationFrames:count,format,background:{id:shot.location},actors:[],captions:[],canvas});
    await store.save(files.shotSpec(ep,shot.id),"SceneSpec",scene,{...produced,inputs:[store.inputRef(files.voiceover(ep)),store.inputRef(files.shotList(ep))]});
    const frames=Array.from({length:8},(_,n)=>Math.round((count-1)*n/7));
    const check=await render.check(scene,{frames,outDir:join(dir,files.shotDir(ep,shot.id),"stills")});
    if(!check.ok)throw Error(JSON.stringify(check.errors));
    console.log(`${shot.id}: ${count} frames, 8 render checks passed`);
  }
  if(!process.argv.includes("--stills-only")){
    await runRender({store,dir,render,bus,seriesId:basename(dir),signal:new AbortController().signal,renderSlots:new Semaphore(1)},ep,"final");
  }
  await writeFile(join(dir,"provenance.json"),JSON.stringify({author:"Codex in this session",path:"ArtifactStore -> runRender -> createRemotionRenderPort -> Episode -> Scene -> AuthoredCanvas",art:"Procedural vector drawing, no paid image model",voice:"Local Chatterbox, machine-generated narration",alignment:"faster-whisper small, measured word times",format,durationSeconds:duration,script:lines,limitations:["Demonstrates authored scenes and real engine rendering; not an autonomous end-to-end planner benchmark.","Music, SFX, motion blur and generated raster art are not included in this first prototype."]},null,2));
  console.log(join(dir,files.rendersDir(ep),"final.mp4"));
}finally{await render.close();}
