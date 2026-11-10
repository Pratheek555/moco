import { appendFile, copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import * as z from "zod";
import type { ArtistTool, ToolContent } from "@moco/ai";
import { SceneSpec, type ArtistProduction } from "@moco/spec";
import type { StageContext } from "../pipeline/context.ts";
import type { SceneInputs } from "../generator/generate.ts";
import { shotBrief } from "../generator/context.ts";
import { validateScene } from "../loop/validate.ts";
import { Semaphore } from "../jobs/semaphore.ts";
import { lookupTemplate } from "../templates/registry.ts";
import { canvasFonts } from "./fonts.ts";
import { files } from "../pipeline/stages.ts";
import { artistPermissions } from "./permissions.ts";
import { EngineError } from "../errors.ts";
import { publishLibrary, restoreLibrary } from "./library.ts";
import { Caption, ShotTransition } from "@moco/spec";

const Manifest = z.object({
  sourceFiles: z.array(z.string()).min(1),
  cast: z.array(z.string()),
  assets: z.record(z.string(), z.string()).default({}),
  dataFiles: z.record(z.string(), z.string()).default({}),
  fonts: z.record(z.string(), z.string()).default({}),
  transition: ShotTransition.optional(),
  captions: z.array(Caption).default([]),
  cues: z.array(z.object({ id: z.string(), atFrame: z.number().int().nonnegative() })).default([]),
});
const Read = z.object({ path: z.string() });
const Write = Read.extend({ content: z.string(), encoding: z.enum(["utf8", "base64"]).default("utf8") });
const Preview = z.object({ frames: z.array(z.number().int().nonnegative()).max(12).optional() });
const GenerateImage = z.object({ path: z.string(), prompt: z.string().trim().min(1).max(12000), transparent: z.boolean().default(false), references: z.array(z.string()).max(5).default([]) });
const Blocker = z.object({ reason: z.string().trim().min(1).max(1600) });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const text = (value: unknown): { content: ToolContent[] } => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

export async function publishShotStills(ctx:Pick<StageContext,"dir">,ep:string,shot:string,stills:string[]) {
  const dir=join(ctx.dir,files.shotDir(ep,shot),"stills");
  await mkdir(dir,{recursive:true});
  for(const entry of await readdir(dir,{withFileTypes:true})) if(entry.isFile() && entry.name.endsWith(".png")) await rm(join(dir,entry.name));
  for(const file of stills) await copyFile(file,join(dir,basename(file)));
}

// Check every path component, including the root: no absolute paths, traversal, links or Windows streams.
export async function workspacePath(root: string, name: string): Promise<string> {
  if (!name || isAbsolute(name) || name.includes("\\") || name.includes(":") || name.split("/").some((part) => !part || part === "." || part === "..")) throw Error("Use a relative workspace path without traversal");
  const target = resolve(root, name);
  if (relative(root, target).startsWith("..")) throw Error("Path escapes workspace");
  for (const current of [resolve(root), ...name.split("/").map((_, index, parts) => resolve(root, ...parts.slice(0, index + 1)))]) {
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (info?.isSymbolicLink()) throw Error("Workspace links are not allowed");
  }
  return target;
}

export function temporalFrames(scene: SceneSpec): number[] {
  const last = scene.durationFrames - 1;
  const regular = Array.from({ length: 8 }, (_, index) => Math.round(last * index / 7));
  const events = scene.canvas?.cues.flatMap((cue) => [Math.max(0, cue.atFrame - 1), Math.min(last, cue.atFrame + 6)]) ?? [];
  const candidates = [...new Set([...regular, ...events])].sort((a, b) => a - b);
  return candidates.length <= 12 ? candidates : Array.from({ length: 12 }, (_, index) => candidates[Math.round((candidates.length - 1) * index / 11)]!);
}

// Roll back editable shot files together with a rejected embedded scene. Shared versions are append-only.
export async function snapshotShotWorkspace(ctx: Pick<StageContext,"dir">, episodeId:string, shotId:string) {
  const root=resolve(ctx.dir,"episodes",episodeId,"artist"), prefix=`shots/${shotId}`;
  const list=async(path:string):Promise<string[]>=>{
    const folder=await workspacePath(root,path);
    const entries=await readdir(folder,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return [];throw error});
    const result:string[]=[];
    for(const entry of entries){
      if(entry.isSymbolicLink())throw Error("Workspace links are not allowed");
      const name=`${path}/${entry.name}`;
      if(entry.isDirectory())result.push(...await list(name));else result.push(name);
    }
    return result;
  };
  const saved=new Map<string,Buffer>();
  for(const path of await list(prefix))saved.set(path,await readFile(await workspacePath(root,path)));
  return async()=>{
    for(const path of await list(prefix))if(!saved.has(path))await rm(await workspacePath(root,path));
    for(const [path,bytes] of saved){const file=await workspacePath(root,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);}
  };
}

export async function artistWorkspace(ctx: StageContext, inputs: SceneInputs, production: ArtistProduction) {
  const permissions = await artistPermissions(ctx, inputs.episodeId);
  if (permissions.images.requested && !permissions.images.available) throw new EngineError("stage_blocked", permissions.images.reason);
  if ((inputs.voiceover.fps ?? 30) !== production.format.fps) throw Error("Voice-track fps differs from the project format; regenerate narration/timing before authoring shots");
  const root = join(ctx.dir, "episodes", inputs.episodeId, "artist");
  const templateBrief = lookupTemplate(ctx.series.template)?.creativePrompt;
  const fonts = await canvasFonts(`${ctx.series.idea}\n${templateBrief ?? ""}`);
  const shotRoot = `shots/${inputs.shot.id}`;
  await mkdir(join(root, shotRoot), { recursive: true });
  // Carry the approved design forward across episodes; source files remain embedded in every saved shot.
  const previousEpisode = ctx.episodeIds()[ctx.episodeIds().indexOf(inputs.episodeId) - 1];
  if (previousEpisode && !await lstat(join(root, "shared")).then(() => true, () => false)) {
    const previousRoot = join(ctx.dir, "episodes", previousEpisode, "artist");
    const copyApproved = async (path: string): Promise<void> => {
      const from = await workspacePath(previousRoot, path);
      const info = await lstat(from).catch(() => undefined);
      if (!info) return;
      if (info.isDirectory()) {
        await mkdir(await workspacePath(root, path), { recursive: true });
        for (const item of await readdir(from)) await copyApproved(`${path}/${item}`);
      } else await copyFile(from, await workspacePath(root, path));
    };
    await copyApproved("shared"); await copyApproved("assets");
    await writeFile(join(root, "shared.lock.json"), JSON.stringify({ inherited: previousEpisode }));
  }
  const published = await restoreLibrary(ctx, root);
  const brief = shotBrief(inputs.shot, inputs.voiceover);
  const writeContext = async (path: string, value: unknown) => writeFile(await workspacePath(root, path), JSON.stringify(value, null, 2));
  const occurrences = new Map<string, number>();
  const words = inputs.voiceover.words.map((word, wordIndex) => {
    const key = word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const occurrence = (occurrences.get(key) ?? 0) + 1; occurrences.set(key, occurrence);
    return { ...word, wordIndex, occurrence, startFrame: Math.round(word.start * production.format.fps) - Math.round(inputs.shot.start * production.format.fps), endFrame: Math.round(word.end * production.format.fps) - Math.round(inputs.shot.start * production.format.fps) };
  }).filter((word) => word.start >= inputs.shot.start && word.start < inputs.shot.end);
  const timeline = ctx.store.has(files.shotList(inputs.episodeId)) ? (await ctx.store.read(files.shotList(inputs.episodeId), "ShotList")).data.shots : [inputs.shot];
  await writeContext(`${shotRoot}/brief.json`, { permissions, originalBrief: ctx.series.idea, templateBrief, availableFonts: Object.keys(fonts), production, show: inputs.show, timeline, shot: inputs.shot, durationFrames: brief.durationFrames, words, feedback: inputs.feedback });
  await writeContext(`${shotRoot}/production-state.json`, permissions);
  const manifestPath = `${shotRoot}/scene.json`;
  const lockPath = join(root, "shared.lock.json");
  const sharedLock = await readFile(lockPath, "utf8").then(value => JSON.parse(value) as { inherited?: string }, () => undefined);
  const locked = Boolean(sharedLock && (sharedLock.inherited || ctx.ledger.stage(`${inputs.episodeId}/sample`).status === "approved"));
  const events = join(root, "events.jsonl");
  const audit = (data: object) => appendFile(events, JSON.stringify({ at: new Date().toISOString(), shotId: inputs.shot.id, ...data }) + "\n");
  const list = async (directory: string): Promise<string[]> => {
    const out: string[] = [];
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw Error("Workspace contains a link");
      if (item.isDirectory()) out.push(...await list(join(directory, item.name)));
      else out.push(relative(root, join(directory, item.name)).replaceAll("\\", "/"));
    }
    return out;
  };
  const ownFile = (path: string) => path.startsWith(`${shotRoot}/`) || path.startsWith("shared/") || path.startsWith("assets/");
  const assemble = async () => {
    const contents = await readFile(await workspacePath(root, manifestPath), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw Error(`The artist did not save the scene for ${inputs.shot.id}. No renderable artwork was created. Use report_blocker to explain any missing capability instead of ending without a scene.`);
      throw error;
    });
    const manifest = Manifest.parse(JSON.parse(contents));
    const sources = await Promise.all(manifest.sourceFiles.map(async (path) => {
      if (!ownFile(path) || extname(path) !== ".js") throw Error("Source files must be .js files under shared/ or this shot");
      return `// ${path}\n${await readFile(await workspacePath(root, path), "utf8")}`;
    }));
    const designSources=Object.fromEntries(await Promise.all(manifest.sourceFiles.filter(path=>path.startsWith("shared/")).map(async path=>[path,hash(await readFile(await workspacePath(root,path)))])));
    const assets: Record<string, string> = {};
    for (const [id, path] of Object.entries(manifest.assets)) {
      const mime = ({ ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp", ".svg": "svg+xml" } as Record<string, string>)[extname(path)];
      if (!ownFile(path) || !mime) throw Error("Images must be PNG/JPEG/WebP/SVG files within this workspace");
      assets[id] = `data:image/${mime};base64,${(await readFile(await workspacePath(root, path))).toString("base64")}`;
    }
    const data: Record<string, unknown> = {};
    for (const [id, path] of Object.entries(manifest.dataFiles)) {
      if (!ownFile(path) || extname(path) !== ".json") throw Error("Data must be JSON within this workspace");
      data[id] = JSON.parse(await readFile(await workspacePath(root, path), "utf8"));
    }
    const embeddedFonts = { ...fonts };
    for (const [family, path] of Object.entries(manifest.fonts)) {
      const extension = extname(path).slice(1);
      if (!ownFile(path) || !["ttf", "otf", "woff", "woff2"].includes(extension)) throw Error("Fonts must be local TTF/OTF/WOFF/WOFF2 files");
      embeddedFonts[family] = `data:font/${extension};base64,${(await readFile(await workspacePath(root, path))).toString("base64")}`;
    }
    const spec = SceneSpec.parse({ shotId: inputs.shot.id, durationFrames: brief.durationFrames, format: production.format, transition: manifest.transition ?? inputs.shot.transition, background: { id: inputs.shot.location }, actors: [], captions: manifest.captions, canvas: { version: 1, source: sources.join("\n"), cast: manifest.cast, cues: manifest.cues, assets, fonts: embeddedFonts, designSources, data, words: words.map(({text,startFrame,endFrame,wordIndex}) => ({text,startFrame,endFrame,wordIndex})) } });
    const issues = validateScene(spec, { brief, bible: inputs.bible, catalog: ctx.catalog });
    if (issues.length) throw Error(JSON.stringify(issues));
    return spec;
  };
  let previews = 0;
  let blocker: EngineError | undefined;
  let reviewedHash: string | undefined;
  let failedPreview: { hash: string; message: string } | undefined;
  const serial = new Semaphore(1);
  const tool = (name: string, description: string, schema: z.ZodType, call: (args: unknown) => Promise<{ content: ToolContent[] }>): ArtistTool => ({ name, description, inputSchema: z.toJSONSchema(schema, { io: "input", target: "draft-07" }), call: async (args) => serial.run(async () => {
    ctx.signal.throwIfAborted();
    try { return await call(args); } catch (error) { await audit({ tool: name, error: error instanceof Error ? error.message : String(error) }); throw error; }
  }) });
  const tools: ArtistTool[] = [
    tool("list_files", "List saved artwork and earlier shots. Reuse shared character designs.", z.object({}), async () => text(await list(root))),
    tool("read_file", "Read a UTF-8 source/manifest/design/brief file within the artist workspace.", Read, async (args) => {
      const { path } = Read.parse(args); const file = await workspacePath(root, path);
      const bytes = await readFile(file);
      return text(bytes.toString("utf8"));
    }),
    tool("write_file", "Create/edit JS canvas artwork, JSON manifests/design notes, or base64 PNG/JPEG/WebP assets. No shell or outside files. Shared designs freeze after the first accepted shot.", Write, async (args) => {
      const { path, content, encoding } = Write.parse(args);
      const version=path.startsWith("shared/versions/") && !await lstat(await workspacePath(root,path)).then(()=>true,()=>false);
      if (published.has(path) || !ownFile(path) || path.endsWith("/brief.json") || path.endsWith("/production-state.json") || (!path.startsWith(`${shotRoot}/`) && locked && !version)) throw Error("Write only this shot's files; approved shared files and production state are read-only. Publish new shared designs under shared/versions/ with a new name.");
      if (!/\.(js|json|md|png|jpg|jpeg|webp|svg|ttf|otf|woff|woff2)$/.test(path)) throw Error("Unsupported artist file extension");
      const file = await workspacePath(root, path), bytes = Buffer.from(content, encoding);
      const previous = await readFile(file).catch(() => undefined);
      if (previous) { const history = join(root, "history"); await mkdir(history, { recursive: true }); await writeFile(join(history, hash(previous) + extname(path)), previous); }
      await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
      await audit({ tool: "write_file", path, bytes: bytes.length, hash: hash(bytes), previousHash: previous && hash(previous) });
      return text({ path, bytes: bytes.length, hash: hash(bytes) });
    }),
    tool("render_preview", "Render the CURRENT saved scene.json through moco. Returns frames in time order plus errors. Inspect text fit, acting, clipping and camera edges; edit files and preview again. Optional frames inspect a gesture closely.", Preview, async (args) => {
      const { frames: requested } = Preview.parse(args);
      if (++previews > 8) throw Error("Preview budget exhausted for this authoring attempt (8)");
      const spec = await assemble();
      const frames = requested ?? temporalFrames(spec);
      if (!frames.length || frames.some((frame) => frame >= spec.durationFrames)) throw Error("Preview frames must be inside the shot");
      const outDir = join(root, "previews", inputs.shot.id, String(Date.now()));
      const result = await ctx.renderSlots.run(() => ctx.render.check(spec, { frames, outDir }));
      await audit({ tool: "render_preview", frames, ok: result.ok, errors: !result.ok ? result.errors : undefined, sourceHash: hash(spec.canvas!.source) });
      if (!result.ok) { failedPreview = { hash: hash(JSON.stringify(spec)), message: JSON.stringify(result.errors) }; return text(result); }
      reviewedHash = hash(JSON.stringify(spec));
      const content: ToolContent[] = [{ type: "text", text: JSON.stringify({ frames, fps: production.format.fps, durationFrames: spec.durationFrames, note: "Images follow in the listed frame order. Diagnose motion from the sequence, not a single pose." }) }];
      for (const path of result.stills) content.push({ type: "image", mimeType: "image/png", data: (await readFile(path)).toString("base64") });
      return { content };
    }),
    tool("report_blocker", "Report a real missing capability or production blocker with a clear explanation. Moco stops this job without repeating artwork-repair attempts. Check the recorded permissions first; historical approval text is not a blocker.", Blocker, async (args) => {
      const { reason } = Blocker.parse(args);
      blocker = new EngineError("stage_blocked", `Could not create scene ${inputs.shot.id}: ${reason}`);
      await audit({ tool: "report_blocker", reason });
      return text({ blocked: true, reason });
    }),
  ];
  if (permissions.images.enabled) tools.push(tool("generate_image", "Generate ONE GPT Image 2 PNG using the user's Codex login and allowance. Save it to a NEW .png path under this shot or unlocked assets/. Reuse saved assets; never regenerate the same file. References are existing workspace PNG paths. Add its path to scene.json assets and animate separate layers/rig components in Canvas.", GenerateImage, async (args) => {
    const { path, prompt, transparent, references } = GenerateImage.parse(args);
    if (!(path.startsWith(`${shotRoot}/`) || (!locked && path.startsWith("assets/"))) || extname(path) !== ".png") throw Error("Save generated PNGs under this shot or unlocked assets/.");
    const file = await workspacePath(root, path);
    if (await lstat(file).then(() => true, () => false)) throw Error("This asset already exists. Reuse it or choose a new versioned filename.");
    const images = await Promise.all(references.map(async path => {
      if (!ownFile(path) || extname(path) !== ".png") throw Error("Image references must be workspace PNG assets.");
      return workspacePath(root, path);
    }));
    await audit({ tool: "generate_image", phase: "started", path, prompt, transparent, references, model: permissions.images.model });
    try {
      const result = await ctx.ai.generate({ imageGeneration: true, signal: ctx.signal, images, timeoutMs: ctx.config.limits.aiTimeoutMs,
        system: "You generate exactly one production image using the built-in image_gen tool (GPT Image 2). Use that tool; do not draw with code, use shell tools, or substitute a different model. The image tool saves the PNG automatically. Finish after one successful image. If unavailable, explain the blocker. Reference attachments are visual references; include them in the generation request when supplied.",
        prompt: `${prompt}\n\nBackground: ${transparent ? "transparent, preserve alpha" : "opaque"}. Generate exactly ONE PNG with GPT Image 2. This is a production asset; do not add text, watermarks or a surrounding presentation unless the prompt explicitly requests them.`,
      }, inputs.episodeId);
      const image = result.generatedImages?.[0];
      if (!image || result.generatedImages?.length !== 1) throw Error("The image provider did not return one usable PNG. No substitute artwork was generated.");
      ctx.signal.throwIfAborted();
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, image.data, { flag: "wx" });
      await audit({ tool: "generate_image", phase: "saved", path, bytes: image.data.length, hash: hash(image.data), model: permissions.images.model });
      return { content: [{ type: "text", text: JSON.stringify({ path, model: permissions.images.model, bytes: image.data.length }) }, { type: "image", mimeType: "image/png", data: image.data.toString("base64") }] };
    } catch (error) {
      blocker = error instanceof EngineError ? error : new EngineError("stage_blocked", `GPT Image 2 could not create the asset: ${error instanceof Error ? error.message : String(error)}`);
      throw blocker;
    }
  }));
  return { root, manifestPath, permissions, blocker: () => blocker, tools, assemble, previewIssue: (spec: SceneSpec) => failedPreview?.hash === hash(JSON.stringify(spec)) ? failedPreview.message : undefined, reviewed: (spec: SceneSpec) => reviewedHash === hash(JSON.stringify(spec)), beginAttempt: () => { previews = 0; reviewedHash = undefined; failedPreview = undefined; blocker = undefined; }, audit, freezeShared: async () => {
    await publishLibrary(ctx, root);
    if (!locked) await writeFile(lockPath, JSON.stringify({ files: (await list(root)).filter((path) => path.startsWith("shared/") || path.startsWith("assets/")) }));
  } };
}
