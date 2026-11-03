// Downloads the asset library the generated worlds build with: real 3D props and PBR textures from Poly Haven
// (polyhaven.com, all CC0: free to use and ship, no attribution needed). Writes them, with an index the engine reads,
// to packages/kit/assets/library/. Run once; it skips what is already there.
//   pnpm library:setup [--models 160] [--textures 30]
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Library, LibraryModel, LibraryTexture } from "../packages/kit/src/library.ts";

const API = "https://api.polyhaven.com";
const OUT = fileURLToPath(new URL("../packages/kit/assets/library/", import.meta.url));
const arg = (name: string, fallback: number) => Number(process.argv[process.argv.indexOf(`--${name}`) + 1] || fallback) || fallback;
const MODEL_BUDGET = arg("models", 160);
const TEXTURE_BUDGET = arg("textures", 30);
const MAX_POLYS = 80_000; // a phone frame never needs more, and the renderer draws several at once

// How many of the most downloaded models to take from each category: the everyday things stories are set among.
const MODEL_CATEGORIES: Record<string, number> = {
  furniture: 18, seating: 10, table: 8, shelves: 6, bed: 2, containers: 12, props: 22, lighting: 10, dishes: 8, food: 8, books: 3,
  "potted plants": 6, plants: 6, vases: 5, flowers: 3, tools: 10, electronics: 8, appliances: 6, decorative: 10, office: 5, instrument: 3,
  "wall decoration": 4, structures: 8, buildings: 6, rocks: 6, trees: 8, nature: 6, ships: 2,
};
// Surface materials by Poly Haven texture category, a few of each.
const TEXTURE_CATEGORIES: Record<string, number> = {
  wood: 4, floor: 3, plaster: 2, brick: 3, concrete: 2, metal: 3, fabric: 3, tiles: 2, stone: 2, rock: 1, terrain: 3, roofing: 1, leather: 1, plastic: 1,
};

interface Asset { name: string; categories: string[]; tags: string[]; download_count: number; polycount?: number; dimensions?: number[]; description?: string }
interface FileEntry { url: string; size: number; md5: string; include?: Record<string, FileEntry> }

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { "User-Agent": "moco-library-setup" } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
}

async function download(entry: FileEntry, file: string): Promise<number> {
  if (existsSync(file) && createHash("md5").update(await readFile(file)).digest("hex") === entry.md5) return 0;
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`${entry.url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return bytes.length;
}

// Runs `task` over `items`, `width` at a time.
async function pool<T, R>(items: T[], width: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  }));
  return results;
}

function pick(assets: Record<string, Asset>, categories: Record<string, number>, budget: number, keep: (asset: Asset) => boolean): string[] {
  const chosen = new Set<string>();
  const ranked = Object.entries(assets).filter(([, asset]) => keep(asset)).sort((a, b) => b[1].download_count - a[1].download_count);
  for (const [category, count] of Object.entries(categories)) {
    ranked.filter(([id, asset]) => asset.categories.includes(category) && !chosen.has(id)).slice(0, count).forEach(([id]) => chosen.add(id));
  }
  return [...chosen].slice(0, budget);
}

const short = (text = "") => text.replace(/^Free \dK (model|texture)\.\s*/i, "").split(/(?<=\.)\s/)[0]!.slice(0, 140);
let bytes = 0;

const models = await json<Record<string, Asset>>("/assets?t=models");
const modelIds = pick(models, MODEL_CATEGORIES, MODEL_BUDGET, (asset) => (asset.polycount ?? 0) <= MAX_POLYS);
console.log(`models: ${modelIds.length}`);
const libraryModels = await pool(modelIds, 6, async (id): Promise<LibraryModel | undefined> => {
  try {
    const [info, files] = await Promise.all([json<Asset>(`/info/${id}`), json<{ gltf: Record<string, { gltf: FileEntry }> }>(`/files/${id}`)]);
    const gltf = files.gltf["1k"]?.gltf;
    if (!gltf) return undefined;
    const sizes = await Promise.all([download(gltf, join(OUT, "models", id, `${id}.gltf`)), ...Object.entries(gltf.include ?? {}).map(([path, entry]) => download(entry, join(OUT, "models", id, path)))]);
    bytes += sizes.reduce((total, size) => total + size, 0);
    // Poly Haven measures in Blender's axes, z up: width, depth, height.
    const [width, depth, height] = (info.dimensions ?? [1000, 1000, 1000]).map((mm) => Math.round(mm) / 1000);
    process.stdout.write(".");
    return { id, name: info.name, size: [width!, height!, depth!], tags: [...new Set([...info.categories.filter((category) => !category.startsWith("collection")), ...info.tags])].slice(0, 10), about: short(info.description) };
  } catch (err) {
    console.warn(`\n${id}: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
});

const textures = await json<Record<string, Asset>>("/assets?t=textures");
const textureIds = pick(textures, TEXTURE_CATEGORIES, TEXTURE_BUDGET, () => true);
console.log(`\ntextures: ${textureIds.length}`);
const MAPS = { diff: ["Diffuse"], nor: ["nor_gl"], rough: ["Rough", "arm"] } as const;
const libraryTextures = await pool(textureIds, 6, async (id): Promise<LibraryTexture | undefined> => {
  try {
    const [info, files] = await Promise.all([json<Asset>(`/info/${id}`), json<Record<string, Record<string, Record<string, FileEntry>>>>(`/files/${id}`)]);
    for (const [map, keys] of Object.entries(MAPS)) {
      const key = keys.find((candidate) => files[candidate]?.["1k"]?.jpg);
      if (!key) throw new Error(`no ${map} map`);
      const size = await download(files[key]!["1k"]!.jpg!, join(OUT, "textures", id, `${map}.jpg`));
      bytes += size;
    }
    process.stdout.write(".");
    const metres = (info.dimensions?.[0] ?? 2000) / 1000; // how much ground one tile covers
    return { id, name: info.name, tags: [...new Set([...info.categories, ...info.tags])].slice(0, 8), tileMetres: Math.round(metres * 100) / 100, rough: files.Rough ? "rough" : "arm" };
  } catch (err) {
    console.warn(`\n${id}: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
});

const library: Library = {
  source: "Poly Haven (polyhaven.com), CC0",
  models: libraryModels.filter((model): model is LibraryModel => model !== undefined),
  textures: libraryTextures.filter((texture): texture is LibraryTexture => texture !== undefined),
};
await writeFile(join(OUT, "index.json"), JSON.stringify(library, null, 1));
console.log(`\n${library.models.length} models, ${library.textures.length} textures, ${(bytes / 1e6).toFixed(0)} MB downloaded → ${OUT}`);
