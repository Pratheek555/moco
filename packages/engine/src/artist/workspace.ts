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

const Manifest = z.object({
  sourceFiles: z.array(z.string()).min(1).max(12),
  cast: z.array(z.string()).max(20),
  assets: z.record(z.string(), z.string()).default({}),
  cues: z.array(z.object({ id: z.string(), atFrame: z.number().int().nonnegative() })).max(100).default([]),
});
const Read = z.object({ path: z.string() });
const Write = Read.extend({ content: z.string().max(10_000_000), encoding: z.enum(["utf8", "base64"]).default("utf8") });
const Preview = z.object({ frames: z.array(z.number().int().nonnegative()).max(12).optional() });
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
  await writeContext(`${shotRoot}/brief.json`, { originalBrief: ctx.series.idea, templateBrief, availableFonts: Object.keys(fonts), production, show: inputs.show, timeline, shot: inputs.shot, durationFrames: brief.durationFrames, words, feedback: inputs.feedback });
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
    const manifest = Manifest.parse(JSON.parse(await readFile(await workspacePath(root, manifestPath), "utf8")));
    if (inputs.shot.characters.length && !manifest.sourceFiles.some((path) => path.startsWith("shared/"))) throw Error("Characters must use a reusable shared design file from shared/");
    const sources = await Promise.all(manifest.sourceFiles.map(async (path) => {
      if (!ownFile(path) || extname(path) !== ".js") throw Error("Source files must be .js files under shared/ or this shot");
      return `// ${path}\n${await readFile(await workspacePath(root, path), "utf8")}`;
    }));
    const designSources=Object.fromEntries(await Promise.all(manifest.sourceFiles.filter(path=>path.startsWith("shared/")).map(async path=>[path,hash(await readFile(await workspacePath(root,path)))])));
    const assets: Record<string, string> = {};
    for (const [id, path] of Object.entries(manifest.assets)) {
      const mime = ({ ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" } as Record<string, string>)[extname(path)];
      if (!ownFile(path) || !mime) throw Error("Images must be PNG/JPEG/WebP files within this workspace");
      assets[id] = `data:image/${mime};base64,${(await readFile(await workspacePath(root, path))).toString("base64")}`;
    }
    const spec = SceneSpec.parse({ shotId: inputs.shot.id, durationFrames: brief.durationFrames, format: production.format, background: { id: inputs.shot.location }, actors: [], captions: [], canvas: { version: 1, source: sources.join("\n"), cast: manifest.cast, cues: manifest.cues, assets, fonts, designSources } });
    const issues = validateScene(spec, { brief, bible: inputs.bible, catalog: ctx.catalog });
    if (issues.length) throw Error(JSON.stringify(issues));
    return spec;
  };
  let previews = 0;
  let reviewedHash: string | undefined;
  const serial = new Semaphore(1);
  const tool = (name: string, description: string, schema: z.ZodType, call: (args: unknown) => Promise<{ content: ToolContent[] }>): ArtistTool => ({ name, description, inputSchema: z.toJSONSchema(schema, { io: "input", target: "draft-07" }), call: async (args) => serial.run(async () => {
    ctx.signal.throwIfAborted();
    try { return await call(args); } catch (error) { await audit({ tool: name, error: error instanceof Error ? error.message : String(error) }); throw error; }
  }) });
  const tools: ArtistTool[] = [
    tool("list_files", "List saved artwork and earlier shots. Reuse shared character designs.", z.object({}), async () => text(await list(root))),
    tool("read_file", "Read a UTF-8 source/manifest/design/brief file within the artist workspace.", Read, async (args) => {
      const { path } = Read.parse(args); const file = await workspacePath(root, path);
      const bytes = await readFile(file); if (bytes.length > 150_000) throw Error("Read is limited to 150 KB text files");
      return text(bytes.toString("utf8"));
    }),
    tool("write_file", "Create/edit JS canvas artwork, JSON manifests/design notes, or base64 PNG/JPEG/WebP assets. No shell or outside files. Shared designs freeze after the first accepted shot.", Write, async (args) => {
      const { path, content, encoding } = Write.parse(args);
      const version=path.startsWith("shared/versions/") && !await lstat(await workspacePath(root,path)).then(()=>true,()=>false);
      if (!ownFile(path) || path.endsWith("/brief.json") || (!path.startsWith(`${shotRoot}/`) && locked && !version)) throw Error("Write only this shot's files; approved shared files are read-only. Publish new shared designs under shared/versions/ with a new name.");
      if (!/\.(js|json|md|png|jpg|jpeg|webp)$/.test(path)) throw Error("Unsupported artist file extension");
      if ((await list(root)).filter((file) => !/^(previews|checks|history)\//.test(file)).length > 180) throw Error("Artist workspace file limit reached");
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
  ];
  return { root, manifestPath, tools, assemble, reviewed: (spec: SceneSpec) => reviewedHash === hash(JSON.stringify(spec)), beginAttempt: () => { previews = 0; reviewedHash = undefined; }, audit, freezeShared: async () => {
    if (!locked) await writeFile(lockPath, JSON.stringify({ files: (await list(root)).filter((path) => path.startsWith("shared/") || path.startsWith("assets/")) }));
  } };
}
