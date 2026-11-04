// Growing canon (v2 phase 5): before an episode after the first is written, the canon keeper compares its synopsis with
// what has been built. Anyone or anywhere it needs that doesn't exist yet gets a cast sheet or place, is built into the
// world (only the new models and locations), and goes through the same model review as the first build. The result is
// saved as that episode's CanonAddition; see canon/merge.ts for how every stage then sees it.
import * as z from "zod";
import { ShowBible, WorldLocation, WorldModel, toAiJsonSchema, type CanonAddition, type SeriesPlan, type World } from "@moco/spec";
import { loadLibrary } from "@moco/kit/library";
import { EngineError } from "../errors.ts";
import { joinSections, jsonSection, loadPrompt, promptRef } from "../generator/prompts.ts";
import { lessonsSection, readPlaybook } from "../learn/playbook.ts";
import { formatIssues, type Issue } from "../loop/feedback.ts";
import { generateValidated } from "../loop/loop.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkIds, planWithAi } from "../planner/common.ts";
import { readShow } from "../planner/show.ts";
import { checkWorld, librarySection } from "../planner/world.ts";
import { lookAtModels } from "../review/look.ts";

const MAX_CAST = 3;
const MAX_PLACES = 2;
// An extension is far smaller than a whole world, but still one long answer.
const EXTEND_TIMEOUT_MS = 20 * 60_000;

const CanonRequest = z.object({ reason: z.string().min(1), cast: ShowBible.shape.cast, places: ShowBible.shape.places });
type CanonRequest = z.infer<typeof CanonRequest>;
const WorldExtension = z.object({
  models: z.array(WorldModel).max(20),
  locations: z.array(WorldLocation).max(MAX_PLACES),
  cast: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase with dashes"), model: z.string().min(1), description: z.string() })),
});
type WorldExtension = z.infer<typeof WorldExtension>;

// Returns the episode's addition, or undefined when nothing new was needed (or the series has no world to grow).
export async function growCanon(ctx: StageContext, episodeId: string): Promise<CanonAddition | undefined> {
  const plan = (await ctx.store.read(files.seriesPlan, "SeriesPlan")).data;
  const episodeIndex = plan.episodes.findIndex((episode) => episode.id === episodeId);
  // The first episode's needs went into the first build; a kit series has no world to add to.
  if (episodeIndex <= 0 || !ctx.world || !ctx.store.has(files.show)) return undefined;
  // Append-only: an episode grows the canon once, so redoing its script doesn't rebuild what was approved.
  if (ctx.store.has(files.canon(episodeId))) return (await ctx.store.read(files.canon(episodeId), "CanonAddition")).data;

  const show = (await readShow(ctx))!;
  const world = ctx.world;
  const playbook = await readPlaybook(ctx);
  const request = await planWithAi(ctx, {
    scope: episodeId,
    promptName: "canon",
    schema: CanonRequest,
    prompt: joinSections([
      jsonSection("Episode", plan.episodes[episodeIndex]),
      jsonSection("Series", { title: plan.title, premise: plan.premise }),
      jsonSection("Show", { tone: show.tone, look: show.look.statement, palette: show.look.palette }),
      jsonSection("Canon so far", {
        cast: show.cast.map(({ id, name, role }) => ({ id, name, role })),
        places: show.places.map(({ id, name, description }) => ({ id, name, description })),
      }),
    ]),
    check: (data) => checkRequest(data, show.cast.map((member) => member.id), [...show.places.map((place) => place.id), ...world.locations.map((location) => location.id)]),
  });
  if (request.cast.length === 0 && request.places.length === 0) {
    ctx.ledger.decide("canon", episodeId, `nothing new: ${request.reason}`);
    return undefined;
  }

  const extension = await buildExtension(ctx, episodeId, plan, show, world, request, lessonsSection(playbook, "world"));
  const addition: CanonAddition = { episodeId, reason: request.reason, cast: request.cast, places: request.places, world: extension };
  await ctx.store.save(files.canon(episodeId), "CanonAddition", addition, {
    producedBy: "ai",
    backend: ctx.ai.backendId,
    inputs: [ctx.store.inputRef(files.show), ctx.store.inputRef(files.world), promptRef("canon"), promptRef("world_extend")],
  });
  ctx.useWorld(withExtension(world, extension));
  ctx.ledger.decide("canon", episodeId, `added ${[...request.cast.map((member) => member.name), ...request.places.map((place) => place.name)].join(", ")}: ${request.reason}`);
  await ctx.bus.emit(ctx.seriesId, "canon.grown", { episodeId, cast: request.cast.map((member) => member.id), places: request.places.map((place) => place.id), models: extension.models.map((model) => model.id) });
  return addition;
}

export function checkRequest(request: CanonRequest, castIds: string[], placeIds: string[]): Issue[] {
  const issues = [
    ...checkIds(request.cast.map((member) => member.id), "cast", /^[a-z0-9][a-z0-9-]*$/, "ravana"),
    ...checkIds(request.places.map((place) => place.id), "places", /^[a-z0-9][a-z0-9-]*$/, "ashoka-grove"),
  ];
  request.cast.forEach((member, index) => {
    if (castIds.includes(member.id)) issues.push({ path: `cast[${index}].id`, problem: `"${member.id}" is already in the canon`, fix: "Leave existing characters out; list only new ones." });
  });
  request.places.forEach((place, index) => {
    if (placeIds.includes(place.id)) issues.push({ path: `places[${index}].id`, problem: `"${place.id}" is already in the canon`, fix: "Leave existing places out; list only new ones." });
  });
  if (request.cast.length > MAX_CAST) issues.push({ path: "cast", problem: `${request.cast.length} new characters; at most ${MAX_CAST} per episode`, fix: "Keep the ones the synopsis can't do without." });
  if (request.places.length > MAX_PLACES) issues.push({ path: "places", problem: `${request.places.length} new places; at most ${MAX_PLACES} per episode`, fix: "Reuse an existing place for the rest." });
  return issues;
}

async function buildExtension(ctx: StageContext, episodeId: string, plan: SeriesPlan, show: ShowBible, world: World, request: CanonRequest, lessons: string): Promise<WorldExtension> {
  const result = await generateValidated({
    ai: ctx.ai,
    scope: episodeId,
    schema: WorldExtension,
    jsonSchema: toAiJsonSchema(WorldExtension),
    // The extension rules first, so they frame the full world-building guide that follows.
    system: `${loadPrompt("world_extend").trimEnd()}\n\n${loadPrompt("world", ctx.series.template)}`,
    prompt: joinSections([
      jsonSection("The world as it is — reuse these models by id, don't rebuild them", {
        look: world.look,
        models: world.models.map(({ id, height, rig }) => ({ id, height, rig })),
        locations: world.locations.map(({ id, hint }) => ({ id, hint })),
        cast: world.cast.map(({ id, model }) => ({ id, model })),
      }),
      jsonSection("The show's look", show.look),
      jsonSection("Build exactly these new characters and places", { cast: request.cast, places: request.places }),
      lessons,
      librarySection(loadLibrary()),
    ]),
    maxAttempts: ctx.config.limits.maxAttemptsPerPlanStage,
    check: (data) => checkExtension(data, world, request),
    signal: ctx.signal,
    timeoutMs: EXTEND_TIMEOUT_MS,
  });
  if (!result.ok) throw new EngineError("validation_failed", `The AI couldn't extend the world after ${result.attempts} attempts:\n${formatIssues(result.issues)}`);
  // A described character is a humanoid whatever rig was written, as in the first build.
  const rigged = { ...result.data, models: result.data.models.map((model) => (model.character ? { ...model, rig: "humanoid" as const } : model)) };
  // Only the new models are looked at: the rest were reviewed and approved with the first build.
  const { world: looked } = await lookAtModels(ctx, plan, { look: world.look, models: rigged.models, locations: [], cast: rigged.cast }, show);
  return { ...rigged, models: looked.models };
}

function withExtension(world: World, extension: WorldExtension): World {
  return { ...world, models: [...world.models, ...extension.models], locations: [...world.locations, ...extension.locations], cast: [...world.cast, ...extension.cast] };
}

export function checkExtension(extension: WorldExtension, world: World, request: CanonRequest): Issue[] {
  const taken = new Set(world.models.map((model) => model.id));
  const issues: Issue[] = [
    ...extension.models.filter((model) => taken.has(model.id)).map((model) => ({ path: "models", problem: `"${model.id}" already exists`, fix: "Reuse it by id in a location instead of returning it, or give the new model another id." })),
    ...request.places.filter((place) => !extension.locations.some((location) => location.id === place.id)).map((place) => ({ path: "locations", problem: `no location for the new place "${place.id}"`, fix: `Add a location with id "${place.id}".` })),
  ];
  const merged = withExtension(world, extension);
  // The whole merged world must still be sound, and every new character needs a cast entry and a model.
  return [...issues, ...checkWorld(merged, request.cast.map((member) => member.id))];
}
