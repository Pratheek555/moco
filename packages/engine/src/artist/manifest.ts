import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import * as z from "zod";
import type { StageContext } from "../pipeline/context.ts";
import { workspacePath } from "./paths.ts";
import { readCharacterRig, type CharacterSelection } from "./characters.ts";

export const Manifest = z.object({
  sourceFiles: z.array(z.string()).min(1).max(12),
  cast: z.array(z.string()).max(20),
  assets: z.record(z.string(), z.string()).default({}),
  cues: z.array(z.object({ id: z.string(), atFrame: z.number().int().nonnegative() })).max(100).default([]),
  characterRigs: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
});
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export async function readArtwork(ctx: Pick<StageContext, "store" | "dir">, root: string, shotId: string, defaults: CharacterSelection) {
  const shotRoot = `shots/${shotId}/`;
  const ownFile = (path: string) => path.startsWith(shotRoot) || path.startsWith("shared/") || path.startsWith("assets/");
  const manifest = Manifest.parse(JSON.parse(await readFile(await workspacePath(root, `${shotRoot}scene.json`), "utf8")));
  const characterRigs = manifest.characterRigs ?? defaults;
  const sharedSources: { path: string; code: string }[] = [], sources: { path: string; code: string }[] = [];
  const assets: Record<string, string> = {};
  const addShared = (source: { path: string; code: string }) => {
    const previous = sharedSources.find(s => s.path === source.path);
    if (previous && previous.code !== source.code) throw Error(`Conflicting shared character source ${source.path}. Use compatible rig versions or give their sources distinct names.`);
    if (!previous) { sharedSources.push(source); sources.push(source); }
  };
  for (const [castId, version] of Object.entries(characterRigs)) {
    if (!manifest.cast.includes(castId)) throw Error(`Reusable character ${castId} is not in this shot's cast`);
    const rig = await readCharacterRig(ctx, castId, version);
    rig.sources.forEach(addShared);
    for (const [id, data] of Object.entries(rig.assets)) {
      if (assets[id] && assets[id] !== data) throw Error(`Conflicting character image ${id}`);
      assets[id] = data;
    }
  }
  // Reusable character code is composed first; shot drawing follows. Duplicate
  // shared files with the same bytes are included once.
  for (const path of manifest.sourceFiles) {
    if (!ownFile(path) || extname(path) !== ".js") throw Error("Source files must be .js files under shared/ or this shot");
    const source = { path, code: await readFile(await workspacePath(root, path), "utf8") };
    if (path.startsWith("shared/")) addShared(source); else sources.push(source);
  }
  for (const [id, path] of Object.entries(manifest.assets)) {
    const mime = ({ ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" } as Record<string, string>)[extname(path)];
    if (!ownFile(path) || !mime) throw Error("Images must be PNG/JPEG/WebP files within this workspace");
    const data = `data:image/${mime};base64,${(await readFile(await workspacePath(root, path))).toString("base64")}`;
    if (assets[id] && assets[id] !== data) throw Error(`Image ${id} would overwrite an approved character image`);
    assets[id] = data;
  }
  const source = sources.map(s => `// ${s.path}\n${s.code}`).join("\n");
  const designSources = Object.fromEntries(sharedSources.map(s => [s.path, hash(s.code)]));
  return { manifest, source, assets, sharedSources, designSources, characterRigs };
}
