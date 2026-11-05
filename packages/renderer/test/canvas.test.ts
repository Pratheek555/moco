import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CanvasScene, SceneSpec } from "@moco/spec";
import { canvasDocument } from "../src/canvas-document.ts";
import { createRemotionRenderPort } from "../src/index.ts";

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
