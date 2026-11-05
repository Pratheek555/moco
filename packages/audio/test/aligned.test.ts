import { mkdtemp,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect,it } from "vitest";
import { alignedAudio } from "../src/aligned.ts";

it("refuses a high-similarity transcript that omitted an entire spoken line",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"moco-align-coverage-"));
  const worker=join(dir,"worker.mjs");
  await writeFile(worker,`import {readFileSync,writeFileSync} from 'node:fs';const r=JSON.parse(readFileSync(process.argv[2],'utf8'));writeFileSync(r.output,JSON.stringify({similarity:.99,words:[{text:'hello',start:0,end:.5,lineId:'l01'}]}));`);
  const base={tts:async()=>({file:join(dir,"vo.wav"),durationSeconds:1}),align:async()=>[],visemes:async()=>[]};
  const audio=alignedAudio(base,{python:process.execPath,worker});
  await expect(audio.tts([{id:"l01",text:"hello"},{id:"l02",text:"Claim Robux"}],{voiceId:"default",backend:"local"},"en",dir)).rejects.toThrow("omitted script lines l02");
});
