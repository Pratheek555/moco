// Stage bible: first the show bible (the series' own rules), then the cast and style. The cast comes from the kit, or
// from a world built for this story to the show bible's cast sheets. The narrator voice is set by the engine, not the AI.
import * as z from "zod";
import { CastMember, SeriesBible } from "@moco/spec";
import type { Catalog } from "@moco/kit";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkIds, planWithAi, previousSection } from "./common.ts";
import { biblePack, runShow } from "./show.ts";
import { runWorld } from "./world.ts";
import { lookupTemplate } from "../templates/registry.ts";

// What the AI writes: the bible without the narrator. An empty cast is how it says the kit can't play this story.
const BibleDraft = SeriesBible.omit({ narrator: true }).extend({ cast: z.array(CastMember) });
type BibleDraft = ReturnType<typeof BibleDraft.parse>;

export async function runBible(ctx: StageContext, feedback?: string): Promise<string> {
  const plan = await ctx.store.read(files.seriesPlan, "SeriesPlan");
  const kitCharacters = ctx.catalog.characters.map((character) => ({ id: character.id, variants: character.variants, packs: character.packs }));
  // Sent back with a note, the show bible is written again too: the note may be about the tone or the cast.
  const show = await runShow(ctx, plan.data, feedback);
  const forcedWorld = lookupTemplate(ctx.series.template)?.world === "world";

  const draft = await planWithAi(ctx, {
    scope: "series",
    promptName: "bible",
    schema: BibleDraft,
    prompt: joinSections([
      jsonSection("Series plan", plan.data),
      jsonSection("Show bible — the cast and look you are casting for", biblePack(show)),
      jsonSection("Kit characters", kitCharacters),
      jsonSection("Kit grades", ctx.catalog.grades),
      jsonSection("Times of day", sharedTimes(ctx.catalog)),
      await previousSection(ctx, files.bible, "SeriesBible", feedback),
      feedbackSection(feedback),
    ]),
    // A template that always builds its own world ignores the kit cast, so only then is it free of the show's cast.
    check: (data) => checkBible(data, ctx.catalog, forcedWorld ? undefined : show.cast.map((member) => member.id)),
  });

  // No kit entry fits, so build the story's own cast and places. Sent back with a note, it builds them again.
  // A template can always want its own world, whatever cast the AI picked from the kit.
  const wantsWorld = draft.cast.length === 0 || forcedWorld;
  const world = wantsWorld ? await runWorld(ctx, plan.data, feedback, show) : undefined;
  if (world) ctx.useWorld(world);
  const cast = world ? world.cast.map(({ id, model, description }) => ({ id, kitCharacterId: model, description })) : draft.cast;

  // A location's sky is its time of day, so the bible doesn't set one for a world.
  const style = world ? { ...draft.style, timeOfDay: undefined } : draft.style;
  const bible: SeriesBible = { ...draft, cast, style, narrator: { ...ctx.config.voice, language: plan.data.language } };
  const saved = await ctx.store.save(files.bible, "SeriesBible", bible, {
    producedBy: "ai",
    backend: ctx.ai.backendId,
    inputs: [ctx.store.inputRef(files.seriesPlan), ctx.store.inputRef(files.show), promptRef("bible", ctx.series.template)],
  });
  return saved.meta.contentHash;
}

// `castIds`: the show bible's cast. A kit cast plays exactly those characters, under the same ids.
export function checkBible(bible: BibleDraft, catalog: Catalog, castIds?: string[]): Issue[] {
  const kitIds = catalog.characters.map((character) => character.id);
  const strangers = castIds ? bible.cast.filter((member) => !castIds.includes(member.id)) : [];
  const missing = castIds && bible.cast.length > 0 ? castIds.filter((id) => !bible.cast.some((member) => member.id === id)) : [];
  const showIssues = [
    ...strangers.map((member) => ({ path: "cast", problem: `"${member.id}" is not in the show bible's cast`, allowed: castIds, fix: "Use the show bible's cast ids." })),
    ...(missing.length > 0 ? [{ path: "cast", problem: `the kit can't play ${missing.join(", ")}`, fix: "Return an empty cast so the whole cast gets built for this story." }] : []),
  ];
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
  const times = sharedTimes(catalog);
  const timeIssues = bible.style.timeOfDay === undefined || times.includes(bible.style.timeOfDay)
    ? []
    : [{ path: "style.timeOfDay", problem: `"${bible.style.timeOfDay}" isn't available everywhere`, allowed: times, fix: "Pick one." }];
  return [...checkIds(bible.cast.map((member) => member.id), "cast", /^[a-z0-9][a-z0-9-]*$/, "krishna"), ...showIssues, ...castIssues, ...gradeIssues, ...timeIssues];
}

// Times of day every background can show: the one the bible picks is used in every shot, wherever it's set.
function sharedTimes(catalog: Catalog): string[] {
  const [first, ...rest] = catalog.backgrounds.map((background) => background.timeOfDay);
  return (first ?? []).filter((time) => rest.every((times) => times.includes(time)));
}
