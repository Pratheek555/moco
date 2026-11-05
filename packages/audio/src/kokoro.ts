// Lightweight local CPU narration. Model files remain in the user's model folder.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Line } from "./index.ts";
import { amplitudeVisemes, parseWav } from "./lipsync.ts";
import { joinLines, wavFrom } from "./system.ts";

// Avoid a separate neural take (and leading/trailing pause) for every two-word
// montage command. Keep speaker, voice and emotion boundaries intact.
export function kokoroPhrases(lines:Line[]):(Line & {compact?:boolean})[] {
  const result:(Line & {compact?:boolean})[]=[];
  for(let i=0;i<lines.length;) {
    const first=lines[i]!;
    let end=i;
    while(end<lines.length && lines[end]!.text.trim().split(/\s+/).length<=3 && lines[end]!.speaker===first.speaker && lines[end]!.voiceId===first.voiceId && lines[end]!.delivery?.emotion===first.delivery?.emotion)end++;
    if(end-i>=3) {
      const last=lines[end-1]!;
      result.push({...first,text:lines.slice(i,end).map(line=>line.text.trim().replace(/[.!?]+$/g,"")).join(", ")+".",delivery:last.delivery,compact:true});
      i=end;
    } else { result.push(first);i++; }
  }
  return result;
}

export function kokoroAudio(options: { python: string; modelDir: string; voice?: string }) {
  return {
    async voices() { return [{id:"default",name:"Kokoro local narrator"}, ...["am_michael","af_bella","af_heart"].map(id=>({id,name:id}))]; },
    async tts(lines: Line[], _voice: {voiceId:string;backend:string}, language: string, outDir: string, signal?: AbortSignal) {
      if(language.split("-")[0]!=="en")throw Error("This Kokoro configuration supports English");
      await mkdir(outDir,{recursive:true});
      const request=join(outDir,"kokoro-request.json");
      const takeDir=await mkdtemp(join(outDir,"kokoro-takes-"));
      const phrases=kokoroPhrases(lines);
      await writeFile(request,JSON.stringify({lines:phrases,modelDir:options.modelDir,voice:options.voice??"am_michael",outDir:takeDir}));
      await new Promise<void>((resolve,reject)=>{
        const child=spawn(options.python,[fileURLToPath(new URL("../python/kokoro_worker.py",import.meta.url)),request],{windowsHide:true,signal,stdio:["ignore","pipe","pipe"]});
        let error="";child.stderr.on("data",chunk=>{error=(error+String(chunk)).slice(-4000)});
        const timer=setTimeout(()=>child.kill(),300_000);
        child.on("error",err=>{clearTimeout(timer);reject(err)});
        child.on("exit",code=>{clearTimeout(timer);code===0?resolve():reject(Error(`Local Kokoro failed (${code}): ${error}`))});
      });
      const clips=await Promise.all(phrases.map((_,i)=>readFile(join(takeDir,`kokoro-${i}.wav`)).then(parseWav)));
      const track=joinLines(phrases,clips), file=join(outDir,"vo.wav");
      const ids=lines.flatMap(line=>line.text.trim().split(/\s+/).map(()=>line.id));
      if(ids.length!==track.words.length)throw Error("Phrase assembly changed the script word count");
      track.words=track.words.map((word,index)=>({...word,lineId:ids[index]!}));
      await writeFile(file,wavFrom(track.pcm));
      return {file,durationSeconds:track.pcm.samples.length/track.pcm.sampleRate,words:track.words,backend:"kokoro"};
    },
    async align(): Promise<never> { throw Error("Use alignedAudio for measured Kokoro word timing"); },
    async visemes(file:string,words:import("@moco/spec").TimedWord[]) { return amplitudeVisemes(parseWav(await readFile(file)),words); },
  };
}
