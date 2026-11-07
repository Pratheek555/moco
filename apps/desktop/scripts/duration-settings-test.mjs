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
  assert.deepEqual(errors,[]);
  console.log("PASS custom duration UI: prompt default, 20/37.5/120-second overrides, invalid durations blocked; no generation started");
}finally{await app.close();}
