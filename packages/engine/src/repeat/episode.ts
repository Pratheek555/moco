// Repeat production reuses approved series decisions; it never creates a new design system.
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { nextStage } from "../pipeline/machine.ts";
import { EngineError } from "../errors.ts";
import { hashData } from "../store/hash.ts";
import { workspacePath } from "../artist/workspace.ts";

export interface RepeatReuse {
  cast: string[];
  voices: string[];
  look: string;
  rules: string[];
  format: { width: number; height: number; fps: number };
  designFiles: number;
}
export interface RepeatEpisode {
  episodeId: string;
  sourceEpisodeId: string;
  outlinePending: boolean;
  topic?: string;
  reuse: RepeatReuse;
  basis: Record<string, string>;
  sharedFiles: Record<string, string>;
  outlineHash?: string;
  memoryResultHash?: string;
  memoryScriptHash?: string;
  narrator?: { voiceId: string; backend: string }; // explicitly selected for this episode, separate from the series bible
}
export interface RepeatOffer {
  available: boolean;
  reason?: string;
  nextEpisode?: { id: string; title: string; synopsis: string };
  sourceEpisodeId?: string;
  reuse?: RepeatReuse;
}

type ReadContext = Pick<StageContext, "dir" | "store" | "ledger" | "series">;
const bytesHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const blocked = (message: string): never => { throw new EngineError("stage_blocked", message); };

async function sharedFiles(ctx: ReadContext, ep: string): Promise<Record<string, string>> {
  const root = join(ctx.dir, "episodes", ep, "artist");
  const result: Record<string, string> = {};
  const walk = async (folder: string) => {
    const path = await workspacePath(root, folder);
    const entries = await readdir(path, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return [];
      throw err;
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${folder}/${entry.name}`;
      const file = await workspacePath(root, name);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) result[name] = bytesHash(await readFile(file));
    }
  };
  await walk("shared");
  await walk("assets");
  return result;
}

export async function repeatOffer(ctx: ReadContext): Promise<RepeatOffer> {
  const unavailable = (reason: string): RepeatOffer => ({ available: false, reason });
  if (!ctx.series.production) return unavailable("Next episode reuse is available for illustrated artist series.");
  if (ctx.ledger.stage("bible").status !== "approved" || ctx.ledger.stage("series_plan").status !== "approved") return unavailable("Approve the series plan and cast first.");
  const next = nextStage(ctx.ledger, ctx.ledger.data.episodeIds);
  if (next.kind !== "finished" && !(next.kind === "run" && next.key.endsWith("/script") && ctx.ledger.stage(next.key).status === "pending")) return unavailable("Finish or resume the current episode first.");
  const index = next.kind === "finished" ? ctx.ledger.data.episodeIds.length : ctx.ledger.data.episodeIds.indexOf(next.key.split("/")[0]!);
  const sourceEpisodeId = ctx.ledger.data.episodeIds[index - 1];
  if (!sourceEpisodeId || ["final", "memory_update", "publish"].some(stage => ctx.ledger.stage(`${sourceEpisodeId}/${stage}`).status !== "done")) return unavailable("Finish the first episode before reusing the series.");
  const show = (await ctx.store.read(files.show, "ShowBible")).data;
  const savedBible = await ctx.store.read(files.bible, "SeriesBible");
  const bible = savedBible.data;
  const narrator = ctx.ledger.data.repeatEpisodes?.[sourceEpisodeId]?.narrator ?? bible.narrator;
  if (ctx.ledger.stage("bible").artifactHash !== savedBible.meta.contentHash || !savedBible.meta.inputs.some(input => input.kind === "ShowBible" && input.contentHash === ctx.store.hashOf(files.show))) return unavailable("Review and approve the current cast and visual rules before reuse.");
  const plan = (await ctx.store.read(files.seriesPlan, "SeriesPlan")).data;
  // An older final on disk is insufficient if its acceptance has since become stale.
  const quality = ctx.store.has(files.critique(sourceEpisodeId)) ? (await ctx.store.read(files.critique(sourceEpisodeId), "Critique")).data.quality : undefined;
  const shots = (await ctx.store.read(files.shotList(sourceEpisodeId), "ShotList")).data.shots;
  if (!quality || quality.status !== "passed" || quality.voiceoverHash !== ctx.store.hashOf(files.voiceover(sourceEpisodeId)) || quality.shotListHash !== ctx.store.hashOf(files.shotList(sourceEpisodeId)) || Object.keys(quality.sceneHashes).length !== shots.length || shots.some(shot => quality.sceneHashes[shot.id] !== ctx.store.hashOf(files.shotSpec(sourceEpisodeId, shot.id)))) return unavailable("The previous episode needs a current passing quality review before reuse.");
  const designs = await sharedFiles(ctx, sourceEpisodeId);
  // Verify that the editable source matches the artwork embedded in accepted scenes.
  const used = new Set<string>();
  for (const shot of shots) {
    const scene = (await ctx.store.read(files.shotSpec(sourceEpisodeId, shot.id), "SceneSpec")).data;
    for (const [path, hash] of Object.entries(scene.canvas?.designSources ?? {})) {
      if (designs[path] !== hash) return unavailable(`Approved design ${path} is missing or changed. Restore it before reuse.`);
      used.add(path);
    }
    // Image files are editable too. Compare them with accepted embedded bytes, rather than blessing edits on copy.
    if (Object.keys(scene.canvas?.assets ?? {}).length) {
      const root = join(ctx.dir, "episodes", sourceEpisodeId, "artist");
      const manifest = JSON.parse(await readFile(await workspacePath(root, `shots/${shot.id}/scene.json`), "utf8")) as { assets?: Record<string, string> };
      for (const [id, embedded] of Object.entries(scene.canvas!.assets)) {
        const path = manifest.assets?.[id];
        if (!path) return unavailable(`Approved image ${id} has no saved source. Restore it before reuse.`);
        const bytes = await readFile(await workspacePath(root, path));
        if (bytes.toString("base64") !== embedded.slice(embedded.indexOf(",") + 1)) return unavailable(`Approved image ${path} changed. Restore it before reuse.`);
      }
    }
  }
  if (!used.size) return unavailable("This episode has no saved shared character design to reuse.");
  return {
    available: true, sourceEpisodeId,
    nextEpisode: index < plan.episodes.length ? plan.episodes[index] : undefined,
    reuse: {
      cast: show.cast.map(member => member.name),
      voices: [`Narrator: ${narrator.voiceId} (${narrator.backend})`, ...show.cast.map(member => `${member.name}: ${member.voiceId ?? narrator.voiceId}`)],
      look: show.look.statement, rules: show.rules, format: ctx.series.production.format,
      designFiles: used.size,
    },
  };
}

export async function captureRepeat(ctx: ReadContext, episodeId: string, offer: RepeatOffer, topic?: string): Promise<RepeatEpisode> {
  if (!offer.available || !offer.sourceEpisodeId || !offer.reuse) blocked(offer.reason ?? "The series is not ready for reuse.");
  const sourceEpisodeId = offer.sourceEpisodeId!;
  const basis: Record<string, string> = { production: hashData(ctx.series.production) };
  for (const file of [files.show, files.bible, files.memory]) {
    if (ctx.store.has(file)) basis[file] = ctx.store.hashOf(file)!;
  }
  const shared = await sharedFiles(ctx, sourceEpisodeId);
  // Failed repair versions are not approved designs. Only carry versions referenced by accepted scenes.
  const used = new Set<string>();
  for (const shot of (await ctx.store.read(files.shotList(sourceEpisodeId), "ShotList")).data.shots) {
    const scene = (await ctx.store.read(files.shotSpec(sourceEpisodeId, shot.id), "SceneSpec")).data;
    Object.keys(scene.canvas?.designSources ?? {}).forEach(path => used.add(path));
  }
  const approved = Object.fromEntries(Object.entries(shared).filter(([path]) => !path.startsWith("shared/versions/") || used.has(path)));
  const narrator = ctx.ledger.data.repeatEpisodes?.[sourceEpisodeId]?.narrator;
  return { episodeId, sourceEpisodeId, outlinePending: Boolean(topic), ...(topic && { topic }), ...(narrator && { narrator: { ...narrator } }), reuse: offer.reuse!, basis, sharedFiles: approved };
}

// Idempotent after a stop/crash: check every file, finish the copy, then write the lock last.
export async function prepareRepeat(ctx: ReadContext, ep: string): Promise<void> {
  const repeat = ctx.ledger.data.repeatEpisodes?.[ep];
  if (!repeat) return;
  await assertRepeatBasis(ctx, ep);
  const fromRoot = join(ctx.dir, "episodes", repeat.sourceEpisodeId, "artist");
  const root = join(ctx.dir, "episodes", ep, "artist");
  await mkdir(root, { recursive: true });
  for (const [path, expected] of Object.entries(repeat.sharedFiles)) {
    const destination = await workspacePath(root, path);
    const existing = await readFile(destination).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return undefined; throw err; });
    if (existing) {
      if (bytesHash(existing) !== expected) blocked(`Reused design ${path} changed. Restore the approved file before continuing.`);
      continue;
    }
    const source = await workspacePath(fromRoot, path);
    if (bytesHash(await readFile(source)) !== expected) blocked(`Source design ${path} changed. Restore it before continuing.`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await ctx.store.writeRaw(`episodes/${ep}/artist/shared.lock.json`, { inherited: repeat.sourceEpisodeId, files: repeat.sharedFiles });
}

export async function assertRepeatBasis(ctx: ReadContext, ep: string): Promise<void> {
  const repeat = ctx.ledger.data.repeatEpisodes?.[ep];
  if (!repeat) return;
  for (const [file, hash] of Object.entries(repeat.basis)) {
    // Memory changes normally after this episode is accepted, so only pin it until its own memory update.
    if (file === files.memory && (ctx.ledger.stage(`${ep}/memory_update`).status === "done" || ctx.store.hashOf(files.memory) === repeat.memoryResultHash)) continue;
    if ((file === "production" ? hashData(ctx.series.production) : ctx.store.hashOf(file)) !== hash) blocked("The approved series rules, voices or continuity changed. Use the standard review workflow to review those changes before continuing this repeat episode.");
  }
  // Read validation catches edits that did not go through the engine ledger.
  await ctx.store.read(files.show, "ShowBible");
  await ctx.store.read(files.bible, "SeriesBible");
  if (ctx.store.has(files.memory)) await ctx.store.read(files.memory, "SeriesMemory");
}

export function repeatScriptHash(ctx: Pick<ReadContext, "ledger">, ep: string, scriptHash: string): string {
  const repeat = ctx.ledger.data.repeatEpisodes?.[ep];
  return repeat ? hashData({ scriptHash, outlineHash: repeat.outlineHash, basis: repeat.basis, sharedFiles: repeat.sharedFiles, ...(repeat.narrator && { narrator: repeat.narrator }) }) : scriptHash;
}
