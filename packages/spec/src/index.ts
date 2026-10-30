// @moco/spec — the single contract between engine, AI and renderer.
// Every artifact the AI writes or the renderer reads is described here.
// Kit-specific rules (valid action names, etc.) are NOT here: they live in the
// engine's semantic validator, fed by the kit catalog, so new packs need no spec release.
import * as z from "zod";

// Bump on any schema change; breaking changes also need a migration (see migrations below).
//   0.2.0: SceneActor.idle, VoiceoverTrack.visemes, SceneSpec.visemes / timeOfDay / atmosphere / grade / finish,
//          CameraMove "focus_on" + castId, SeriesBible.style.grade. All additive with defaults: old data parses as-is.
export const SPEC_VERSION = "0.2.0";

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

export const ScriptLine = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  beat: z.string(),
  speaker: z.string().default("narrator"),
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

export const SceneSpec = z.object({
  shotId: z.string(),
  durationFrames: z.number().int().positive(),
  background: z.object({ id: z.string(), parallax: z.boolean().default(true) }),
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
  grade: z.string().default("none"), // the series grade, copied from the bible
  finish: z.object({ vignette: z.boolean().default(true), grain: z.boolean().default(true) }).default({ vignette: true, grain: true }),
});
export type SceneSpec = z.infer<typeof SceneSpec>;

// What the AI is asked to write: a SceneSpec minus the fields the engine fills in.
export const AiSceneSpec = SceneSpec.omit({ visemes: true, grade: true, finish: true });

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

// ---------- Registry ----------

// Every artifact kind the engine can store, by name. Meta.kind is one of these keys.
export const ArtifactSchemas = {
  SeriesPlan,
  SeriesBible,
  SeriesMemory,
  EpisodeScript,
  VoiceoverTrack,
  ShotList,
  SceneSpec,
  RenderReport,
} as const;
export type ArtifactKind = keyof typeof ArtifactSchemas;
export type ArtifactData<K extends ArtifactKind> = z.infer<(typeof ArtifactSchemas)[K]>;

// JSON Schema handed to the AI backend's structured-output flag.
// `io: "input"` makes fields with defaults optional, which is what the AI may omit.
// draft-07 because Claude Code's --json-schema validator rejects the draft-2020-12 meta-schema (verified on 2.1.312).
export function toAiJsonSchema(schema: z.ZodTypeAny): object {
  return z.toJSONSchema(schema, { io: "input", target: "draft-07" }) as object;
}
