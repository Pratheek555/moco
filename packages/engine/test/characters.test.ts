import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEngine, EngineError } from "../src/index.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import { advance, approveNext, validAnswer } from "./helpers.ts";
import { CharacterRig, SceneSpec } from "@moco/spec";
import { ArtifactStore } from "../src/store/artifacts.ts";
import { Ledger } from "../src/store/ledger.ts";
import { files } from "../src/pipeline/stages.ts";
import { hashData } from "../src/store/hash.ts";
import { characterLibraryFile, characterRigFile, readCharacterLibrary, readCharacterRig, saveCharacter, selectCharacterRigs } from "../src/artist/characters.ts";
import { readArtwork } from "../src/artist/manifest.ts";

const pngBytes = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const png = `data:image/png;base64,${pngBytes}`;
const code = "function character(){helpers.circle(100+scene.frame,100,50,'#48767a')}";

async function reviewedShot() {
  const dir = await mkdtemp(join(tmpdir(), "moco-character-")), ledger = await Ledger.load(dir);
  const store = new ArtifactStore(dir, ledger, () => {}), ctx = { dir, store };
  const root = join(dir, "episodes/ep-01/artist");
  await mkdir(join(root, "shots/s01"), { recursive: true });
  await mkdir(join(root, "shared"), { recursive: true });
  await writeFile(join(root, "shared/character.js"), code);
  await writeFile(join(root, "shared/design.md"), "Teal recurring guide. Use bespoke motion.");
  await writeFile(join(root, "shots/s01/draw.js"), "character();");
  await writeFile(join(root, "shots/s01/skin.png"), Buffer.from(pngBytes, "base64"));
  const manifest = { sourceFiles: ["shared/character.js", "shots/s01/draw.js"], cast: ["guide"], assets: { skin: "shots/s01/skin.png" } };
  await writeFile(join(root, "shots/s01/scene.json"), JSON.stringify(manifest));
  const artwork = await readArtwork(ctx, root, "s01", {});
  const spec = SceneSpec.parse({ shotId: "s01", durationFrames: 60, background: { id: "lab" }, actors: [], captions: [], canvas: { version: 1, source: artwork.source, cast: ["guide"], assets: artwork.assets, designSources: artwork.designSources } });
  const saved = await store.save(files.shotSpec("ep-01", "s01"), "SceneSpec", spec, { producedBy: "ai", backend: "selected-provider" });
  await store.save(files.voiceover("ep-01"), "VoiceoverTrack", { file: "voice.wav", durationSeconds: 2, words: [{ text: "Hello", start: 0, end: 1, lineId: "l01" }], visemes: [] }, { producedBy: "engine" });
  await store.save(files.shotList("ep-01"), "ShotList", { shots: [{ id: "s01", start: 0, end: 2, lineIds: ["l01"], intent: "Explain", characters: ["guide"], location: "lab" }] }, { producedBy: "ai" });
  const report = "episodes/ep-01/quality/run/report.json";
  await store.writeRaw(report, { final: { s01: { score: 4, evidence: "Sampled frames" } } });
  const quality = { status: "passed" as const, unresolved: [], sceneHashes: { s01: saved.meta.contentHash }, voiceoverHash: store.hashOf(files.voiceover("ep-01"))!, shotListHash: store.hashOf(files.shotList("ep-01"))!, report };
  const critique = { episodeId: "ep-01", shots: [{ shotId: "s01", score: 4, problems: [], fix: "", requirements: [{ id: "s01-pose", status: "pass" as const, evidence: "Hand visible in samples" }] }], overall: "Sampled visual review", quality };
  await store.save(files.critique("ep-01"), "Critique", critique, { producedBy: "ai" });
  return { ctx, root, saved, critique, ledger, manifest };
}

it("approves exact source and image bytes once, preserving provenance and independent shot bytes", async () => {
  const { ctx, saved, root } = await reviewedShot();
  const before = await readFile(join(ctx.dir, files.shotSpec("ep-01", "s01")));
  const result = await saveCharacter(ctx, "ep-01", "s01", "guide", saved.meta.contentHash);
  const rig = await readCharacterRig(ctx, "guide", result.version);
  expect(rig.sources).toEqual([{ path: "shared/character.js", code }]);
  expect(rig.assets.skin).toBe(png);
  expect(rig.provenance).toMatchObject({ backend: "selected-provider", sceneHash: saved.meta.contentHash, review: { requirements: [{ id: "s01-pose", status: "pass" }] } });
  expect(rig.provenance.review.limitation).toContain("do not certify continuous motion");
  const artifact = characterRigFile("guide", result.version), original = await readFile(join(ctx.dir, artifact));
  await saveCharacter(ctx, "ep-01", "s01", "guide", saved.meta.contentHash);
  expect(await readFile(join(ctx.dir, artifact))).toEqual(original);
  expect(await readFile(join(ctx.dir, files.shotSpec("ep-01", "s01")))).toEqual(before);
  expect((await readCharacterLibrary(ctx)).characters[0]?.versions).toEqual([result.version]);
  expect(await selectCharacterRigs(ctx, "ep-01", "s01", ["guide"])).toEqual({}); // legacy/original stays pinned
  expect(await selectCharacterRigs(ctx, "ep-02", "s01", ["guide"])).toEqual({ guide: result.version });

  // A later episode can use the approved bundle without any inherited files.
  const later = join(ctx.dir, "episodes/ep-02/artist");
  await mkdir(join(later, "shots/s01"), { recursive: true });
  await writeFile(join(later, "shots/s01/draw.js"), "character();");
  await writeFile(join(later, "shots/s01/scene.json"), JSON.stringify({ sourceFiles: ["shots/s01/draw.js"], cast: ["guide"] }));
  const reused = await readArtwork(ctx, later, "s01", { guide: result.version });
  expect(reused.source).toContain(code);
  expect(reused.assets).toEqual(rig.assets);
  expect(reused.characterRigs).toEqual({ guide: result.version });
  await writeFile(join(root, "shared/character.js"), "// drift");
  await expect(saveCharacter(ctx, "ep-01", "s01", "guide", saved.meta.contentHash)).rejects.toMatchObject({ code: "gate_mismatch" });
  expect((await readArtwork(ctx, later, "s01", { guide: result.version })).source).toBe(reused.source);
});

it.each(["scene", "voiceover", "cut", "verdict"])("rejects approval with stale or failing %s evidence", async cause => {
  const { ctx, saved, critique } = await reviewedShot();
  if (cause === "scene") await expect(saveCharacter(ctx, "ep-01", "s01", "guide", "0".repeat(64))).rejects.toMatchObject({ code: "gate_mismatch" });
  else {
    if (cause === "voiceover") critique.quality.voiceoverHash = "stale";
    if (cause === "cut") critique.quality.sceneHashes.s01 = "stale";
    if (cause === "verdict") Object.assign(critique.quality, { status: "needs_attention", unresolved: ["Unproven hand contact"] });
    await ctx.store.save(files.critique("ep-01"), "Critique", critique, { producedBy: "ai" });
    await expect(saveCharacter(ctx, "ep-01", "s01", "guide", saved.meta.contentHash)).rejects.toMatchObject({ code: "stage_blocked" });
  }
  expect((await readCharacterLibrary(ctx)).characters).toEqual([]);
});

it("does not load unapproved versions or allow an image to replace approved character artwork", async () => {
  const { ctx, root, saved } = await reviewedShot();
  const result = await saveCharacter(ctx, "ep-01", "s01", "guide", saved.meta.contentHash);
  await expect(readCharacterRig(ctx, "guide", "../escape")).rejects.toThrow(/Invalid character version/);
  await expect(readCharacterRig(ctx, "other-series-guide", result.version)).rejects.toThrow();
  const orphan = CharacterRig.parse({ ...(await readCharacterRig(ctx, "guide", result.version)), notes: "Unapproved candidate" });
  const version = hashData({ castId: orphan.castId, sources: orphan.sources, assets: orphan.assets, notes: orphan.notes });
  await ctx.store.save(characterRigFile("guide", version), "CharacterRig", orphan, { producedBy: "ai" });
  await expect(readCharacterRig(ctx, "guide", version)).rejects.toThrow(/not been approved/);
  await writeFile(join(root, "shots/s01/skin.png"), Buffer.from("different"));
  await expect(readArtwork(ctx, root, "s01", { guide: result.version })).rejects.toThrow(/overwrite an approved character image/);
});

it("preserves sourceFiles execution order for existing authored scenes", async () => {
  const { ctx, root, manifest } = await reviewedShot();
  await writeFile(join(root, "shots/s01/scene.json"), JSON.stringify({ ...manifest, sourceFiles: [...manifest.sourceFiles].reverse() }));
  expect((await readArtwork(ctx, root, "s01", {})).source).toBe(`// shots/s01/draw.js\ncharacter();\n// shared/character.js\n${code}`);
});

it("reuses across episodes, upgrades only a selected shot, and rolls back failed upgrades through the engine", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-character-engine-"));
  let rejectUpgrade = false, makeNewDesign = false, interruptAuthor = false;
  const ai = Object.assign(new FakeAi(async (request, task) => {
    if (task === "artist") {
      const call = (name: string, args: object) => request.artistTools!.find(t => t.name === name)!.call(args);
      const id = /Create shot (s\d+)/.exec(request.prompt)![1]!;
      const text = (result: Awaited<ReturnType<typeof call>>) => result.content.filter(b => b.type === "text").map(b => b.text).join("");
      const brief = JSON.parse(text(await call("read_file", { path: `shots/${id}/brief.json` })));
      const rigs = makeNewDesign ? {} : brief.characterRigs;
      const sources = [`shots/${id}/draw.js`];
      if (Object.keys(rigs).length) {
        const approved = JSON.parse(text(await call("read_file", { path: "approved-characters/krishna.json" })));
        expect(approved.sources[0].code).toContain("function character");
      } else {
        const path = makeNewDesign ? "shared/versions/character-v2.js" : "shared/character.js";
        const listed = JSON.parse(text(await call("list_files", {}))) as string[];
        if (!listed.includes(path)) await call("write_file", { path, content: code + (makeNewDesign ? " // improved rig" : "") });
        sources.unshift(path);
      }
      await call("write_file", { path: `shots/${id}/draw.js`, content: "ctx.fillStyle='#eee';ctx.fillRect(0,0,scene.width,scene.height);character();" });
      await call("write_file", { path: `shots/${id}/scene.json`, content: JSON.stringify({ sourceFiles: sources, cast: brief.shot.characters, characterRigs: rigs }) });
      if (interruptAuthor) {
        await call("write_file", { path: `shots/${id}/unaccepted.js`, content: "// interrupted candidate" });
        throw new EngineError("cap_reached", "Simulated author disconnect");
      }
      await call("render_preview", {});
      return { done: true };
    }
    if (task === "artist_review") {
      const p = JSON.parse(request.prompt), targets = p.targets?.map((t: { shot: unknown }) => t.shot) ?? [p.target];
      const verdicts = targets.map((shot: { id: string; actionChecks: { id: string; description: string }[] }) => ({ id: shot.id, score: rejectUpgrade ? 3 : 4, overall: "Sample evidence only", checks: shot.actionChecks.map(a => ({ ...a, status: rejectUpgrade ? "fail" : "pass", severity: "major", evidence: "Hand visible in sequence", fix: "Improve hand" })) }));
      return p.targets ? { verdicts } : verdicts[0];
    }
    if (task === "script") return { targetSeconds: 12, lines: [{ id: "l01", text: Array.from({ length: 30 }, () => "word").join(" "), beat: "Explain", speaker: "narrator" }] };
    const answer = validAnswer(request, task);
    if (task === "shots") return { ...answer as object, shots: (answer as { shots: { fromWord: number }[] }).shots.map(s => ({ ...s, actionChecks: [{ id: "pose", description: "Point clearly", fromWord: s.fromWord, toWord: s.fromWord }] })) };
    if (task === "show") return { ...answer as object, format: { ...(answer as { format: object }).format, targetSeconds: 12 }, requirements: [{ id: "art", text: "Original illustrations", support: "available", reason: "Canvas" }] };
    return answer;
  }), { supportsArtist: true, seesImages: true });
  const render = new FakeRenderPort(), audio = new FakeAudio(.4);
  const engine = createEngine({ projectsDir: dir, ai, render, audio });
  const seriesId = await engine.createSeries({ idea: "Recurring illustrated guide", language: "en", episodes: 2, production: { mode: "artist", format: { width: 640, height: 360, fps: 60 }, targetSeconds: 12 } });
  const ref = { seriesId, episodeId: "ep-01", shotId: "s01" };
  const scene = async (episodeId: string, shotId: string) => await engine.readArtifact({ seriesId, file: files.shotSpec(episodeId, shotId) }) as { data: SceneSpec; meta: { contentHash: string } };
  for (let i = 0; i < 3; i++) { await advance(engine, seriesId); await approveNext(engine, seriesId); }
  await advance(engine, seriesId); // reviewed sample, before batch
  const sample = await scene("ep-01", "s01"), requestsBeforeSave = ai.requests.length;
  const v1 = await engine.saveCharacter(ref, { castId: "krishna", sceneHash: sample.meta.contentHash });
  expect(ai.requests).toHaveLength(requestsBeforeSave);
  await expect(engine.restore({ seriesId, file: characterRigFile("krishna", v1.version) }, 0)).rejects.toThrow(/immutable/);
  await expect(engine.restore({ seriesId, file: characterLibraryFile }, 0)).rejects.toThrow(/append-only/);
  await approveNext(engine, seriesId);
  await advance(engine, seriesId); // rest of episode + preview
  expect((await scene("ep-01", "s02")).data.canvas?.characterRigs).toEqual({ krishna: v1.version });
  expect((await scene("ep-01", "s01")).data).toEqual(sample.data);

  // A bespoke improvement remains a candidate until explicitly saved.
  makeNewDesign = true;
  expect((await engine.waitForJob(await engine.regenerateShot(ref, "Improve the shared rig"))).status).toBe("succeeded");
  makeNewDesign = false;
  expect((await engine.listCharacters(seriesId))[0]?.activeVersion).toBe(v1.version);
  const improved = await scene("ep-01", "s01");
  const v2 = await engine.saveCharacter(ref, { castId: "krishna", sceneHash: improved.meta.contentHash });
  expect(v2.version).not.toBe(v1.version);
  const untouched = await scene("ep-01", "s03"), oldShot = await scene("ep-01", "s02");
  expect(oldShot.data.canvas?.characterRigs).toEqual({ krishna: v1.version });
  expect((await engine.listCharacters(seriesId))[0]?.versions.find(v => v.version === v1.version)?.dependants).toContainEqual({ episodeId: "ep-01", shotId: "s02" });
  const target = { ...ref, shotId: "s02" };
  const upgrade = await engine.waitForJob(await engine.applyCharacter(target, { castId: "krishna", version: v2.version, sceneHash: oldShot.meta.contentHash }));
  expect(upgrade.status, upgrade.error?.message).toBe("succeeded");
  expect((await scene("ep-01", "s02")).data.canvas?.characterRigs).toEqual({ krishna: v2.version });
  expect((await scene("ep-01", "s03")).data).toEqual(untouched.data);
  expect((await engine.status(seriesId)).stages.find(s => s.key === "ep-01/preview")?.status).toBe("stale");
  const prior = await scene("ep-01", "s02"), manifestPath = join(dir, seriesId, "episodes/ep-01/artist/shots/s02/scene.json"), manifestBefore = await readFile(manifestPath);
  const stillPath = join(dir, seriesId, "episodes/ep-01/shots/s02/stills/0.png"), stillBefore = Buffer.from("retained still marker");
  await writeFile(stillPath, stillBefore);
  rejectUpgrade = true;
  const rejected = await engine.waitForJob(await engine.applyCharacter(target, { castId: "krishna", version: v1.version, sceneHash: prior.meta.contentHash }));
  expect(rejected.status).toBe("failed");
  expect((await scene("ep-01", "s02")).data).toEqual(prior.data);
  expect(await readFile(manifestPath)).toEqual(manifestBefore);
  expect(await readFile(stillPath)).toEqual(stillBefore);
  interruptAuthor = true;
  const interrupted = await engine.waitForJob(await engine.applyCharacter(target, { castId: "krishna", version: v1.version, sceneHash: prior.meta.contentHash }));
  expect(interrupted.error?.code).toBe("cap_reached");
  expect((await scene("ep-01", "s02")).data).toEqual(prior.data);
  expect(await readFile(manifestPath)).toEqual(manifestBefore);
  expect(await readFile(stillPath)).toEqual(stillBefore);
  await expect(readFile(join(dir, seriesId, "episodes/ep-01/artist/shots/s02/unaccepted.js"))).rejects.toMatchObject({ code: "ENOENT" });
  interruptAuthor = false;
  expect((await engine.waitForJob(await engine.renderFinal({ seriesId, episodeId: "ep-01" }))).status).toBe("failed");
  rejectUpgrade = false;
  expect((await engine.waitForJob(await engine.reviewEpisode({ seriesId, episodeId: "ep-01" }))).status).toBe("succeeded");
  await advance(engine, seriesId); await approveNext(engine, seriesId); // preview and approval
  await advance(engine, seriesId); // finish episode one
  await advance(engine, seriesId); // plan episode two
  await approveNext(engine, seriesId); // episode two script
  await advance(engine, seriesId);
  expect((await scene("ep-02", "s01")).data.canvas?.characterRigs).toEqual({ krishna: v2.version });
  // Reload with the same selected provider; saved versions remain usable.
  const reopened = createEngine({ projectsDir: dir, ai, render, audio });
  expect((await reopened.listCharacters(seriesId))[0]?.versions).toHaveLength(2);
}, 90_000);

it.runIf(process.env.MOCO_RENDER_TESTS)("renders retained character artwork after source removal and out-of-order seeks", async () => {
  const { createRemotionRenderPort } = await import("@moco/renderer");
  const { decodePng } = await import("../../renderer/src/pixels.ts");
  const { ctx, root, saved } = await reviewedShot();
  const rig = await saveCharacter(ctx, "ep-01", "s01", "guide", saved.meta.contentHash);
  const next = join(ctx.dir, "episodes/ep-02/artist");
  await mkdir(join(next, "shots/s01"), { recursive: true });
  await writeFile(join(next, "shots/s01/draw.js"), "character();");
  await writeFile(join(next, "shots/s01/scene.json"), JSON.stringify({ cast: ["guide"], sourceFiles: ["shots/s01/draw.js"] }));
  const artwork = await readArtwork(ctx, next, "s01", { guide: rig.version });
  const spec = SceneSpec.parse({ ...saved.data, format: { width: 640, height: 360, fps: 60 }, canvas: { ...saved.data.canvas, ...artwork, version: 1, source: `ctx.fillStyle='#ffffff';ctx.fillRect(0,0,scene.width,scene.height);\n${artwork.source}` } });
  await rm(join(root, "shared/character.js")); // compiled scenes no longer need the authoring file
  const port = createRemotionRenderPort({ browserExecutable: process.env.MOCO_TEST_BROWSER });
  try {
    const result = await port.check(spec, { frames: [59, 0, 29], outDir: join(ctx.dir, "render-seek") });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw Error(JSON.stringify(result.errors));
    const frames = await Promise.all(result.stills.map(async path => decodePng(await readFile(path))));
    const pixel = (picture: typeof frames[number]) => {
      const offset = (50 * picture.width + 40) * picture.channels;
      return [...picture.data.slice(offset, offset + 3)];
    };
    expect(pixel(frames[0]!)).toEqual([255, 255, 255]);
    expect(pixel(frames[1]!)).toEqual([72, 118, 122]);
    const again = await port.check(spec, { frames: [0], outDir: join(ctx.dir, "render-again") });
    if (!again.ok) throw Error(JSON.stringify(again.errors));
    expect(decodePng(await readFile(again.stills[0]!)).data).toEqual(frames[1]!.data);
  } finally { await port.close(); }
}, 120_000);
