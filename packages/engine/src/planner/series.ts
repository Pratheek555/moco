// Stage series_plan: idea → SeriesPlan (episode list). While the ledger has a plan extension, the stage instead
// keeps the episodes already planned and asks for the next ones, so a long series can grow a batch at a time.
import * as z from "zod";
import { SeriesPlan } from "@moco/spec";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkIds, planWithAi, previousSection } from "./common.ts";

// The most episodes a series can have: ids are "ep-01" … "ep-99".
export const MAX_EPISODES = 99;

// What the AI writes when extending: only the new episodes.
const PlanExtension = SeriesPlan.pick({ episodes: true });
type PlanExtension = z.infer<typeof PlanExtension>;

export async function runSeriesPlan(ctx: StageContext, feedback?: string): Promise<string> {
  const plan = ctx.ledger.data.planExtension ? await extendPlan(ctx, ctx.ledger.data.planExtension, feedback) : await newPlan(ctx, feedback);
  const saved = await ctx.store.save(files.seriesPlan, "SeriesPlan", plan, { producedBy: "ai", backend: ctx.ai.backendId, inputs: [promptRef(ctx.ledger.data.planExtension ? "series_extend" : "series")] });
  ctx.ledger.data.episodeIds = plan.episodes.map((episode) => episode.id);
  return saved.meta.contentHash;
}

async function newPlan(ctx: StageContext, feedback: string | undefined): Promise<SeriesPlan> {
  const { idea, language, episodes } = ctx.series;
  return planWithAi(ctx, {
    scope: "series",
    promptName: "series",
    schema: SeriesPlan,
    prompt: joinSections([
      jsonSection("Request", { idea, language, episodes }),
      await previousSection(ctx, files.seriesPlan, "SeriesPlan", feedback),
      feedbackSection(feedback),
    ]),
    check: (data) => checkPlan(data, language, episodes),
  });
}

// The first `keep` episodes are fixed (scripts may already be built on them); the AI writes the rest.
async function extendPlan(ctx: StageContext, extension: { keep: number; note?: string }, feedback: string | undefined): Promise<SeriesPlan> {
  const current = (await ctx.store.read(files.seriesPlan, "SeriesPlan")).data;
  const kept = current.episodes.slice(0, extension.keep);
  const count = ctx.series.episodes - kept.length;
  const firstId = episodeId(kept.length + 1);
  const memory = ctx.store.has(files.memory) ? (await ctx.store.read(files.memory, "SeriesMemory")).data : undefined;
  const previous = current.episodes.length > kept.length ? { episodes: current.episodes.slice(kept.length) } : undefined;

  const added = await planWithAi(ctx, {
    scope: "series",
    promptName: "series_extend",
    schema: PlanExtension,
    prompt: joinSections([
      jsonSection("Series", { idea: ctx.series.idea, title: current.title, language: current.language, premise: current.premise }),
      jsonSection("Episodes so far", kept),
      memory ? jsonSection("Story so far", { storySoFar: memory.storySoFar, facts: memory.facts }) : "",
      jsonSection("Request", { episodes: count, firstId, ...(extension.note && { direction: extension.note }) }),
      feedback && previous ? jsonSection("Your previous version — keep what the change below doesn't touch", previous) : "",
      feedbackSection(feedback),
    ]),
    check: (data) => checkExtension(data, kept.length, count),
  });
  return { ...current, episodes: [...kept, ...added.episodes] };
}

export function checkPlan(plan: SeriesPlan, language: string, episodes: number): Issue[] {
  const issues = checkIds(plan.episodes.map((episode) => episode.id), "episodes", /^ep-\d{2}$/, "ep-01");
  if (plan.episodes.length !== episodes) {
    issues.push({ path: "episodes", problem: `has ${plan.episodes.length} episodes, ${episodes} were requested`, fix: `Return exactly ${episodes}.` });
  }
  if (plan.language !== language) {
    issues.push({ path: "language", problem: `must be "${language}"`, fix: `Set language to "${language}".` });
  }
  return issues;
}

// New episodes continue the numbering: after 5 kept, exactly `count` episodes "ep-06", "ep-07", …
export function checkExtension(extension: PlanExtension, kept: number, count: number): Issue[] {
  if (extension.episodes.length !== count) {
    return [{ path: "episodes", problem: `has ${extension.episodes.length} episodes, ${count} were requested`, fix: `Return exactly ${count}.` }];
  }
  return extension.episodes.flatMap((episode, index) => {
    const expected = episodeId(kept + index + 1);
    return episode.id === expected ? [] : [{ path: `episodes[${index}].id`, problem: `"${episode.id}" is out of order`, fix: `Use "${expected}".` }];
  });
}

function episodeId(n: number): string {
  return `ep-${String(n).padStart(2, "0")}`;
}
