import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import type { AiRequest } from "@moco/ai";
import { createEngine, type StyleSampleInput } from "../src/index.ts";
import { allTemplates, lookupTemplate } from "../src/templates/registry.ts";
import { copiedPhrases } from "../src/templates/samples.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import { advance, approveNext, section, showData, validAnswer } from "./helpers.ts";

const input: StyleSampleInput = { templateId: "learned", topic: "How bread rises", language: "en", seconds: 12, format: { width: 960, height: 540, fps: 60 }, choices: { palette: [], detail: "balanced", acting: "expressive", pacing: "balanced", feedback: "Make the pointing clear" } };

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "moco-style-sample-"));
  const styles = join(root, "styles"), source = join(styles, "learned");
  await mkdir(source, { recursive: true });
  const template = { id: "learned", name: "Illustrated", creativePrompt: "STYLE-SENTINEL: original geometric art", production: { mode: "artist", localOnly: true, format: input.format }, palette: { sky: ["#000000", "#ffffff"], ground: "#333333", accents: ["#ff0000"] }, missing: ["Stock soundtrack unavailable"] };
  await writeFile(join(source, "moco-template.json"), JSON.stringify(template));
  await writeFile(join(source, "moco-template.md"), "# artist\nSTYLE-SENTINEL");
  await writeFile(join(source, "style-rules.json"), JSON.stringify({ sections: [], measurements: [{ key: "wpm", label: "Speaking rate", unit: "wpm", values: [120, 140] }] }));
  await writeFile(join(source, "content-exclusions.json"), JSON.stringify({ references: [{ id: "r1", contentSpecifics: ["Reference Hero"], words: ["Never", "copy", "this", "reference", "script"] }] }));
  await writeFile(join(source, "leaks.json"), "[]");
  const ai = Object.assign(new FakeAi(async (request, task) => {
    if (task === "artist") {
      const tools = request.artistTools!;
      const call = (name: string, args: object) => tools.find(tool => tool.name === name)!.call(args);
      const id = /Create shot (s\d+)/.exec(request.prompt)![1]!;
      const listing = JSON.parse((await call("list_files", {})).content.filter(c => c.type === "text").map(c => c.text).join("")) as string[];
      if (!listing.includes("shared/characters.js")) await call("write_file", { path: "shared/characters.js", content: "function character(){helpers.circle(100,100,50,'#ff0000')}" });
      await call("write_file", { path: `shots/${id}/draw.js`, content: "ctx.fillStyle='#fff';ctx.fillRect(0,0,scene.width,scene.height);character();" });
      await call("write_file", { path: `shots/${id}/scene.json`, content: JSON.stringify({ sourceFiles: ["shared/characters.js", `shots/${id}/draw.js`], cast: ["krishna"], cues: [] }) });
      await call("render_preview", {});
      return { finished: true };
    }
    if (task === "artist_review") {
      const data = JSON.parse(request.prompt), shots = data.targets?.map((item: { shot: unknown }) => item.shot) ?? [data.target];
      const verdicts = shots.map((shot: { id: string; actionChecks: { id: string; description: string }[] }) => ({ id: shot.id, score: 4, overall: "Fake evidence review", checks: shot.actionChecks.map(check => ({ ...check, status: "pass", severity: "major", evidence: "Test frames", fix: "" })) }));
      return data.targets ? { verdicts } : verdicts[0];
    }
    if (task === "show") return { ...showData(), format: { targetSeconds: 12, shotSeconds: { min: 1, max: 8 }, pacing: "Two motivated cuts" }, requirements: [{ id: "art", text: "Original illustrations", support: "available", reason: "Canvas" }] };
    if (task === "script") {
      const episode = section<{ wordBudget: number }>(request.prompt, "Episode");
      return { targetSeconds: 12, lines: [{ id: "l01", text: Array.from({ length: episode.wordBudget }, (_, index) => `original${index}`).join(" "), beat: "Explain bread", speaker: "narrator" }], shotPlan: [{ lineId: "l01", seconds: 12, picture: "Our new character shows dough expanding" }] };
    }
    if (task === "shots") {
      const words = section<unknown[]>(request.prompt, "Words");
      return { shots: [0, Math.floor(words.length / 2)].map((fromWord, index) => ({ id: `s0${index + 1}`, fromWord, intent: "Show the dough", characters: ["krishna"], location: "kurukshetra", actionChecks: [{ id: `s0${index + 1}-point`, description: "Hand points to diagram", fromWord, toWord: fromWord }] })) };
    }
    return validAnswer(request, task);
  }), { supportsArtist: true, seesImages: true });
  const engine = createEngine({ projectsDir: join(root, "projects"), stylesDir: styles, ai, render: new FakeRenderPort(), audio: new FakeAudio(0.4) });
  return { root, source, engine, ai };
}

it("pins context, keeps human gates, saves the approved executable sample and stops before publishing", async () => {
  const { root, source, engine, ai } = await setup();
  expect(lookupTemplate("learned")?.missing).toEqual(["Stock soundtrack unavailable"]);
  const id = await engine.createStyleSample(input);
  expect(ai.requests).toHaveLength(0);
  expect((await engine.styleSampleReview(id)).canApprove).toBe(false);
  const snapshot = (await engine.status(id)).series.template!;
  expect(lookupTemplate(snapshot)?.palette.accents).toEqual(["#ff0000"]);
  expect(allTemplates().some(template => template.id === snapshot)).toBe(false);
  await writeFile(join(source, "moco-template.md"), "CHANGED BASE");
  expect(lookupTemplate(snapshot)?.creativePrompt).toContain("STYLE-SENTINEL");
  for (const gate of ["series_plan", "bible", "ep-01/script", "ep-01/sample"]) {
    await advance(engine, id);
    expect((await engine.status(id)).next).toMatchObject({ kind: "waiting", key: gate });
    await approveNext(engine, id);
  }
  await advance(engine, id);
  const review = await engine.styleSampleReview(id);
  expect(review.blockers).toEqual([]);
  expect(review.canApprove).toBe(true);
  expect(review.deviations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "measured", label: "Speaking rate" }), expect.objectContaining({ kind: "limitation", detail: "Stock soundtrack unavailable" })]));
  await expect(engine.approve({ seriesId: id, key: "ep-01/preview" }, review.previewHash!)).rejects.toThrow(/full evidence hash/);
  await expect(engine.approveStyleSample(id, "stale")).rejects.toMatchObject({ code: "gate_mismatch" });
  const concurrent = await Promise.allSettled([engine.approveStyleSample(id, review.contentHash), engine.runStage({ seriesId: id, key: "ep-01/scenes" })]);
  expect(concurrent[0].status).toBe("fulfilled");
  expect(concurrent[1].status).toBe("rejected");
  expect((await engine.styleSampleReview(id)).approved?.contentHash).toBe(review.contentHash);
  expect((await engine.status(id)).next).toEqual({ kind: "finished" });
  const retained = join(review.folder!, "approved");
  expect(await readFile(join(retained, "episode/shots/s01/spec.json"), "utf8")).toContain("function character");
  expect(await readFile(join(retained, "episode/artist/shared/characters.js"), "utf8")).toContain("function character");
  expect(JSON.parse(await readFile(join(retained, "manifest.json"), "utf8")).sampleHash).toBe(review.contentHash);
  await expect(engine.runStage({ seriesId: id, key: "ep-01/final" })).rejects.toMatchObject({ code: "stage_blocked" });
  await expect(engine.runStage({ seriesId: id, key: "ep-01/scenes" })).rejects.toThrow(/Generate a new revision/);
  await expect(engine.saveCharacter({ seriesId: id, episodeId: "ep-01", shotId: "s01" }, { castId: "krishna", sceneHash: "viewed" })).rejects.toThrow(/Generate a new revision/);
  await expect(engine.applyCharacter({ seriesId: id, episodeId: "ep-01", shotId: "s01" }, { castId: "krishna", version: "a".repeat(64), sceneHash: "viewed" })).rejects.toThrow(/Generate a new revision/);
  await expect(engine.setPublishDefaults(id, { descriptionFooter: "Changed" } as never)).rejects.toThrow(/do not enter publishing/);
  await expect(engine.rewritePublish({ seriesId: id, episodeId: "ep-01" }, "Changed")).rejects.toThrow(/do not enter publishing/);
  expect(ai.requests.some(request => request.system.includes("prompt: publish"))).toBe(false);
  const restarted = createEngine({ projectsDir: join(root, "projects"), stylesDir: join(root, "styles"), ai, render: new FakeRenderPort(), audio: new FakeAudio() });
  expect((await restarted.styleSamples("learned"))[0]?.series.id).toBe(id);
  expect((await restarted.styleSampleReview(id)).approved?.contentHash).toBe(review.contentHash);
  // Simulate a crash after the approval marker, before the ledger gate commit.
  const ledgerFile = join(root, "projects", id, "ledger.json");
  const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
  ledger.stages["ep-01/preview"].status = "awaiting_approval";
  await writeFile(ledgerFile, JSON.stringify(ledger));
  const recovered = createEngine({ projectsDir: join(root, "projects"), stylesDir: join(root, "styles"), ai, render: new FakeRenderPort(), audio: new FakeAudio() });
  expect((await recovered.styleSampleReview(id)).approved?.contentHash).toBe(review.contentHash);
  expect((await recovered.status(id)).next).toEqual({ kind: "finished" });
  const second = await restarted.createStyleSample({ ...input, choices: { ...input.choices, detail: "rich" } });
  expect(second).not.toBe(id);
  expect((await restarted.styleSamples("learned"))).toHaveLength(2);
}, 30000);

it("detects changed video and learning content warnings before approval", async () => {
  const { engine, root } = await setup();
  const id = await engine.createStyleSample(input);
  for (let index = 0; index < 4; index++) { await advance(engine, id); await approveNext(engine, id); }
  await advance(engine, id);
  const viewed = await engine.styleSampleReview(id);
  const capabilities = join(root, "projects", id, "artifacts/artist-capabilities.json");
  const originalCapabilities = await readFile(capabilities, "utf8");
  await writeFile(capabilities, JSON.stringify({ requirements: [{ text: "Exact font", support: "partial", reason: "Substituted font" }] }));
  await expect(engine.approveStyleSample(id, viewed.contentHash)).rejects.toMatchObject({ code: "gate_mismatch" });
  await writeFile(capabilities, originalCapabilities);
  await writeFile(join(root, "projects", id, "episodes/ep-01/renders/preview.mp4"), "changed");
  await expect(engine.approveStyleSample(id, viewed.contentHash)).rejects.toMatchObject({ code: "gate_mismatch" });
  await writeFile(join(viewed.folder!, "leaks.json"), '[{"phrase":"Reference Hero"}]');
  const flagged = await engine.styleSampleReview(id);
  expect(flagged.canApprove).toBe(false);
  expect(flagged.blockers.join(" ")).toContain("reference-content warning");
  await expect(engine.approveStyleSample(id, flagged.contentHash)).rejects.toMatchObject({ code: "stage_blocked" });
}, 30000);

it("checks verbatim source narration and preserves explicitly selected provider capability", async () => {
  expect(copiedPhrases("They say never copy this reference script.", { references: [{ id: "r1", contentSpecifics: [], words: ["never", "copy", "this", "reference", "script"] }] })).toHaveLength(2);
  expect(copiedPhrases("This is how the system works.", { references: [{ id: "r1", contentSpecifics: [], words: ["this", "is", "how", "the"] }] })).toEqual([]);
  const { root } = await setup();
  const ai = new FakeAi(() => { throw Error("Must not call"); });
  const engine = createEngine({ projectsDir: join(root, "other"), stylesDir: join(root, "styles"), ai, render: new FakeRenderPort(), audio: new FakeAudio() });
  await expect(engine.createStyleSample(input)).rejects.toThrow(/selected AI backend/);
  expect(ai.requests).toHaveLength(0);
});
