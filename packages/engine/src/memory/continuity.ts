// Stage memory_update: after an episode's preview is approved, the AI writes what later episodes must remember.
// Facts may only be about cast members or kit locations, so memory can't drift from the bible.
import { ContinuityUpdate, SeriesMemory } from "@moco/spec";
import { hashData } from "../store/hash.ts";
import { joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { planWithAi } from "../planner/common.ts";
import { files } from "../pipeline/stages.ts";
import { readBible } from "../canon/merge.ts";
import { runRetro } from "../learn/playbook.ts";

export async function runMemoryUpdate(ctx: StageContext, episodeId: string): Promise<string> {
  const repeat = ctx.ledger.data.repeatEpisodes?.[episodeId];
  // The artifact and this checkpoint share the store's ledger save. A crash after saving memory
  // must not append the same episode's facts again or reject its own updated continuity.
  if (repeat?.memoryResultHash && ctx.store.hashOf(files.memory) === repeat.memoryResultHash && repeat.memoryScriptHash === ctx.store.hashOf(files.script(episodeId))) {
    await ctx.store.read(files.memory, "SeriesMemory");
    return repeat.memoryResultHash;
  }
  const bible = await readBible(ctx);
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

  const merged: SeriesMemory = { storySoFar: update.storySoFar, facts: [...(repeat ? memory.facts.filter(fact => fact.sinceEpisode !== episodeId) : memory.facts), ...update.newFacts] };
  if (repeat) {
    repeat.memoryResultHash = hashData(SeriesMemory.parse(merged));
    repeat.memoryScriptHash = ctx.store.hashOf(files.script(episodeId));
  }
  const saved = await ctx.store.save(files.memory, "SeriesMemory", merged, {
    producedBy: "ai",
    backend: ctx.ai.backendId,
    inputs: [ctx.store.inputRef(files.script(episodeId)), promptRef("memory")],
  });
  // The episode retro keeps the playbook. Learning is a bonus: if it fails, the episode is still done.
  await runRetro(ctx, episodeId).catch((err: unknown) => {
    if (ctx.signal.aborted) throw err;
    ctx.ledger.decide("learn", episodeId, `retro skipped: ${err instanceof Error ? err.message : String(err)}`);
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
