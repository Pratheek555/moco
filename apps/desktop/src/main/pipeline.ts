import type { Engine, OnProgress } from "@moco/engine";
import { pad } from "@moco/engine";
import { SFX, type Episode } from "@moco/spec";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { JobSpec, Settings } from "../shared/api.ts";
import type { JobContext, JobManager } from "./jobs.ts";
import type { RenderService } from "./render.ts";

interface Deps {
  engine: () => Engine;
  jobs: JobManager;
  render: RenderService;
  settings: () => Settings;
  fileServer: () => string;
  changed: (seriesId: string, number?: number) => void;
}

/** Bridge engine progress callbacks into a job, scaling progress into [from, to]. */
function progressInto(ctx: JobContext, from = 0, to = 1): OnProgress {
  return (p) => {
    if (p.stage) ctx.update({ stage: p.stage });
    if (p.progress !== undefined)
      ctx.update({ progress: from + (to - from) * p.progress });
    if (p.text) ctx.stream(p.text);
    if (p.log) ctx.log(p.log, p.level);
  };
}

const needsVoice = (ep: Episode, s: Settings) =>
  s.voice.provider !== "none" &&
  ep.shots.some((sh) => sh.narration.trim() && !sh.voice);
const needsMusic = (ep: Episode) => ep.music.mood !== "none" && !ep.music.src;

export function createPipelines(d: Deps) {
  const voiceSettings = () => {
    const s = d.settings();
    return {
      provider: s.voice.provider,
      voice: s.voice.voice || undefined,
      rate: s.voice.rate,
      apiKey:
        s.voice.provider === "elevenlabs"
          ? s.voice.elevenlabsKey
          : s.voice.provider === "openai"
            ? s.ai.openaiKey
            : undefined,
    };
  };

  async function write(
    ctx: JobContext,
    seriesId: string,
    number: number,
    from = 0,
    to = 1,
  ) {
    ctx.update({ stage: `Writing episode ${number}` });
    await d
      .engine()
      .writeEpisode(seriesId, number, progressInto(ctx, from, to), ctx.signal);
    d.changed(seriesId, number);
  }

  async function voice(
    ctx: JobContext,
    seriesId: string,
    number: number,
    from = 0,
    to = 1,
  ) {
    const { warnings } = await d
      .engine()
      .voiceEpisode(
        seriesId,
        number,
        voiceSettings(),
        progressInto(ctx, from, to),
        ctx.signal,
      );
    for (const w of warnings) ctx.log(w, "warn");
    d.changed(seriesId, number);
  }

  async function render(
    ctx: JobContext,
    seriesId: string,
    number: number,
    from = 0,
    to = 1,
  ) {
    const s = d.settings();
    const maxFixes = s.ai.maxRepairs;
    const sfx = await d.engine().ensureSfx();
    const base = d.fileServer();
    const sfxUrls = Object.fromEntries(
      SFX.map((id) => [
        id,
        `${base}/sfx/${encodeURIComponent(path.basename(sfx[id]))}`,
      ]),
    );
    for (let attempt = 0; ; attempt++) {
      let episode = await d.engine().store.getEpisode(seriesId, number);
      if (!episode) throw new Error("Write the episode before rendering");
      if (needsVoice(episode, s) || needsMusic(episode)) {
        ctx.update({ stage: "Preparing voice & music" });
        await voice(ctx, seriesId, number, from, from + (to - from) * 0.15);
        episode = (await d.engine().store.getEpisode(seriesId, number))!;
      }
      const output = d.engine().store.renderPath(seriesId, number);
      await mkdir(path.dirname(output), { recursive: true });
      const inputProps = {
        episode,
        assets: {
          base: `${base}/projects/${encodeURIComponent(seriesId)}/episodes/${pad(number)}/`,
          sfx: sfxUrls,
        },
      };
      const start = from + (to - from) * 0.15;
      try {
        ctx.log(
          `Rendering ${episode.shots.length} shots to ${path.basename(output)}`,
        );
        const out = await d.render.render({
          inputProps,
          output,
          quality: s.render.quality,
          concurrency: s.render.concurrency,
          licenseKey: s.render.remotionLicenseKey,
          signal: ctx.signal,
          onProgress: (p) =>
            ctx.update({
              stage: p.stage,
              progress: start + (to - start) * p.progress,
            }),
        });
        await d.engine().store.setStatus(seriesId, number, "rendered");
        ctx.update({ output: out, stage: "Rendered", progress: to });
        ctx.log(`Saved ${out}`);
        d.changed(seriesId, number);
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (ctx.signal.aborted) throw err;
        ctx.log(`Render failed: ${message.slice(0, 800)}`, "error");
        if (attempt >= maxFixes) throw err;
        // The auto-fix loop: send the failing shot and the error back to the AI.
        const fixed = await d
          .engine()
          .repairFromRenderError(
            seriesId,
            number,
            message,
            progressInto(ctx),
            ctx.signal,
          )
          .catch((e) => {
            ctx.log(
              `Auto-fix failed: ${e instanceof Error ? e.message : e}`,
              "warn",
            );
            return false;
          });
        if (!fixed) throw err;
        ctx.log(
          `Auto-fixed — retrying render (${attempt + 1}/${maxFixes})`,
          "warn",
        );
        d.changed(seriesId, number);
      }
    }
  }

  return {
    start(spec: JobSpec) {
      if (
        !spec ||
        ![
          "plan",
          "write",
          "write-all",
          "revise",
          "voice",
          "render",
          "make",
        ].includes(spec.kind)
      )
        throw new Error("Unknown job type");
      if (
        spec.kind !== "plan" &&
        d.jobs.isBusy(spec.seriesId, "number" in spec ? spec.number : undefined)
      )
        throw new Error("This episode already has a job in progress");
      switch (spec.kind) {
        case "plan":
          return d.jobs.add(
            "plan",
            `New series: ${spec.input.idea.slice(0, 48)}`,
            {},
            async (ctx) => {
              const series = await d
                .engine()
                .planSeries(
                  spec.input,
                  progressInto(ctx, 0, spec.thenWrite ? 0.25 : 1),
                  ctx.signal,
                );
              ctx.update({
                title: `New series: ${series.title}`,
                output: series.id,
              });
              ctx.job.seriesId = series.id;
              d.changed(series.id);
              if (spec.thenWrite) {
                const n = series.episodes.length;
                for (const [i, e] of series.episodes.entries())
                  await write(
                    ctx,
                    series.id,
                    e.number,
                    0.25 + (0.75 * i) / n,
                    0.25 + (0.75 * (i + 1)) / n,
                  );
              }
              ctx.update({ stage: "Series ready" });
            },
          );
        case "write":
          return d.jobs.add(
            "write",
            `Write episode ${spec.number}`,
            { seriesId: spec.seriesId, number: spec.number },
            (ctx) => write(ctx, spec.seriesId, spec.number),
          );
        case "write-all":
          return d.jobs.add(
            "write-all",
            "Write all episodes",
            { seriesId: spec.seriesId },
            async (ctx) => {
              const series = await d.engine().store.getSeries(spec.seriesId);
              const todo = series.episodes.filter(
                (e) => e.status === "planned" || e.status === "error",
              );
              for (const [i, e] of todo.entries())
                await write(
                  ctx,
                  spec.seriesId,
                  e.number,
                  i / todo.length,
                  (i + 1) / todo.length,
                );
              ctx.update({
                stage: todo.length
                  ? "All episodes written"
                  : "Nothing to write",
              });
            },
          );
        case "revise":
          return d.jobs.add(
            "revise",
            `Revise shot ${spec.shotId}`,
            { seriesId: spec.seriesId, number: spec.number },
            async (ctx) => {
              await d
                .engine()
                .reviseShot(
                  spec.seriesId,
                  spec.number,
                  spec.shotId,
                  spec.instruction,
                  progressInto(ctx),
                  ctx.signal,
                );
              d.changed(spec.seriesId, spec.number);
            },
          );
        case "voice":
          return d.jobs.add(
            "voice",
            `Voice & music · episode ${spec.number}`,
            { seriesId: spec.seriesId, number: spec.number },
            (ctx) => voice(ctx, spec.seriesId, spec.number),
          );
        case "render":
          return d.jobs.add(
            "render",
            `Render episode ${spec.number}`,
            { seriesId: spec.seriesId, number: spec.number },
            async (ctx) => {
              await render(ctx, spec.seriesId, spec.number);
            },
          );
        case "make":
          return d.jobs.add(
            "make",
            `Make episode ${spec.number}`,
            { seriesId: spec.seriesId, number: spec.number },
            async (ctx) => {
              const ep = await d
                .engine()
                .store.getEpisode(spec.seriesId, spec.number);
              if (!ep) await write(ctx, spec.seriesId, spec.number, 0, 0.4);
              await render(ctx, spec.seriesId, spec.number, ep ? 0 : 0.4, 1);
            },
          );
      }
    },
  };
}
