// The AI looks at what it made. Every model and shot is written blind, as numbers, so a render is shown back to it
// and the ones that don't read get one more go with the notes. Models are reviewed when the world is built, shots
// once every shot of an episode exists. Only for a backend that can see images; a review that fails is skipped, never
// fatal: the work it would have polished is already valid.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HUMANOID_JOINTS } from "@moco/kit";
import { SceneSpec, World, WorldLocation, WorldModel, toAiJsonSchema, type Critique, type SeriesPlan, type Shot, type ShowBible } from "@moco/spec";
import * as z from "zod";
import { shotBrief } from "../generator/context.ts";
import { generateScene, type SceneInputs } from "../generator/generate.ts";
import { joinSections, jsonSection, loadPrompt } from "../generator/prompts.ts";
import { generateValidated } from "../loop/loop.ts";
import type { StageContext } from "../pipeline/context.ts";
import { temporalFrames } from "../artist/workspace.ts";
import { files } from "../pipeline/stages.ts";
import { appearanceOf, critiquePack } from "../planner/show.ts";
import { checkModel } from "../planner/world.ts";
import { reviewArtistEpisode } from "./artist.ts";

// A score at or under this is sent back.
const FIX_AT = 3;
// Images per review call: enough to judge a cut together, few enough to keep one request small.
const PER_CALL = 12;

const Verdict = z.object({
  id: z.string(),
  score: z.number().int().min(1).max(5),
  problems: z.array(z.string()).max(6),
  fix: z.string(),
  requirements: z.array(z.object({ id: z.string(), status: z.enum(["pass", "fail", "not_applicable", "unknown"]), evidence: z.string() })).optional(),
});
const Review = z.object({ verdicts: z.array(Verdict), overall: z.string() });
type Verdict = z.infer<typeof Verdict>;

export interface LookOutcome {
  reviewed: number;
  fixed: string[]; // ids sent back
}

// One thing to judge: a model's single render, or a shot's frames from start to end so movement can be judged.
interface LookItem {
  id: string;
  images: string[];
  brief: unknown;
}

// Items packed into calls of at most PER_CALL images, never splitting one item's frames across calls.
function batches(items: LookItem[]): LookItem[][] {
  const out: LookItem[][] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last.reduce((total, entry) => total + entry.images.length, 0) + item.images.length <= PER_CALL) last.push(item);
    else out.push([item]);
  }
  return out;
}

// Which images belong to which item, in the order they're attached: "images 1–3 = s01 (start, middle, end)".
function imageKey(batch: LookItem[]): string {
  let next = 1;
  return batch.map((item) => {
    const first = next;
    next += item.images.length;
    if (item.images.length === 1) return `image ${first} = ${item.id}`;
    return `images ${first}–${next - 1} = ${item.id} (${item.images.length === 3 ? "start, middle, end" : "in time order"})`;
  }).join(", ");
}

// `standard`: a prompt section on what good looks like for this show, judged on top of the prompt's general scale.
async function look(ctx: StageContext, scope: string, prompt: "look_models" | "look_shots", items: LookItem[], standard = ""): Promise<{ verdicts: Verdict[]; overall: string }> {
  const verdicts: Verdict[] = [];
  const overall: string[] = [];
  for (const batch of batches(items)) {
    const result = await ctx.ai.generate(
      {
        system: loadPrompt(prompt),
        prompt: joinSections([
          `The images above are, in order: ${imageKey(batch)}.`,
          standard,
          ctx.series.production ? jsonSection("Full original creative brief", ctx.series.idea) : "",
          ctx.series.production ? "For EVERY supplied requirement id, return requirements=[{id,status:pass|fail|not_applicable|unknown,evidence}] on each verdict. Explain actual frame evidence. A failed requirement caps the shot score at 3; an unknown cannot be called a pass. Judge character acting across the image sequence." : "",
          jsonSection("What each one is meant to be", batch.map(({ id, brief }) => ({ id, ...(brief as object) }))),
          "Return one verdict per id.",
        ]),
        images: batch.flatMap((item) => item.images),
        jsonSchema: toAiJsonSchema(Review),
        signal: ctx.signal,
      },
      scope,
    );
    const parsed = Review.safeParse(result.json);
    if (parsed.success) {
      verdicts.push(...parsed.data.verdicts.filter((verdict) => batch.some((item) => item.id === verdict.id)));
      overall.push(parsed.data.overall);
    }
  }
  return { verdicts, overall: overall.join(" ") };
}

// Every score, not only the failures: how a cut scored is how a pipeline change gets measured.
const scoresOf = (verdicts: Verdict[]) => Object.fromEntries(verdicts.map((verdict) => [verdict.id, verdict.score]));
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
export async function lookAtModels(ctx: StageContext, plan: SeriesPlan, world: World, show?: ShowBible, maxFixes = 6): Promise<{ world: World; outcome: LookOutcome }> {
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
      const appearance = appearanceOf(show, member?.id);
      items.push({ id: model.id, image: check.stills[0]!, brief: { heightMetres: model.height, ...(member ? { character: member } : {}), ...(appearance ? { modelSheet: appearance } : {}) } });
    }
    const standard = show ? jsonSection("The show's look — judge against it as well", { look: show.look.statement, palette: show.look.palette }) : "";
    const { verdicts } = await look(ctx, "series", "look_models", items.map((item) => ({ id: item.id, images: [item.image], brief: { ...(item.brief as object), story: plan.title } })), standard);
    const toFix = worst(verdicts, maxFixes);
    await ctx.bus.emit(ctx.seriesId, "look.models", { reviewed: verdicts.length, fixing: toFix.map((verdict) => verdict.id), scores: scoresOf(verdicts) });

    const fixed = await Promise.all(toFix.map((verdict) => fixModel(ctx, world.models.find((model) => model.id === verdict.id)!, items.find((item) => item.id === verdict.id)!, verdict)));
    const replaced = new Map(fixed.filter((model): model is WorldModel => model !== undefined).map((model) => [model.id, model]));
    for (const verdict of toFix) ctx.ledger.decide("look", `model ${verdict.id}`, `scored ${verdict.score}/5${replaced.has(verdict.id) ? ", rebuilt" : ", rebuild failed, kept"}: ${verdict.problems.join("; ")}`);
    return { world: { ...world, models: world.models.map((model) => replaced.get(model.id) ?? model) }, outcome: { reviewed: verdicts.length, fixed: [...replaced.keys()] } };
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    ctx.ledger.decide("look", "models", `review skipped: ${err instanceof Error ? err.message : String(err)}`);
    return { world, outcome: { reviewed: 0, fixed: [] } };
  }
}

async function fixModel(ctx: StageContext, model: WorldModel, item: { image: string; brief: unknown }, verdict: Verdict): Promise<WorldModel | undefined> {
  const { image } = item;
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

// The frames a shot is judged on: near its start, its middle and near its end, so the critic sees what moves (a
// subject walking out of frame, a camera arriving late, a pose that never changes), not one still.
export function critiqueFrames(durationFrames: number): number[] {
  const last = durationFrames - 1;
  return [...new Set([Math.round(last * 0.12), Math.round(last / 2), Math.round(last * 0.88)])];
}

// A shot as the critic sees it, rendered now: a reused shot's stills can be from an older renderer, and the director
// judges what ships. Undefined if nothing could be rendered or found for it.
async function shotItem(ctx: StageContext, episodeId: string, shot: Shot, shared: Omit<SceneInputs, "shot">, pass: string) {
  const spec = (await ctx.store.read(files.shotSpec(episodeId, shot.id), "SceneSpec")).data;
  const frames = spec.canvas ? temporalFrames(spec) : critiqueFrames(spec.durationFrames);
  const words = shotBrief(shot, shared.voiceover).words.map((word) => word.text).join(" ");
  const check = await ctx.renderSlots.run(() => ctx.render.check(spec, { frames, outDir: join(ctx.dir, "cache", "look", episodeId, shot.id, pass) }));
  const images = check.ok ? check.stills : frames.map((frame) => join(ctx.dir, files.shotDir(episodeId, shot.id), "stills", `${frame}.png`)).filter((file) => existsSync(file));
  if (images.length === 0) return undefined;
  const brief = { intent: shot.intent, spoken: words || undefined, camera: spec.stage?.camera, place: spec.stage?.place, subject: spec.stage?.subject, fallback: spec.fallback || undefined };
  return { id: shot.id, images, brief, fallback: spec.fallback };
}

// Looks at every shot against its brief, repairs the weakest with the notes, then looks at each repair: a repair is
// kept only if it scores at least as well as the shot it replaced. Every score is saved as the episode's critique,
// the evidence the episode retro learns from (learn/playbook.ts).
export async function lookAtShots(ctx: StageContext, episodeId: string, shots: Shot[], shared: Omit<SceneInputs, "shot">, maxFixes = Math.ceil(shots.length / 3)): Promise<LookOutcome> {
  if(ctx.series.production)return reviewArtistEpisode(ctx,episodeId,shots,shared);
  if (!ctx.ai.seesImages) return { reviewed: 0, fixed: [] };
  try {
    const items = (await Promise.all(shots.map((shot) => shotItem(ctx, episodeId, shot, shared, "first")))).filter((item) => item !== undefined);
    const standard = shared.show ? jsonSection("What a 5/5 shot is for this show — score against this rubric", critiquePack(shared.show)) : "";
    const first = await look(ctx, episodeId, "look_shots", items, standard);
    // Fallback shots already failed the AI: another go won't help.
    const toFix = worst(first.verdicts.filter((verdict) => !items.find((item) => item.id === verdict.id)?.fallback), maxFixes);
    await ctx.bus.emit(ctx.seriesId, "look.shots", { episodeId, reviewed: first.verdicts.length, fixing: toFix.map((verdict) => verdict.id), scores: scoresOf(first.verdicts) });

    const shotOf = (id: string) => shots.find((shot) => shot.id === id)!;
    const before = new Map(await Promise.all(toFix.map(async (verdict) => [verdict.id, await ctx.store.read(files.shotSpec(episodeId, verdict.id), "SceneSpec")] as const)));
    await Promise.all(
      toFix.map((verdict) => generateScene(ctx, { ...shared, shot: shotOf(verdict.id), force: true, keepOnFailure: true, feedback: `The director saw this shot rendered and asked for changes:
${notes(verdict)}` })),
    );
    const again = (await Promise.all(toFix.map((verdict) => shotItem(ctx, episodeId, shotOf(verdict.id), shared, "repair")))).filter((item) => item !== undefined);
    const second = again.length > 0 ? await look(ctx, episodeId, "look_shots", again, standard) : { verdicts: [], overall: "" };

    const repaired = new Map<string, { score: number; kept: boolean }>();
    for (const verdict of toFix) {
      const after = second.verdicts.find((candidate) => candidate.id === verdict.id);
      if (!after) continue;
      const kept = after.score >= verdict.score;
      const old = before.get(verdict.id)!;
      // Worse than before: put the old shot back, as a new revision, so the history shows both.
      if (!kept) await ctx.store.save(files.shotSpec(episodeId, verdict.id), "SceneSpec", old.data, { producedBy: old.meta.producedBy, backend: old.meta.backend, inputs: old.meta.inputs });
      repaired.set(verdict.id, { score: after.score, kept });
      ctx.ledger.decide("look", `${episodeId}/${verdict.id}`, `scored ${verdict.score}/5, repair scored ${after.score}/5, ${kept ? "kept" : "reverted"}: ${verdict.problems.join("; ")}`);
    }
    await ctx.bus.emit(ctx.seriesId, "look.repairs", { episodeId, repairs: Object.fromEntries(repaired) });

    const critique: Critique = {
      episodeId,
      shots: first.verdicts.map(({ id, score, problems, fix, requirements }) => ({ shotId: id, score, problems, fix, repaired: repaired.get(id), ...(requirements && { requirements }) })),
      overall: first.overall,
    };
    await ctx.store.save(files.critique(episodeId), "Critique", critique, { producedBy: "ai", backend: ctx.ai.backendId, inputs: shots.map((shot) => ctx.store.inputRef(files.shotSpec(episodeId, shot.id))) });
    return { reviewed: first.verdicts.length, fixed: [...repaired].filter(([, repair]) => repair.kept).map(([id]) => id) };
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    ctx.ledger.decide("look", episodeId, `review skipped: ${err instanceof Error ? err.message : String(err)}`);
    return { reviewed: 0, fixed: [] };
  }
}
