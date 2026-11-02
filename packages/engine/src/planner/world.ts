// A story the kit can't play gets a world of its own: the AI builds its cast, sets and places as data (see World in
// @moco/spec), and from then on the series runs on a catalog made from that world, so every later stage treats the
// AI's models and locations just like installed kit entries.
import { DEFAULT_IDLE, HUMANOID_JOINTS, WORLD_CAMERAS, movesOf, type Catalog, type CatalogCharacter } from "@moco/kit";
import { World, type SceneSpec, type SeriesPlan, type WorldLocation, type WorldModel, type WorldPart } from "@moco/spec";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { planWithAi, previousSection } from "./common.ts";

// Building a whole world is one long answer: a real one took 14 minutes, so this leaves room for a bigger story.
const WORLD_TIMEOUT_MS = 30 * 60_000;

export async function runWorld(ctx: StageContext, plan: SeriesPlan, feedback?: string): Promise<World> {
  const world = await planWithAi(ctx, {
    scope: "series",
    promptName: "world",
    schema: World,
    timeoutMs: WORLD_TIMEOUT_MS,
    prompt: joinSections([
      jsonSection("Series plan", plan),
      await previousSection(ctx, files.world, "World", feedback),
      feedbackSection(feedback),
    ]),
    check: checkWorld,
  });
  await ctx.store.save(files.world, "World", world, {
    producedBy: "ai",
    backend: ctx.ai.backendId,
    inputs: [ctx.store.inputRef(files.seriesPlan), promptRef("world")],
  });
  return world;
}

// ---------- checks the schema can't make ----------

function duplicates(ids: string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

// What each shape needs beyond its size.
const SHAPE_NEEDS: Partial<Record<WorldPart["shape"], "profile" | "outline" | "path">> = { lathe: "profile", extrude: "outline", tube: "path" };

function checkPart(part: WorldPart, path: string, model: WorldModel, ids: Set<string>): Issue[] {
  const issues: Issue[] = [];
  if (part.parent !== undefined && !ids.has(part.parent)) issues.push({ path: `${path}.parent`, problem: `"${part.parent}" is not a part of ${model.id}` });
  if (!(part.surface in model.surfaces)) issues.push({ path: `${path}.surface`, problem: `"${part.surface}" is not a surface of ${model.id}`, allowed: Object.keys(model.surfaces) });
  const needs = SHAPE_NEEDS[part.shape];
  if (needs && !part[needs]) issues.push({ path, problem: `a ${part.shape} needs \`${needs}\`` });
  return issues;
}

// A part that can't reach the root through its parents never draws, and would hang anything that walks up the chain.
function loopingParts(model: WorldModel): string[] {
  const byId = new Map(model.parts.map((part) => [part.id, part]));
  const reachesRoot = (part: WorldPart): boolean => {
    const seen = new Set<string>();
    let current: WorldPart | undefined = part;
    while (current?.parent !== undefined) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      current = byId.get(current.parent);
    }
    return true;
  };
  return model.parts.filter((part) => !reachesRoot(part)).map((part) => part.id);
}

function checkMoves(model: WorldModel, path: string, ids: Set<string>): Issue[] {
  return model.moves.flatMap((move, index) => {
    const named = [...new Set(move.keys.flatMap((key) => Object.keys(key.turn)))];
    return named.filter((part) => !ids.has(part)).map((part) => ({ path: `${path}.moves[${index}]`, problem: `"${part}" is not a part of ${model.id}` }));
  });
}

function checkModel(model: WorldModel, index: number): Issue[] {
  const path = `models[${index}]`;
  const ids = new Set(model.parts.map((part) => part.id));
  const loops = loopingParts(model);
  const missing = model.rig === "humanoid" ? HUMANOID_JOINTS.filter((joint) => !ids.has(joint)) : [];
  return [
    ...duplicates(model.parts.map((part) => part.id)).map((id) => ({ path: `${path}.parts`, problem: `part id "${id}" is used twice` })),
    ...model.parts.flatMap((part, partIndex) => checkPart(part, `${path}.parts[${partIndex}]`, model, ids)),
    ...(loops.length > 0 ? [{ path: `${path}.parts`, problem: `${loops.join(", ")} form a loop of parents` }] : []),
    ...(missing.length > 0 ? [{ path, problem: `a humanoid needs parts with these exact ids: ${missing.join(", ")}`, fix: 'Add them, or use rig "none" with its own moves.' }] : []),
    ...checkMoves(model, path, ids),
  ];
}

function checkLocation(location: WorldLocation, index: number, modelIds: string[]): Issue[] {
  const path = `locations[${index}]`;
  const unknown = (ids: string[], field: string) => ids.filter((id) => !modelIds.includes(id)).map((id) => ({ path: `${path}.${field}`, problem: `"${id}" is not a model`, allowed: modelIds }));
  const flipped = location.scatter.filter((entry) => entry.far <= entry.near).map((entry) => ({ path: `${path}.scatter`, problem: `${entry.model}: far must be beyond near` }));
  return [
    ...unknown(location.set.map((item) => item.model), "set"),
    ...unknown(location.scatter.map((item) => item.model), "scatter"),
    ...duplicates(location.marks.map((mark) => mark.id)).map((id) => ({ path: `${path}.marks`, problem: `mark id "${id}" is used twice` })),
    ...flipped,
  ];
}

export function checkWorld(world: World): Issue[] {
  const modelIds = world.models.map((model) => model.id);
  const unknownCast = world.cast.filter((member) => !modelIds.includes(member.model));
  return [
    ...duplicates(modelIds).map((id) => ({ path: "models", problem: `model id "${id}" is used twice` })),
    ...duplicates(world.locations.map((location) => location.id)).map((id) => ({ path: "locations", problem: `location id "${id}" is used twice` })),
    ...world.models.flatMap(checkModel),
    ...world.locations.flatMap((location, index) => checkLocation(location, index, modelIds)),
    ...unknownCast.map((member) => ({ path: "cast", problem: `${member.id} is played by "${member.model}", which is not a model`, allowed: modelIds })),
  ];
}

// ---------- the world as a catalog ----------

const moveList = (model: WorldModel) => movesOf(model).map(({ name, minFrames }) => ({ name, minFrames }));

function castCharacter(model: WorldModel): CatalogCharacter {
  return { id: model.id, packs: ["generated"], variants: [], actions: moveList(model), expressions: [], visemes: [], layers: [], angles: ["front"], idle: DEFAULT_IDLE, anchors: { defaultScale: 1 } };
}

// A series with a world sees only that world: no other story's characters or places to wander into.
export function worldCatalog(base: Catalog, world: World): Catalog {
  const castModels = world.cast.map((member) => member.model);
  const things = world.models.map((model) => ({ id: model.id, height: model.height, moves: moveList(model) }));
  return {
    ...base,
    characters: world.models.filter((model) => castModels.includes(model.id)).map(castCharacter),
    props: [],
    fx: [],
    atmosphere: [],
    backgrounds: world.locations.map((location) => ({
      id: location.id,
      hint: location.hint,
      layers: [],
      timeOfDay: ["set"],
      stage: { cameras: WORLD_CAMERAS, places: location.marks.map(({ id, hint }) => ({ id, hint })), subjects: castModels, things },
    })),
  };
}

// The part of the world one shot needs. It travels inside the spec, so a render needs nothing else and a changed
// world changes the spec's hash, which is what sends the shot back to the renderer.
export function worldForShot(world: World, spec: Pick<SceneSpec, "background" | "stage">): SceneSpec["world"] {
  const location = world.locations.find((candidate) => candidate.id === spec.background.id);
  if (!location) return undefined;
  const used = new Set([...location.set, ...location.scatter, ...(spec.stage?.players ?? [])].map((item) => item.model));
  return { location, models: world.models.filter((model) => used.has(model.id)) };
}
