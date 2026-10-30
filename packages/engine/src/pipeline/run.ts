// Runs stages: marks status, emits events, binds gates to the output hash, propagates staleness.
// One call runs stages back to back until one waits for approval, fails, or nothing is left.
import { EngineError } from "../errors.ts";
import { runSample, runScenes } from "../generator/generate.ts";
import { runMemoryUpdate } from "../memory/continuity.ts";
import { runBible } from "../planner/bible.ts";
import { runScript } from "../planner/script.ts";
import { runSeriesPlan } from "../planner/series.ts";
import { runShotList } from "../planner/shots.ts";
import { runVoiceover } from "../planner/voiceover.ts";
import type { StageContext } from "./context.ts";
import { canRun, markDependantsStale, nextStage } from "./machine.ts";
import { runRender } from "./render.ts";
import { GATED, parseStageKey } from "./stages.ts";

// A stage either produced output (with its hash) or sent its input back to be redone.
type StageOutput = { kind: "done"; hash: string } | { kind: "sent_back" };

// Run `firstKey` (or the next runnable stage), then keep going. Returns the stage keys that ran.
export async function runStages(ctx: StageContext, firstKey?: string): Promise<string[]> {
  const ran: string[] = [];
  let key: string | undefined = firstKey ?? runnableNext(ctx);

  while (key) {
    if (ctx.signal.aborted) throw new EngineError("cancelled", "cancelled");
    const { status } = await runOne(ctx, key);
    ran.push(key);
    if (status !== "done") break; // waiting for the user (gate) or failed
    key = runnableNext(ctx);
  }
  return ran;
}

function runnableNext(ctx: StageContext): string | undefined {
  const next = nextStage(ctx.ledger, ctx.episodeIds());
  return next.kind === "run" ? next.key : undefined;
}

async function runOne(ctx: StageContext, key: string): Promise<{ status: "done" | "awaiting_approval" }> {
  if (!canRun(ctx.ledger, key, ctx.episodeIds())) {
    throw new EngineError("stage_blocked", `${key} can't run until the stages before it are complete`);
  }
  const previousHash = ctx.ledger.stage(key).artifactHash;
  const feedback = ctx.ledger.stage(key).feedback;
  ctx.ledger.setStage(key, { status: "running", error: undefined });
  await ctx.ledger.save();
  await ctx.bus.emit(ctx.seriesId, "stage.started", { key });

  try {
    const output = await execute(ctx, key, feedback);

    // Send-back: this stage goes back to pending; the stage it sent back to runs next.
    if (output.kind === "sent_back") {
      ctx.ledger.setStage(key, { status: "pending" });
      await ctx.ledger.save();
      return { status: "done" };
    }

    const gated = GATED.has(parseStageKey(key).stage);
    const status = gated ? "awaiting_approval" : "done";
    ctx.ledger.setStage(key, { status, artifactHash: output.hash, feedback: undefined });

    // New output → everything built from the old output is stale.
    if (previousHash && previousHash !== output.hash) {
      const stale = markDependantsStale(ctx.ledger, key, ctx.episodeIds());
      if (stale.length > 0) await ctx.bus.emit(ctx.seriesId, "artifact.stale", { because: key, stages: stale });
    }
    await ctx.ledger.save();
    await ctx.bus.emit(ctx.seriesId, gated ? "stage.awaiting_approval" : "stage.done", { key, contentHash: output.hash });
    return { status };
  } catch (err) {
    const error = err instanceof EngineError ? { code: err.code, message: err.message } : { code: "internal", message: err instanceof Error ? err.message : String(err) };
    // A cancelled stage can simply run again; anything else is shown as failed.
    ctx.ledger.setStage(key, { status: error.code === "cancelled" ? "pending" : "failed", error });
    await ctx.ledger.save();
    await ctx.bus.emit(ctx.seriesId, "stage.failed", { key, error });
    throw err;
  }
}

async function execute(ctx: StageContext, key: string, feedback: string | undefined): Promise<StageOutput> {
  const { stage, episodeId = "" } = parseStageKey(key);
  const done = (hash: string): StageOutput => ({ kind: "done", hash });
  switch (stage) {
    case "series_plan":
      return done(await runSeriesPlan(ctx, feedback));
    case "bible":
      return done(await runBible(ctx, feedback));
    case "script":
      return done(await runScript(ctx, episodeId, feedback));
    case "voiceover":
      return runVoiceover(ctx, episodeId);
    case "shot_list":
      return done(await runShotList(ctx, episodeId, feedback));
    case "sample":
      return done(await runSample(ctx, episodeId, feedback));
    case "scenes":
      return done(await runScenes(ctx, episodeId));
    case "preview":
      return done(await runRender(ctx, episodeId, "preview"));
    case "final":
      return done(await runRender(ctx, episodeId, "final"));
    case "memory_update":
      return done(await runMemoryUpdate(ctx, episodeId));
  }
}
