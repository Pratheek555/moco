// The catalog is what the engine validates AI specs against, so it must be internally consistent.
import { describe, expect, it } from "vitest";
import { REQUIRED_LAYERS, VISEMES } from "../src/art/template.ts";
import { buildCatalog } from "../src/build-catalog.ts";
import { registry } from "../src/components.ts";
import { catalog, type CatalogCharacter } from "../src/index.ts";

it("catalog.json matches the component registry (run `pnpm --filter @moco/kit catalog` if not)", () => {
  expect(catalog).toEqual(buildCatalog(registry));
});

describe("catalog validation", () => {
  it("has unique ids in every section", () => {
    const sections = [catalog.characters, catalog.props, catalog.backgrounds, catalog.fx];
    const duplicated = sections.map((entries) => entries.map((entry) => entry.id)).filter((ids) => new Set(ids).size !== ids.length);
    expect(duplicated).toEqual([]);
  });

  it.each(catalog.characters.map((character) => [character.id, character] as const))("%s is consistent", (_id, character) => {
    expect(problems(character)).toEqual([]);
  });

  it("has sane background and fx entries", () => {
    const badBackgrounds = catalog.backgrounds.filter((background) => {
      const depths = background.layers.map((layer) => layer.depth);
      const sorted = depths.every((depth, index) => index === 0 || depth >= depths[index - 1]!);
      const inRange = depths.every((depth) => depth >= 0 && depth <= 1);
      return background.layers.length < 3 || background.layers.length > 5 || !sorted || !inRange || background.timeOfDay.length === 0;
    });
    expect(badBackgrounds).toEqual([]); // 3–5 layers, far to near, depth 0..1
    expect(catalog.grades).toContain("none");
    expect(catalog.fx.filter((fx) => !(fx.maxDurationFrames > 0))).toEqual([]);
  });
});

// Every rule a character entry must follow, as readable problem strings.
function problems(character: CatalogCharacter): string[] {
  const found: string[] = [];
  const actionNames = character.actions.map((action) => action.name);
  if (new Set(actionNames).size !== actionNames.length) found.push("duplicate action names");
  if (character.actions.some((action) => !Number.isInteger(action.minFrames) || action.minFrames < 1)) found.push("minFrames must be a whole number ≥ 1");
  if (character.actions.some((action) => Object.values(action.params ?? {}).some((values) => values.length === 0))) found.push("a param allows no values");
  if (!character.expressions.includes("neutral")) found.push('expressions must include "neutral"');
  if (character.variants.length === 0) found.push("needs at least one variant");
  if (character.angles[0] !== "front") found.push('angles must start with "front"');

  const knownVisemes = new Set<string>(VISEMES);
  if (character.visemes.some((viseme) => !knownVisemes.has(viseme))) found.push("unknown viseme");
  if (actionNames.includes("speak") && character.visemes.length < VISEMES.length) found.push("speak needs every viseme");

  // Layered characters: the full template (hands included) and one mouth per expression.
  if (character.layers.length > 0) {
    const layers = new Set(character.layers);
    const needed = [...REQUIRED_LAYERS, ...character.expressions.map((expression) => `mouth_${expression}`)];
    const missing = needed.filter((layer) => !layers.has(layer));
    if (missing.length > 0) found.push(`missing layers ${missing.join(", ")}`);
  }

  const idle = character.idle;
  if (!(idle.blinkMinSeconds > 0 && idle.blinkMinSeconds < idle.blinkMaxSeconds)) found.push("blink interval must be 0 < min < max");
  if (!(idle.blinkFrames >= 2 && idle.blinkFrames <= 6)) found.push("blinkFrames must be 2–6");
  if (!(idle.breathPeriodFrames > 0 && idle.swayPeriodFrames > 0)) found.push("idle periods must be positive");
  if (!(idle.breathAmount >= 0 && idle.breathAmount <= 0.05)) found.push("breathAmount must be 0–0.05");
  if (!(idle.secondaryDelayFrames >= 0)) found.push("secondaryDelayFrames must be ≥ 0");
  return found;
}
