// Stage bible: cast (kit characters only), style. The narrator voice is set by the engine, not the AI.
import { SeriesBible } from "@moco/spec";
import type { Catalog } from "@moco/kit";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkIds, planWithAi } from "./common.ts";

// What the AI writes: the bible without the narrator.
const BibleDraft = SeriesBible.omit({ narrator: true });
type BibleDraft = ReturnType<typeof BibleDraft.parse>;

export async function runBible(ctx: StageContext, feedback?: string): Promise<string> {
  const plan = await ctx.store.read(files.seriesPlan, "SeriesPlan");
  const kitCharacters = ctx.catalog.characters.map((character) => ({ id: character.id, variants: character.variants, packs: character.packs }));

  const draft = await planWithAi(ctx, {
    scope: "series",
    promptName: "bible",
    schema: BibleDraft,
    prompt: joinSections([
      jsonSection("Series plan", plan.data),
      jsonSection("Kit characters", kitCharacters),
      jsonSection("Kit grades", ctx.catalog.grades),
      feedbackSection(feedback),
    ]),
    check: (data) => checkBible(data, ctx.catalog),
  });

  const bible: SeriesBible = { ...draft, narrator: { ...ctx.config.voice, language: plan.data.language } };
  const saved = await ctx.store.save(files.bible, "SeriesBible", bible, {
    producedBy: "ai",
    backend: ctx.ai.backendId,
    inputs: [ctx.store.inputRef(files.seriesPlan), promptRef("bible")],
  });
  return saved.meta.contentHash;
}

export function checkBible(bible: BibleDraft, catalog: Catalog): Issue[] {
  const kitIds = catalog.characters.map((character) => character.id);
  const castIssues = bible.cast.flatMap((member, index) => {
    const character = catalog.characters.find((candidate) => candidate.id === member.kitCharacterId);
    if (!character) {
      return [{ path: `cast[${index}].kitCharacterId`, problem: `"${member.kitCharacterId}" is not in the kit`, allowed: kitIds, fix: "Pick a kit character or leave this cast member out." }];
    }
    if (member.variant && !character.variants.includes(member.variant)) {
      return [{ path: `cast[${index}].variant`, problem: `"${member.variant}" is not a variant of ${character.id}`, allowed: character.variants, fix: "Pick one or leave it out." }];
    }
    return [];
  });
  const gradeIssues = catalog.grades.includes(bible.style.grade)
    ? []
    : [{ path: "style.grade", problem: `"${bible.style.grade}" is not a kit grade`, allowed: catalog.grades, fix: "Pick one." }];
  return [...checkIds(bible.cast.map((member) => member.id), "cast", /^[a-z0-9][a-z0-9-]*$/, "krishna"), ...castIssues, ...gradeIssues];
}
