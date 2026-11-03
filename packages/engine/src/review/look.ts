// The AI looks at what it made. Every model and shot is written blind, as numbers, so a render is shown back to it
// and the ones that don't read get one more go with the notes. Models are reviewed when the world is built, shots
// once every shot of an episode exists. Only for a backend that can see images; a review that fails is skipped, never
// fatal: the work it would have polished is already valid.
import { join } from "node:path";
import { HUMANOID_JOINTS } from "@moco/kit";
import { SceneSpec, World, WorldLocation, WorldModel, toAiJsonSchema, type SeriesPlan, type Shot } from "@moco/spec";
import * as z from "zod";
import { shotBrief } from "../generator/context.ts";
import { generateScene, type SceneInputs } from "../generator/generate.ts";
import { joinSections, jsonSection, loadPrompt } from "../generator/prompts.ts";
import { generateValidated } from "../loop/loop.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkModel } from "../planner/world.ts";

// A score at or under this is sent back.
const FIX_AT = 3;
// Images per review call: enough to judge a cut together, few enough to keep one request small.
const PER_CALL = 12;

const Verdict = z.object({
  id: z.string(),
  score: z.number().int().min(1).max(5),
  problems: z.array(z.string()).max(6),
  fix: z.string(),
});
const Review = z.object({ verdicts: z.array(Verdict), overall: z.string() });
type Verdict = z.infer<typeof Verdict>;

export interface LookOutcome {
  reviewed: number;
  fixed: string[]; // ids sent back
}

async function look(ctx: StageContext, scope: string, prompt: "look_models" | "look_shots", items: { id: string; image: string; brief: unknown }[]): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (let start = 0; start < items.length; start += PER_CALL) {
    const batch = items.slice(start, start + PER_CALL);
    const result = await ctx.ai.generate(
      {
        system: loadPrompt(prompt),
        prompt: joinSections([
          `The ${batch.length} images above are, in order: ${batch.map((item, index) => `image ${index + 1} = ${item.id}`).join(", ")}.`,
          jsonSection("What each one is meant to be", batch.map(({ id, brief }) => ({ id, ...(brief as object) }))),
          "Return one verdict per image, with its id.",
        ]),
        images: batch.map((item) => item.image),
        jsonSchema: toAiJsonSchema(Review),
        signal: ctx.signal,
      },
      scope,
    );
    const parsed = Review.safeParse(result.json);
    if (parsed.success) verdicts.push(...parsed.data.verdicts.filter((verdict) => batch.some((item) => item.id === verdict.id)));
  }
  return verdicts;
}

const worst = (verdicts: Verdict[], limit: number) => verdicts.filter((verdict) => verdict.score <= FIX_AT).sort((a, b) => a.score - b.score).slice(0, limit);
const notes = (verdict: Verdict) => [...verdict.problems.map((problem) => `- ${problem}`), `Fix: ${verdict.fix}`].join("\n");

// ---------- models ----------

// A plain grey studio: what a model looks like with nothing else to read it by.
const STUDIO = WorldLocation.parse({
  id: "model_check",
  hint: "a neutral studio to look at one model",
  sky: { top: "#8f99a6", middle: "#aeb6bf", horizon: "#c9cdd2", sunAzimuth: 35, sunElevation: 50, sunColour: "#ffffff", sunStrength: 2.2, fill: 1.3, fog: "#c9cdd2", fogDensity: 0 },
  ground: { kind: "land", surface: { colour: "#7d838a" } },
  marks: [{ id: "centre", hint: "the middle", at: [0, 0, 0] }],
});

function modelShot(model: WorldModel, camera: string): SceneSpec {
  return SceneSpec.parse({
    shotId: `look-${model.id}-${camera}`,
    durationFrames: 30,
    background: { id: STUDIO.id },
    stage: { camera, place: "centre", subject: model.id, players: [{ id: model.id, model: model.id, at: [0, 0, 0], facing: 25, actions: [] }] },
    actors: [],
    captions: [],
    world: { location: STUDIO, models: [model] },
  });
}

// Renders each model on its own and has the AI rebuild the ones that don't read. Returns the world with them replaced.
export async function lookAtModels(ctx: StageContext, plan: SeriesPlan, world: World, maxFixes = 6): Promise<{ world: World; outcome: LookOutcome }> {
  if (!ctx.ai.seesImages) return { world, outcome: { reviewed: 0, fixed: [] } };
  try {
    const cast = new Map(world.cast.map((member) => [member.model, member]));
    const dir = join(ctx.dir, "cache", "look", "models");
    const items: { id: string; image: string; brief: unknown }[] = [];
    for (const model of world.models) {
      // Characters are judged on their face, which a full-length shot is too far away to show.
      const camera = cast.has(model.id) ? "medium" : "wide";
      const check = await ctx.renderSlots.run(() => ctx.render.check(modelShot(model, camera), { frames: [15], outDir: join(dir, model.id) }));
      if (!check.ok) continue;
      const member = cast.get(model.id);
      items.push({ id: model.id, image: check.stills[0]!, brief: { heightMetres: model.height, ...(member ? { character: member } : {}) } });
    }
    const verdicts = await look(ctx, "series", "look_models", items.map((item) => ({ ...item, brief: { ...(item.brief as object), story: plan.title } })));
    const toFix = worst(verdicts, maxFixes);
    await ctx.bus.emit(ctx.seriesId, "look.models", { reviewed: verdicts.length, fixing: toFix.map((verdict) => verdict.id) });

    const fixed = await Promise.all(toFix.map((verdict) => fixModel(ctx, world.models.find((model) => model.id === verdict.id)!, items.find((item) => item.id === verdict.id)!.image, verdict)));
    const replaced = new Map(fixed.filter((model): model is WorldModel => model !== undefined).map((model) => [model.id, model]));
    for (const verdict of toFix) ctx.ledger.decide("look", `model ${verdict.id}`, `scored ${verdict.score}/5${replaced.has(verdict.id) ? ", rebuilt" : ", rebuild failed, kept"}: ${verdict.problems.join("; ")}`);
    return { world: { ...world, models: world.models.map((model) => replaced.get(model.id) ?? model) }, outcome: { reviewed: verdicts.length, fixed: [...replaced.keys()] } };
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    ctx.ledger.decide("look", "models", `review skipped: ${err instanceof Error ? err.message : String(err)}`);
    return { world, outcome: { reviewed: 0, fixed: [] } };
  }
}

async function fixModel(ctx: StageContext, model: WorldModel, image: string, verdict: Verdict): Promise<WorldModel | undefined> {
  const joints = new Map(model.parts.map((part) => [part.id, part.at]));
  const result = await generateValidated({
    ai: { ...ctx.ai, generate: (request, scope) => ctx.ai.generate({ ...request, images: [image] }, scope) },
    scope: "series",
    schema: WorldModel,
    jsonSchema: toAiJsonSchema(WorldModel),
    system: loadPrompt("fix_model"),
    prompt: joinSections([jsonSection("The model as it is (the image above is its render)", model), `## The art director's notes\n${notes(verdict)}`]),
    maxAttempts: 2,
    signal: ctx.signal,
    check: (rebuilt) => {
      const issues = checkModel(rebuilt, 0).map((issue) => ({ ...issue, path: issue.path.replace(/^models\[0\]\.?/, "") }));
      if (rebuilt.id !== model.id) issues.push({ path: "id", problem: `must stay "${model.id}"` });
      if (rebuilt.rig !== model.rig) issues.push({ path: "rig", problem: `must stay "${model.rig}"` });
      if (Math.abs(rebuilt.height / model.height - 1) > 0.15) issues.push({ path: "height", problem: `must stay near ${model.height}` });
      return issues;
    },
  });
  if (!result.ok) return undefined;
  // A humanoid's joints keep their hinges, or every built-in move would bend in the wrong place.
  if (model.rig !== "humanoid" || result.data.character) return result.data;
  return { ...result.data, parts: result.data.parts.map((part) => (joints.has(part.id) && HUMANOID_JOINTS.includes(part.id) ? { ...part, at: joints.get(part.id)! } : part)) };
}

// ---------- shots ----------

// Looks at every shot's middle still against its brief and regenerates the weakest with the notes, once.
export async function lookAtShots(ctx: StageContext, episodeId: string, shots: Shot[], shared: Omit<SceneInputs, "shot">, maxFixes = Math.ceil(shots.length / 3)): Promise<LookOutcome> {
  if (!ctx.ai.seesImages) return { reviewed: 0, fixed: [] };
  try {
    const items = await Promise.all(
      shots.map(async (shot) => {
        const spec = (await ctx.store.read(files.shotSpec(episodeId, shot.id), "SceneSpec")).data;
        const middle = Math.floor((spec.durationFrames - 1) / 2);
        const words = shotBrief(shot, shared.voiceover).words.map((word) => word.text).join(" ");
        // Rendered now: a reused shot's stills can be from an older renderer, and the director judges what ships.
        const check = await ctx.renderSlots.run(() => ctx.render.check(spec, { frames: [middle], outDir: join(ctx.dir, "cache", "look", episodeId, shot.id) }));
        return {
          id: shot.id,
          image: check.ok ? check.stills[0]! : join(ctx.dir, files.shotDir(episodeId, shot.id), "stills", `${middle}.png`),
          brief: { intent: shot.intent, spoken: words || undefined, camera: spec.stage?.camera, place: spec.stage?.place, subject: spec.stage?.subject, fallback: spec.fallback || undefined },
          fallback: spec.fallback,
        };
      }),
    );
    const verdicts = await look(ctx, episodeId, "look_shots", items);
    // Fallback shots already failed the AI: another go won't help.
    const toFix = worst(verdicts.filter((verdict) => !items.find((item) => item.id === verdict.id)?.fallback), maxFixes);
    await ctx.bus.emit(ctx.seriesId, "look.shots", { episodeId, reviewed: verdicts.length, fixing: toFix.map((verdict) => verdict.id) });
    for (const verdict of toFix) ctx.ledger.decide("look", `${episodeId}/${verdict.id}`, `scored ${verdict.score}/5, regenerated: ${verdict.problems.join("; ")}`);
    await Promise.all(
      toFix.map((verdict) => generateScene(ctx, { ...shared, shot: shots.find((shot) => shot.id === verdict.id)!, force: true, keepOnFailure: true, feedback: `The director saw this shot rendered and asked for changes:\n${notes(verdict)}` })),
    );
    return { reviewed: verdicts.length, fixed: toFix.map((verdict) => verdict.id) };
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    ctx.ledger.decide("look", episodeId, `review skipped: ${err instanceof Error ? err.message : String(err)}`);
    return { reviewed: 0, fixed: [] };
  }
}
