import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { EpisodeScript } from "@moco/spec";
import { createEngine } from "../src/index.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import { findTemplate, ILLUSTRATED_EXPLAINER_ID } from "../src/templates/index.ts";
import { advance, approveNext, section, showData, validAnswer } from "./helpers.ts";
import { checkShotPlan } from "../src/planner/script.ts";
import { imageGenerationCapability } from "../src/artist/permissions.ts";

const example = JSON.parse(await readFile(new URL("../../../examples/explainers/queue.json", import.meta.url), "utf8"));
const script = EpisodeScript.parse(example.script);

it("keeps the original acceptance story short, complete and storyboarded", () => {
  expect(script.lines).toHaveLength(5);
  expect(checkShotPlan(script)).toEqual([]);
  expect(script.lines.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0)).toBeLessThanOrEqual(90);
});

// This exercises real engine orchestration with deterministic model/audio/render
// doubles. It verifies contracts and gates, not the artistic quality of generated video.
it.each(["codex-cli", "claude-cli"])("runs the portrait format through approvals without changing %s", async (provider) => {
  const dir = await mkdtemp(join(tmpdir(), "moco-explainer-"));
  let authors = 0, narration = 0;
  const audio = new FakeAudio(.37);
  const speak = audio.tts.bind(audio);
  audio.tts = async (...args) => { narration++; return speak(...args); };
  const ai = Object.assign(new FakeAi(async (request, task) => {
    if (["world", "bible", "scene"].includes(task)) throw Error("Explainers must use original artist artwork");
    if (task === "series") return { title: "How a queue works", language: "en", premise: example.topic, episodes: [{ id: "ep-01", title: "First in, first out", synopsis: example.topic }] };
    if (task === "show") {
      const base = showData();
      return { ...base, logline: example.topic, genre: "Illustrated explainer", narration: "Curious off-screen narration for a general audience.",
        format: { targetSeconds: 30, shotSeconds: { min: 3, max: 9 }, pacing: "Question, demonstration, answer." },
        look: { ...base.look, statement: example.visualDirection, captions: "Sparse physical labels in Montserrat; no continuous subtitles." },
        cast: [{ ...base.cast[0]!, id: "presenter", name: "Presenter", appearance: example.visualDirection }],
        places: [{ id: "booth", name: "Ticket booth", description: "Booth and explanatory board", mood: "Curious" }],
        requirements: [{ id: "diagram", text: "Readable first-in-first-out diagram and consistent presenter", support: "available", reason: "Custom Canvas artwork" }] };
    }
    if (task === "script") return script;
    if (task === "shots") {
      const words = section<{ text: string }[]>(request.prompt, "Words");
      return { shots: script.lines.map((line, i) => {
        const fromWord = script.lines.slice(0, i).reduce((sum, previous) => sum + previous.text.split(/\s+/).length, 0);
        expect(words[fromWord]!.text).toBe(line.text.split(/\s+/)[0]);
        return { id: `s0${i + 1}`, fromWord, intent: script.shotPlan![i]!.picture, characters: ["presenter"], location: "booth",
          actionChecks: [{ id: `s0${i + 1}-demonstration`, description: script.shotPlan![i]!.picture, fromWord, toWord: fromWord }] };
      }) };
    }
    if (task === "artist") {
      authors++;
      const call = async (name: string, args: object) => request.artistTools!.find(tool => tool.name === name)!.call(args);
      const id = /Create shot (s\d+)/.exec(request.prompt)![1]!;
      const result = await call("read_file", { path: `shots/${id}/brief.json` });
      const brief = JSON.parse(result.content.filter(block => block.type === "text").map(block => block.text).join(""));
      expect(brief.permissions).toMatchObject({ authoringAuthorized: true, storyboard: { status: "approved" }, images: { enabled: false } });
      expect(brief.templateBrief).toContain("DIAGRAMS, LABELS AND ACTING");
      expect(brief.production.format).toEqual({ width: 1080, height: 1920, fps: 60 });
      expect(request.artistTools!.some(tool => tool.name === "generate_image")).toBe(false);
      if (id === "s01") {
        await call("write_file", { path: "shared/design.md", content: example.visualDirection });
        await call("write_file", { path: "shared/characters.js", content: "function presenter(){helpers.circle(300,600,80,'#48767a')}" });
      }
      await call("write_file", { path: `shots/${id}/draw.js`, content: "ctx.fillStyle='#f3ecdf';ctx.fillRect(0,0,scene.width,scene.height);presenter();" });
      await call("write_file", { path: `shots/${id}/scene.json`, content: JSON.stringify({ sourceFiles: ["shared/characters.js", `shots/${id}/draw.js`], cast: ["presenter"] }) });
      await call("render_preview", {});
      return { finished: true };
    }
    if (task === "artist_review") {
      const parsed = JSON.parse(request.prompt);
      const targets = parsed.targets?.map((target: { shot: unknown }) => target.shot) ?? [parsed.target];
      const verdicts = targets.map((shot: { id: string; actionChecks: { id: string; description: string }[] }) => ({ id: shot.id, score: 4, overall: "Mock acceptance for orchestration test only", checks: shot.actionChecks.map(action => ({ ...action, status: "pass", severity: "major", evidence: "Test double", fix: "" })) }));
      return parsed.targets ? { verdicts } : verdicts[0];
    }
    if (task === "memory") return { storySoFar: "The presenter demonstrated first in, first out at a ticket booth.", newFacts: [{ entity: "presenter", fact: example.visualDirection, sinceEpisode: "ep-01" }] };
    return validAnswer(request, task);
  }), { id: provider, supportsArtist: true, seesImages: true });
  const render = new FakeRenderPort();
  const engine = createEngine({ projectsDir: dir, ai, audio, render });
  const id = await engine.createSeries({ idea: `${example.topic}\n\nIntended viewer: ${example.audience}\n\nVisual direction: ${example.visualDirection}`, language: "en", template: ILLUSTRATED_EXPLAINER_ID });
  expect((await engine.status(id)).series).toMatchObject({ episodes: 1, production: { mode: "artist", localOnly: true, targetSeconds: 30, format: { width: 1080, height: 1920, fps: 60 } } });
  for (const gate of ["series_plan", "bible", "ep-01/script"]) {
    await advance(engine, id);
    expect((await engine.status(id)).next).toMatchObject({ kind: "waiting", key: gate });
    expect(narration).toBe(0);
    expect(authors).toBe(0);
    await approveNext(engine, id);
  }
  await advance(engine, id);
  expect((await engine.status(id)).next).toMatchObject({ kind: "waiting", key: "ep-01/sample" });
  expect(narration).toBe(1);
  expect(authors).toBe(1);
  await approveNext(engine, id);
  await advance(engine, id);
  expect((await engine.status(id)).next).toMatchObject({ kind: "waiting", key: "ep-01/preview" });
  expect(authors).toBe(5);
  for (let n = 1; n <= 5; n++) {
    const scene = JSON.parse(await readFile(join(dir, id, `episodes/ep-01/shots/s0${n}/spec.json`), "utf8"));
    expect(scene.data).toMatchObject({ format: { width: 1080, height: 1920, fps: 60 }, actors: [], captions: [], fallback: false });
    expect(scene.data.canvas.source).toContain("function presenter");
    expect(scene.meta.backend).toBe(provider);
  }
  const planning = ai.requests.filter(request => /prompt: (series|show|script|shots)\b/.test(request.system));
  expect(planning.every(request => request.system.includes("FORMAT AND AUDIENCE"))).toBe(true);
  await approveNext(engine, id);
  await advance(engine, id);
  expect(render.renders).toBe(2); // preview then final, after approvals
  expect(ai.id).toBe(provider);
}, 30_000);

it("retains explicit duration and landscape overrides and blocks unsupported authoring", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-explainer-settings-"));
  const ai = Object.assign(new FakeAi(() => { throw Error("Creation must not call a model"); }), { supportsArtist: true });
  const engine = createEngine({ projectsDir: dir, ai, audio: new FakeAudio(), render: new FakeRenderPort() });
  const production = { ...findTemplate(ILLUSTRATED_EXPLAINER_ID)!.production!, targetSeconds: undefined, format: { width: 1920, height: 1080, fps: 60 } };
  const id = await engine.createSeries({ idea: "A 45-second explainer", language: "en", template: ILLUSTRATED_EXPLAINER_ID, production });
  expect((await engine.status(id)).series.production).toEqual(production);
  expect(imageGenerationCapability({ idea: "Generate images using GPT Image 2", production }, { supportsImageGeneration: true }).enabled).toBe(false);
  const unsupported = createEngine({ projectsDir: dir, ai: new FakeAi(() => ({})), audio: new FakeAudio(), render: new FakeRenderPort() });
  await expect(unsupported.createSeries({ idea: "Queue", language: "en", template: ILLUSTRATED_EXPLAINER_ID })).rejects.toThrow("does not support the artist workspace");
});
