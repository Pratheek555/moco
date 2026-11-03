// @moco/kit/library — the asset library generated worlds can build with: real props and PBR textures, downloaded
// once by `pnpm library:setup` into assets/library/ (Poly Haven, CC0). Without it the library is empty and worlds
// are built from shapes alone. Node only: the renderer finds files by id (see libraryFiles).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface LibraryModel {
  id: string;
  name: string;
  size: [number, number, number]; // real width, height, depth in metres
  tags: string[];
  about: string;
}

export interface LibraryTexture {
  id: string;
  name: string;
  tags: string[];
  tileMetres: number; // how much surface one repeat of the texture covers
  rough: "rough" | "arm"; // rough.jpg is a roughness map, or AO/roughness/metal packed (three.js reads green either way)
}

export interface Library {
  source: string;
  models: LibraryModel[];
  textures: LibraryTexture[];
}

const EMPTY: Library = { source: "", models: [], textures: [] };
let loaded: Library | undefined;

export function loadLibrary(): Library {
  if (loaded) return loaded;
  try {
    loaded = JSON.parse(readFileSync(fileURLToPath(new URL("../assets/library/index.json", import.meta.url)), "utf8")) as Library;
  } catch {
    loaded = EMPTY;
  }
  return loaded;
}
