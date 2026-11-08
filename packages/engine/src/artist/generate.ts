import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SceneSpec } from "@moco/spec";
import { EngineError } from "../errors.ts";
import type { StageContext } from "../pipeline/context.ts";
import type { SceneInputs } from "../generator/generate.ts";
import { loadPrompt } from "../generator/prompts.ts";
import { artistWorkspace, temporalFrames, publishShotStills } from "./workspace.ts";
import { templateImages } from "../templates/registry.ts";

export async function generateArtistScene(ctx: StageContext, inputs: SceneInputs) {
  // The same task meter covers author attempts, nested image tools and later
  // independent-review repairs. Other shots cannot consume this allowance.
  ctx = { ...ctx, ai: ctx.ai.forTask?.(`scene ${inputs.shot.id}`) ?? ctx.ai };
  const production = ctx.series.production!;
  if (!ctx.ai.supportsArtist) throw new EngineError("validation_failed", "Artist tools are unavailable on this backend; the shot was not replaced with a kit fallback.");
  const workspace = await artistWorkspace(ctx, inputs, production);
  const invocationId = randomUUID();
  let feedback = inputs.feedback ?? "";
  for (let attempt = 1; attempt <= ctx.config.limits.maxAttemptsPerShot; attempt++) {
    workspace.beginAttempt();
    const prompt = `Create shot ${inputs.shot.id} by writing workspace files with the artist tools. Read shots/${inputs.shot.id}/brief.json FIRST: it contains the FULL original brief, approved cast appearance, fixed format and actual word times.\nManifest path: ${workspace.manifestPath}\nReuse shared character/design files from earlier shots. Before finishing, call render_preview, inspect the returned sequence and repair visible failures. Final response: a short account of what you created and checked; the saved files are your deliverable.\n${feedback ? `Repair feedback: ${feedback}` : ""}`;
    await workspace.audit({ phase: "author.started", attempt, invocationId });
    const activity = { key: `${inputs.episodeId}/${ctx.ledger.stage(`${inputs.episodeId}/sample`).status === "running" ? "sample" : "scenes"}`, episodeId: inputs.episodeId, shotId: inputs.shot.id };
    await ctx.bus.emit(ctx.seriesId, "ai.activity", { ...activity, phase: "started", message: `Creating ${inputs.shot.id}, attempt ${attempt}: drawing and animating the shot.` });
    let updates = Promise.resolve();
    const result = await ctx.ai.generate({ onActivity: (message) => {
      updates = updates.then(() => ctx.bus.emit(ctx.seriesId, "ai.activity", { ...activity, phase: "working", message })).catch(() => {});
    }, system: `${loadPrompt("artist", ctx.series.template)}\n\nCURRENT MOCO PRODUCTION PERMISSIONS (override historical approval and tool-availability statements in the brief/template):\n${JSON.stringify(workspace.permissions)}\nRead permissions in brief.json. The engine has verified the current approval hashes before invoking you. Use generate_image when enabled and requested; otherwise do not claim it is available. Report genuine blockers with report_blocker instead of returning without files.`, prompt, images: ctx.ai.seesImages ? templateImages(ctx.series.template) : undefined, artistTools: workspace.tools, signal: ctx.signal }, inputs.episodeId).finally(() => updates);
    const blocker = workspace.blocker();
    if (blocker) throw blocker;
    await ctx.bus.emit(ctx.seriesId, "ai.activity", { ...activity, phase: "working", message: `Checking the saved artwork and motion for ${inputs.shot.id}.` });
    let issues: unknown[] = [];
    let spec: SceneSpec | undefined;
    let stills:string[]=[];
    try {
      spec = await workspace.assemble();
      if (!workspace.reviewed(spec)) throw Error("The FINAL saved source/assets were not successfully previewed. Call render_preview after the last edit before completing the shot.");
      const checked = await ctx.renderSlots.run(() => ctx.render.check(spec!, { frames: temporalFrames(spec!), outDir: join(workspace.root, "checks", inputs.shot.id, String(attempt)) }));
      if (!checked.ok) throw Error(JSON.stringify(checked.errors));
      stills=checked.stills;
    } catch (error) { issues = [{ path: "canvas.source", problem: error instanceof Error ? error.message : String(error) }]; }
    const record = { invocationId, attempt, summary: result.text, model: result.model, backend: result.backend, sessionId: result.sessionId, usage: result.usage, issues };
    const attemptsDir = `episodes/${inputs.episodeId}/shots/${inputs.shot.id}/attempts`;
    // Keep the familiar latest-attempt path, plus immutable records across later visual-review repairs.
    await ctx.store.writeRaw(`${attemptsDir}/artist-${invocationId}-${attempt}.json`, record);
    await ctx.store.writeRaw(`${attemptsDir}/artist-${attempt}.json`, record);
    await ctx.bus.emit(ctx.seriesId, "shot.attempt", { episodeId: inputs.episodeId, shotId: inputs.shot.id, attempt, errors: issues.length });
    if (!issues.length && spec) {
      await publishShotStills(ctx,inputs.episodeId,inputs.shot.id,stills);
      await workspace.freezeShared();
      await workspace.audit({ phase: "author.accepted", attempt, invocationId });
      return { ok: true as const, data: spec, attempts: attempt };
    }
    feedback = JSON.stringify(issues);
  }
  // Artist projects fail visibly instead of silently substituting an unrelated kit picture.
  throw new EngineError("validation_failed", `Moco couldn't finish scene ${inputs.shot.id} after ${ctx.config.limits.maxAttemptsPerShot} attempts. Saved artwork is kept. Last check: ${feedback}`);
}
