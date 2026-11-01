// Every AI call goes through here: concurrency limit, per-episode call cap, usage counting,
// and rate-limit detection that shows "plan limit reached" instead of a generic failure.
import { RateLimitError, type AiBackend, type AiRequest, type AiResult } from "@moco/ai";
import type { EngineConfig } from "../config.ts";
import { EngineError } from "../errors.ts";
import type { EventBus } from "../events/bus.ts";
import type { Semaphore } from "../jobs/semaphore.ts";
import type { Ledger } from "../store/ledger.ts";

export interface MeteredAi {
  backendId: string;
  // `scope` is the episode id, or "series" for series-level stages.
  generate(request: Omit<AiRequest, "timeoutMs">, scope: string): Promise<AiResult>;
}

export function meteredAi(
  ai: AiBackend,
  aiSlots: Semaphore,
  ledger: Ledger,
  bus: EventBus,
  seriesId: string,
  config: EngineConfig,
): MeteredAi {
  // One meter is made per job, so the cap stops a runaway job and can't lock a series after a few redos.
  // The ledger keeps the lifetime count.
  const callsThisJob: Record<string, number> = {};

  return {
    backendId: ai.id,
    async generate(request, scope) {
      const calls = callsThisJob[scope] ?? 0;
      if (calls >= config.limits.maxAiCallsPerEpisode) {
        throw new EngineError("cap_reached", `${scope} used all ${config.limits.maxAiCallsPerEpisode} AI calls allowed in one run`);
      }
      callsThisJob[scope] = calls + 1;
      ledger.data.usage.aiCalls[scope] = (ledger.data.usage.aiCalls[scope] ?? 0) + 1;

      try {
        const result = await aiSlots.run(async () => {
          request.signal?.throwIfAborted(); // calls still queued when a job is stopped must not start
          return ai.generate({ ...request, timeoutMs: config.limits.aiTimeoutMs });
        });
        ledger.data.usage.costUsdEstimate += result.usage?.costUsdEstimate ?? 0;
        return result;
      } catch (err) {
        if (err instanceof RateLimitError) {
          await bus.emit(seriesId, "usage.rate_limited", { message: err.message });
          throw new EngineError("rate_limited", "Your AI plan limit was reached. Resume later.");
        }
        throw err;
      } finally {
        await ledger.save();
        await bus.emit(seriesId, "usage.updated", { scope, aiCalls: ledger.data.usage.aiCalls[scope] });
      }
    },
  };
}
