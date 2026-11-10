import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { catalog } from "@moco/kit";
import { SceneSpec, EpisodeSpec, blenderSceneIssues, thumbnailPresentation } from "@moco/spec";
import { blankReason, decodePng } from "../pixels.ts";
import type { RemotionRenderPort } from "../index.ts";
import { runTool } from "./process.ts";
import { blenderBinaryStamp, blenderStatus, findBlender } from "./runtime.ts";
export { blenderStatus, findBlender, blenderToolsDir, BLENDER_VERSION } from "./runtime.ts";

export interface BlenderRenderOptions {
  executable?: string;
  ffmpegExecutable?: string;
  samples?: number;
  timeoutMs?: number;
  // Trusted application-owned registry. Scene JSON can name ids, never file paths.
  assets?: Record<string, string>;
  assetRoots?: string[]; // project roots whose assets/blender/manifest.json may be resolved
}

const bridge = fileURLToPath(new URL("./scene.py", import.meta.url));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const exists = (path: string) => stat(path).then(s => s.isFile() && s.size > 0, () => false);

export function createBlenderRenderPort(options: BlenderRenderOptions = {}): RemotionRenderPort & { sceneBackend: "blender" } {
  const executable = findBlender(options.executable);
  const ffmpeg = options.ffmpegExecutable ?? process.env.MOCO_FFMPEG_PATH ?? "ffmpeg";
  const samples = options.samples ?? 32;
  if (!Number.isInteger(samples) || samples < 1 || samples > 256) throw new Error("Blender samples must be between 1 and 256");
  // A running production must use exactly the bridge source in its cache stamp,
  // even when the developer edits scene.py while it is rendering.
  const bridgeSource = readFileSync(bridge, "utf8");
  const assets = Object.fromEntries(Object.entries(options.assets ?? {}).map(([id,path]) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new Error("Invalid Blender asset id");
    const bytes = readFileSync(path);
    if (bytes.length > 30 * 1024 * 1024 || !(bytes.subarray(0,8).toString("hex") === "89504e470d0a1a0a" || bytes.subarray(0,3).toString("hex") === "ffd8ff")) throw new Error("Blender image assets must be PNG/JPEG files under 30 MB");
    return [id, resolve(path)];
  }));
  const fonts = Object.fromEntries([ ["headline","Bangers-Regular.ttf"], ["hand","PatrickHand-Regular.ttf"] ].map(([id,name]) => [id!, fileURLToPath(new URL(`../../assets/fonts/${name}`,import.meta.url))]));
  // Image content hashes belong to SceneSpec, so the desktop and a production CLI
  // get the same renderer version regardless of which project's registry is open.
  const resources = Object.entries(fonts).map(([id,path]) => [id,fileHash(path)]);
  const version = `blender-2-${hash([bridgeSource, blenderBinaryStamp(executable), samples, resources]).slice(0,16)}`;
  let ready: Promise<void> | undefined;
  let closed = false;
  const active = new Set<AbortController>();
  const ensureReady = () => {
    if (closed) throw new Error("Blender renderer is closed");
    ready ??= blenderStatus(executable, ffmpeg).then(status => { if (!status.ok) throw new Error(status.reason); }).catch(error => { ready = undefined; throw error; });
    return ready;
  };
  const validate = (input: SceneSpec): SceneSpec => {
    const spec = SceneSpec.parse(input);
    if (!spec.blender) throw new Error("This shot has no Blender scene");
    if (spec.canvas || spec.stage || spec.actors.length || spec.props.length || spec.camera.length || spec.fx.length || spec.atmosphere.length) throw new Error("Blender owns the complete shot; remove Canvas, stage and kit elements");
    const issues = blenderSceneIssues(spec.blender, spec.durationFrames);
    if (issues.length) throw new Error(issues.map(issue => `${issue.path}: ${issue.problem}`).join("\n"));
    return spec;
  };
  const resolveAssets = async (spec: SceneSpec, from: string) => {
    const needed = [...new Set(spec.blender!.objects.filter(object=>object.kind==="image").map(object=>object.image!))];
    if (!needed.length) return {};
    let registry = assets;
    if (needed.some(id=>!registry[id])) {
      const roots = (options.assetRoots ?? []).map(root=>resolve(root));
      let folder = resolve(from);
      while (roots.some(root=>folder===root || folder.startsWith(root+sep))) {
        const manifest = join(folder,"assets","blender","manifest.json");
        if (await exists(manifest)) {
          const rows = JSON.parse(await readFile(manifest,"utf8")) as {id:string;file:string}[];
          if (!Array.isArray(rows) || rows.length>80 || rows.some(row=>typeof row.id!=="string" || typeof row.file!=="string" || basename(row.file)!==row.file || !/\.(png|jpe?g)$/i.test(row.file))) throw Error("Invalid Blender asset registry");
          registry=Object.fromEntries(rows.map(row=>[row.id,join(dirname(manifest),row.file)]));
          break;
        }
        const parent=dirname(folder);if(parent===folder)break;folder=parent;
      }
    }
    const result:Record<string,string>={};
    for (const id of needed) {
      const file=registry[id], expected=spec.blender!.assets?.find(asset=>asset.id===id)?.sha256;
      if (!file || !expected) throw Error(`Blender image asset ${id} is not registered`);
      if (fileHash(file)!==expected) throw Error(`Blender image asset ${id} has changed; rebuild its scene spec before rendering`);
      result[id]=file;
    }
    return result;
  };
  const invoke = async (request: object, requestDir: string, signal?: AbortSignal, onLine?: (line: string) => void) => {
    await ensureReady();
    const controller = new AbortController();
    active.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const file = join(requestDir, `request-${randomUUID()}.json`);
    const script = join(requestDir, `bridge-${randomUUID()}.py`);
    try {
      const payload=request as {spec:SceneSpec;outDir?:string;out?:string};
      const imageAssets=await resolveAssets(payload.spec,payload.outDir ?? dirname(payload.out ?? requestDir));
      await writeFile(file, JSON.stringify({ ...request, assets:imageAssets, fonts }));
      await writeFile(script, bridgeSource);
      await runTool(executable, ["--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1", "--python", script, "--", file], { signal: controller.signal, timeoutMs: options.timeoutMs, onLine });
    } finally { active.delete(controller); signal?.removeEventListener("abort", abort); await Promise.all([rm(file, { force: true }), rm(script, { force: true })]); }
  };
  const port: RemotionRenderPort & { sceneBackend: "blender" } = {
    sceneBackend: "blender",
    versions: () => ({ kitVersion: catalog.kitVersion, rendererVersion: version }),
    async check(input, { frames, outDir, signal }) {
      // Dependency errors fail the stage, rather than asking the AI to repair a missing installation.
      await ensureReady();
      const directory = resolve(outDir);
      await mkdir(directory, { recursive: true });
      let spec: SceneSpec;
      try { spec = validate(input); } catch (error) { return { ok: false, errors: [{ shotId: input.shotId, path: "blender", message: String(error) }] }; }
      if (frames.some(frame => !Number.isInteger(frame) || frame < 0 || frame >= spec.durationFrames)) throw new Error("Check frame is outside the shot");
      // Each check has its own request and Blender process; shared output folders are safe.
      await invoke({ mode: "stills", spec, frames, outDir: directory, scale: 0.5, samples: Math.min(samples, 8) }, directory, signal);
      const stills = frames.map(frame => join(directory, `${frame}.png`));
      for (let i = 0; i < stills.length; i++) {
        const reason = blankReason(decodePng(await readFile(stills[i]!)));
        if (reason) return { ok: false, errors: [{ shotId: spec.shotId, frame: frames[i], path: "blender.camera", message: `Blender frame is ${reason}; light and frame the subject` }] };
      }
      return { ok: true, stills };
    },
    async thumbnail(input, { frame, text, design, out }) {
      const spec = validate(input);
      if (!Number.isInteger(frame) || frame < 0 || frame >= spec.durationFrames) throw new Error("Thumbnail frame is outside the shot");
      await mkdir(dirname(resolve(out)), { recursive: true });
      const dir = await mkdtemp(join(tmpdir(), "moco-blender-thumb-"));
      const format = spec.format ?? { width: 1080, height: 1920 };
      const presentation = thumbnailPresentation(format.width, format.height, text, design);
      try { await invoke({ mode: "thumbnail", spec, frame, text, headline: presentation.headline, out: resolve(out), scale: 1, samples }, dir); }
      finally { await rm(dir, { recursive: true, force: true }); }
    },
    async renderEpisode(input, output, quality, onProgress, signal) {
      signal?.throwIfAborted();
      await ensureReady();
      const episode = EpisodeSpec.parse(input);
      const scenes = episode.scenes.map(validate);
      const format = episode.export;
      if (format.width % 2 || format.height % 2) throw new Error("H.264 export needs even dimensions");
      if (scenes.some(scene => scene.format && hash(scene.format) !== hash(format))) throw new Error("All Blender shots must match the episode output format");
      if (episode.audio.music) throw new Error("Blender soundtrack mixing is not supported yet; provide one mixed voiceover track");
      if (episode.audio.voiceover && !await exists(episode.audio.voiceover)) throw new Error("The episode voiceover file is missing or empty");
      const total = scenes.reduce((sum, scene) => sum + scene.durationFrames, 0);
      const out = resolve(output), scale = quality === "preview" ? 0.5 : 1;
      const width = Math.max(2, Math.floor(format.width * scale / 2) * 2), height = Math.max(2, Math.floor(format.height * scale / 2) * 2);
      const renderSamples = quality === "preview" ? Math.min(samples, 8) : samples;
      await mkdir(dirname(out), { recursive: true });
      const work = await mkdtemp(join(dirname(out), ".blender-assembly-"));
      let completed = 0;
      const shots: string[] = [];
      const operation = new AbortController();
      active.add(operation);
      signal = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
      try {
        for (const scene of scenes) {
          signal?.throwIfAborted();
          const key = hash([scene, format, width, height, renderSamples, version]);
          const dir = join(dirname(out), ".blender-cache", key);
          const clip = join(dir, "shot.mp4");
          const step = scene.blender!.animationStep ?? 1;
          await mkdir(dir, { recursive: true });
          if (!await exists(clip)) {
            await invoke({ mode: "animation", spec: { ...scene, format }, outDir: dir, width, height, samples: renderSamples }, dir, signal, line => {
              const match = /^MOCO_FRAME (\d+)/.exec(line);
              if (match) onProgress?.(Math.min(0.95, (completed + Number(match[1]) + 1) / total * 0.95));
            });
            const encoding = join(dir, "encoding.mp4");
            try {
              await runTool(ffmpeg, ["-y", "-v", "error", "-framerate", String(format.fps / step), "-start_number", "0", "-i", join(dir, "frame-%06d.png"), "-r", String(format.fps), "-frames:v", String(scene.durationFrames), "-c:v", "libx264", "-preset", "fast", "-crf", quality === "preview" ? "26" : "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", encoding], { signal, timeoutMs: options.timeoutMs });
              await rename(encoding, clip);
              await writeFile(join(dir,"scene.json"),JSON.stringify({spec:scene,quality,format,rendererVersion:version}));
              // Keep the editable .blend and encoded shot, free the lossless frames after success.
              await Promise.all(Array.from({ length: Math.ceil(scene.durationFrames / step) }, (_, i) => rm(join(dir, `frame-${String(i).padStart(6,"0")}.png`), { force: true })));
            } finally { await rm(encoding, { force: true }); }
          }
          shots.push(clip); completed += scene.durationFrames;
          onProgress?.(completed / total * 0.95);
        }
        // Use relative, generated names in the concat manifest so arbitrary output paths never become FFmpeg syntax.
        for (let i = 0; i < shots.length; i++) {
          const { copyFile } = await import("node:fs/promises");
          await copyFile(shots[i]!, join(work, `${i}.mp4`));
        }
        const manifest = join(work, "shots.txt");
        await writeFile(manifest, shots.map((_,i) => `file '${i}.mp4'`).join("\n"));
        const muxed = join(work, "episode.mp4");
        await runTool(ffmpeg, ["-y", "-v", "error", "-f", "concat", "-safe", "1", "-i", manifest,
          ...(episode.audio.voiceover ? ["-i", resolve(episode.audio.voiceover)] : []),
          "-map", "0:v:0", ...(episode.audio.voiceover ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-af", "apad"] : []),
          "-c:v", "copy", "-t", String(total / format.fps), "-movflags", "+faststart", muxed], { signal, timeoutMs: options.timeoutMs });
        signal?.throwIfAborted(); await rename(muxed, out); onProgress?.(1);
        return { path: out, durationSeconds: total / format.fps };
      } finally { active.delete(operation); await rm(work, { recursive: true, force: true }); }
    },
    async release() {},
    async close() { closed = true; for (const controller of active) controller.abort(); },
  };
  return port;
}
