import { expect,it } from "vitest";
import { kokoroPhrases } from "../src/kokoro.ts";

it("joins terse montage commands while retaining speaker, voice, emotion and final pause",()=>{
  const commands=["Grab socks.","Claim Robux.","Repeat forever."].map((text,i)=>({id:`l${i}`,text,speaker:"narrator",voiceId:"default",delivery:{emotion:"resolute" as const,intensity:.7,pauseAfterMs:120}}));
  const phrases=kokoroPhrases([...commands,{...commands[0]!,id:"mom",speaker:"mom",text:"Not so fast!"}]);
  expect(phrases).toHaveLength(2);
  expect(phrases[0]).toMatchObject({text:"Grab socks, Claim Robux, Repeat forever.",compact:true,delivery:{pauseAfterMs:120}});
  expect(phrases[1]?.speaker).toBe("mom");
  expect(kokoroPhrases(commands.slice(0,2))).toEqual(commands.slice(0,2));
});
