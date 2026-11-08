import { appendFile, copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
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
import { workspacePath } from "./paths.ts";
import { readArtwork } from "./manifest.ts";
import { readCharacterRig } from "./characters.ts";
export { workspacePath } from "./paths.ts";

const Read = z.object({ path: z.string() });
const Write = Read.extend({ content: z.string().max(10_000_000), encoding: z.enum(["utf8", "base64"]).default("utf8") });
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

export function temporalFrames(scene: SceneSpec): number[] {
  const last = scene.durationFrames - 1;
  const regular = Array.from({ length: 8 }, (_, index) => Math.round(last * index / 7));
  const events = scene.canvas?.cues.flatMap((cue) => [Math.max(0, cue.atFrame - 1), Math.min(last, cue.atFrame + 6)]) ?? [];
  const candidates = [...new Set([...regular, ...events])].sort((a, b) => a - b);
  return candidates.length <= 12 ? candidates : Array.from({ length: 12 }, (_, index) => candidates[Math.round((candidates.length - 1) * index / 11)]!);
}

async function snapshotDirectory(root: string, prefix: string) {
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

// Roll back editable artwork AND the stills shown to the user together with a
// rejected embedded scene. Shared versions and review evidence remain append-only.
export async function snapshotShotWorkspace(ctx: Pick<StageContext,"dir">, episodeId:string, shotId:string) {
  const artwork = await snapshotDirectory(resolve(ctx.dir,"episodes",episodeId,"artist"), `shots/${shotId}`);
  const stills = await snapshotDirectory(resolve(ctx.dir), `${files.shotDir(episodeId,shotId)}/stills`);
  return async () => { await artwork(); await stills(); };
}

export async function artistWorkspace(ctx: StageContext, inputs: SceneInputs, production: ArtistProduction) {
  const permissions = await artistPermissions(ctx, inputs.episodeId);
  const repeat = ctx.ledger.data.repeatEpisodes?.[inputs.episodeId];
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
  const brief = shotBrief(inputs.shot, inputs.voiceover);
  const writeContext = async (path: string, value: unknown) => writeFile(await workspacePath(root, path), JSON.stringify(value, null, 2));
  const occurrences = new Map<string, number>();
  const words = inputs.voiceover.words.map((word, wordIndex) => {
    const key = word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const occurrence = (occurrences.get(key) ?? 0) + 1; occurrences.set(key, occurrence);
    return { ...word, wordIndex, occurrence, startFrame: Math.round(word.start * production.format.fps) - Math.round(inputs.shot.start * production.format.fps) };
  }).filter((word) => word.start >= inputs.shot.start && word.start < inputs.shot.end);
  const timeline = ctx.store.has(files.shotList(inputs.episodeId)) ? (await ctx.store.read(files.shotList(inputs.episodeId), "ShotList")).data.shots : [inputs.shot];
  const approvedCharacters = Object.fromEntries(await Promise.all(Object.entries(inputs.characterRigs ?? {}).map(async ([id, version]) => {
    const rig = await readCharacterRig(ctx, id, version);
    return [`approved-characters/${id}.json`, { castId: id, version, sources: rig.sources, notes: rig.notes, imageIds: Object.keys(rig.assets), limitation: rig.provenance.review.limitation }];
  })));
  await writeContext(`${shotRoot}/brief.json`, { permissions, originalBrief: ctx.series.idea, templateBrief, availableFonts: Object.keys(fonts), production, show: inputs.show, timeline, shot: inputs.shot, durationFrames: brief.durationFrames, words, feedback: inputs.feedback, characterRigs: inputs.characterRigs ?? {}, approvedCharacters: Object.keys(approvedCharacters) });
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
  const checkFileBudget = async (path: string) => {
    if (await lstat(await workspacePath(root, path)).then(() => true, () => false)) return;
    // A long film legitimately has hundreds of files. Bound each shot and the
    // shared library separately; allow existing files to be repaired at the cap.
    const shotFile = path.startsWith(`${shotRoot}/`);
    const used = (await list(root)).filter(file => shotFile
      ? file.startsWith(`${shotRoot}/`)
      : file.startsWith("shared/") || file.startsWith("assets/"));
    if (used.length >= 180) throw Error(`Artist file limit reached for ${shotFile ? `scene ${inputs.shot.id}` : "shared assets"} (180). Reuse existing files.`);
  };
  const assemble = async () => {
    const artwork = await readArtwork(ctx, root, inputs.shot.id, inputs.characterRigs ?? {}).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw Error(`The artist did not save the scene or a required artwork file for ${inputs.shot.id}. Use report_blocker for a missing capability.`);
      throw error;
    });
    const { manifest, source, assets, designSources, characterRigs } = artwork;
    if (inputs.shot.characters.length && !artwork.sharedSources.length) throw Error("Characters must use a reusable shared design file from shared/ or an approved character rig");
    if (inputs.requireCharacterRigs && Object.entries(inputs.characterRigs ?? {}).some(([id, version]) => characterRigs[id] !== version)) throw Error("This shot must use the explicitly selected character version");
    const spec = SceneSpec.parse({ shotId: inputs.shot.id, durationFrames: brief.durationFrames, format: production.format, background: { id: inputs.shot.location }, actors: [], captions: [], canvas: { version: 1, source, cast: manifest.cast, cues: manifest.cues, assets, fonts, designSources, characterRigs } });
    const issues = validateScene(spec, { brief, bible: inputs.bible, catalog: ctx.catalog });
    if (issues.length) throw Error(JSON.stringify(issues));
    return spec;
  };
  let previews = 0;
  let blocker: EngineError | undefined;
  let reviewedHash: string | undefined;
  const serial = new Semaphore(1);
  const tool = (name: string, description: string, schema: z.ZodType, call: (args: unknown) => Promise<{ content: ToolContent[] }>): ArtistTool => ({ name, description, inputSchema: z.toJSONSchema(schema, { io: "input", target: "draft-07" }), call: async (args) => serial.run(async () => {
    ctx.signal.throwIfAborted();
    try { return await call(args); } catch (error) { await audit({ tool: name, error: error instanceof Error ? error.message : String(error) }); throw error; }
  }) });
  const tools: ArtistTool[] = [
    tool("list_files", "List saved artwork, approved character rigs and earlier shots.", z.object({}), async () => text([...await list(root), ...Object.keys(approvedCharacters)])),
    tool("read_file", "Read a UTF-8 source/manifest/design/brief file within the artist workspace.", Read, async (args) => {
      const { path } = Read.parse(args);
      if (Object.hasOwn(approvedCharacters, path)) return text(approvedCharacters[path]);
      const file = await workspacePath(root, path);
      const bytes = await readFile(file); if (bytes.length > 150_000) throw Error("Read is limited to 150 KB text files");
      return text(bytes.toString("utf8"));
    }),
    tool("write_file", "Create/edit JS canvas artwork, JSON manifests/design notes, or base64 PNG/JPEG/WebP assets. No shell or outside files. Shared designs freeze after the first accepted shot.", Write, async (args) => {
      const { path, content, encoding } = Write.parse(args);
      if (repeat && !path.startsWith(`${shotRoot}/`)) throw new EngineError("stage_blocked", "This repeat episode reuses approved designs. Use the standard series review workflow for a new or changed recurring design; only this shot's files can be written here.");
      const version=path.startsWith("shared/versions/") && !await lstat(await workspacePath(root,path)).then(()=>true,()=>false);
      if (!ownFile(path) || path.endsWith("/brief.json") || path.endsWith("/production-state.json") || (!path.startsWith(`${shotRoot}/`) && locked && !version)) throw Error("Write only this shot's files; approved shared files and production state are read-only. Publish new shared designs under shared/versions/ with a new name.");
      if (!/\.(js|json|md|png|jpg|jpeg|webp)$/.test(path)) throw Error("Unsupported artist file extension");
      await checkFileBudget(path);
      const file = await workspacePath(root, path), bytes = Buffer.from(content, encoding);
      if (bytes.length > 6_000_000) throw Error("File exceeds 6 MB");
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
      if (!result.ok) return text(result);
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
    await checkFileBudget(path);
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
      if (image.data.length > 5_999_900) throw Error("The generated image exceeds the scene's 6 MB asset limit. Request a smaller PNG before retrying.");
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
  return { root, manifestPath, permissions, blocker: () => blocker, tools, assemble, reviewed: (spec: SceneSpec) => reviewedHash === hash(JSON.stringify(spec)), beginAttempt: () => { previews = 0; reviewedHash = undefined; blocker = undefined; }, audit, freezeShared: async () => {
    if (!locked) await writeFile(lockPath, JSON.stringify({ files: (await list(root)).filter((path) => path.startsWith("shared/") || path.startsWith("assets/")) }));
  } };
}
