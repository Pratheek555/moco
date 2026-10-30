// Shared helper for plan-level AI stages: run the fix loop, or fail the stage with the remaining issues.
import { toAiJsonSchema } from "@moco/spec";
import type * as z from "zod";
import { EngineError } from "../errors.ts";
import { loadPrompt, type PromptName } from "../generator/prompts.ts";
import { formatIssues, type Issue } from "../loop/feedback.ts";
import { generateValidated } from "../loop/loop.ts";
import type { StageContext } from "../pipeline/context.ts";

export interface PlanCall<T> {
  scope: string; // episode id or "series"
  promptName: PromptName;
  schema: z.ZodType<T>;
  prompt: string;
  check: (data: T) => Issue[];
}

export async function planWithAi<T>(ctx: StageContext, call: PlanCall<T>): Promise<T> {
  const result = await generateValidated({
    ai: ctx.ai,
    scope: call.scope,
    schema: call.schema,
    jsonSchema: toAiJsonSchema(call.schema),
    system: loadPrompt(call.promptName),
    prompt: call.prompt,
    maxAttempts: ctx.config.limits.maxAttemptsPerPlanStage,
    check: call.check,
    signal: ctx.signal,
  });
  if (!result.ok) {
    throw new EngineError("validation_failed", `The AI couldn't produce a valid ${call.promptName} after ${result.attempts} attempts:\n${formatIssues(result.issues)}`);
  }
  return result.data;
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
