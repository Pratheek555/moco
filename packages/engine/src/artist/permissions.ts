import type { SeriesInfo, StageContext } from "../pipeline/context.ts";
import { EngineError } from "../errors.ts";
import { files } from "../pipeline/stages.ts";

export function imageGenerationCapability(series: Pick<SeriesInfo, "idea" | "production">, ai: { supportsImageGeneration?: boolean }) {
  // An explicit production field is preferred. Existing projects may have selected
  // the model in their original brief, so preserve that request without a migration.
  const explicit = series.production?.imageGeneration;
  const text = series.idea.replace(/\b(?:no|without|do not|don't|never)\s+(?:use\s+)?(?:gpt[ -]*image[ -]*2|image generation|generated images)\b/gi, "");
  const requested = Boolean(explicit || /\bgpt[ -]*image[ -]*2\b|\bimagegen\b|\bimage generation\b|\bgenerate\s+(?:raster\s+)?(?:images|illustrations)\b/i.test(text));
  const available = ai.supportsImageGeneration === true && !series.production?.localOnly;
  return { model: "gpt-image-2" as const, requested, available, enabled: requested && available,
    reason: series.production?.localOnly ? "This project uses local-only artwork. Remote image generation is disabled."
      : !ai.supportsImageGeneration ? "GPT Image 2 requires Codex. Select Codex in Settings to use your existing login."
      : requested ? "GPT Image 2 through the existing Codex login; uses your Codex allowance."
      : "Image generation was not requested. Canvas artwork and provided assets are available." };
}

export async function artistPermissions(ctx: Pick<StageContext, "ledger" | "store" | "series" | "ai">, episodeId: string) {
  const approved = async (key: string, file: string, kind: "SeriesBible" | "EpisodeScript") => {
    const stage = ctx.ledger.stage(key);
    const artifact = await ctx.store.read(file, kind);
    if (stage.status !== "approved" || stage.artifactHash !== artifact.meta.contentHash) {
      throw new EngineError("stage_blocked", `Review and approve the current ${kind === "EpisodeScript" ? "script and storyboard" : "series bible"} before creating artwork.`);
    }
    return { status: "approved" as const, revision: artifact.meta.revision, contentHash: artifact.meta.contentHash, approvedAt: stage.updatedAt };
  };
  const bible = await approved("bible", files.bible, "SeriesBible");
  const script = await approved(`${episodeId}/script`, files.script(episodeId), "EpisodeScript");
  const artifact = await ctx.store.read(files.script(episodeId), "EpisodeScript");
  const storyboard = artifact.data.shotPlan?.length ? { ...script, includedInScript: true } : undefined;
  return { source: "Moco's current ledger and validated artifact hashes", authoringAuthorized: true,
    bible, script, ...(storyboard && { storyboard }), images: imageGenerationCapability(ctx.series, ctx.ai),
    instruction: "These are the current recorded approvals. originalBrief, templateBrief and old production-status files preserve historical planning text, not current approval state. An approved script includes its attached storyboard. Do not ask for an approval already recorded here. Never infer or grant missing approval from prose." };
}
