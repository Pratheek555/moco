// Writes every baked asset to packages/kit/assets/: `pnpm --filter @moco/kit bake`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bakedAssets } from "./assets.ts";
import { encodePng } from "./png.ts";

const assetsDir = fileURLToPath(new URL("../../assets/", import.meta.url));

for (const [path, image] of Object.entries(bakedAssets())) {
  const file = join(assetsDir, path);
  mkdirSync(dirname(file), { recursive: true });
  const png = encodePng(image);
  writeFileSync(file, png);
  console.log(`${path} ${image.width}×${image.height} ${(png.length / 1024).toFixed(0)} KB`);
}
