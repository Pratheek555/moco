// The generate → validate → fix loop (harness 4), shared by every AI-produced artifact.
//   L0 the backend returned JSON
//   L1 it passes the zod schema
//   L2 it passes semantic checks (kit catalog, bible, timings) — supplied by the caller
//   L3 optional runtime check (render stills) — supplied by the caller, only after L1+L2 pass
// Failed attempts are retried with the previous output and a compact issue list, up to a cap.
import { SchemaRefusal } from "@moco/ai";
import type * as z from "zod";
import { formatIssues, jsonPath, type Issue } from "./feedback.ts";
import type { MeteredAi } from "../usage/meter.ts";

export interface LoopOptions<T> {
  ai: MeteredAi;
  scope: string; // usage scope: episode id or "series"
  schema: z.ZodType<T>; // full schema the engine validates against
  jsonSchema: object; // AI-facing JSON Schema for structured output
  system: string;
  prompt: string; // the first prompt; retries append the previous attempt and its issues
  maxAttempts: number;
  check: (data: T) => Issue[] | Promise<Issue[]>; // L2 (+ L3)
  signal?: AbortSignal;
  onAttempt?: (attempt: AttemptRecord) => Promise<void>; // store attempts, emit events
}

export interface AttemptRecord {
  attempt: number;
  raw: unknown;
  issues: Issue[];
}

export type LoopResult<T> =
  | { ok: true; data: T; attempts: number }
  | { ok: false; issues: Issue[]; attempts: number };

export async function generateValidated<T>(options: LoopOptions<T>): Promise<LoopResult<T>> {
  let prompt = options.prompt;
  let issues: Issue[] = [];

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const { raw, issues: found, data } = await runAttempt(options, prompt);
    issues = found;
    await options.onAttempt?.({ attempt, raw, issues });
    if (issues.length === 0) return { ok: true, data: data as T, attempts: attempt };
    prompt = retryPrompt(options.prompt, raw, issues);
  }
  return { ok: false, issues, attempts: options.maxAttempts };
}

// One AI call plus all validation levels. Rate limits, auth and cap errors propagate (they aren't the model's fault).
async function runAttempt<T>(options: LoopOptions<T>, prompt: string): Promise<{ raw: unknown; issues: Issue[]; data?: T }> {
  let raw: unknown;
  try {
    const result = await options.ai.generate(
      { system: options.system, prompt, jsonSchema: options.jsonSchema, signal: options.signal },
      options.scope,
    );
    raw = result.json ?? tryParseJson(result.text);
  } catch (err) {
    if (err instanceof SchemaRefusal) return { raw: null, issues: [{ path: "", problem: "no JSON was returned", fix: "Return only the JSON object." }] };
    throw err;
  }

  // L0
  if (raw === undefined) return { raw, issues: [{ path: "", problem: "output is not valid JSON", fix: "Return only the JSON object." }] };

  // L1
  const parsed = options.schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({ path: jsonPath(issue.path), problem: issue.message }));
    return { raw, issues };
  }

  // L2 (+ L3)
  const issues = await options.check(parsed.data);
  return { raw, issues, data: parsed.data };
}

function retryPrompt(original: string, previous: unknown, issues: Issue[]): string {
  return [
    original,
    "",
    "## Your previous attempt",
    "```json",
    JSON.stringify(previous, null, 2),
    "```",
    "",
    "## It was rejected for these reasons — fix every one and return the full corrected JSON",
    formatIssues(issues),
  ].join("\n");
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
