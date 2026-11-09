// Shared helper for plan-level AI stages: run the fix loop, or fail the stage with the remaining issues.
import { toAiJsonSchema, type ArtifactKind } from "@moco/spec";
import type * as z from "zod";
import { EngineError } from "../errors.ts";
import { imageGenerationCapability } from "../artist/permissions.ts";
import { jsonSection, loadPrompt, type PromptName } from "../generator/prompts.ts";
import { formatIssues, type Issue } from "../loop/feedback.ts";
import { generateValidated } from "../loop/loop.ts";
import type { StageContext } from "../pipeline/context.ts";
import { templateImages } from "../templates/registry.ts";

export interface PlanCall<T> {
  scope: string; // episode id or "series"
  promptName: PromptName;
  schema: z.ZodType<T>;
  prompt: string;
  check: (data: T) => Issue[];
  timeoutMs?: number; // default: the engine's usual limit per call
}

export async function planWithAi<T>(ctx: StageContext, call: PlanCall<T>): Promise<T> {
  // The live UI follows stage keys, not prompt names. A bare "script" or
  // "show" hides real commentary while ep-01/script or bible is running.
  const stage = ({ series: "series_plan", series_extend: "series_plan", show: "bible", world: "bible", canon: "script", world_extend: "script", shots: "shot_list", memory: "memory_update", retro: "memory_update" } as Partial<Record<PromptName, string>>)[call.promptName] ?? call.promptName;
  const key = call.scope === "series" ? stage : `${call.scope}/${stage}`;
  await ctx.bus.emit(ctx.seriesId, "ai.activity", { key, phase: "started", message: key === "series_plan" ? `Developing your premise and outlining ${ctx.series.episodes} ${ctx.series.episodes === 1 ? "episode" : "episodes"}.` : `Developing the ${call.promptName.replaceAll("_", " ")}.` });
  let updates = Promise.resolve();
  try {
    const result = await generateValidated({
      ai: ctx.ai,
      scope: call.scope,
      schema: call.schema,
      images: ctx.ai.seesImages ? templateImages(ctx.series.template) : undefined,
      jsonSchema: toAiJsonSchema(call.schema),
      system: `${loadPrompt(call.promptName, ctx.series.template)}\n\nExplicit production settings and the full creative brief override generic vertical/3D/preset advice. Artist mode builds custom 2D artwork and animation with provided raster assets and requested GPT Image 2 assets when enabled; it does not build a 3D world. Current image capability: ${JSON.stringify(imageGenerationCapability(ctx.series, ctx.ai))}. Do not promise unavailable tools or override a requested image model.${ctx.series.production ? " Duration is user-controlled: when production.targetSeconds is supplied, it is the user's explicit duration override and takes precedence over length references in the brief. Otherwise honor the brief's requested duration; if absent propose a suitable duration for user approval. Do not invent a 30-second default or treat a duration override/conflicting length reference as an unsupported artwork capability." : ""}`,
      prompt: [jsonSection("Full original creative brief", ctx.series.idea), jsonSection("Production settings", ctx.series.production ?? { mode: "kit-or-world", format: { width: 1080, height: 1920, fps: 30 } }), ctx.series.production?.localOnly ? "USER-SELECTED LOCAL MODE: local voice, procedural canvas artwork and installed fonts. Generated raster art, remote image/voice services, stock soundtrack, external downloads and automatic publishing are explicitly excluded. Record these substitutions as partial requirements with reasons; do not retain the excluded services as unavailable mandatory requirements. Retain all achievable visual, pacing and story rules. Truly unsupported visual requirements remain unavailable; never claim equivalent output or paid capabilities." : "", call.prompt].join("\n\n"),
      maxAttempts: ctx.config.limits.maxAttemptsPerPlanStage,
      check: call.check,
      signal: ctx.signal,
      timeoutMs: call.timeoutMs,
      onActivity: (message) => {
        updates = updates.then(() => ctx.bus.emit(ctx.seriesId, "ai.activity", { key, phase: "working", message })).catch(() => {});
      },
      onAttempt: async ({ attempt, issues }) => {
        await updates;
        await ctx.bus.emit(ctx.seriesId, "ai.activity", { key, phase: issues.length ? "retrying" : "checked", message: issues.length ? `Checking draft ${attempt}: ${issues.length} ${issues.length === 1 ? "detail needs" : "details need"} another pass.` : "The draft passed its story and format checks. Preparing it for your review." });
      },
    });
    if (!result.ok) {
      throw new EngineError("validation_failed", `The AI couldn't produce a valid ${call.promptName} after ${result.attempts} attempts:\n${formatIssues(result.issues)}`);
    }
    return result.data;
  } finally {
    await updates;
  }
}

// A redo changes the last version, so the AI has to see it: a note alone can't say "line 3" or "cut 6 words".
export async function previousSection(ctx: StageContext, file: string, kind: ArtifactKind, feedback: string | undefined): Promise<string> {
  if (!feedback || !ctx.store.has(file)) return "";
  return jsonSection("Your previous version — keep what the change below doesn't touch", (await ctx.store.read(file, kind)).data);
}

// Ids that become folder names or keys must be unique slugs.
export function checkIds(ids: string[], path: string, pattern: RegExp, example: string): Issue[] {
  const seen = new Set<string>();
  return ids.flatMap((id, index) => {
    const duplicate = seen.has(id);
    seen.add(id);
    if (!pattern.test(id)) return [{ path: `${path}[${index}].id`, problem: `"${id}" is not a valid id`, fix: `Use the form "${example}".` }];
    if (duplicate) return [{ path: `${path}[${index}].id`, problem: `"${id}" is used twice`, fix: "Make ids unique." }];
    return [];
  });
}
