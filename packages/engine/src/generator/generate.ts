// Shot → SceneSpec via the AI, through the validate → render-check → fix loop.
// After the attempt cap, a deterministic fallback shot is saved instead and flagged for the user.
// Each spec records a "SceneInput" hash of everything it was generated from; if that hash is unchanged
// on the next run, the spec is reused without calling the AI (partial regeneration).
import { join } from "node:path";
import { AiSceneSpec, SceneSpec, toAiJsonSchema, type InputRef, type SeriesBible, type SeriesMemory, type Shot, type VoiceoverTrack } from "@moco/spec";
import type { Issue } from "../loop/feedback.ts";
import { generateValidated } from "../loop/loop.ts";
import { avoidFor, repeatedLook, shotLook, validateScene, type SceneBrief, type ShotLook } from "../loop/validate.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { hashData } from "../store/hash.ts";
import { catalogSlice, fallbackScene, goldenScene, relevantFacts, shotBrief, shotVisemes } from "./context.ts";
import { feedbackSection, joinSections, jsonSection, loadPrompt, promptRef } from "./prompts.ts";

const sceneJsonSchema = toAiJsonSchema(AiSceneSpec);

export interface SceneInputs {
  episodeId: string;
  shot: Shot;
  voiceover: VoiceoverTrack;
  bible: SeriesBible;
  memory?: SeriesMemory;
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
  const { episodeId, shot } = inputs;
  const brief = { ...shotBrief(shot, inputs.voiceover), avoid: inputs.avoid };
  const shotDir = files.shotDir(episodeId, shot.id);
  const specFile = files.shotSpec(episodeId, shot.id);
  const sceneInput = sceneInputRef(ctx, inputs, brief);

  const reusable = !inputs.force && !inputs.feedback && (await upToDate(ctx, specFile, sceneInput));
  if (reusable) return { shotId: shot.id, fallback: false, attempts: 0, contentHash: await refreshEngineFields(ctx, specFile, inputs) };

  const result = await generateValidated({
    ai: ctx.ai,
    scope: episodeId,
    schema: SceneSpec,
    jsonSchema: sceneJsonSchema,
    system: loadPrompt("scene"),
    prompt: scenePrompt(ctx, inputs, brief),
    maxAttempts: ctx.config.limits.maxAttemptsPerShot,
    signal: ctx.signal,
    check: (spec) => checkScene(ctx, spec, brief, inputs.bible, shotDir),
    onAttempt: async (attempt) => {
      await ctx.store.writeRaw(`${shotDir}/attempts/${String(attempt.attempt).padStart(2, "0")}.json`, attempt);
      await ctx.bus.emit(ctx.seriesId, "shot.attempt", { episodeId, shotId: shot.id, attempt: attempt.attempt, errors: attempt.issues.length });
    },
  });

  // A looks-only regeneration that fails keeps what it had: a repeated framing beats a shot with no cast.
  if (!result.ok && inputs.keepOnFailure && ctx.store.has(specFile)) {
    ctx.ledger.decide("regenerate", `${episodeId}/${shot.id}`, `kept the previous spec: ${result.attempts} attempts couldn't avoid ${JSON.stringify(inputs.avoid)}`);
    return { shotId: shot.id, fallback: false, attempts: result.attempts, contentHash: ctx.store.hashOf(specFile)! };
  }

  const spec = withEngineFields(result.ok ? result.data : fallbackScene(brief), inputs);
  if (!result.ok) {
    // Never silent: recorded in the ledger and shown in the UI as "needs attention".
    ctx.ledger.decide("fallback", `${episodeId}/${shot.id}`, `${result.attempts} attempts failed; last issues: ${result.issues.length}`);
    await ctx.bus.emit(ctx.seriesId, "shot.fallback", { episodeId, shotId: shot.id, issues: result.issues.slice(0, 8) });
  }

  const saved = await ctx.store.save(specFile, "SceneSpec", spec, {
    producedBy: result.ok ? "ai" : "engine",
    backend: result.ok ? ctx.ai.backendId : undefined,
    inputs: [ctx.store.inputRef(files.shotList(episodeId)), ctx.store.inputRef(files.voiceover(episodeId)), sceneInput],
  });
  return { shotId: shot.id, fallback: !result.ok, attempts: result.attempts, contentHash: saved.meta.contentHash };
}

// Everything that shapes this shot's spec. Times are relative to the shot, so a shot that only moved
// in time (because an earlier line changed) still matches.
function sceneInputRef(ctx: StageContext, inputs: SceneInputs, brief: SceneBrief): InputRef {
  const { id: _id, start: _start, end: _end, ...shotContent } = brief.shot;
  const key = hashData({
    shot: shotContent,
    durationFrames: brief.durationFrames,
    words: brief.words,
    kit: catalogSlice(ctx.catalog, inputs.bible, brief.shot),
    kitVersion: ctx.catalog.kitVersion,
    style: inputs.bible.style,
    facts: relevantFacts(inputs.memory, brief.shot),
    prompt: promptRef("scene").contentHash,
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

// Fields the engine owns, not the AI: costume/age variants and the series grade (bible decisions) and the
// lip-sync track (from the audio).
function withEngineFields(spec: SceneSpec, inputs: SceneInputs): SceneSpec {
  const visemes = shotVisemes(inputs.shot, inputs.voiceover);
  return { ...withBibleVariants(spec, inputs.bible), visemes, grade: inputs.bible.style.grade };
}

function withBibleVariants(spec: SceneSpec, bible: SeriesBible): SceneSpec {
  const actors = spec.actors.map((actor) => ({ ...actor, variant: bible.cast.find((member) => member.id === actor.castId)?.variant }));
  return { ...spec, actors };
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
async function checkScene(ctx: StageContext, spec: SceneSpec, brief: SceneBrief, bible: SeriesBible, shotDir: string): Promise<Issue[]> {
  const semantic = validateScene(spec, { brief, bible, catalog: ctx.catalog });
  if (semantic.length > 0) return semantic;

  const lastFrame = spec.durationFrames - 1;
  const frames = [0, Math.floor(lastFrame / 2), lastFrame];
  const outDir = join(ctx.dir, shotDir, "stills");
  // Saved before rendering, so a spec that crashes or hangs the renderer can be inspected afterwards.
  await ctx.store.writeRaw(`${shotDir}/stills/spec.json`, spec);
  const check = await ctx.renderSlots.run(() => ctx.render.check(withBibleVariants(spec, bible), { frames, outDir }));
  if (check.ok) return [];
  return check.errors.map((error) => ({
    path: error.path ?? "",
    problem: `renderer error${error.frame === undefined ? "" : ` at frame ${error.frame}`}: ${error.message}`,
  }));
}

function scenePrompt(ctx: StageContext, inputs: SceneInputs, brief: SceneBrief): string {
  return joinSections([
    jsonSection("Shot brief", {
      shotId: brief.shot.id,
      durationFrames: brief.durationFrames,
      intent: brief.shot.intent,
      characters: brief.shot.characters,
      location: brief.shot.location,
      cameraHint: brief.shot.cameraHint,
      voiceoverWords: brief.words,
      avoid: brief.avoid, // left out of the JSON when unset
    }),
    jsonSection("Kit you can use", catalogSlice(ctx.catalog, inputs.bible, brief.shot)),
    jsonSection("Series style", inputs.bible.style),
    jsonSection("Continuity to respect", relevantFacts(inputs.memory, brief.shot)),
    jsonSection("Example of a good SceneSpec (a different shot — copy the quality, not the content)", AiSceneSpec.parse(goldenScene())), // engine fields stripped
    feedbackSection(inputs.feedback),
  ]);
}

// ---------- stages ----------

// Stage sample (first episode only): the first shot, generated and shown before the rest.
export async function runSample(ctx: StageContext, episodeId: string, feedback?: string): Promise<string> {
  const shotList = (await ctx.store.read(files.shotList(episodeId), "ShotList")).data;
  const shared = await sceneSharedInputs(ctx, episodeId);
  const outcome = await generateScene(ctx, { ...shared, shot: shotList.shots[0]!, feedback });
  return outcome.contentHash;
}

// Stage scenes: every shot in parallel (the AI semaphore limits real concurrency). Up-to-date specs are reused.
// Returns the stage hash: the shot spec hashes in order.
export async function runScenes(ctx: StageContext, episodeId: string): Promise<string> {
  const shotList = (await ctx.store.read(files.shotList(episodeId), "ShotList")).data;
  const shared = await sceneSharedInputs(ctx, episodeId);
  const settled = await Promise.allSettled(shotList.shots.map((shot) => generateScene(ctx, { ...shared, shot })));
  // Wait for every shot before failing, so no shot keeps writing after the stage is marked failed.
  const failure = settled.find((outcome) => outcome.status === "rejected");
  if (failure) throw failure.reason;
  await breakRepeatedLooks(ctx, episodeId, shotList.shots, shared);
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
  const bible = (await ctx.store.read(files.bible, "SeriesBible")).data;
  const memory = ctx.store.has(files.memory) ? (await ctx.store.read(files.memory, "SeriesMemory")).data : undefined;
  return { episodeId, voiceover, bible, memory };
}

// Stage hash recomputed from the specs on disk (after a single shot was regenerated).
export async function scenesHash(ctx: StageContext, episodeId: string): Promise<string> {
  const shotList = (await ctx.store.read(files.shotList(episodeId), "ShotList")).data;
  return hashData(shotList.shots.map((shot) => ctx.store.hashOf(files.shotSpec(episodeId, shot.id))));
}
