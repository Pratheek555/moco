// @moco/spec — the single contract between engine, AI and renderer.
// Every artifact the AI writes or the renderer reads is described here.
// Kit-specific rules (valid action names, etc.) are NOT here: they live in the
// engine's semantic validator, fed by the kit catalog, so new packs need no spec release.
import * as z from "zod";

// Bump on any schema change; breaking changes also need a migration (see migrations below).
//   0.2.0: SceneActor.idle, VoiceoverTrack.visemes, SceneSpec.visemes / timeOfDay / atmosphere / grade / finish,
//          CameraMove "focus_on" + castId, SeriesBible.style.grade. All additive with defaults: old data parses as-is.
//   0.3.0: PublishDefaults, PublishKit (new artifact kinds; nothing existing changed).
//   0.4.0: PublishKit.thumbnail, AiPublishCopy.thumbnail (optional: old kits parse as-is).
//   0.5.0: Generated world schema and per-series world rendering.
//   0.6.0: ScriptLine.delivery (optional performance directions; old scripts parse as-is).
export const SPEC_VERSION = "0.6.0";

// Renderer output is fixed: 1080×1920 at 30 fps (see renderer README).
export const FPS = 30;
export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;

// ---------- Envelope ----------

// One input an artifact was built from; used for staleness tracking.
export const InputRef = z.object({
  kind: z.string(),
  revision: z.number().int().nonnegative(),
  contentHash: z.string(),
});
export type InputRef = z.infer<typeof InputRef>;

export const Meta = z.object({
  kind: z.string(), // "SceneSpec", "EpisodeScript", ...
  specVersion: z.string(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  producedBy: z.enum(["ai", "human", "engine"]),
  backend: z.string().optional(), // "claude-cli", ...
  inputs: z.array(InputRef),
  contentHash: z.string(), // sha256 of canonical JSON of `data`, computed by the engine
});
export type Meta = z.infer<typeof Meta>;

// Every artifact on disk is { meta, data }.
export const Envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ meta: Meta, data });

// ---------- Generated worlds ----------
// A story the kit can't play gets its own 3D world, written by the AI as data: models built from shapes, sets,
// sky and marks to stand on. It is data and not code because the packaged app ships a prebuilt bundle, and
// because this text comes from a model: everything here is range-checked, and nothing in it can run.

const Metres = z.number().min(-2000).max(2000);
const Vec3 = z.tuple([Metres, Metres, Metres]);
const Vec2 = z.tuple([Metres, Metres]);
const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour like #a1b2c3");
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "letters, digits, - and _");
const Fraction = z.number().min(0).max(1);

export const WORLD_PATTERNS = ["plain", "noise", "stripes", "checker", "bricks", "planks", "windows", "scales"] as const;
export const WORLD_SHAPES = ["box", "sphere", "cylinder", "capsule", "torus", "lathe", "extrude", "tube"] as const;
export const WORLD_WEATHER = ["none", "rain", "snow", "dust", "embers", "fireflies", "bubbles"] as const;

// How something looks. `pattern` mixes `colour` and `colour2`; `glow` makes it give off its own light.
export const WorldSurface = z.object({
  colour: Colour,
  colour2: Colour.optional(),
  pattern: z.enum(WORLD_PATTERNS).default("plain"),
  repeat: z.number().min(0.05).max(400).default(1), // how many times the pattern fits across the shape
  rough: Fraction.default(0.7),
  metal: Fraction.default(0),
  glow: z.number().min(0).max(12).default(0),
  opacity: Fraction.default(1),
});
export type WorldSurface = z.infer<typeof WorldSurface>;

// One shape of a model. Parts are a flat list joined by `parent`; `at` is where the part hinges on its parent,
// and `offset` moves the shape away from that hinge, so an arm swings from the shoulder and not its middle.
export const WorldPart = z.object({
  id: Id,
  parent: Id.nullish().transform((parent) => parent ?? undefined), // models write null for "no parent" as often as they leave it out
  shape: z.enum(WORLD_SHAPES),
  size: Vec3, // width, height, depth in metres. lathe, extrude and tube: a scale on their points, except tube's radius in x
  surface: Id,
  at: Vec3.default([0, 0, 0]),
  turn: Vec3.default([0, 0, 0]), // degrees
  offset: Vec3.default([0, 0, 0]),
  taper: z.number().min(0).max(4).default(1), // cylinder: top radius over bottom radius; 0 is a cone
  round: Fraction.default(0.15), // box: how soft the edges are
  profile: z.array(Vec2).min(3).max(32).optional(), // lathe: [radius, height] points, turned around the y axis
  outline: z.array(Vec2).min(3).max(48).optional(), // extrude: [x, y] points of a flat shape, pushed out by size z
  path: z.array(Vec3).min(2).max(24).optional(), // tube: points the tube runs through; hair, tails, tentacles, pipes
  spin: Vec3.optional(), // degrees per second, always on: wheels, rotors
  blinks: z.boolean().default(false), // an eye: it shuts now and then
});
export type WorldPart = z.infer<typeof WorldPart>;

// A named motion: poses at moments from 0 to 1 through the action, by part id, added to each part's rest turn.
export const WorldMove = z.object({
  name: Id,
  minFrames: z.number().int().min(4).max(600).default(24),
  loop: z.boolean().default(false), // repeats every minFrames while the action runs, like a walk
  keys: z.array(z.object({ at: Fraction, turn: z.record(Id, Vec3).default({}) })).min(2).max(12),
});
export type WorldMove = z.infer<typeof WorldMove>;

// `rig: humanoid` promises the standard joint ids and earns the built-in moves (walk, wave, kneel…).
export const WorldModel = z.object({
  id: Id,
  rig: z.enum(["none", "humanoid"]).default("none"),
  height: z.number().positive().max(2000), // metres, the camera frames by it
  surfaces: z.record(Id, WorldSurface),
  parts: z.array(WorldPart).min(1).max(160),
  moves: z.array(WorldMove).max(12).default([]),
});
export type WorldModel = z.infer<typeof WorldModel>;

// One location of the world.
export const WorldLocation = z.object({
  id: Id,
  hint: z.string().min(1), // what is here, for the AI directing shots
  sky: z.object({
    top: Colour,
    middle: Colour,
    horizon: Colour,
    sunAzimuth: z.number().min(-360).max(360), // degrees, 0 is along +z, the side cameras usually stand on
    sunElevation: z.number().min(-10).max(90),
    sunColour: Colour,
    sunStrength: z.number().min(0).max(10),
    fill: z.number().min(0).max(6), // light from everywhere
    fog: Colour,
    fogDensity: z.number().min(0).max(0.2),
    stars: z.boolean().default(false),
  }),
  ground: z.object({
    kind: z.enum(["land", "water", "none"]), // none: deep space, or a set that is its own floor
    surface: WorldSurface,
    hills: z.number().min(0).max(120).default(0), // metres of relief beyond 50 m from the middle
  }),
  set: z.array(z.object({ model: Id, at: Vec3, turn: Metres.default(0), scale: z.number().positive().max(100).default(1) })).max(160).default([]),
  scatter: z.array(z.object({ model: Id, count: z.number().int().min(1).max(800), near: z.number().min(0).max(1500), far: z.number().min(1).max(1800), scaleMin: z.number().positive().max(40).default(0.8), scaleMax: z.number().positive().max(40).default(1.3) })).max(10).default([]),
  lamps: z.array(z.object({ at: Vec3, colour: Colour, strength: z.number().min(0).max(4000), reach: z.number().min(1).max(300) })).max(8).default([]),
  weather: z.enum(WORLD_WEATHER).default("none"),
  marks: z.array(z.object({ id: Id, hint: z.string().min(1), at: Vec3, facing: Metres.default(0) })).min(1).max(12), // where shots happen
});
export type WorldLocation = z.infer<typeof WorldLocation>;

export const World = z.object({
  models: z.array(WorldModel).min(1).max(40),
  locations: z.array(WorldLocation).min(1).max(8),
  cast: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase with dashes"), model: Id, description: z.string() })).min(1),
});
export type World = z.infer<typeof World>;

// ---------- Series level ----------

export const SeriesPlan = z.object({
  title: z.string().min(1),
  language: z.string().min(1),
  premise: z.string().min(1),
  episodes: z
    .array(z.object({ id: z.string().min(1), title: z.string().min(1), synopsis: z.string().min(1) }))
    .min(1),
});
export type SeriesPlan = z.infer<typeof SeriesPlan>;

export const CastMember = z.object({
  id: z.string().min(1), // story id, e.g. "krishna"
  kitCharacterId: z.string().min(1), // must exist in the kit catalog (checked by the engine)
  variant: z.string().optional(), // costume/age variant in the kit
  description: z.string(),
});
export type CastMember = z.infer<typeof CastMember>;

export const SeriesBible = z.object({
  cast: z.array(CastMember).min(1),
  style: z.object({
    palette: z.array(z.string()),
    captionStyle: z.string(),
    mood: z.string(),
    grade: z.string().default("none"), // kit colour grade for the whole series (checked against the catalog)
    timeOfDay: z.string().optional(), // every shot's time of day, so the sky can't jump between shots
  }),
  narrator: z.object({ voiceId: z.string(), backend: z.string(), language: z.string() }),
});
export type SeriesBible = z.infer<typeof SeriesBible>;

// Grows after every approved episode (harness 7).
export const ContinuityFact = z.object({
  entity: z.string().min(1), // cast id or location id
  fact: z.string().min(1),
  sinceEpisode: z.string().min(1),
});
export type ContinuityFact = z.infer<typeof ContinuityFact>;

export const SeriesMemory = z.object({
  storySoFar: z.string(),
  facts: z.array(ContinuityFact),
});
export type SeriesMemory = z.infer<typeof SeriesMemory>;

// What the AI returns after an episode is approved; merged into SeriesMemory.
export const ContinuityUpdate = z.object({
  storySoFar: z.string().min(1),
  newFacts: z.array(ContinuityFact),
});
export type ContinuityUpdate = z.infer<typeof ContinuityUpdate>;

// ---------- Episode level ----------

// Optional on old scripts. Directions are metadata, never spoken or printed in captions.
export const Delivery = z.object({
  emotion: z.enum(["neutral", "warm", "tense", "awed", "grieving", "resolute"]).default("neutral"),
  intensity: z.number().min(0).max(1).default(0.5),
  pauseAfterMs: z.number().int().min(0).max(2000).default(300),
});
export type Delivery = z.infer<typeof Delivery>;

export const ScriptLine = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  beat: z.string(),
  speaker: z.string().default("narrator"),
  delivery: Delivery.optional(),
});
export type ScriptLine = z.infer<typeof ScriptLine>;

export const EpisodeScript = z.object({
  targetSeconds: z.number().min(15).max(90),
  lines: z.array(ScriptLine).min(1),
});
export type EpisodeScript = z.infer<typeof EpisodeScript>;

export const TimedWord = z.object({
  text: z.string(),
  start: z.number().nonnegative(), // seconds
  end: z.number().nonnegative(),
  lineId: z.string(),
});
export type TimedWord = z.infer<typeof TimedWord>;

// Lip sync: the mouth shape (a kit viseme name, e.g. "X", "A"…"F") shown from `frame` until the next key.
export const VisemeKey = z.object({ frame: z.number().int().nonnegative(), viseme: z.string().min(1) });
export const VisemeTrack = z.array(VisemeKey);
export type VisemeTrack = z.infer<typeof VisemeTrack>;

export const VoiceoverTrack = z.object({
  file: z.string(),
  durationSeconds: z.number().positive(),
  words: z.array(TimedWord).min(1),
  visemes: VisemeTrack.default([]), // whole-episode frames, computed from the audio by the audio package
});
export type VoiceoverTrack = z.infer<typeof VoiceoverTrack>;

export const Shot = z.object({
  id: z.string().min(1),
  start: z.number().nonnegative(), // seconds, snapped to word boundaries
  end: z.number().positive(),
  lineIds: z.array(z.string()),
  intent: z.string().min(1),
  characters: z.array(z.string()), // bible cast ids
  location: z.string().min(1), // kit background id
  cameraHint: z.string().optional(),
});
export type Shot = z.infer<typeof Shot>;

export const ShotList = z.object({ shots: z.array(Shot).min(1) });
export type ShotList = z.infer<typeof ShotList>;

// ---------- Scene (one shot) ----------

// Normalised frame coordinates: 0..1 on both axes.
const Position = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().positive().max(2),
});

export const SceneAction = z.object({
  name: z.string(), // must exist in the character's rig (checked by the engine)
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type SceneAction = z.infer<typeof SceneAction>;

export const SceneActor = z.object({
  castId: z.string(),
  kitCharacterId: z.string(),
  variant: z.string().optional(), // set by the engine from the bible, not chosen by the AI
  position: Position,
  facing: z.enum(["left", "right"]),
  actions: z.array(SceneAction),
  expression: z.array(z.object({ name: z.string(), atFrame: z.number().int().nonnegative() })).default([]),
  idle: z.boolean().default(true), // breathing, blinking, head sway and cloth follow-through; false = hold still
});
export type SceneActor = z.infer<typeof SceneActor>;

export const CameraMove = z.object({
  move: z.enum(["static", "push_in", "pull_out", "pan_left", "pan_right", "shake", "focus_on"]),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  amount: z.number().min(0).max(1),
  castId: z.string().optional(), // focus_on only: the actor to frame (face above the caption area)
});
export type CameraMove = z.infer<typeof CameraMove>;

export const Caption = z.object({
  text: z.string(),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  emphasis: z.boolean().default(false),
});
export type Caption = z.infer<typeof Caption>;

// One model in a shot of a generated world, placed in metres from the shot's mark.
export const ScenePlayer = z.object({
  id: z.string(), // a cast id, or a model id for a thing
  model: z.string(), // the model that plays it (set by the engine for cast members)
  at: Vec3,
  to: Vec3.optional(), // where it has moved to by `arriveFrame`, for walking, flying, driving
  arriveFrame: z.number().int().positive().optional(), // default: the end of the shot
  facing: Metres.default(0), // degrees, 0 faces +z, the camera's usual side
  actions: z.array(SceneAction).default([]),
});
export type ScenePlayer = z.infer<typeof ScenePlayer>;

// A shot on a 3D stage (a background whose catalog entry has `stage`): real lenses and depth instead of layers.
export const SceneStage = z.object({
  camera: z.string(), // one of the stage's camera rigs
  place: z.string(), // where in the world the shot happens
  subject: z.string(), // who the camera follows
  // Metres the subject is ahead of the other one, at the start and end of the shot. Negative is behind, and a
  // change of sign is an overtake.
  leadStart: z.number().min(-300).max(300).default(0),
  leadEnd: z.number().min(-300).max(300).default(0),
  players: z.array(ScenePlayer).default([]), // generated worlds: who is in the shot and what they do
});
export type SceneStage = z.infer<typeof SceneStage>;

export const SceneSpec = z.object({
  shotId: z.string(),
  durationFrames: z.number().int().positive(),
  background: z.object({ id: z.string(), parallax: z.boolean().default(true) }),
  stage: SceneStage.optional(), // required on a 3D stage; actors, props and camera moves don't apply there
  actors: z.array(SceneActor),
  props: z.array(z.object({ id: z.string(), position: Position })).default([]),
  camera: z.array(CameraMove).default([]),
  captions: z.array(Caption),
  fx: z.array(z.object({ id: z.string(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() })).default([]),
  fallback: z.boolean().default(false), // true = deterministic safe shot, flagged in the UI
  timeOfDay: z.string().optional(), // a time the background supports (catalog); default: its first
  // Baked atmosphere effects (catalog ids), drawn for the whole shot. `layer` puts one just in front of that
  // background layer instead of its default place.
  atmosphere: z
    .array(z.object({ id: z.string(), intensity: z.number().min(0).max(1).default(1), layer: z.string().optional() }))
    .default([]),
  // Engine-filled, never by the AI:
  visemes: VisemeTrack.default([]), // shot frames, copied from the voiceover
  world: z.object({ location: WorldLocation, models: z.array(WorldModel) }).optional(), // a generated world: what this shot needs of it
  grade: z.string().default("none"), // the series grade, copied from the bible
  finish: z.object({ vignette: z.boolean().default(true), grain: z.boolean().default(true) }).default({ vignette: true, grain: true }),
});
export type SceneSpec = z.infer<typeof SceneSpec>;

// What the AI is asked to write: a SceneSpec minus the fields the engine fills in.
export const AiSceneSpec = SceneSpec.omit({ visemes: true, grade: true, finish: true, world: true });

// ---------- Episode assembly + render ----------

export const EpisodeSpec = z.object({
  episodeId: z.string(),
  scenes: z.array(SceneSpec).min(1),
  audio: z.object({ voiceover: z.string(), music: z.string().optional() }),
  export: z.object({ width: z.literal(FRAME_WIDTH), height: z.literal(FRAME_HEIGHT), fps: z.literal(FPS) }),
});
export type EpisodeSpec = z.infer<typeof EpisodeSpec>;

export const RenderReport = z.object({
  file: z.string(),
  quality: z.enum(["preview", "final"]),
  durationSeconds: z.number().positive(),
  kitVersion: z.string(),
  rendererVersion: z.string(),
});
export type RenderReport = z.infer<typeof RenderReport>;

// ---------- Publishing ----------
// The publish kit is everything a user pastes into YouTube Studio for one episode. The same fields
// later feed a direct videos.insert upload, so they follow the YouTube Data API's names and limits.

// Studio's category names, with the API's categoryId for each.
export const YOUTUBE_CATEGORIES = {
  "Film & Animation": "1",
  "People & Blogs": "22",
  Entertainment: "24",
  Education: "27",
  "Nonprofits & Activism": "29",
} as const;
export const YoutubeCategory = z.enum(Object.keys(YOUTUBE_CATEGORIES) as [keyof typeof YOUTUBE_CATEGORIES, ...(keyof typeof YOUTUBE_CATEGORIES)[]]);
export type YoutubeCategory = z.infer<typeof YoutubeCategory>;

// Set once per series by the user; applied to every episode's kit.
export const PublishDefaults = z.object({
  footer: z.string().max(1500).default(""), // appended to every description: channel links, a follow line
  hashtags: z.array(z.string()).max(5).default([]), // always included, before the episode's own
  madeForKids: z.boolean().default(false),
  category: YoutubeCategory.default("Entertainment"),
  secondLanguage: z.string().optional(), // e.g. "en" on a Hindi series: titles carry both
});
export type PublishDefaults = z.infer<typeof PublishDefaults>;

export const YoutubeMetadata = z.object({
  title: z.string().min(1),
  description: z.string(), // the full text as pasted: body, hashtags and footer
  tags: z.array(z.string().min(1)),
  category: YoutubeCategory,
  madeForKids: z.boolean(),
  language: z.string().min(1), // the video's language code
});
export type YoutubeMetadata = z.infer<typeof YoutubeMetadata>;

// Headline on the thumbnail: it has to read at feed size, so a few words at most.
export const THUMBNAIL_TEXT_MAX = 40;

// A still from one shot with a headline on it, rendered by the engine next to the kit.
export const PublishThumbnail = z.object({
  shotId: z.string().min(1),
  frame: z.number().int().nonnegative(), // within the shot
  text: z.string().max(THUMBNAIL_TEXT_MAX), // empty = no headline
  file: z.string().min(1), // the JPEG, relative to the series folder
});
export type PublishThumbnail = z.infer<typeof PublishThumbnail>;

export const PublishKit = z.object({ youtube: YoutubeMetadata, thumbnail: PublishThumbnail.optional() });
export type PublishKit = z.infer<typeof PublishKit>;

// What the AI writes; the engine adds the series defaults to make a PublishKit.
export const AiPublishCopy = z.object({
  youtube: z.object({
    title: z.string().min(1),
    description: z.string().min(1), // without hashtags; they go in `hashtags`
    hashtags: z.array(z.string()),
    tags: z.array(z.string()),
  }),
  // The shot that makes the best thumbnail, and a headline for it.
  thumbnail: z.object({ shotId: z.string(), text: z.string() }).optional(),
});
export type AiPublishCopy = z.infer<typeof AiPublishCopy>;

// YouTube's own limits (Data API videos resource and Studio): what Studio would refuse or silently drop.
export const YOUTUBE_LIMITS = { titleChars: 100, descriptionBytes: 5000, tagsChars: 500, hashtags: 15 } as const;

export interface PublishProblem {
  field: "title" | "description" | "tags";
  problem: string;
}

// Hashtags as YouTube reads them out of a description.
export function hashtagsIn(text: string): string[] {
  return text.match(/#[\p{L}\p{N}\p{M}_]+/gu) ?? [];
}

// Tags as Studio counts them: commas between tags, and quotes around a tag with a space.
export function tagsLength(tags: string[]): number {
  return tags.reduce((total, tag) => total + tag.length + (tag.includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

export function checkYoutube(meta: Pick<YoutubeMetadata, "title" | "description" | "tags">): PublishProblem[] {
  const problems: PublishProblem[] = [];
  const angle = /[<>]/;
  const title = [...meta.title.trim()].length;
  if (title === 0) problems.push({ field: "title", problem: "The title is empty." });
  if (title > YOUTUBE_LIMITS.titleChars) problems.push({ field: "title", problem: `The title is ${title} characters; YouTube allows ${YOUTUBE_LIMITS.titleChars}.` });
  if (angle.test(meta.title)) problems.push({ field: "title", problem: "YouTube doesn't allow < or > in titles." });
  const bytes = new TextEncoder().encode(meta.description).length;
  if (bytes > YOUTUBE_LIMITS.descriptionBytes) problems.push({ field: "description", problem: `The description is ${bytes} bytes; YouTube allows ${YOUTUBE_LIMITS.descriptionBytes}.` });
  if (angle.test(meta.description)) problems.push({ field: "description", problem: "YouTube doesn't allow < or > in descriptions." });
  const hashtags = hashtagsIn(meta.description).length;
  if (hashtags > YOUTUBE_LIMITS.hashtags) problems.push({ field: "description", problem: `${hashtags} hashtags; with more than ${YOUTUBE_LIMITS.hashtags} YouTube ignores them all.` });
  const tags = tagsLength(meta.tags);
  if (tags > YOUTUBE_LIMITS.tagsChars) problems.push({ field: "tags", problem: `Tags use ${tags} characters; YouTube allows ${YOUTUBE_LIMITS.tagsChars}.` });
  if (meta.tags.some((tag) => angle.test(tag))) problems.push({ field: "tags", problem: "YouTube doesn't allow < or > in tags." });
  return problems;
}

// ---------- Registry ----------

// Every artifact kind the engine can store, by name. Meta.kind is one of these keys.
export const ArtifactSchemas = {
  SeriesPlan,
  SeriesBible,
  SeriesMemory,
  World,
  EpisodeScript,
  VoiceoverTrack,
  ShotList,
  SceneSpec,
  RenderReport,
  PublishDefaults,
  PublishKit,
} as const;
export type ArtifactKind = keyof typeof ArtifactSchemas;
export type ArtifactData<K extends ArtifactKind> = z.infer<(typeof ArtifactSchemas)[K]>;

// JSON Schema handed to the AI backend's structured-output flag.
// `io: "input"` makes fields with defaults optional, which is what the AI may omit.
// draft-07 because Claude Code's --json-schema validator rejects the draft-2020-12 meta-schema (verified on 2.1.312).
export function toAiJsonSchema(schema: z.ZodTypeAny): object {
  return z.toJSONSchema(schema, { io: "input", target: "draft-07" }) as object;
}
