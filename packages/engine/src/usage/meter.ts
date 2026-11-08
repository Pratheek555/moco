// Every AI call goes through here: concurrency limit, episode/task call caps, usage counting,
// and rate-limit detection that shows "plan limit reached" instead of a generic failure.
import { RateLimitError, type AiBackend, type AiRequest, type AiResult } from "@moco/ai";
import type { EngineConfig } from "../config.ts";
import { EngineError } from "../errors.ts";
import type { EventBus } from "../events/bus.ts";
import type { Semaphore } from "../jobs/semaphore.ts";
import type { Ledger } from "../store/ledger.ts";

export interface MeteredAi {
  backendId: string;
  seesImages: boolean; // the backend can be shown renders (see review/look.ts)
  supportsArtist?: boolean;
  supportsImageGeneration?: boolean;
  // Engine-owned task identity, stable across attempts/repairs in this job.
  // Nested image calls share the scene's allowance; usage still belongs to the episode.
  forTask?(task: string): MeteredAi;
  // `scope` is the episode id, or "series" for series-level stages.
  generate(request: Omit<AiRequest, "timeoutMs"> & { timeoutMs?: number }, scope: string): Promise<AiResult>;
}

export function meteredAi(
  ai: AiBackend,
  aiSlots: Semaphore,
  ledger: Ledger,
  bus: EventBus,
  seriesId: string,
  config: EngineConfig,
): MeteredAi {
  // Planning retains the per-episode job cap. Artist production is bounded by
  // scene and review batch, so a longer approved shot list isn't a runaway loop.
  // All views share counters: reopening a task never resets its allowance.
  const callsThisJob = new Map<string, number>();

  const view = (task?: string): MeteredAi => ({
    backendId: ai.id,
    seesImages: ai.seesImages === true,
    supportsArtist: ai.supportsArtist === true,
    supportsImageGeneration: ai.supportsImageGeneration === true,
    forTask: (task) => view(task),
    async generate(request, scope) {
      request.signal?.throwIfAborted();
      const budgetKey = JSON.stringify([scope, task ?? null]);
      const calls = callsThisJob.get(budgetKey) ?? 0;
      if (calls >= config.limits.maxAiCallsPerEpisode) {
        throw new EngineError("cap_reached", `This run reached its ${config.limits.maxAiCallsPerEpisode}-call AI safety limit for ${scope}${task ? ` (${task})` : ""}. Saved work is kept. Try again to continue with a fresh run allowance. This is Moco's run limit, not your AI provider's quota.`);
      }
      callsThisJob.set(budgetKey, calls + 1);
      ledger.data.usage.aiCalls[scope] = (ledger.data.usage.aiCalls[scope] ?? 0) + 1;
      const day = ledger.today();
      day.calls += 1;

      try {
        const invoke = async () => {
          request.signal?.throwIfAborted(); // calls still queued when a job is stopped must not start
          return ai.generate({ ...request, timeoutMs: request.timeoutMs ?? config.limits.aiTimeoutMs });
        };
        // Image tools run inside an artist call that already holds an AI slot.
        // Waiting for another slot here can deadlock two concurrent authors.
        // The artist workspace serializes its image calls; usage/call caps still apply.
        const result = request.imageGeneration ? await invoke() : await aiSlots.run(invoke);
        const { inputTokens = 0, outputTokens = 0, costUsdEstimate = 0 } = result.usage ?? {};
        const tokens = (ledger.data.usage.tokens ??= { input: 0, output: 0 });
        tokens.input += inputTokens;
        tokens.output += outputTokens;
        ledger.data.usage.costUsdEstimate += costUsdEstimate;
        day.inputTokens += inputTokens;
        day.outputTokens += outputTokens;
        day.costUsdEstimate += costUsdEstimate;
        return result;
      } catch (err) {
        if (err instanceof RateLimitError) {
          day.rateLimits += 1;
          await bus.emit(seriesId, "usage.rate_limited", { message: err.message });
          throw new EngineError("rate_limited", "Your AI plan limit was reached. Resume later.");
        }
        throw err;
      } finally {
        await ledger.save();
        await bus.emit(seriesId, "usage.updated", { scope, aiCalls: ledger.data.usage.aiCalls[scope], ...(task && { task, taskCalls: callsThisJob.get(budgetKey) }) });
      }
    },
  });
  return view();
}
