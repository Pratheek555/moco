// Character art loader: reads an illustrator's layered SVG (named <g id="…"> groups plus hidden pivot markers)
// and returns each layer's markup and each pivot's position. It fails loudly, with a typed error,
// on anything the rig can't use: a missing layer or pivot, nested layers, unsafe or slow SVG features.
// Runs at build time (`pnpm --filter @moco/kit catalog`), never on AI output.
import { CANVAS, OPTIONAL_PIVOTS, REQUIRED_LAYERS, REQUIRED_PIVOTS, isLayerName, splitLayerId } from "./template.ts";

export interface Point {
  x: number;
  y: number;
}

export interface CharacterArt {
  layers: Record<string, string>; // layer id ("torso", "garment_upper--charioteer") → SVG markup in canvas coordinates
  pivots: Record<string, Point>; // pivot name ("neck") → position in canvas coordinates
}

// Any problem with an art file. `source` is the file it came from.
export class ArtError extends Error {
  readonly source: string;

  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.source = source;
  }
}

// The art is missing layers or pivots the rig needs. `missing` lists them ("eyelid_L", "pivot_neck").
export class MissingLayerError extends ArtError {
  readonly missing: string[];

  constructor(source: string, missing: string[]) {
    super(source, `missing ${missing.join(", ")} (see docs/kit-asset-spec.md)`);
    this.missing = missing;
  }
}

// SVG features the kit refuses. Scripts and external references are unsafe in a file that came from outside.
// Filters, gradients, masks, clip paths and images are slow to draw on every frame (bake them into flat shapes
// instead), and anything referenced by id clashes when two copies of a character are on screen.
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /<script\b/i, reason: "scripts are not allowed" },
  { pattern: /<foreignObject\b/i, reason: "foreignObject is not allowed" },
  { pattern: /\son[a-z]+\s*=/i, reason: "event handler attributes are not allowed" },
  { pattern: /\bhref\s*=/i, reason: "links and <use> references are not allowed" },
  { pattern: /<style\b|\sstyle\s*=/i, reason: "CSS is not allowed; use presentation attributes (fill=, stroke=)" },
  { pattern: /<image\b/i, reason: "embedded images are not allowed; draw vector shapes" },
  { pattern: /<filter\b|\sfilter\s*=/i, reason: "filters are not allowed (slow per frame); bake the effect into shapes" },
  { pattern: /<(linear|radial)Gradient\b/i, reason: "gradients are not allowed (slow per frame); use flat shading shapes" },
  { pattern: /<(mask|clipPath|pattern)\b/i, reason: "masks, clip paths and patterns are not allowed" },
  { pattern: /url\(/i, reason: "url(...) references are not allowed" },
];

// One SVG tag: closing slash, tag name, attributes, self-closing slash.
// ponytail: attribute values containing ">" break this tag pattern; illustrator exports don't produce them, switch to an XML parser if one does.
const TAG = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;

export function parseCharacterArt(svg: string, source: string): CharacterArt {
  const text = svg.replace(/<!--[\s\S]*?-->/g, ""); // comments may mention forbidden words
  const forbidden = FORBIDDEN.find((rule) => rule.pattern.test(text));
  if (forbidden) throw new ArtError(source, forbidden.reason);

  const layers: Record<string, string> = {};
  const pivots: Record<string, Point> = {};
  const openGroups: { layerId?: string; start: number }[] = [];
  let insideLayer: string | undefined;

  for (const match of text.matchAll(TAG)) {
    const [whole, closing, tag, attrs, selfClosing] = match;
    const index = match.index;

    if (tag === "svg" && !closing) checkCanvas(attrs!, source);
    if (tag === "circle") readPivot(attrs!, pivots, source);
    if (tag !== "g") continue;

    if (closing) {
      const group = openGroups.pop();
      if (!group) throw new ArtError(source, "a </g> has no matching <g>");
      if (group.layerId) {
        layers[group.layerId] = withoutId(text.slice(group.start, index + whole.length));
        insideLayer = undefined;
      }
      continue;
    }

    const id = attribute(attrs!, "id");
    const isLayer = id !== undefined && isLayerName(splitLayerId(id).name);
    if (isLayer && insideLayer) throw new ArtError(source, `layer "${id}" is inside layer "${insideLayer}"; layers must not be nested`);
    if (isLayer && id in layers) throw new ArtError(source, `layer "${id}" appears twice`);

    if (selfClosing) {
      if (isLayer) layers[id] = ""; // an empty layer, e.g. a variant that hides something
      continue;
    }
    openGroups.push({ layerId: isLayer ? id : undefined, start: index });
    if (isLayer) insideLayer = id;
  }
  if (openGroups.length > 0) throw new ArtError(source, "a <g> is never closed");

  const art = { layers, pivots };
  checkVariantOverrides(art, source);
  requireLayers(art, [], source);
  return art;
}

// Throws MissingLayerError unless the art has every template layer and pivot, plus `extraLayers`
// (layers a character's own actions need, e.g. prop_flute for play_flute).
export function requireLayers(art: CharacterArt, extraLayers: string[], source: string): void {
  const names = new Set(Object.keys(art.layers).filter((id) => splitLayerId(id).variant === undefined));
  const missingLayers = [...REQUIRED_LAYERS, ...extraLayers].filter((name) => !names.has(name));
  const neededPivots = [...REQUIRED_PIVOTS, ...OPTIONAL_PIVOTS.filter((pivot) => names.has(pivot))];
  const missingPivots = neededPivots.filter((pivot) => !(pivot in art.pivots)).map((pivot) => `pivot_${pivot}`);
  const missing = [...missingLayers, ...missingPivots];
  if (missing.length > 0) throw new MissingLayerError(source, missing);
}

// ---------- what the catalog lists ----------

// Layer names without variant suffixes, sorted.
export function layerNames(art: CharacterArt): string[] {
  const names = Object.keys(art.layers).map((id) => splitLayerId(id).name);
  return [...new Set(names)].sort();
}

// Expressions are the mouth_<expression> layers the art has.
export function expressionsOf(art: CharacterArt): string[] {
  return layerNames(art).filter((name) => name.startsWith("mouth_")).map((name) => name.slice("mouth_".length));
}

export function visemesOf(art: CharacterArt): string[] {
  return layerNames(art).filter((name) => name.startsWith("viseme_")).map((name) => name.slice("viseme_".length));
}

// Variants the art has overrides for.
export function variantsOf(art: CharacterArt): string[] {
  const variants = Object.keys(art.layers).map((id) => splitLayerId(id).variant);
  return [...new Set(variants.filter((variant) => variant !== undefined))].sort();
}

// ---------- helpers ----------

function checkCanvas(attrs: string, source: string): void {
  const expected = `0 0 ${CANVAS.width} ${CANVAS.height}`;
  const viewBox = attribute(attrs, "viewBox")?.trim().split(/[\s,]+/).join(" ");
  if (viewBox !== expected) throw new ArtError(source, `viewBox must be "${expected}", got "${viewBox ?? "none"}"`);
}

// <circle id="pivot_neck" cx="200" cy="240"/> → pivots.neck. Pivots must be in canvas coordinates, so no transform.
function readPivot(attrs: string, pivots: Record<string, Point>, source: string): void {
  const id = attribute(attrs, "id");
  if (!id?.startsWith("pivot_")) return;
  if (attribute(attrs, "transform") !== undefined) throw new ArtError(source, `${id} must not have a transform`);
  const x = Number(attribute(attrs, "cx"));
  const y = Number(attribute(attrs, "cy"));
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new ArtError(source, `${id} needs numeric cx and cy`);
  pivots[id.slice("pivot_".length)] = { x, y };
}

// A "<name>--<variant>" override only makes sense if the base layer exists (it's what the other variants draw).
function checkVariantOverrides(art: CharacterArt, source: string): void {
  const overrides = Object.keys(art.layers).filter((id) => splitLayerId(id).variant !== undefined);
  const orphan = overrides.find((id) => !(splitLayerId(id).name in art.layers));
  if (orphan) throw new ArtError(source, `"${orphan}" overrides "${splitLayerId(orphan).name}", which doesn't exist`);
}

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return match ? (match[2] ?? match[3]) : undefined;
}

// Layer ids are only names for the loader; dropping them avoids duplicate ids when a character appears twice.
function withoutId(markup: string): string {
  return markup.replace(/\sid\s*=\s*("[^"]*"|'[^']*')/, "");
}
