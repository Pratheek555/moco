import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CharacterLibrary, CharacterRig } from "@moco/spec";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { hashData } from "../store/hash.ts";
import { assertSafeId } from "../store/workspace.ts";
import { EngineError } from "../errors.ts";
import { workspacePath } from "./paths.ts";
import { readArtwork } from "./manifest.ts";

type Context = Pick<StageContext, "dir" | "store">;
export type CharacterSelection = Record<string, string>;
export const characterLibraryFile = "artifacts/characters/library.json";
export function characterRigFile(castId: string, version: string) {
  assertSafeId(castId, "character id");
  if (!/^[a-f0-9]{64}$/.test(version)) throw new EngineError("validation_failed", "Invalid character version");
  return `artifacts/characters/${castId}/${version}.json`;
}
export const rigVersion = ({ castId, sources, assets, notes }: CharacterRig) => hashData({ castId, sources, assets, notes });
export async function readCharacterLibrary(ctx: Context): Promise<CharacterLibrary> {
  return ctx.store.has(characterLibraryFile) ? (await ctx.store.read(characterLibraryFile, "CharacterLibrary")).data : { characters: [] };
}
export async function readCharacterRig(ctx: Context, castId: string, version: string): Promise<CharacterRig> {
  const rig = (await ctx.store.read(characterRigFile(castId, version), "CharacterRig")).data;
  if (rig.castId !== castId || rigVersion(rig) !== version) throw new EngineError("modified_externally", "Character version does not match its saved artwork");
  const library = await readCharacterLibrary(ctx);
  if (!library.characters.some(c => c.castId === castId && c.versions.includes(version))) throw new EngineError("stage_blocked", "This character version has not been approved for reuse");
  return rig;
}

// Existing scenes keep their pins, including legacy/original artwork. Updating
// the preferred version changes only new shots, never an existing episode.
export async function selectCharacterRigs(ctx: Context, episodeId: string, shotId: string, cast: string[]): Promise<CharacterSelection> {
  if (ctx.store.has(files.shotSpec(episodeId, shotId))) {
    const spec = (await ctx.store.read(files.shotSpec(episodeId, shotId), "SceneSpec")).data;
    return Object.fromEntries(Object.entries(spec.canvas?.characterRigs ?? {}).filter(([id]) => cast.includes(id)));
  }
  const library = await readCharacterLibrary(ctx);
  return Object.fromEntries(library.characters.filter(c => cast.includes(c.castId)).map(c => [c.castId, c.activeVersion]));
}

export interface CharacterSummary {
  castId: string;
  activeVersion: string;
  versions: { version: string; provenance: CharacterRig["provenance"]; dependants: { episodeId: string; shotId: string }[] }[];
}
export async function listCharacters(ctx: Context): Promise<CharacterSummary[]> {
  const library = await readCharacterLibrary(ctx);
  const dependencies = new Map<string, { episodeId: string; shotId: string }[]>();
  // Use the artifact index, not mutable workspace files or a previous-episode copy.
  // Older shots without explicit pins remain original artwork.
  for (const c of library.characters) for (const version of c.versions) dependencies.set(`${c.castId}/${version}`, []);
  // Enumerate shots through the persisted series plan; partial episodes are allowed.
  if (ctx.store.has(files.seriesPlan)) {
    const plan = (await ctx.store.read(files.seriesPlan, "SeriesPlan")).data;
    for (const episode of plan.episodes) {
      if (!ctx.store.has(files.shotList(episode.id))) continue;
      for (const shot of (await ctx.store.read(files.shotList(episode.id), "ShotList")).data.shots) {
        if (!ctx.store.has(files.shotSpec(episode.id, shot.id))) continue;
        const spec = (await ctx.store.read(files.shotSpec(episode.id, shot.id), "SceneSpec")).data;
        for (const [id, version] of Object.entries(spec.canvas?.characterRigs ?? {})) dependencies.get(`${id}/${version}`)?.push({ episodeId: episode.id, shotId: shot.id });
      }
    }
  }
  return Promise.all(library.characters.map(async c => ({ ...c, versions: await Promise.all(c.versions.map(async version => ({
    version, provenance: (await readCharacterRig(ctx, c.castId, version)).provenance, dependants: dependencies.get(`${c.castId}/${version}`) ?? [],
  }))) })));
}

export async function saveCharacter(ctx: Context, episodeId: string, shotId: string, castId: string, sceneHash: string) {
  assertSafeId(castId, "character id");
  const saved = await ctx.store.read(files.shotSpec(episodeId, shotId), "SceneSpec");
  if (saved.meta.contentHash !== sceneHash) throw new EngineError("gate_mismatch", "The shot changed. Review its current artwork before saving the character.");
  if (!saved.data.canvas?.cast.includes(castId)) throw new EngineError("validation_failed", "This character is not declared in the shot");
  const critique = await ctx.store.read(files.critique(episodeId), "Critique");
  const quality = critique.data.quality;
  if (!quality || quality.status !== "passed" || quality.sceneHashes[shotId] !== sceneHash || quality.voiceoverHash !== ctx.store.hashOf(files.voiceover(episodeId)) || quality.shotListHash !== ctx.store.hashOf(files.shotList(episodeId)) || Object.entries(quality.sceneHashes).some(([id, h]) => ctx.store.hashOf(files.shotSpec(episodeId, id)) !== h)) {
    throw new EngineError("stage_blocked", "Review the current cut successfully before saving a character for reuse");
  }
  const root = join(ctx.dir, "episodes", episodeId, "artist");
  const artwork = await readArtwork(ctx, root, shotId, saved.data.canvas.characterRigs ?? {});
  // Mutable authoring files are never assumed to be the artwork the user saw.
  if (artwork.source !== saved.data.canvas.source || hashData(artwork.assets) !== hashData(saved.data.canvas.assets) || hashData(artwork.designSources) !== hashData(saved.data.canvas.designSources ?? {})) {
    throw new EngineError("gate_mismatch", "The editable artwork differs from the reviewed shot. Regenerate and review it before saving.");
  }
  const notesPath = await workspacePath(root, "shared/design.md");
  const notes = await readFile(notesPath, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return ""; throw e; });
  const report = JSON.parse(await readFile(await workspacePath(ctx.dir, quality.report), "utf8"));
  const rig = CharacterRig.parse({ castId, sources: artwork.sharedSources, assets: artwork.assets, notes,
    provenance: { episodeId, shotId, sceneHash, backend: saved.meta.backend, approvedAt: new Date().toISOString(), review: {
      report: quality.report, reportHash: hashData(report), critiqueHash: critique.meta.contentHash,
      requirements: critique.data.shots.find(s => s.shotId === shotId)?.requirements ?? [],
      limitation: "Approval records this character in the source shot. Sampled frames and model verdicts do not certify continuous motion, contact, or every future gesture.",
    } },
  });
  const version = rigVersion(rig), file = characterRigFile(castId, version);
  const library = await readCharacterLibrary(ctx);
  const entry = library.characters.find(c => c.castId === castId);
  // Validate limits before writing anything. Repeat saves are idempotent.
  const next = CharacterLibrary.parse({ characters: entry ? library.characters.map(c => c === entry ? { ...c, activeVersion: version, versions: [...new Set([...c.versions, version])] } : c) : [...library.characters, { castId, activeVersion: version, versions: [version] }] });
  if (!ctx.store.has(file)) await ctx.store.save(file, "CharacterRig", rig, { producedBy: "human", inputs: [ctx.store.inputRef(files.shotSpec(episodeId, shotId)), ctx.store.inputRef(files.critique(episodeId))] });
  else if (rigVersion((await ctx.store.read(file, "CharacterRig")).data) !== version) throw new EngineError("modified_externally", "Saved character version changed");
  await ctx.store.save(characterLibraryFile, "CharacterLibrary", next, { producedBy: "human" });
  return { castId, version };
}
