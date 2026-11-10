// Verify renderer submission without starting generation or changing real projects.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const profile=await mkdtemp(path.join(tmpdir(),"moco-duration-ui-"));
await writeFile(path.join(profile,"settings.json"),JSON.stringify({onboarded:true,projectsDir:path.join(profile,"projects")}));
const templateProduction={mode:"artist",localOnly:true,format:{width:1440,height:1080,fps:24},targetSeconds:42};
const templateDir=path.join(profile,"styles","format-fixture");
await mkdir(templateDir,{recursive:true});
await writeFile(path.join(templateDir,"moco-template.md"),"# Creative prompt\nOriginal illustrated scenes");
await writeFile(path.join(templateDir,"moco-template.json"),JSON.stringify({
  id:"format-fixture",name:"Format fixture",palette:{sky:["#123456","#345678"],accents:[]},
  creativePrompt:"Original illustrated scenes",production:templateProduction,defaults:{episodes:1},
}));
const env={...process.env,MOCO_USER_DATA:profile,CODEX_HOME:path.join(profile,"codex-home")};
delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[desktop],cwd:desktop,env});
try{
  const page=await app.firstWindow();
  await app.evaluate(({ipcMain})=>{
    globalThis.durationRequests=[];
    ipcMain.removeHandler("moco:series.create");
    ipcMain.handle("moco:series.create",(_e,input)=>{globalThis.durationRequests.push(input);throw Error("Test request captured; no generation started");});
    ipcMain.removeHandler("moco:ai.status");
    ipcMain.handle("moco:ai.status",()=>({ok:true,authMethod:"Test"}));
    ipcMain.removeHandler("moco:voice.list");
    ipcMain.handle("moco:voice.list",()=>[{id:"test",name:"Test voice",locale:"en-US"}]);
  });
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.getByRole("button",{name:"Story options",exact:true}).click();
  await page.getByLabel("Visual approach").click();
  await page.getByRole("option",{name:"Custom illustration · experimental"}).click();
  const duration=page.getByLabel("Length in seconds (optional)");
  await expect(duration).toHaveValue("");
  const artifacts=path.resolve(desktop,"../../artifacts/studio-implementation");
  await mkdir(artifacts,{recursive:true});
  await page.setViewportSize({width:1120,height:720});
  await expect(page.getByRole("button",{name:"Done",exact:true})).toBeInViewport();
  await expect(duration).toBeInViewport();
  await page.screenshot({path:path.join(artifacts,"00-story-options-illustration.png"),animations:"disabled"});
  await page.getByRole("button",{name:"Done",exact:true}).click();
  const idea=page.getByLabel("What story will you tell?");
  await idea.fill("Make a 20-second illustrated explainer about your nose.");
  const submit=()=>idea.press(process.platform==="darwin"?"Meta+Enter":"Control+Enter");
  await submit();
  await expect.poll(()=>app.evaluate(()=>globalThis.durationRequests.length)).toBe(1);
  assert.equal((await app.evaluate(()=>globalThis.durationRequests[0])).production.targetSeconds,undefined);
  for(const [index,value] of ["20","37.5","120"].entries()){
    await page.getByRole("button",{name:"Story options",exact:true}).click();
    await duration.fill(value);
    await page.getByRole("button",{name:"Done",exact:true}).click();
    await submit();
    await expect.poll(()=>app.evaluate(()=>globalThis.durationRequests.length)).toBe(index+2);
    assert.equal((await app.evaluate(()=>globalThis.durationRequests.at(-1))).production.targetSeconds,Number(value));
  }
  for(const value of ["0","-5"]){
    await page.getByRole("button",{name:"Story options",exact:true}).click();
    await duration.fill(value);
    await page.getByRole("button",{name:"Done",exact:true}).click();
    await submit();
    await expect(page.getByText("Enter a positive duration in seconds, or leave it blank to use your prompt.",{exact:true}).first()).toBeVisible();
    assert.equal(await app.evaluate(()=>globalThis.durationRequests.length),4);
  }
  const options=()=>page.getByRole("button",{name:"Story options",exact:true}).click();
  const chooseTemplate=async name=>{
    await page.getByRole("combobox",{name:"Template",exact:true}).click();
    await page.getByRole("option",{name,exact:true}).click();
  };
  const capture=async()=>{
    const count=await app.evaluate(()=>globalThis.durationRequests.length);
    await page.getByRole("button",{name:"Done",exact:true}).click();
    await submit();
    await expect.poll(()=>app.evaluate(()=>globalThis.durationRequests.length)).toBe(count+1);
    return app.evaluate(()=>globalThis.durationRequests.at(-1));
  };
  await options();
  await chooseTemplate("kurzgesat style");
  const shape=page.getByRole("combobox",{name:"Video shape",exact:true});
  await expect(shape).toHaveText("Landscape · 16:9");
  const defaultRequest=await capture();
  assert.equal(defaultRequest.template,"kurzgesat-style");
  assert.deepEqual(defaultRequest.production,{mode:"artist",format:{width:1920,height:1080,fps:60}});
  for(const [name,width,height] of [["Portrait · 9:16",1080,1920],["Square · 1:1",1080,1080],["Landscape · 16:9",1920,1080],["Portrait · 9:16",1080,1920]]){
    await options();
    await shape.click();
    await page.getByRole("option",{name,exact:true}).click();
    const request=await capture();
    assert.equal(request.template,"kurzgesat-style");
    assert.deepEqual(request.production,{mode:"artist",format:{width,height,fps:60}});
    await options();
    await expect(shape).toHaveText(name);
    await page.getByRole("button",{name:"Done",exact:true}).click();
  }
  await options();
  await chooseTemplate("Format fixture");
  await expect(shape).toHaveText("Portrait · 9:16");
  assert.deepEqual((await capture()).production,{...templateProduction,format:{width:1080,height:1920,fps:24}});
  // A fresh composer preserves arbitrary template defaults until a shape is chosen.
  await page.reload();
  await idea.fill("An illustrated explanation of rain.");
  await options();
  await chooseTemplate("Format fixture");
  await expect(shape).toHaveText("Template default · 1440 × 1080");
  assert.deepEqual((await capture()).production,templateProduction);
  await options();
  await chooseTemplate("Cartoon 3D story short");
  await expect(shape).toHaveCount(0);
  const legacyRequest=await capture();
  assert.equal(legacyRequest.template,"cartoon-3d-short");
  assert.equal(legacyRequest.production,undefined);
  assert.deepEqual(errors,[]);
  console.log("PASS duration and format UI: valid/invalid durations, landscape/portrait/square templates, shape retained across styles, arbitrary defaults and template settings preserved, legacy pipeline unchanged; no generation started");
}finally{await app.close();}
