// The catalog is generated from the registry, so it can never offer something the kit doesn't draw.
import { layerNames, visemesOf } from "./art/load.ts";
import { KIT_VERSION, type CharacterDef } from "./define.ts";
import type { Catalog } from "./index.ts";
import type { Registry } from "./components.ts";

export function buildCatalog(registry: Registry): Catalog {
  return {
    kitVersion: KIT_VERSION,
    characters: registry.characters.map(catalogCharacter),
    props: registry.props.map((prop) => ({ id: prop.id, attachPoints: prop.attachPoints })),
    backgrounds: registry.backgrounds.map((background) => ({
      id: background.id,
      layers: background.layers.map((layer) => ({ id: layer.id, depth: layer.depth })),
      timeOfDay: background.timeOfDay,
    })),
    fx: registry.fx.map((fx) => ({ id: fx.id, maxDurationFrames: fx.maxDurationFrames })),
    atmosphere: registry.atmospheres.map((atmosphere) => ({ id: atmosphere.id, placement: atmosphere.placement })),
    grades: registry.grades.map((grade) => grade.id),
  };
}

function catalogCharacter(character: CharacterDef): Catalog["characters"][number] {
  const front = character.art?.front;
  return {
    id: character.id,
    packs: character.packs,
    variants: character.variants,
    // shows/hides are drawing details, not something the AI chooses
    actions: character.actions.map((action) => ({ name: action.name, minFrames: action.minFrames, ...(action.params ? { params: action.params } : {}) })),
    expressions: character.expressions,
    visemes: front ? visemesOf(front) : [],
    layers: front ? layerNames(front) : [],
    angles: character.art ? Object.keys(character.art) : ["front"],
    idle: character.idle,
    anchors: { defaultScale: character.defaultScale },
  };
}
