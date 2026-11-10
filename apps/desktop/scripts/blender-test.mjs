// Real Electron → preload IPC → engine-host check, with a disposable profile.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-blender-ui-"));
const projects = process.env.MOCO_BLENDER_PROJECTS ?? path.join(profile, "projects");
const artifacts = process.env.MOCO_BLENDER_ARTIFACTS ?? path.resolve(desktop,"../../artifacts/blender-desktop");
await mkdir(artifacts,{recursive:true});
await writeFile(path.join(profile,"settings.json"),JSON.stringify({onboarded:true,projectsDir:projects,voice:{backend:"system"}}));
const env = {...process.env,MOCO_USER_DATA:profile}; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({args:[desktop],cwd:desktop,env,timeout:60_000});
try {
  const page = await app.firstWindow();
  const errors=[]; page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await page.getByRole("tab",{name:"Rendering",exact:true}).click();
  await page.getByLabel("Renderer for new animations").click();
  await page.getByRole("option",{name:"Blender · native 3D animation",exact:true}).click();
  await page.getByRole("button",{name:"Check Blender installation",exact:true}).click();
  await expect(page.getByText(/Blender 4\.5\.\d+ ready/)).toBeVisible({timeout:30_000});
  await page.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect.poll(() => page.evaluate(async () => (await window.moco.settings.get()).render.backend)).toBe("blender");
  await page.reload();
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await page.getByRole("tab",{name:"Rendering",exact:true}).click();
  await expect(page.getByLabel("Renderer for new animations")).toContainText("Blender");
  await page.screenshot({path:path.join(artifacts,"settings.png")});
  // No duplicate AI calls during the playback verification.
  await app.evaluate(({ipcMain}) => {
    ipcMain.removeHandler("moco:ai.status");
    ipcMain.handle("moco:ai.status",()=>({ok:false,reason:"No AI calls during the renderer wiring test"}));
  });
  const seriesId=process.env.MOCO_BLENDER_SERIES;
  if (seriesId) {
    const info=await page.evaluate(id=>window.moco.series.status(id),seriesId);
    assert.equal(info.series.renderer,"blender");
    const media=await page.evaluate(id=>window.moco.episode.media(id,"ep-01"),seriesId);
    assert.ok(media.final,"Finished Blender video must be exposed by Moco");
    assert.equal(Boolean(media.outdatedFinal),false,"Finished video must match the current renderer");
    const playback=await page.evaluate(async url=>{
      const video=document.createElement("video"); video.muted=true; video.preload="auto"; video.src=url;
      document.body.append(video);
      await new Promise((resolve,reject)=>{
        video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error(video.error?.message??"Video did not load"));
        setTimeout(()=>reject(new Error("Video metadata timed out")),30_000);
      });
      const result={width:video.videoWidth,height:video.videoHeight,duration:video.duration};
      video.currentTime=Math.min(2,video.duration/2);
      await new Promise(resolve=>video.onseeked=resolve);
      await video.play(); await new Promise(resolve=>setTimeout(resolve,250)); video.pause();
      result.played=video.currentTime>2;
      video.remove();return result;
    },media.final);
    assert.equal(playback.width,Number(process.env.MOCO_BLENDER_WIDTH??1080));
    assert.equal(playback.height,Number(process.env.MOCO_BLENDER_HEIGHT??1920));
    assert.ok(playback.duration>10);assert.ok(playback.played);
    const plan=await page.evaluate(id=>window.moco.series.artifact(id,"artifacts/series_plan.json"),seriesId);
    await page.getByRole("button",{name:"My series",exact:true}).click();
    await page.getByRole("button",{name:plan.data.title,exact:true}).click();
    await page.getByText("Project workspace",{exact:true}).click();
    await page.getByRole("list",{name:"Episodes"}).getByRole("button").first().click();
    await expect(page.getByText("Final render",{exact:true})).toBeVisible();
    await expect(page.locator("video").first()).toHaveJSProperty("readyState",4);
    const displayedPlayback=await page.locator("video").first().evaluate(async video=>{
      video.muted=true;
      const start=video.currentTime;
      await video.play();
      await new Promise(resolve=>setTimeout(resolve,500));
      video.pause();
      return video.currentTime>start;
    });
    assert.ok(displayedPlayback,"The episode page must play the finished Blender video");
    await page.screenshot({path:path.join(artifacts,"finished-episode.png")});
    console.log("Moco playback:",JSON.stringify(playback));
  } else {
    const probe=await page.evaluate(()=>window.moco.settings.blenderStatus());
    assert.equal(probe.ok,true);
  }
  assert.deepEqual(errors,[]);
  console.log("Blender desktop settings, persistence, IPC and installation checks passed.");
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({path:path.join(artifacts,"failure.png")}).catch(()=>{});
  await writeFile(path.join(artifacts,"failure.html"),await page.content()).catch(()=>{});
  throw error;
} finally { await app.close(); await rm(profile,{recursive:true,force:true}); }
