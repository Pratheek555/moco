// Growing canon, read side: the series' canon is its approved show bible, bible and world plus every episode's
// CanonAddition (artifacts/canon/<episode>.json), merged in episode order. Additions only ever add new ids, so the base
// artifacts stay exactly as approved and an episode already made keeps what it was made with.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CanonAddition, SeriesBible, ShowBible, World } from "@moco/spec";
import type { ArtifactStore } from "../store/artifacts.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";

export async function readAdditions(dir: string, store: ArtifactStore): Promise<CanonAddition[]> {
  const folder = join(dir, files.canonDir);
  if (!existsSync(folder)) return [];
  const names = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => (await store.read(`${files.canonDir}/${name}`, "CanonAddition")).data));
}

export function showWithAdditions(show: ShowBible, additions: CanonAddition[]): ShowBible {
  return { ...show, cast: [...show.cast, ...additions.flatMap((addition) => addition.cast)], places: [...show.places, ...additions.flatMap((addition) => addition.places)] };
}

export function worldWithAdditions(world: World, additions: CanonAddition[]): World {
  return {
    ...world,
    models: [...world.models, ...additions.flatMap((addition) => addition.world.models)],
    locations: [...world.locations, ...additions.flatMap((addition) => addition.world.locations)],
    cast: [...world.cast, ...additions.flatMap((addition) => addition.world.cast)],
  };
}

export function bibleWithAdditions(bible: SeriesBible, additions: CanonAddition[]): SeriesBible {
  const added = additions.flatMap((addition) => addition.world.cast).map(({ id, model, description }) => ({ id, kitCharacterId: model, description }));
  return { ...bible, cast: [...bible.cast, ...added] };
}

// The bible every stage casts from: the approved one plus the characters later episodes added.
export async function readBible(ctx: StageContext): Promise<SeriesBible> {
  const bible = (await ctx.store.read(files.bible, "SeriesBible")).data;
  return bibleWithAdditions(bible, await readAdditions(ctx.dir, ctx.store));
}
