// Stage series_plan: idea → SeriesPlan (episode list).
import { SeriesPlan } from "@moco/spec";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkIds, planWithAi } from "./common.ts";

export async function runSeriesPlan(ctx: StageContext, feedback?: string): Promise<string> {
  const { idea, language, episodes } = ctx.series;
  const plan = await planWithAi(ctx, {
    scope: "series",
    promptName: "series",
    schema: SeriesPlan,
    prompt: joinSections([jsonSection("Request", { idea, language, episodes }), feedbackSection(feedback)]),
    check: (data) => checkPlan(data, language, episodes),
  });
  const saved = await ctx.store.save(files.seriesPlan, "SeriesPlan", plan, { producedBy: "ai", backend: ctx.ai.backendId, inputs: [promptRef("series")] });
  ctx.ledger.data.episodeIds = plan.episodes.map((episode) => episode.id);
  return saved.meta.contentHash;
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
