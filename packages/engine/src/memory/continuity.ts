// Stage memory_update: after an episode's preview is approved, the AI writes what later episodes must remember.
// Facts may only be about cast members or kit locations, so memory can't drift from the bible.
import { ContinuityUpdate, type SeriesMemory } from "@moco/spec";
import { joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { planWithAi } from "../planner/common.ts";
import { files } from "../pipeline/stages.ts";

export async function runMemoryUpdate(ctx: StageContext, episodeId: string): Promise<string> {
  const bible = (await ctx.store.read(files.bible, "SeriesBible")).data;
  const script = (await ctx.store.read(files.script(episodeId), "EpisodeScript")).data;
  const memory: SeriesMemory = ctx.store.has(files.memory)
    ? (await ctx.store.read(files.memory, "SeriesMemory")).data
    : { storySoFar: "", facts: [] };

  const entities = [...bible.cast.map((member) => member.id), ...ctx.catalog.backgrounds.map((background) => background.id)];
  const update = await planWithAi(ctx, {
    scope: episodeId,
    promptName: "memory",
    schema: ContinuityUpdate,
    prompt: joinSections([
      jsonSection("Story so far", memory.storySoFar || "Nothing yet."),
      jsonSection("Approved episode", { episodeId, narration: script.lines.map((line) => line.text) }),
      jsonSection("Allowed entities", entities),
    ]),
    check: (data) => checkUpdate(data, entities, episodeId),
  });

  const merged: SeriesMemory = { storySoFar: update.storySoFar, facts: [...memory.facts, ...update.newFacts] };
  const saved = await ctx.store.save(files.memory, "SeriesMemory", merged, {
    producedBy: "ai",
    backend: ctx.ai.backendId,
    inputs: [ctx.store.inputRef(files.script(episodeId)), promptRef("memory")],
  });
  return saved.meta.contentHash;
}

export function checkUpdate(update: ContinuityUpdate, entities: string[], episodeId: string): Issue[] {
  return update.newFacts.flatMap((fact, index) => {
    const path = `newFacts[${index}]`;
    if (!entities.includes(fact.entity)) return [{ path: `${path}.entity`, problem: `"${fact.entity}" is not a cast member or location`, allowed: entities, fix: "Pick one." }];
    if (fact.sinceEpisode !== episodeId) return [{ path: `${path}.sinceEpisode`, problem: `must be "${episodeId}"` }];
    return [];
  });
}
