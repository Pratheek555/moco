// Stages preview and final: assemble the episode from its shot specs and hand it to the renderer.
import { copyFile, link, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { FPS, FRAME_HEIGHT, FRAME_WIDTH, type EpisodeSpec, type RenderReport } from "@moco/spec";
import { hashData } from "../store/hash.ts";
import { exists } from "../store/workspace.ts";
import type { StageContext } from "./context.ts";
import { files } from "./stages.ts";

type RenderContext = Pick<StageContext, "store" | "dir" | "render" | "bus" | "seriesId" | "signal" | "renderSlots"> & {series?:StageContext["series"]};

export async function runRender(ctx: RenderContext, episodeId: string, quality: "preview" | "final"): Promise<string> {
  if(quality==="final") {
    const critique=ctx.store.has(files.critique(episodeId)) ? (await ctx.store.read(files.critique(episodeId),"Critique")).data : undefined;
    if(ctx.series?.production || critique?.quality){
      const gate=critique?.quality,shots=(await ctx.store.read(files.shotList(episodeId),"ShotList")).data.shots;
      if(!gate || gate.status!=="passed")throw Error(`Final export needs an accepted artist quality review: ${gate?.unresolved.join("; ") ?? "no current review"}. Review the preview and quality report.`);
      if(gate.voiceoverHash!==ctx.store.hashOf(files.voiceover(episodeId)) || gate.shotListHash!==ctx.store.hashOf(files.shotList(episodeId)) || shots.length!==Object.keys(gate.sceneHashes).length || shots.some(s=>gate.sceneHashes[s.id]!==ctx.store.hashOf(files.shotSpec(episodeId,s.id))))throw Error("Artist quality review is stale; re-review the changed scenes, shot list or narration before final export");
    }
  }
  const episode = await assembleEpisode(ctx, episodeId);
  const out = join(ctx.dir, files.rendersDir(episodeId), `${quality}.mp4`);
  const rendered = await renderCached(ctx, episode, out, quality);

  const report: RenderReport = {
    file: relative(ctx.dir, rendered.path),
    quality,
    durationSeconds: rendered.durationSeconds,
    ...ctx.render.versions(), // recorded so a render can be reproduced
  };
  const file = quality === "preview" ? files.previewReport(episodeId) : files.renderReport(episodeId);
  const inputs = episode.scenes.map((scene) => ctx.store.inputRef(files.shotSpec(episodeId, scene.shotId)));
  const saved = await ctx.store.save(file, "RenderReport", report, { producedBy: "engine", inputs });
  return saved.meta.contentHash;
}

// Same scenes + same voiceover + same kit/renderer + same quality → same video, so reuse it.
async function renderCached(ctx: RenderContext, episode: EpisodeSpec, out: string, quality: "preview" | "final") {
  const key = hashData({
    scenes: episode.scenes.map((scene) => hashData(scene)),
    voiceover: ctx.store.hashOf(files.voiceover(episode.episodeId)),
    versions: ctx.render.versions(),
    format: episode.export,
    quality,
  });
  const cached = join(ctx.dir, files.renderCache(key));
  const durationSeconds = episode.scenes.reduce((total, scene) => total + scene.durationFrames, 0) / episode.export.fps;

  if (await exists(cached)) {
    await placeFile(cached, out);
    await ctx.bus.emit(ctx.seriesId, "render.progress", { episodeId: episode.episodeId, quality, progress: 1, cached: true });
    return { path: out, durationSeconds };
  }

  // Renderers report progress per frame; only tell the UI about whole-percent changes.
  let lastPercent = -1;
  const onProgress = (progress: number) => {
    const percent = Math.floor(progress * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    void ctx.bus.emit(ctx.seriesId, "render.progress", { episodeId: episode.episodeId, quality, progress: percent / 100 });
  };
  const rendered = await ctx.renderSlots.run(async () => {
    // Movie encoding launches its own Chromium. Release the still-check browser
    // first so large canvas episodes do not keep two copies of the artwork alive.
    await ctx.render.release?.();
    return ctx.render.renderEpisode(episode, out, quality, onProgress, ctx.signal);
  });
  await placeFile(rendered.path, cached);
  return rendered;
}

// Hard link when possible (no extra disk space), copy otherwise.
async function placeFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await rm(to, { force: true });
  await link(from, to).catch(() => copyFile(from, to));
}

async function assembleEpisode(ctx: RenderContext, episodeId: string): Promise<EpisodeSpec> {
  const shotList = (await ctx.store.read(files.shotList(episodeId), "ShotList")).data;
  const voiceover = (await ctx.store.read(files.voiceover(episodeId), "VoiceoverTrack")).data;
  const scenes = await Promise.all(
    shotList.shots.map(async (shot) => (await ctx.store.read(files.shotSpec(episodeId, shot.id), "SceneSpec")).data),
  );
  const format = scenes[0]?.format ?? { width: FRAME_WIDTH, height: FRAME_HEIGHT, fps: FPS };
  if (scenes.some((scene) => {
    const candidate = scene.format ?? { width: FRAME_WIDTH, height: FRAME_HEIGHT, fps: FPS };
    return candidate.width !== format.width || candidate.height !== format.height || candidate.fps !== format.fps;
  })) {
    throw new Error("All shots in an episode must use the same output format and frame rate");
  }
  return {
    episodeId,
    scenes,
    audio: { voiceover: join(ctx.dir, voiceover.file) },
    export: format,
  };
}
