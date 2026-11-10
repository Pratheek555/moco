import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { importPromptTemplate } from "../src/templates/import.ts";
import { allTemplates, setStylesDir, templateImages } from "../src/templates/registry.ts";
import { loadPrompt, promptRef } from "../src/generator/prompts.ts";
import { checkShotPlan } from "../src/planner/script.ts";
import { createEngine } from "../src/index.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import type { AudioPort } from "../src/ports.ts";
import { advance, approveNext, validAnswer, scriptData, section } from "./helpers.ts";

it("persists arbitrary prompts and routes planning to canvas, stopping before voice for script + pictures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-prompt-"));
  const production = { mode: "artist" as const, format: { width: 1920, height: 1080, fps: 60 }, targetSeconds: 45, localOnly: true };
  const frame="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=";
  const imported = await importPromptTemplate(join(dir, "styles"), { name: "My vector show", prompt: "<direction>NO OUTLINES sentinel</direction>", production, referenceImages:[frame] });
  setStylesDir(join(dir, "styles"));
  try {
    expect(allTemplates().find(t => t.id === imported.id)).toMatchObject({ creativePrompt: imported.creativePrompt, production });
    expect(loadPrompt("artist", imported.id)).toContain("NO OUTLINES sentinel");
    expect(promptRef("artist", imported.id).contentHash).not.toBe(promptRef("artist").contentHash);
    let voices = 0;
    const audio = Object.assign(new FakeAudio(0.425),{ttsMeasured:undefined as AudioPort["tts"]|undefined}); // 112 words: >5% over 45s, within the legacy 10% allowance
    const original = audio.tts.bind(audio);
    audio.tts = async (...args) => { voices++; return original(...args); };
    let measured=0;
    audio.ttsMeasured=async (...args)=>{measured++;return audio.tts(args[0],args[1],args[2],args[3]);};
    const ai = Object.assign(new FakeAi((request, task) => {
      if (task === "world" || task === "bible") throw Error("Unexpected 3D work");
      if (task === "show") return { ...validAnswer(request, task) as object, requirements: [{id:"art",text:"Canvas",support:"available",reason:"Vector code"}] };
      if (task === "script") {
        const script = scriptData();
        return { ...script, shotPlan: script.lines.map(line => ({ lineId: line.id, seconds: 45 / script.lines.length, picture: "Viewer points to a physical board" })) };
      }
      return validAnswer(request, task);
    }), { supportsArtist: true, seesImages: true });
    const engine = createEngine({ projectsDir: dir, stylesDir: join(dir,"styles"), ai, audio, render: new FakeRenderPort() });
    const defaultId = await engine.createSeries({ idea: "Template defaults", language: "en", template: imported.id });
    expect((await engine.status(defaultId)).series.production).toEqual(production);
    const portrait = { ...production, format: { width: 1080, height: 1920, fps: 60 } };
    const id = await engine.createSeries({ idea: "Why do we dream?", language: "en", template: imported.id, production: portrait });
    expect((await engine.status(id)).series.episodes).toBe(1);
    expect((await engine.status(id)).series).toMatchObject({ template: imported.id, production: portrait });
    for (let n=0;n<2;n++) { await advance(engine,id); await approveNext(engine,id); }
    await advance(engine,id);
    expect((await engine.status(id)).next).toMatchObject({kind:"waiting",key:"ep-01/script"});
    expect(voices).toBe(0);
    expect(measured).toBe(0);
    const prematureReview=await engine.waitForJob(await engine.reviewEpisode({seriesId:id,episodeId:"ep-01"}));
    expect(prematureReview.error?.code).toBe("stage_blocked");
    const saved = JSON.parse(await readFile(join(dir,id,"episodes/ep-01/artifacts/script.json"),"utf8"));
    expect(saved.data.shotPlan).toHaveLength(8);
    expect(ai.requests.every(request => request.system.includes("NO OUTLINES sentinel"))).toBe(true);
    expect(ai.requests.every(request => request.system.includes("production.format overrides template dimensions"))).toBe(true);
    for (const request of ai.requests) expect(section(request.prompt, "Production settings")).toEqual(portrait);
    expect(ai.requests.every(request => request.prompt.includes("USER-SELECTED LOCAL MODE"))).toBe(true);
    expect(ai.requests.every(request => request.images?.[0]===templateImages(imported.id)[0])).toBe(true);
    await approveNext(engine,id);
    await advance(engine,id);
    expect(measured).toBe(1);
    const refit=await engine.status(id);
    expect(refit.decisions.some(decision => decision.category === "send_back")).toBe(true);
    expect(refit.next).toMatchObject({kind:"waiting",key:"ep-01/script"});
    const before=promptRef("artist",imported.id).contentHash;
    const image=templateImages(imported.id)[0]!;
    await writeFile(image,Buffer.concat([await readFile(image),Buffer.from("changed reference")]));
    expect(promptRef("artist",imported.id).contentHash).not.toBe(before);
  } finally { setStylesDir(undefined); }
});

it("rejects invalid imports and incomplete review plans", async () => {
  const dir=await mkdtemp(join(tmpdir(),"moco-import-"));
  const production={mode:"artist" as const,format:{width:1080,height:1920,fps:60}};
  await expect(importPromptTemplate(dir,{name:"",prompt:"x",production})).rejects.toThrow();
  await expect(importPromptTemplate(dir,{name:"x",prompt:"x",production:{...production,format:{...production.format,fps:0}}})).rejects.toThrow();
  await expect(importPromptTemplate(dir,{name:"x",prompt:"x",production,referenceImages:["https://example.com/a.png"]})).rejects.toThrow();
  await expect(importPromptTemplate(dir,{name:"x",prompt:"x",production,referenceImages:["data:image/png;base64,YQ=="]})).rejects.toThrow();
  expect(checkShotPlan(scriptData()).length).toBeGreaterThan(0);
  expect(checkShotPlan({...scriptData(),shotPlan:[{lineId:"missing",seconds:45,picture:"A board"}]}).length).toBeGreaterThan(0);
});
