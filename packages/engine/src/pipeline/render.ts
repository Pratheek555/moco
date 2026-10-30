// Stages preview and final: assemble the episode from its shot specs and hand it to the renderer.
import { copyFile, link, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { FPS, FRAME_HEIGHT, FRAME_WIDTH, type EpisodeSpec, type RenderReport } from "@moco/spec";
import { hashData } from "../store/hash.ts";
import { exists } from "../store/workspace.ts";
import type { StageContext } from "./context.ts";
import { files } from "./stages.ts";

export async function runRender(ctx: StageContext, episodeId: string, quality: "preview" | "final"): Promise<string> {
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
async function renderCached(ctx: StageContext, episode: EpisodeSpec, out: string, quality: "preview" | "final") {
  const key = hashData({
    scenes: episode.scenes.map((scene) => hashData(scene)),
    voiceover: ctx.store.hashOf(files.voiceover(episode.episodeId)),
    versions: ctx.render.versions(),
    quality,
  });
  const cached = join(ctx.dir, files.renderCache(key));
  const durationSeconds = episode.scenes.reduce((total, scene) => total + scene.durationFrames, 0) / FPS;

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
  const rendered = await ctx.renderSlots.run(() => ctx.render.renderEpisode(episode, out, quality, onProgress, ctx.signal));
  await placeFile(rendered.path, cached);
  return rendered;
}

// Hard link when possible (no extra disk space), copy otherwise.
async function placeFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await rm(to, { force: true });
  await link(from, to).catch(() => copyFile(from, to));
}

async function assembleEpisode(ctx: StageContext, episodeId: string): Promise<EpisodeSpec> {
  const shotList = (await ctx.store.read(files.shotList(episodeId), "ShotList")).data;
  const voiceover = (await ctx.store.read(files.voiceover(episodeId), "VoiceoverTrack")).data;
  const scenes = await Promise.all(
    shotList.shots.map(async (shot) => (await ctx.store.read(files.shotSpec(episodeId, shot.id), "SceneSpec")).data),
  );
  return {
    episodeId,
    scenes,
    audio: { voiceover: join(ctx.dir, voiceover.file) },
    export: { width: FRAME_WIDTH, height: FRAME_HEIGHT, fps: FPS },
  };
}
