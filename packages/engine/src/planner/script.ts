// Stage script: episode → narration lines fitted to a word budget for 30–60 s.
import { EpisodeScript } from "@moco/spec";
import { wordsPerMinute, type EngineConfig } from "../config.ts";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkIds, planWithAi } from "./common.ts";

// Allowed drift from the word budget before the AI is asked to fix it. The real check is the VO duration.
const BUDGET_TOLERANCE = 0.2;

export async function runScript(ctx: StageContext, episodeId: string, feedback?: string): Promise<string> {
  const plan = await ctx.store.read(files.seriesPlan, "SeriesPlan");
  const bible = await ctx.store.read(files.bible, "SeriesBible");
  const memory = ctx.store.has(files.memory) ? (await ctx.store.read(files.memory, "SeriesMemory")).data : undefined;
  const episode = plan.data.episodes.find((candidate) => candidate.id === episodeId);

  const targetSeconds = Math.round((ctx.config.targetSeconds.min + ctx.config.targetSeconds.max) / 2);
  const budget = wordBudget(ctx.config, plan.data.language, targetSeconds);

  const script = await planWithAi(ctx, {
    scope: episodeId,
    promptName: "script",
    schema: EpisodeScript,
    prompt: joinSections([
      jsonSection("Episode", { ...episode, language: plan.data.language, targetSeconds, wordBudget: budget }),
      jsonSection("Series", { title: plan.data.title, premise: plan.data.premise }),
      jsonSection("Cast", bible.data.cast),
      jsonSection("Story so far", memory?.storySoFar ?? "This is the first episode."),
      feedbackSection(feedback),
    ]),
    check: (data) => checkScript(data, ctx.config, budget),
  });

  const inputs = [ctx.store.inputRef(files.seriesPlan), ctx.store.inputRef(files.bible), promptRef("script")];
  const saved = await ctx.store.save(files.script(episodeId), "EpisodeScript", script, { producedBy: "ai", backend: ctx.ai.backendId, inputs });
  return saved.meta.contentHash;
}

export function wordBudget(config: EngineConfig, language: string, seconds: number): number {
  return Math.round((seconds * wordsPerMinute(config, language)) / 60);
}

export function countWords(script: EpisodeScript): number {
  return script.lines.map((line) => line.text.split(/\s+/).filter(Boolean).length).reduce((a, b) => a + b, 0);
}

export function checkScript(script: EpisodeScript, config: EngineConfig, budget: number): Issue[] {
  const issues = checkIds(script.lines.map((line) => line.id), "lines", /^l\d{2,3}$/, "l01");
  const { min, max } = config.targetSeconds;
  if (script.targetSeconds < min || script.targetSeconds > max) {
    issues.push({ path: "targetSeconds", problem: `must be between ${min} and ${max}` });
  }
  const words = countWords(script);
  if (Math.abs(words - budget) > budget * BUDGET_TOLERANCE) {
    const verb = words > budget ? "cut" : "add";
    issues.push({ path: "lines", problem: `has ${words} words, the budget is ${budget}`, fix: `${verb} about ${Math.abs(words - budget)} words.` });
  }
  return issues;
}
