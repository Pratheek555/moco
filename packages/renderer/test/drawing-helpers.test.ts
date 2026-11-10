import { afterEach, expect, it, vi } from "vitest";
import { drawingHelpersSource } from "../src/drawing-helpers.ts";
import { transitionAt } from "../src/transitions.ts";

// Evaluate exactly the trusted factory sent to the iframe (never authored input).
function fixture() {
  const gradient = { addColorStop: vi.fn() };
  const ctx = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), measureText: () => ({ width: 20 }), createRadialGradient: () => gradient,
    globalAlpha: 1, beginPath: vi.fn(), closePath: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn() };
  const scene = { frame: 15, width: 100, height: 200, words: [{ text: "one", startFrame: 0, endFrame: 10 }, { text: "two", startFrame: 10, endFrame: 20 }] };
  const helpers = new Function(`return (${drawingHelpersSource})`)()(ctx, scene);
  return { ctx, scene, helpers, gradient };
}
afterEach(() => vi.unstubAllGlobals());

it("offers snap, pop, overshoot, ease-out, hold, stagger and stepped animation without prescribing motion", () => {
  const { helpers: h } = fixture();
  expect([h.snap(9,10),h.snap(10,10),h.snap(40,10)]).toEqual([0,1,1]);
  expect([h.snap(9,10,2),h.snap(10,10,2),h.snap(11,10,2)]).toEqual([0,.5,1]);
  for (const easing of [h.pop,h.overshoot,h.easeOut]) {
    expect(easing(0)).toBeCloseTo(0); expect(easing(1)).toBeCloseTo(1);
  }
  expect(h.pop(.7)).toBeGreaterThan(1); expect(h.overshoot(.7)).toBeGreaterThan(1);
  expect(h.easeOut(.5)).toBeCloseTo(.875);
  expect([h.hold("poseA",8,9,"poseB"),h.hold("poseA",9,9,"poseB")]).toEqual(["poseA","poseB"]);
  expect(h.stagger(8,2,3,4)).toBe(.5);
  expect([h.step(5,2),h.step(5,3)]).toEqual([4,3]);
});
it("offers ballistic arcs, linear drift/push and reproducible seeded variation", () => {
  const { helpers: h } = fixture();
  expect(h.gravityArc([0,0],[100,40],0)).toEqual([0,0]);
  expect(h.gravityArc([0,0],[100,40],.5,60)).toEqual([50,-40]);
  expect(h.gravityArc([0,0],[100,40],1)).toEqual([100,40]);
  expect(h.camera(.5,{x:20,y:-10,push:.1})).toEqual({x:10,y:-5,scale:1.05});
  expect(h.seededRandom("star:42")).toBe(h.seededRandom("star:42"));
  expect(h.seededRandom("star:42")).not.toBe(h.seededRandom("star:43"));
  expect(h.seededRandom(2)).toBeGreaterThanOrEqual(0); expect(h.seededRandom(2)).toBeLessThan(1);
});
it("reveals and highlights text from measured words", () => {
  const { helpers: h, scene, ctx } = fixture();
  expect(h.words().map((word: {active: boolean}) => word.active)).toEqual([false,true]);
  h.wordText(scene.words,10,50,{frame:5});
  expect(ctx.fillText.mock.calls).toEqual([["one",10,50]]);
  ctx.fillText.mockClear();
  h.wordText(scene.words,10,50,{frame:15});
  expect(ctx.fillText.mock.calls).toEqual([["one",10,50],["two",42,50]]);
});
it("keeps rough ink attached, bounded and identical on out-of-order frames, with varying pressure", () => {
  const { helpers: h, ctx, scene } = fixture();
  const widths: number[] = [];
  ctx.stroke.mockImplementation(() => { widths.push((ctx as typeof ctx & { lineWidth: number }).lineWidth); });
  const points = [[10,20],[110,20],[110,80]];
  const original = structuredClone(points);
  h.wobblyStroke(points,{width:5,wobble:2,seed:"puppet",closed:true});
  const lines = structuredClone(ctx.lineTo.mock.calls);
  expect(ctx.moveTo.mock.calls[0]).toEqual([10,20]);
  expect(lines).toContainEqual([110,20]);
  expect(lines).toContainEqual([110,80]);
  expect(lines.at(-1)).toEqual([10,20]);
  for (const [x,y] of lines.slice(0,10)) { expect(x).toBeGreaterThan(10); expect(Math.abs(y-20)).toBeLessThanOrEqual(2); }
  expect(new Set(widths).size).toBeGreaterThan(1);
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(4.25);
  expect(Math.max(...widths)).toBeLessThanOrEqual(5.75);
  scene.frame = 99; ctx.lineTo.mockClear();
  h.wobblyStroke(points,{width:5,wobble:2,seed:"puppet",closed:true});
  expect(ctx.lineTo.mock.calls).toEqual(lines);
  expect(points).toEqual(original);
  ctx.lineTo.mockClear();
  h.wobblyStroke(points,{width:5,wobble:2,seed:"different",closed:true});
  expect(ctx.lineTo.mock.calls).not.toEqual(lines);
});
it("draws legible label glyphs as pen paths, measures/aligns them and never needs a font", () => {
  const { helpers: h, ctx } = fixture();
  expect(h.handLetterWidth("",{size:50})).toBe(0);
  expect(h.handLetterWidth("A B",{size:50,tracking:5})).toBeCloseTo(103);
  expect(h.handLetter("A B",200,100,{size:50,tracking:5,align:"center",seed:8})).toBeCloseTo(103);
  expect(ctx.translate.mock.calls[0]![0]).toBe(148.5);
  expect(ctx.translate.mock.calls[1]![0]).toBeCloseTo(215.5);
  expect(ctx.fillText).not.toHaveBeenCalled();
  const lines = structuredClone(ctx.lineTo.mock.calls);
  ctx.lineTo.mockClear();
  h.handLetter("a b",200,100,{size:50,tracking:5,align:"center",seed:8});
  expect(ctx.lineTo.mock.calls).toEqual(lines);
  ctx.lineTo.mockClear();
  h.handLetter("?",0,0); const question=structuredClone(ctx.lineTo.mock.calls);
  ctx.lineTo.mockClear();
  h.handLetter("\u2603",0,0); expect(ctx.lineTo.mock.calls).toEqual(question);
  ctx.lineTo.mockClear();
  h.handLetter("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?!.,:-/'()+=%",0,0);
  expect(ctx.lineTo.mock.calls.length).toBeGreaterThan(150);
  for(const point of ctx.lineTo.mock.calls) expect(point.every(Number.isFinite)).toBe(true);
});
it("offers tapered seeded paint ribbons with directional striations in the caller's clip", () => {
  const { helpers: h, ctx, scene } = fixture();
  const points=[[0,20],[50,20],[100,20]];
  h.paintStroke(points,{width:20,seed:'wood',opacity:.2});
  expect(ctx.fill).toHaveBeenCalledOnce();
  const outline=ctx.lineTo.mock.calls.slice(0,5);
  expect(ctx.moveTo.mock.calls[0]).toEqual([0,17.6]);
  expect(outline[0]![1]).toBeLessThan(12); // broad centre, narrow endpoints
  expect(outline[1]).toEqual([100,17.6]);
  expect(outline[2]).toEqual([100,22.4]);
  expect(ctx.stroke).toHaveBeenCalledTimes(3); // bounded cost, independent of the stroke's pixel length
  const drawing=structuredClone(ctx.lineTo.mock.calls);
  scene.frame=1;ctx.globalAlpha=1;ctx.lineTo.mockClear();
  h.paintStroke(points,{width:20,seed:'wood',opacity:.2});
  expect(ctx.lineTo.mock.calls).toEqual(drawing);
  ctx.lineTo.mockClear();h.paintStroke([]);expect(ctx.lineTo).not.toHaveBeenCalled();
});
it("offers palette lookup, grade, vignette, deterministic paper, rim light and offscreen layers", () => {
  const { helpers: h, ctx, gradient } = fixture();
  expect(h.palette({ink:"#123456"},"ink")).toBe("#123456");
  expect(h.palette({},"missing","#aaa")).toBe("#aaa");
  h.grade("#abc",.2,"multiply");
  expect(ctx).toMatchObject({globalAlpha:.2,globalCompositeOperation:"multiply",fillStyle:"#abc"});
  h.vignette(.4); expect(gradient.addColorStop.mock.calls).toEqual([[0,"rgba(0,0,0,0)"],[1,"rgba(0,0,0,0.4)"]]);
  ctx.fillRect.mockClear(); h.paper(1,.04,40); const texture = [...ctx.fillRect.mock.calls];
  ctx.fillRect.mockClear(); h.paper(1,.04,40); expect(ctx.fillRect.mock.calls).toEqual(texture);
  const draw = vi.fn(); h.rimLight(draw,"#fff",8); expect(draw).toHaveBeenCalledWith(ctx);
  expect(ctx).toMatchObject({shadowColor:"#fff",shadowBlur:8,shadowOffsetX:8});
  vi.stubGlobal("document",{createElement:(tag:string)=>({tag})});
  expect(h.layer(20,30)).toEqual({tag:"canvas",width:20,height:30});
});
it("keeps cuts instantaneous and dissolves/fades inside the incoming shot without shifting its duration", () => {
  expect(transitionAt(undefined,0,120)).toEqual({outgoing:0,incoming:1});
  expect(transitionAt({type:"cut",durationFrames:9},0,120)).toEqual({outgoing:0,incoming:1});
  const dissolve = {type:"dissolve" as const,durationFrames:11};
  expect(transitionAt(dissolve,0,120)).toEqual({outgoing:1,incoming:0});
  expect(transitionAt(dissolve,5,120)).toEqual({outgoing:1,incoming:.5});
  expect(transitionAt(dissolve,11,120)).toEqual({outgoing:0,incoming:1});
  const fade = {type:"fade-through-black" as const,durationFrames:11};
  expect(transitionAt(fade,0,120)).toEqual({outgoing:1,incoming:0});
  expect(transitionAt(fade,5,120)).toEqual({outgoing:0,incoming:0});
  expect(transitionAt(fade,10,120)).toEqual({outgoing:0,incoming:1});
  expect(transitionAt(fade,0,1)).toEqual({outgoing:0,incoming:1});
});
