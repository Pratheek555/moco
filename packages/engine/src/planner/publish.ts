// Stage publish: the YouTube title, description, hashtags and tags for a finished episode,
// combined with the series' publish defaults into the kit the user pastes into YouTube Studio.
import { AiPublishCopy, checkYoutube, PublishDefaults, type PublishKit } from "@moco/spec";
import { EngineError } from "../errors.ts";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { planWithAi } from "./common.ts";

export async function runPublish(ctx: StageContext, episodeId: string, feedback?: string): Promise<string> {
  const plan = (await ctx.store.read(files.seriesPlan, "SeriesPlan")).data;
  const bible = (await ctx.store.read(files.bible, "SeriesBible")).data;
  const script = (await ctx.store.read(files.script(episodeId), "EpisodeScript")).data;
  const defaults = await readPublishDefaults(ctx);
  const index = plan.episodes.findIndex((candidate) => candidate.id === episodeId);
  const episode = plan.episodes[index];

  let copy: AiPublishCopy;
  try {
    copy = await planWithAi(ctx, {
      scope: episodeId,
      promptName: "publish",
      schema: AiPublishCopy,
      prompt: joinSections([
        jsonSection("Series", { title: plan.title, premise: plan.premise, language: plan.language, secondLanguage: defaults.secondLanguage ?? null }),
        jsonSection("Episode", { number: index + 1, of: plan.episodes.length, title: episode?.title, synopsis: episode?.synopsis, nextEpisode: plan.episodes[index + 1]?.title ?? null }),
        jsonSection("Narration", script.lines.map((line) => line.text)),
        jsonSection("Cast", bible.cast.map((member) => ({ id: member.id, description: member.description }))),
        jsonSection("Series defaults (added for you)", { hashtags: defaults.hashtags, footerLength: defaults.footer.length }),
        feedbackSection(feedback),
      ]),
      check: (data) => checkCopy(data, defaults),
    });
  } catch (err) {
    // The video is done; a failed write-up must not block the series. Plain details the user can edit instead.
    if (!(err instanceof EngineError) || err.code !== "validation_failed") throw err;
    ctx.ledger.decide("fallback", `${episodeId}/publish`, "The AI's YouTube details broke YouTube's limits; wrote plain ones from the plan instead.");
    copy = fallbackCopy(plan.title, index + 1, episode?.title ?? episodeId, episode?.synopsis ?? plan.premise);
  }

  const kit = composeKit(copy, defaults, plan.language);
  const inputs = [ctx.store.inputRef(files.seriesPlan), ctx.store.inputRef(files.script(episodeId)), promptRef("publish")];
  if (ctx.store.has(files.publishDefaults)) inputs.push(ctx.store.inputRef(files.publishDefaults));
  const saved = await ctx.store.save(files.publish(episodeId), "PublishKit", kit, { producedBy: "ai", backend: ctx.ai.backendId, inputs });
  return saved.meta.contentHash;
}

export async function readPublishDefaults(ctx: Pick<StageContext, "store">): Promise<PublishDefaults> {
  return ctx.store.has(files.publishDefaults) ? (await ctx.store.read(files.publishDefaults, "PublishDefaults")).data : PublishDefaults.parse({});
}

// The AI's copy plus the defaults, as it will be pasted: description, a hashtag line, then the footer.
export function composeKit(copy: AiPublishCopy, defaults: PublishDefaults, language: string): PublishKit {
  const hashtags = unique([...defaults.hashtags, ...copy.youtube.hashtags].map(normaliseHashtag).filter(Boolean));
  const description = [copy.youtube.description.trim(), hashtags.join(" "), defaults.footer.trim()].filter(Boolean).join("\n\n");
  return {
    youtube: {
      title: copy.youtube.title.trim(),
      description,
      tags: unique(copy.youtube.tags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean)),
      category: defaults.category,
      madeForKids: defaults.madeForKids,
      language,
    },
  };
}

export function checkCopy(copy: AiPublishCopy, defaults: PublishDefaults): Issue[] {
  const issues: Issue[] = copy.youtube.hashtags
    .map((tag, index) => ({ tag, index }))
    .filter(({ tag }) => !/^#?[\p{L}\p{N}\p{M}_]+$/u.test(tag.trim()))
    .map(({ tag, index }) => ({ path: `youtube.hashtags[${index}]`, problem: `"${tag}" is not a hashtag`, fix: "One word after #, no spaces or punctuation." }));
  // Checked on the composed kit, so the footer and default hashtags count towards the limits.
  const composed = composeKit(copy, defaults, "und").youtube;
  for (const { field, problem } of checkYoutube(composed)) issues.push({ path: `youtube.${field}`, problem, fix: "Shorten it." });
  return issues;
}

function fallbackCopy(series: string, number: number, title: string, synopsis: string): AiPublishCopy {
  return {
    youtube: {
      title: `${title} | ${series} Ep ${number}`.slice(0, 100),
      description: synopsis,
      hashtags: ["#shorts"],
      tags: [series, title],
    },
  };
}

function normaliseHashtag(tag: string): string {
  const word = tag.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return word ? `#${word}` : "";
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
