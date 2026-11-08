import { expandModel } from "@moco/kit";
import { generateArtistScene } from "../artist/generate.ts";
import { EngineError } from "../errors.ts";
import { reviewArtistEpisode } from "../review/artist.ts";
// Shot → SceneSpec via the AI, through the validate → render-check → fix loop.
// After the attempt cap, a deterministic fallback shot is saved instead and flagged for the user.
// Each spec records a "SceneInput" hash of everything it was generated from; if that hash is unchanged
// on the next run, the spec is reused without calling the AI (partial regeneration).
import { join } from "node:path";
import { AiSceneSpec, SceneSpec, toAiJsonSchema, type InputRef, type SeriesBible, type Playbook, type SeriesMemory, type Shot, type ShowBible, type World, type VoiceoverTrack, type Vocabulary } from "@moco/spec";
import type { Issue } from "../loop/feedback.ts";
import { generateValidated } from "../loop/loop.ts";
import { avoidFor, repeatedLook, shotLook, validateScene, type SceneBrief, type ShotLook } from "../loop/validate.ts";
import type { StageContext } from "../pipeline/context.ts";
import { readShow, scenePack } from "../planner/show.ts";
import { worldForShot } from "../planner/world.ts";
import { files } from "../pipeline/stages.ts";
import { lookAtShots } from "../review/look.ts";
import { hashData } from "../store/hash.ts";
import { catalogSlice, fallbackScene, goldenScene, relevantFacts, shotBrief, shotSpeech, shotVisemes } from "./context.ts";
import { feedbackSection, joinSections, jsonSection, loadPrompt, promptRef, selectBlocks } from "./prompts.ts";

import { compileScene, checkTimelines, sequencesFrom } from "./compiler.ts";
import { readBible } from "../canon/merge.ts";
import { lessonsSection, readPlaybook } from "../learn/playbook.ts";
import { selectCharacterRigs, type CharacterSelection } from "../artist/characters.ts";

const sceneJsonSchema = toAiJsonSchema(AiSceneSpec);

export interface SceneInputs {
  characterRigs?: CharacterSelection;
  requireCharacterRigs?: boolean; // an explicit user-selected upgrade cannot be omitted
  episodeId: string;
  shot: Shot;
  voiceover: VoiceoverTrack;
  bible: SeriesBible;
  memory?: SeriesMemory;
  world?: World; // this series' generated world, if it has one
  show?: ShowBible; // this series' own rules, if it was made with a show bible
  vocabulary?: Vocabulary;
  playbook?: Playbook; // the series' lessons so far (learn/playbook.ts)
  feedback?: string; // from reject() on the sample or regenerateShot()
  force?: boolean; // regenerate even if an up-to-date spec exists
  avoid?: ShotLook; // camera presets and shot sizes its neighbours already repeat (no 3 in a row)
  keepOnFailure?: boolean; // if every attempt fails, keep the existing spec instead of saving a fallback
}

export interface SceneOutcome {
  shotId: string;
  fallback: boolean;
  attempts: number; // 0 = reused
  contentHash: string;
}

export async function generateScene(ctx: StageContext, inputs: SceneInputs): Promise<SceneOutcome> {
  if (ctx.series.production) inputs = { ...inputs, characterRigs: inputs.characterRigs ?? await selectCharacterRigs(ctx, inputs.episodeId, inputs.shot.id, inputs.shot.characters) };
  const { episodeId, shot } = inputs;
  const activity = { episodeId, shotId: shot.id, key: `${episodeId}/${ctx.ledger.stage(`${episodeId}/sample`).status === "running" ? "sample" : "scenes"}` };
  await ctx.bus.emit(ctx.seriesId, "shot.started", { ...activity, intent: shot.intent });
  const complete = async (outcome: SceneOutcome) => {
    await ctx.bus.emit(ctx.seriesId, "shot.done", { ...activity, ...outcome, reused: outcome.attempts === 0 });
    return outcome;
  };
  const brief = { ...shotBrief(shot, inputs.voiceover), avoid: inputs.avoid };
  const shotDir = files.shotDir(episodeId, shot.id);
  const specFile = files.shotSpec(episodeId, shot.id);
  const sceneInput = sceneInputRef(ctx, inputs, brief);

  const reusable = !inputs.force && !inputs.feedback && (await upToDate(ctx, specFile, sceneInput));
  if (reusable) return complete({ shotId: shot.id, fallback: false, attempts: 0, contentHash: await refreshEngineFields(ctx, specFile, inputs) });

  // A redo changes the current shot, so the AI has to see it. Engine fields are stripped, as in the golden example.
  const previous = inputs.feedback && ctx.store.has(specFile) ? AiSceneSpec.parse((await ctx.store.read(specFile, "SceneSpec")).data) : undefined;

  let updates = Promise.resolve();
  const result = ctx.series.production ? await generateArtistScene(ctx, inputs) : await generateValidated({
    ai: ctx.ai,
    scope: episodeId,
    schema: SceneSpec,
    jsonSchema: sceneJsonSchema,
    system: selectBlocks(loadPrompt("scene", ctx.series.template), stageKind(ctx, shot)),
    prompt: scenePrompt(ctx, inputs, brief, previous),
    maxAttempts: ctx.config.limits.maxAttemptsPerShot,
    signal: ctx.signal,
    onActivity: (message) => {
      updates = updates.then(() => ctx.bus.emit(ctx.seriesId, "ai.activity", { ...activity, phase: "working", message })).catch(() => {});
    },
    check: (spec) => checkScene(ctx, spec, brief, inputs, shotDir),
    onAttempt: async (attempt) => {
      await ctx.store.writeRaw(`${shotDir}/attempts/${String(attempt.attempt).padStart(2, "0")}.json`, attempt);
      await ctx.bus.emit(ctx.seriesId, "shot.attempt", { episodeId, shotId: shot.id, attempt: attempt.attempt, errors: attempt.issues.length });
    },
  }).finally(() => updates);

  // A looks-only regeneration that fails keeps what it had: a repeated framing beats a shot with no cast.
  if (!result.ok && inputs.keepOnFailure && ctx.store.has(specFile)) {
    ctx.ledger.decide("regenerate", `${episodeId}/${shot.id}`, `kept the previous spec: ${result.attempts} attempts couldn't avoid ${JSON.stringify(inputs.avoid)}`);
    return complete({ shotId: shot.id, fallback: false, attempts: result.attempts, contentHash: ctx.store.hashOf(specFile)! });
  }

  const spec = withEngineFields(result.ok ? result.data : fallbackScene(brief, ctx.catalog, inputs.bible), inputs);
  if (!result.ok) {
    // Never silent: recorded in the ledger and shown in the UI as "needs attention".
    ctx.ledger.decide("fallback", `${episodeId}/${shot.id}`, `${result.attempts} attempts failed; last issues: ${result.issues.length}`);
    await ctx.bus.emit(ctx.seriesId, "shot.fallback", { episodeId, shotId: shot.id, issues: result.issues.slice(0, 8) });
  }

  const saved = await ctx.store.save(specFile, "SceneSpec", spec, {
    producedBy: result.ok ? "ai" : "engine",
    backend: result.ok ? ctx.ai.backendId : undefined,
    inputs: [ctx.store.inputRef(files.shotList(episodeId)), ctx.store.inputRef(files.voiceover(episodeId)), spec.canvas ? sceneInputRef(ctx, { ...inputs, characterRigs: spec.canvas.characterRigs }, brief) : sceneInput],
  });
  return complete({ shotId: shot.id, fallback: !result.ok, attempts: result.attempts, contentHash: saved.meta.contentHash });
}

// Everything that shapes this shot's spec. Times are relative to the shot, so a shot that only moved
// in time (because an earlier line changed) still matches.
function sceneInputRef(ctx: StageContext, inputs: SceneInputs, brief: SceneBrief): InputRef {
  const { id: _id, start: _start, end: _end, ...shotContent } = brief.shot;
  const key = hashData({
    creativeBrief: ctx.series.idea,
    production: ctx.series.production,
    characterRigs: inputs.characterRigs,
    shot: shotContent,
    durationFrames: brief.durationFrames,
    words: brief.words,
    speech: shotSpeech(inputs.shot, inputs.voiceover),
    kit: catalogSlice(ctx.catalog, inputs.bible, brief.shot),
    kitVersion: ctx.catalog.kitVersion,
    style: inputs.bible.style,
    vocabulary: inputs.vocabulary,
    lessons: inputs.playbook && lessonsSection(inputs.playbook, "scene"),
    worldLayout: inputs.world,
    facts: relevantFacts(inputs.memory, brief.shot),
    show: inputs.show && scenePack(inputs.show, brief.shot),
    prompt: promptRef(ctx.series.production ? "artist" : "scene", ctx.series.template).contentHash,
  });
  return { kind: "SceneInput", revision: 0, contentHash: key };
}

// Reuse only a non-fallback spec whose recorded SceneInput matches.
async function upToDate(ctx: StageContext, specFile: string, sceneInput: InputRef): Promise<boolean> {
  if (!ctx.store.has(specFile)) return false;
  const existing = await ctx.store.read(specFile, "SceneSpec");
  const recorded = existing.meta.inputs.find((input) => input.kind === "SceneInput");
  return !existing.data.fallback && recorded?.contentHash === sceneInput.contentHash;
}

// Fields the engine owns, not the AI: costume/age variants, time of day and the series grade (bible decisions)
// and the lip-sync track (from the audio).
function withEngineFields(spec: SceneSpec, inputs: SceneInputs): SceneSpec {
  const visemes = shotVisemes(inputs.shot, inputs.voiceover);
  return { ...withBibleVariants(spec, inputs.bible), visemes, speech: shotSpeech(inputs.shot, inputs.voiceover), grade: inputs.bible.style.grade, world: !spec.canvas && inputs.world ? worldForShot(inputs.world, spec) : undefined };
}

function withBibleVariants(spec: SceneSpec, bible: SeriesBible): SceneSpec {
  const actors = spec.actors.map((actor) => ({ ...actor, variant: bible.cast.find((member) => member.id === actor.castId)?.variant }));
  return { ...spec, actors, timeOfDay: bible.style.timeOfDay ?? spec.timeOfDay };
}

// A reused spec keeps the AI's work but picks up new engine fields (a re-recorded voiceover, a bible variant
// change) without another AI call. Returns the spec's content hash.
async function refreshEngineFields(ctx: StageContext, specFile: string, inputs: SceneInputs): Promise<string> {
  const existing = await ctx.store.read(specFile, "SceneSpec");
  const refreshed = withEngineFields(existing.data, inputs);
  if (hashData(refreshed) === existing.meta.contentHash) return existing.meta.contentHash;
  const saved = await ctx.store.save(specFile, "SceneSpec", refreshed, { producedBy: "engine", inputs: existing.meta.inputs });
  return saved.meta.contentHash;
}

// L2, then L3 (render a few stills) only when L2 is clean: no point rendering a spec we already know is wrong.
async function checkScene(ctx: StageContext, spec: SceneSpec, brief: SceneBrief, inputs: SceneInputs, shotDir: string): Promise<Issue[]> {
  const compiled = compileScene(spec, inputs.vocabulary);
  if (compiled.issues.length) return compiled.issues;
  Object.assign(spec, compiled.spec);
  const timing = checkTimelines(spec, inputs.world);
  if (timing.length) return timing;
  const semantic = validateScene(spec, { brief, bible: inputs.bible, catalog: ctx.catalog });
  if (semantic.length > 0) return semantic;

  const lastFrame = spec.durationFrames - 1;
  const frames = [0, Math.floor(lastFrame / 2), lastFrame];
  const outDir = join(ctx.dir, shotDir, "stills");
  // Saved before rendering, so a spec that crashes or hangs the renderer can be inspected afterwards.
  await ctx.store.writeRaw(`${shotDir}/stills/spec.json`, spec);
  const check = await ctx.renderSlots.run(() => ctx.render.check(withEngineFields(spec, inputs), { frames, outDir }));
  if (check.ok) return [];
  return check.errors.map((error) => ({
    path: error.path ?? "",
    problem: `renderer error${error.frame === undefined ? "" : ` at frame ${error.frame}`}: ${error.message}`,
  }));
}

// Which rules of the scene prompt apply: the 2D kit, the race circuit, or a world built for this series.
function stageKind(ctx: StageContext, shot: Shot): "kit" | "race" | "world" {
  const stage = ctx.catalog.backgrounds.find((background) => background.id === shot.location)?.stage;
  return !stage ? "kit" : stage.things ? "world" : "race";
}

function scenePrompt(ctx: StageContext, inputs: SceneInputs, brief: SceneBrief, previous: unknown): string {
  return joinSections([
    jsonSection("Full original creative brief — preserve its visual requirements", ctx.series.idea),
    inputs.show ? jsonSection("Show bible — this series' rules for this shot", scenePack(inputs.show, brief.shot)) : "",
    jsonSection("Shot brief", {
      shotId: brief.shot.id,
      durationFrames: brief.durationFrames,
      intent: brief.shot.intent,
      characters: brief.shot.characters,
      location: brief.shot.location,
      cameraHint: brief.shot.cameraHint,
      voiceoverWords: brief.words,
      speakers: inputs.voiceover.speakers?.filter((span) => span.start < inputs.shot.end && span.end > inputs.shot.start)
        .map((span) => ({ speaker: span.speaker, startFrame: Math.max(0, Math.round((span.start - inputs.shot.start) * 30)), endFrame: Math.min(brief.durationFrames, Math.round((span.end - inputs.shot.start) * 30)) })),
      avoid: brief.avoid, // left out of the JSON when unset
    }),
    jsonSection("Kit you can use", catalogSlice(ctx.catalog, inputs.bible, brief.shot)),
    inputs.world ? jsonSection("World layout for timeline coordinates", {
      location: inputs.world.locations.find((location) => location.id === inputs.shot.location),
      setModels: inputs.world.models.filter((model) => inputs.world!.locations.find((location) => location.id === inputs.shot.location)?.set.some((item) => item.model === model.id)).map(({id,height,parts}) => ({id,height,parts})),
      joints: inputs.world.models.filter((model) => inputs.world!.cast.some((member) => member.model === model.id && inputs.shot.characters.includes(member.id))).map((model) => ({ model: model.id, ids: expandModel(model).parts.map((part) => part.id) })),
    }) : "",
    jsonSection("Series vocabulary ? reusable validated timelines", inputs.vocabulary?.entries ?? []),
    inputs.playbook ? lessonsSection(inputs.playbook, "scene") : "",
    jsonSection("Series style", inputs.bible.style),
    jsonSection("Continuity to respect", relevantFacts(inputs.memory, brief.shot)),
    // The example shows the kit's 2D layout, which a generated world doesn't use.
    inputs.world ? "" : jsonSection("Example of a good SceneSpec (a different shot — copy the quality, not the content)", AiSceneSpec.parse(goldenScene())), // engine fields stripped
    previous ? jsonSection("Your previous version — keep what the change below doesn't touch", previous) : "",
    feedbackSection(inputs.feedback),
  ]);
}

// ---------- stages ----------

// Stage sample (first episode only): the first shot, generated and shown before the rest.
export async function runSample(ctx: StageContext, episodeId: string, feedback?: string): Promise<string> {
  const shotList = (await ctx.store.read(files.shotList(episodeId), "ShotList")).data;
  const shared = await sceneSharedInputs(ctx, episodeId);
  const outcome = await generateScene(ctx, { ...shared, shot: shotList.shots[0]!, feedback });
  if(ctx.series.production && ctx.ai.seesImages) {
    await reviewArtistEpisode(ctx,episodeId,[shotList.shots[0]!],shared);
    const quality=(await ctx.store.read(files.critique(episodeId),"Critique")).data.quality;
    if(quality?.status!=="passed")throw new EngineError("validation_failed",`Sample needs visual repair before batching: ${quality?.unresolved.join("; ")}`);
    return ctx.store.hashOf(files.shotSpec(episodeId,shotList.shots[0]!.id))!;
  }
  return outcome.contentHash;
}

// Stage scenes: every shot in parallel (the AI semaphore limits real concurrency). Up-to-date specs are reused,
// unless there is a note on the preview: that rewrites every shot. Returns the stage hash: the shot spec hashes in order.
export async function runScenes(ctx: StageContext, episodeId: string, feedback?: string): Promise<string> {
  const shotList = (await ctx.store.read(files.shotList(episodeId), "ShotList")).data;
  const shared = await sceneSharedInputs(ctx, episodeId);
  const settled = ctx.series.production
    ? await (async () => { for (const shot of shotList.shots) await generateScene(ctx, { ...shared, shot, feedback }); return []; })()
    : await Promise.allSettled(shotList.shots.map((shot) => generateScene(ctx, { ...shared, shot, feedback })));
  // Wait for every shot before failing, so no shot keeps writing after the stage is marked failed.
  const failure = settled.find((outcome) => outcome.status === "rejected");
  if (failure) throw failure.reason;
  if (!ctx.series.production) await breakRepeatedLooks(ctx, episodeId, shotList.shots, shared);
  await ctx.bus.emit(ctx.seriesId, "ai.activity", { key: `${episodeId}/scenes`, episodeId, phase: "working", message: "Shots saved. Reviewing visual consistency and checking the animation for repairs." });
  // Every shot was written blind: the director looks at the cut and the weakest shots get one more go.
  await lookAtShots(ctx, episodeId, shotList.shots, shared);
  if(ctx.series.production){
    const quality=(await ctx.store.read(files.critique(episodeId),"Critique")).data.quality;
    if(quality?.status!=="passed")throw new EngineError("validation_failed",`Visual review needs attention before export. Retry to resume saved checks and repairs: ${quality?.unresolved.join("; ")??"No complete review"}`);
  }
  const finalSpecs = await specsOf(ctx, episodeId, shotList.shots);
  const entries = finalSpecs.flatMap((spec) => sequencesFrom(spec, episodeId));
  if (entries.length) {
    const previous = ctx.store.has("artifacts/vocabulary.json") ? (await ctx.store.read("artifacts/vocabulary.json", "Vocabulary")).data.entries : [];
    const kept = previous.filter((entry) => !entry.source.startsWith(`${episodeId}/`));
    await ctx.store.save("artifacts/vocabulary.json", "Vocabulary", { entries: [...kept, ...entries].slice(-100) }, { producedBy: "engine", inputs: shotList.shots.map((shot) => ctx.store.inputRef(files.shotSpec(episodeId, shot.id))) });
  }
  return scenesHash(ctx, episodeId);
}

// No 3 consecutive shots with the same camera preset or shot size. Shots are generated in parallel, so this is
// checked once all exist: the shot that completes a run is regenerated, told what to avoid (L2 enforces it).
// That shot then matches neither neighbour pair, so each fix removes a run without making one. Each shot is
// regenerated at most once, and fallback shots never are (the AI already failed on them), so a broken AI
// can't burn the call cap here.
async function breakRepeatedLooks(ctx: StageContext, episodeId: string, shots: Shot[], shared: Omit<SceneInputs, "shot">) {
  let specs = await specsOf(ctx, episodeId, shots);
  const tried = new Set(specs.flatMap((spec, index) => (spec.fallback ? [index] : [])));
  let repeat = repeatedLook(specs.map(shotLook), tried);
  while (repeat) {
    tried.add(repeat.index);
    const shot = shots[repeat.index]!;
    ctx.ledger.decide("regenerate", `${episodeId}/${shot.id}`, `3 same-looking shots in a row; avoid ${JSON.stringify(repeat.avoid)}`);
    await generateScene(ctx, { ...shared, shot, force: true, avoid: repeat.avoid, keepOnFailure: true });
    specs = await specsOf(ctx, episodeId, shots);
    repeat = repeatedLook(specs.map(shotLook), tried);
  }
}

async function specsOf(ctx: StageContext, episodeId: string, shots: Shot[]): Promise<SceneSpec[]> {
  const stored = await Promise.all(shots.map((shot) => ctx.store.read(files.shotSpec(episodeId, shot.id), "SceneSpec")));
  return stored.map((artifact) => artifact.data);
}

// What a single regenerated shot must avoid, given the shots around it as they are now.
export async function neighbourAvoid(ctx: StageContext, episodeId: string, shots: Shot[], shotId: string): Promise<ShotLook> {
  const specs = await specsOf(ctx, episodeId, shots);
  return avoidFor(specs.map(shotLook), shots.findIndex((shot) => shot.id === shotId));
}

// Voiceover, bible and memory: the same for every shot in an episode.
export async function sceneSharedInputs(ctx: StageContext, episodeId: string): Promise<Omit<SceneInputs, "shot">> {
  const voiceover = (await ctx.store.read(files.voiceover(episodeId), "VoiceoverTrack")).data;
  const bible = await readBible(ctx);
  const memory = ctx.store.has(files.memory) ? (await ctx.store.read(files.memory, "SeriesMemory")).data : undefined;
  const vocabulary = ctx.store.has("artifacts/vocabulary.json") ? (await ctx.store.read("artifacts/vocabulary.json", "Vocabulary")).data : undefined;
  return { episodeId, voiceover, bible, memory, world: ctx.world, show: await readShow(ctx), playbook: await readPlaybook(ctx), vocabulary: vocabulary && { entries: vocabulary.entries.filter((entry) => !entry.source.startsWith(`${episodeId}/`)) } };
}

// Stage hash recomputed from the specs on disk (after a single shot was regenerated).
export async function scenesHash(ctx: StageContext, episodeId: string): Promise<string> {
  const shotList = (await ctx.store.read(files.shotList(episodeId), "ShotList")).data;
  return hashData(shotList.shots.map((shot) => ctx.store.hashOf(files.shotSpec(episodeId, shot.id))));
}
