// Regenerates the kit's generated files: `pnpm --filter @moco/kit catalog`. Tests fail if either is out of date.
//   1. art/<character>/<angle>.svg → src/characters/<character>.art.json (checked by the art loader)
//   2. src/catalog.json from the component registry
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseCharacterArt } from "./art/load.ts";

const artDir = new URL("../art/", import.meta.url);

// Only folders: macOS drops .DS_Store files next to them.
const characters = readdirSync(artDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
for (const character of characters) writeCharacterArt(character.name);

// Imported after the art is written, so the registry loads the fresh art.
const { buildCatalog } = await import("./build-catalog.ts");
const { registry } = await import("./components.ts");
writeFileSync(new URL("./catalog.json", import.meta.url), JSON.stringify(buildCatalog(registry), null, 2) + "\n");
console.log("catalog.json written");

function writeCharacterArt(character: string): void {
  const angles = readdirSync(new URL(`${character}/`, artDir)).filter((file) => file.endsWith(".svg"));
  const art = Object.fromEntries(angles.map((file) => [file.replace(/\.svg$/, ""), loadAngle(character, file)]));
  writeFileSync(new URL(`./characters/${character}.art.json`, import.meta.url), JSON.stringify(art, null, 2) + "\n");
  console.log(`${character}.art.json written (${Object.keys(art).join(", ")})`);
}

function loadAngle(character: string, file: string) {
  const svg = readFileSync(new URL(`${character}/${file}`, artDir), "utf8");
  return parseCharacterArt(svg, `art/${character}/${file}`);
}
