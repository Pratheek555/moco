import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { advance, approveNext, section, setup } from "./helpers.ts";

it("saves authored scene source through the ordinary generation pipeline without forcing captions or kit actors", async () => {
  const {engine,dir}=await setup({scene:request=>{
    const brief=section<{shotId:string;durationFrames:number;location:string}>(request.prompt,"Shot brief");
    return {shotId:brief.shotId,durationFrames:brief.durationFrames,background:{id:brief.location},actors:[],captions:[],canvas:{version:1,cast:["krishna","arjuna"],source:"helpers.circle(scene.width/2,scene.height/2,100,'#48767a');"}};
  }});
  const id=await engine.createSeries({idea:"Flat illustrations, words only on signs, no subtitles. "+"Full creative direction. ".repeat(200),language:"en",episodes:1});
  for(let i=0;i<4;i++){await advance(engine,id);await approveNext(engine,id);}
  const saved=JSON.parse(await readFile(join(dir,id,"episodes/ep-01/shots/s01/spec.json"),"utf8"));
  expect(saved.data.canvas.source).toContain("helpers.circle");
  expect(saved.data.captions).toEqual([]);
  expect(saved.data.fallback).toBe(false);
});
