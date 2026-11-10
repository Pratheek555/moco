import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blenderShot } from "../../spec/test/blender-fixture.ts";
import { silentWav } from "@moco/audio";
import { createBlenderRenderPort, blenderStatus } from "../src/blender/index.ts";
import { runTool } from "../src/blender/process.ts";
import { decodePng } from "../src/pixels.ts";

describe("Blender process lifecycle", () => {
  it("stops a timed out subprocess and reports its failure", async () => {
    await expect(runTool(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 })).rejects.toThrow("timed out");
  });
  it("does not launch work for an already aborted job", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runTool("does-not-exist", [], { signal: controller.signal })).rejects.toBeTruthy();
  });
  it("cancels an in-flight subprocess", async () => {
    const controller = new AbortController();
    const pending = runTool(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });
});

describe.runIf(process.env.MOCO_BLENDER_TESTS === "1")("real Blender export", () => {
  let dir: string;
  const port = createBlenderRenderPort({ samples: 4 });
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "moco-blender-test-")); expect((await blenderStatus()).ok).toBe(true); });
  afterAll(async () => { await port.close(); await rm(dir, { recursive: true, force: true }); });

  it("renders animated stills and a JPEG thumbnail", async () => {
    const result = await port.check(blenderShot(), { frames: [0,5], outDir: join(dir, "stills") });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const first = await readFile(result.stills[0]!), last = await readFile(result.stills[1]!);
    expect(first.equals(last)).toBe(false);
    expect(decodePng(first)).toMatchObject({ width: 80, height: 120 });
    const out = join(dir, "thumbnail.jpg");
    await port.thumbnail(blenderShot(), { frame: 3, text: "Blender test", out });
    expect((await readFile(out)).subarray(0,2).toString("hex")).toBe("ffd8");
  }, 120_000);

  it("exports two shots with audio, exact duration and reusable editable scenes", async () => {
    const { writeFile } = await import("node:fs/promises");
    const audio = join(dir, "voice.wav"); await writeFile(audio, silentWav(2));
    const scene = blenderShot();
    const episode = { episodeId: "ep-01", scenes: [scene, { ...scene, shotId: "s02" }], audio: { voiceover: audio }, export: scene.format! };
    const out = join(dir, "final.mp4");
    const progress: number[] = [];
    const result = await port.renderEpisode(episode, out, "final", value => progress.push(value));
    expect(result.durationSeconds).toBe(2);
    expect((await stat(out)).size).toBeGreaterThan(1000);
    expect(progress.at(-1)).toBe(1);
    const probe = JSON.parse(await runTool(process.env.MOCO_FFPROBE_PATH ?? "ffprobe", ["-v","error","-show_streams","-show_format","-of","json",out]));
    expect(probe.streams.find((s: {codec_type: string}) => s.codec_type === "video")).toMatchObject({ width: 160, height: 240, nb_frames: "12" });
    expect(probe.streams.some((s: {codec_type: string}) => s.codec_type === "audio")).toBe(true);
    const cache = join(dir, ".blender-cache");
    const entries = await readdir(cache);
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(await readdir(join(cache,entry))).toEqual(expect.arrayContaining(["scene.blend","shot.mp4"]));
    const before = await Promise.all(entries.map(entry => stat(join(cache,entry,"scene.blend")).then(s => s.mtimeMs)));
    await port.renderEpisode(episode, join(dir,"cached.mp4"), "final");
    expect(await Promise.all(entries.map(entry => stat(join(cache,entry,"scene.blend")).then(s => s.mtimeMs)))).toEqual(before);
  }, 180_000);

  it("resolves pinned project artwork and exports odd-length native cutout animation on twos", async () => {
    const registry=join(dir,"assets/blender");await mkdir(registry,{recursive:true});
    const sample=await port.check(blenderShot(),{frames:[0],outDir:join(dir,"texture")});
    if(!sample.ok)throw Error(JSON.stringify(sample.errors));
    const image=join(registry,"paint.png");await copyFile(sample.stills[0]!,image);
    const sha256=createHash("sha256").update(await readFile(image)).digest("hex");
    await writeFile(join(registry,"manifest.json"),JSON.stringify([{id:"paint",file:"paint.png"}]));
    const cutout=blenderShot(5);
    Object.assign(cutout.blender!,{renderStyle:"illustration",rasterizer:"workbench",animationStep:2,assets:[{id:"paint",sha256}],camera:{lens:50,projection:"orthographic",orthoScale:3,keys:[{atFrame:0,eye:[0,0,10],target:[0,0,0]}]},objects:[
      {id:"background",kind:"image",image:"paint",material:"floor",position:[0,0,-1],scale:[2,3,1]},
      {id:"ball",kind:"path",material:"coral",path:{points:[[-.5,-.5],[.5,-.5],[0,.5]],strokeMaterial:"floor"},keys:[{atFrame:0,position:[-.2,0,0]},{atFrame:4,position:[.2,0,0]}]},
    ]});
    const renderer=createBlenderRenderPort({assetRoots:[dir]});
    try{
      const output=join(dir,"renders/cutout.mp4");
      await renderer.renderEpisode({episodeId:"cutout",scenes:[cutout],audio:{voiceover:""},export:cutout.format!},output,"final");
      const probe=JSON.parse(await runTool("ffprobe",["-v","error","-show_streams","-of","json",output]));
      expect(probe.streams[0]).toMatchObject({width:160,height:240,nb_frames:"5"});
      await writeFile(image,Buffer.from("changed artwork"));
      await expect(renderer.check(cutout,{frames:[0],outDir:join(dir,"changed")})).rejects.toThrow("has changed");
    }finally{await renderer.close();}
  },120_000);
});
