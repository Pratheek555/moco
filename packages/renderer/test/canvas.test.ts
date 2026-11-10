import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderFrames, selectComposition } from "@remotion/renderer";
import { KIT_ASSETS_DIR } from "@moco/kit/assets";
import { afterAll, describe, expect, it } from "vitest";
import { CanvasScene, SceneSpec, type EpisodeSpec } from "@moco/spec";
import { canvasDocument } from "../src/canvas-document.ts";
import { createRemotionRenderPort } from "../src/index.ts";
import { serveEpisodeInput } from "../src/episode-input.ts";
import { decodePng } from "../src/pixels.ts";

it("escapes HTML and rejects remote assets", () => {
  const config = CanvasScene.parse({version:1,source:'throw Error("</script><script>alert(1)</script>")'});
  expect(canvasDocument(config, 640, 360).match(/<script>/g)).toHaveLength(1);
  expect(CanvasScene.safeParse({...config, assets:{bad:"https://example.com/a.png"}}).success).toBe(false);
  expect(CanvasScene.safeParse({...config, fonts:{bad:"https://example.com/font.ttf"}}).success).toBe(false);
});

describe.runIf(process.env.MOCO_RENDER_TESTS)("authored canvas renderer", () => {
  const port = createRemotionRenderPort({stillFrameBudget:6});
  afterAll(() => port.close());
  const scene = (source: string) => SceneSpec.parse({shotId:"canvas",durationFrames:60,format:{width:640,height:360,fps:60},background:{id:"custom"},actors:[],captions:[],canvas:{version:1,source}});
  it("leaves intentional blank/flat-colour authored holds to visual review", async () => {
    const held = scene("ctx.fillStyle='#000000';ctx.fillRect(0,0,640,360)");
    const checked = await port.check(held,{frames:[0],outDir:await mkdtemp(join(tmpdir(),"moco-authored-hold-"))});
    expect(checked.ok).toBe(true);
  },240_000);
  it("composites dissolves and fade-through-black at exact cut frames, including seeks", async () => {
    const red = scene("ctx.fillStyle='#ff0000';ctx.fillRect(0,0,640,360)");
    const blue = {...scene("ctx.fillStyle='#0000ff';ctx.fillRect(0,0,640,360)"),shotId:"blue",transition:{type:"dissolve" as const,durationFrames:11}};
    const green = {...scene("ctx.fillStyle='#00ff00';ctx.fillRect(0,0,640,360)"),shotId:"green",transition:{type:"fade-through-black" as const,durationFrames:11}};
    const input = await serveEpisodeInput({episodeId:"transitions",scenes:[red,blue,green],audio:{voiceover:""},export:red.format!});
    try {
      const serveUrl = await bundle({entryPoint:fileURLToPath(new URL("../src/remotion/index.ts",import.meta.url)),publicDir:KIT_ASSETS_DIR});
      const inputProps = {episode:input.episode,audioUrl:null};
      const composition = await selectComposition({serveUrl,id:"Episode",inputProps});
      expect(composition.durationInFrames).toBe(180);
      const expected: Record<number,number[]> = {60:[255,0,0],65:[127,0,128],70:[0,0,255],120:[0,0,255],125:[0,0,0],130:[0,255,0]};
      await renderFrames({composition,serveUrl,inputProps,frames:[125,65,60,130,70,120],concurrency:1,scale:.5,imageFormat:"png",outputDir:null,onStart:()=>{},onFrameUpdate:()=>{},
        onFrameBuffer:(buffer,frame)=>{
          const rgb = [...decodePng(buffer).data.slice(0,3)];
          rgb.forEach((value,index)=>expect(Math.abs(value-expected[frame]![index]!),`frame ${frame}`).toBeLessThanOrEqual(1));
        }});
    } finally { await input.close(); }
  },240_000);
  it("offers native SVG paths, SVG images, gradients, text, blend modes and offscreen layers inside isolation", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="gold"/></svg>';
    const spec = scene(`
      // Remotion injects a browser-only process.env.NODE_ENV shim, not Node.
      if(typeof require!=='undefined'||(typeof process!=='undefined'&&(typeof process.cwd==='function'||process.versions?.node)))throw Error('host access');
      let blocked=false;try{parent.document.body.innerHTML='bad'}catch{blocked=true}
      if(!blocked)throw Error('parent access');
      const g=ctx.createLinearGradient(0,0,640,360);g.addColorStop(0,'#cc3f72');g.addColorStop(1,'#293f77');
      ctx.fillStyle=g;ctx.fillRect(0,0,640,360);
      const layer=helpers.layer(80,80),lc=layer.getContext('2d');lc.fillStyle='#58bdaa';
      lc.fill(new Path2D('M0 0 L80 0 L40 80 Z'));ctx.drawImage(layer,100,100);
      ctx.globalCompositeOperation='screen';ctx.drawImage(scene.assets.icon,300,80,100,100);ctx.globalCompositeOperation='source-over';
      ctx.font='28px Arial';helpers.wordText(scene.words,20,300);
      if(scene.data.original!=='yes')throw Error('missing data');
    `);
    spec.canvas!.assets = {icon:`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`};
    spec.canvas!.words = [{text:"Original",startFrame:0,endFrame:60}];
    spec.canvas!.data = {original:"yes"};
    const checked = await port.check(spec,{frames:[0,30],outDir:await mkdtemp(join(tmpdir(),"moco-native-drawing-"))});
    expect(checked.ok,JSON.stringify(checked)).toBe(true);
  },240_000);
  it("waits for loaded drawings on the first frame, across cuts, and after seeks", async () => {
    const first = scene("ctx.fillStyle='#ff0000';ctx.fillRect(0,0,scene.width,scene.height)");
    const second = scene("ctx.fillStyle='#0000ff';ctx.fillRect(0,0,scene.width,scene.height)");
    const input = await serveEpisodeInput({episodeId: "cuts", scenes: [first, {...second, shotId: "second"}], audio: {voiceover: ""}, export: first.format!});
    try {
      const serveUrl = await bundle({entryPoint: fileURLToPath(new URL("../src/remotion/index.ts", import.meta.url)), publicDir: KIT_ASSETS_DIR});
      const inputProps = {episode: input.episode, audioUrl: null};
      const composition = await selectComposition({serveUrl, id: "Episode", inputProps});
      const captured: number[] = [];
      await renderFrames({composition, serveUrl, inputProps, frames: [60, 0, 59, 119], concurrency: 1, scale: 0.5,
        imageFormat: "png", outputDir: null, onStart: () => {}, onFrameUpdate: () => {},
        onFrameBuffer: (buffer, frame) => {
          captured.push(frame);
          const picture = decodePng(buffer);
          expect([...picture.data.slice(0, 3)], `frame ${frame}`).toEqual(frame < 60 ? [255, 0, 0] : [0, 0, 255]);
        },
      });
      expect(captured.sort((a, b) => a - b)).toEqual([0, 59, 60, 119]);
      // Unavailable artwork must fail explicitly, rather than render a blank frame.
      input.episode.scenes[0]!.canvasUrl = new URL("/missing", input.episode.scenes[0]!.canvasUrl).href;
      await expect(renderFrames({composition: {...composition, props: inputProps}, serveUrl, inputProps, frames: [0], concurrency: 1,
        imageFormat: "png", outputDir: null, onStart: () => {}, onFrameUpdate: () => {}, onFrameBuffer: () => {},
      })).rejects.toThrow("could not load (404)");
    } finally { await input.close(); }
  }, 240_000);
  it("renders embedded canvas episodes larger than Chrome's 100 MiB protocol limit", async () => {
    const bytes = await readFile(new URL("../../engine/assets/fonts/LilitaOne-Regular.ttf", import.meta.url));
    const spec = scene("if(!document.fonts.check('48px \"Lilita One\"'))throw Error('font not ready');ctx.fillStyle='#e4d9c7';ctx.fillRect(0,0,640,360);helpers.circle(320,180,50,'#48767a');");
    // TTF readers use the table directory; padding after the tables makes a valid
    // large embedded font without checking a 100 MiB fixture into the repository.
    const paddedFont = Buffer.concat([bytes, Buffer.alloc(800_000)]);
    spec.canvas!.fonts = { "Lilita One": `data:font/ttf;base64,${paddedFont.toString("base64")}` };
    const episode: EpisodeSpec = { episodeId: "large", scenes: Array.from({length: 112}, (_, index) => ({ ...spec, shotId: `s${index}`, durationFrames: 2 })), audio: { voiceover: "" }, export: spec.format! };
    expect(Buffer.byteLength(JSON.stringify(episode))).toBeGreaterThan(100 * 1024 * 1024);
    const out = join(await mkdtemp(join(tmpdir(), "moco-large-canvas-")), "preview.mp4");
    const result = await port.renderEpisode(episode, out, "preview");
    expect(result.durationSeconds).toBeCloseTo(224 / 60);
    expect((await stat(out)).size).toBeGreaterThan(1_000);
    // A source failure after lazy loading must still reject, rather than capture an empty frame or hang.
    episode.scenes = [{ ...spec, canvas: { ...spec.canvas!, source: "throw Error('episode source failure')" } }];
    await expect(port.renderEpisode(episode, out, "preview")).rejects.toThrow("episode source failure");
  }, 300_000);
  it("loads embedded fonts before accepting the first frame", async () => {
    const bytes=await readFile(new URL("../../engine/assets/fonts/LilitaOne-Regular.ttf",import.meta.url));
    const spec=scene("if(!document.fonts.check('48px \"Lilita One\"'))throw Error('font not ready');ctx.fillStyle='#e4d9c7';ctx.fillRect(0,0,640,360);ctx.fillStyle='#222';ctx.font='48px \"Lilita One\"';ctx.fillText('READY',30,100)");
    spec.canvas!.fonts={"Lilita One":`data:font/ttf;base64,${bytes.toString("base64")}`};
    const result=await port.check(spec,{frames:[0],outDir:await mkdtemp(join(tmpdir(),"moco-font-"))});
    if(!result.ok)throw Error(JSON.stringify(result.errors));
    expect(result.ok).toBe(true);
  },240_000);
  it("renders the acting controls deterministically at gesture endpoints", async () => {
    const source=`ctx.fillStyle='#e4d9c7';ctx.fillRect(0,0,scene.width,scene.height);
      const p=helpers.acting.pose('question',scene.frame/59);
      ctx.save();ctx.translate(240,20);ctx.scale(.7,.7);
      for(const arm of [p.left,p.right]){helpers.tube(arm,24,'#48767a');helpers.acting.hand(...arm[2],{shape:p.hand});}
      helpers.acting.face(0,100,{turn:p.headTurn,gaze:p.gaze,expression:p.expression,t:scene.t});ctx.restore();`;
    const dir=await mkdtemp(join(tmpdir(),"moco-acting-"));
    const result=await port.check(scene(source),{frames:[59,0,59],outDir:dir});
    expect(result.ok).toBe(true);
    if(!result.ok)throw Error(JSON.stringify(result.errors));
    const first=await readFile(join(dir,"59.png"));
    expect(first.equals(await readFile(join(dir,"0.png")))).toBe(false);
    const repeated=await port.check(scene(source),{frames:[59],outDir:join(dir,"repeat")});
    expect(repeated.ok).toBe(true);
    if(repeated.ok)expect(first.equals(await readFile(repeated.stills[0]!))).toBe(true);
  },240_000);
  it("renders frames out of order deterministically, isolates parent DOM, and repairs source errors", async () => {
    const source = `ctx.fillStyle='#e4d9c7';ctx.fillRect(0,0,scene.width,scene.height);
      let blocked=false;try{parent.document.body.innerHTML='broken'}catch{blocked=true}
      if(!blocked)throw Error('parent was accessible');
      helpers.circle(80+scene.frame*4,180,50,'#48767a');`;
    const dir = await mkdtemp(join(tmpdir(),"moco-canvas-"));
    const result = await port.check(scene(source),{frames:[40,0,40],outDir:dir});
    expect(result.ok).toBe(true);
    if(!result.ok) throw Error(JSON.stringify(result.errors));
    expect((await readFile(join(dir,"0.png"))).equals(await readFile(join(dir,"40.png")))).toBe(false);
    const repeat = await port.check(scene(source),{frames:[40],outDir:join(dir,"repeat")});
    expect(repeat.ok).toBe(true);
    if(repeat.ok) expect((await readFile(repeat.stills[0]!)).equals(await readFile(join(dir,"40.png")))).toBe(true);
    const bad = await port.check(scene(`throw Error('repair this drawing')`),{frames:[0],outDir:join(dir,"bad")});
    expect(bad).toMatchObject({ok:false,errors:[{path:"canvas.source",message:"repair this drawing"}]});
    // The renderer remains usable after a source failure (as in a repair attempt).
    const repaired = await port.check(scene(source),{frames:[20],outDir:join(dir,"repaired")});
    expect(repaired.ok).toBe(true);
  },240_000);
});
