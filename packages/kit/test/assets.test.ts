import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { KIT_ASSETS_DIR } from "../src/assets.ts";
import { bakedAssets } from "../src/bake/assets.ts";
import { encodePng } from "../src/bake/png.ts";
import { registry } from "../src/components.ts";
import { finish, timesOfDay } from "../src/looks.ts";

it("baked assets on disk are current and reproducible (run `pnpm --filter @moco/kit bake` if not)", () => {
  const stale = Object.entries(bakedAssets()).filter(([path, image]) => {
    const file = join(KIT_ASSETS_DIR, path);
    return !existsSync(file) || !readFileSync(file).equals(encodePng(image));
  });
  expect(stale.map(([path]) => path)).toEqual([]);
});

it("every asset the kit refers to exists, and none is over the 5 MB limit", () => {
  const referenced = [
    ...registry.atmospheres.map((atmosphere) => atmosphere.asset),
    ...registry.grades.flatMap((grade) => (grade.asset ? [grade.asset] : [])),
    ...registry.backgrounds.flatMap((background) => background.layers).flatMap((layer) => Object.values(layer.image ?? {})),
    ...Object.values(timesOfDay).flatMap((time) => (time.tint ? [time.tint] : [])),
    finish.vignette.asset,
    ...finish.grain.assets,
  ];
  const missing = referenced.filter((path) => !existsSync(join(KIT_ASSETS_DIR, path)));
  expect(missing).toEqual([]);
  const tooBig = referenced.filter((path) => readFileSync(join(KIT_ASSETS_DIR, path)).length > 5 * 1024 * 1024);
  expect(tooBig).toEqual([]);
});
