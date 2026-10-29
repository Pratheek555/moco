import { z } from 'zod';
import {
  CAMERA_MOVES,
  CAPTION_POSITIONS,
  CAPTION_STYLES,
  EASES,
  ENTER_FROM,
  EXPRESSIONS,
  LOOK_DIRECTIONS,
  MUSIC_MOODS,
  OVERLAY_KINDS,
  PARTICLE_VARIANTS,
  POSES,
  SFX,
  TIMES_OF_DAY,
  TINTS,
  TRANSITIONS,
} from './vocab.ts';

// Times are seconds relative to the start of the shot. Positions are fractions
// of the 1080×1920 frame: x=0 left edge, x=1 right edge, y=1 bottom edge.

const Seconds = z.number().min(0).max(60);
const Id = z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and dashes');
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use a #rrggbb colour');

export const PoseSchema = z.enum(POSES);
export const ExpressionSchema = z.enum(EXPRESSIONS);
export const CameraMoveSchema = z.enum(CAMERA_MOVES);
export const TransitionSchema = z.enum(TRANSITIONS);
export const TimeOfDaySchema = z.enum(TIMES_OF_DAY);
export const SfxIdSchema = z.enum(SFX);
export const MusicMoodSchema = z.enum(MUSIC_MOODS);
export const CaptionStyleSchema = z.enum(CAPTION_STYLES);
export const CaptionPositionSchema = z.enum(CAPTION_POSITIONS);

const Point = z.object({ x: z.number().min(-1).max(2), y: z.number().min(-1).max(2) });

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pose'), at: Seconds, pose: PoseSchema, duration: z.number().min(0).max(3).default(0.45) }),
  z.object({ type: z.literal('expression'), at: Seconds, expression: ExpressionSchema }),
  z.object({
    type: z.literal('move'),
    at: Seconds,
    duration: z.number().min(0.1).max(30).default(1),
    x: z.number().min(-1).max(2).optional(),
    y: z.number().min(-1).max(2).optional(),
    scale: z.number().min(0.1).max(4).optional(),
    ease: z.enum(EASES).default('smooth'),
  }),
  z.object({ type: z.literal('enter'), at: Seconds, from: z.enum(ENTER_FROM).default('fade'), duration: z.number().min(0.1).max(5).default(0.6) }),
  z.object({ type: z.literal('exit'), at: Seconds, to: z.enum(ENTER_FROM).default('fade'), duration: z.number().min(0.1).max(5).default(0.6) }),
  z.object({ type: z.literal('speak'), at: Seconds, duration: z.number().min(0.1).max(30) }),
  z.object({ type: z.literal('look'), at: Seconds, direction: z.enum(LOOK_DIRECTIONS) }),
  z.object({ type: z.literal('turn'), at: Seconds, facing: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('nod'), at: Seconds }),
]);
export type Action = z.output<typeof ActionSchema>;

export const ActorSchema = z.object({
  id: Id,
  character: Id,
  x: z.number().min(-1).max(2).default(0.5),
  /** Ground line (feet). Omit to stand on the background's ground. */
  y: z.number().min(-1).max(2).optional(),
  /** 1 = the character is ~55% of frame height. */
  scale: z.number().min(0.1).max(4).default(1),
  facing: z.enum(['left', 'right']).default('right'),
  pose: PoseSchema.default('stand'),
  expression: ExpressionSchema.default('neutral'),
  /** Prop held in the right / left hand. `none` empties a hand that holds something by default. */
  holdRight: z.string().max(48).optional(),
  holdLeft: z.string().max(48).optional(),
  /** Id of a vehicle prop in this shot to ride (e.g. a chariot); x/y become offsets on the vehicle. */
  ride: Id.optional(),
  /** Draw order; higher is in front. Defaults to y (lower on screen = in front). */
  z: z.number().min(-10).max(10).optional(),
  actions: z.array(ActionSchema).max(24).default([]),
});
export type Actor = z.output<typeof ActorSchema>;

export const PropActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move'),
    at: Seconds,
    duration: z.number().min(0.1).max(30).default(1),
    x: z.number().min(-1).max(2).optional(),
    y: z.number().min(-1).max(2).optional(),
    scale: z.number().min(0.1).max(4).optional(),
    ease: z.enum(EASES).default('smooth'),
  }),
  z.object({ type: z.literal('enter'), at: Seconds, from: z.enum(ENTER_FROM).default('fade'), duration: z.number().min(0.1).max(5).default(0.6) }),
  z.object({ type: z.literal('exit'), at: Seconds, to: z.enum(ENTER_FROM).default('fade'), duration: z.number().min(0.1).max(5).default(0.6) }),
]);

export const PropSchema = z.object({
  id: Id,
  prop: Id,
  x: z.number().min(-1).max(2).default(0.5),
  y: z.number().min(-1).max(2).optional(),
  scale: z.number().min(0.1).max(4).default(1),
  facing: z.enum(['left', 'right']).default('right'),
  /** Animate wheels, legs, flames… */
  moving: z.boolean().default(false),
  z: z.number().min(-10).max(10).optional(),
  actions: z.array(PropActionSchema).max(12).default([]),
});
export type Prop = z.output<typeof PropSchema>;

const Timed = { at: Seconds.default(0), duration: z.number().min(0.05).max(60).optional() };

export const FxSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('particles'), variant: z.enum(PARTICLE_VARIANTS).default('dust'), intensity: z.number().min(0).max(1).default(0.5), ...Timed }),
  z.object({ type: z.literal('light-rays'), color: Hex.default('#ffe9b0'), intensity: z.number().min(0).max(1).default(0.5), ...Timed }),
  z.object({ type: z.literal('aura'), target: Id, color: Hex.default('#ffd36b'), intensity: z.number().min(0).max(1).default(0.7), ...Timed }),
  z.object({ type: z.literal('divine-light'), x: z.number().min(0).max(1).default(0.5), color: Hex.default('#fff2c4'), intensity: z.number().min(0).max(1).default(0.7), ...Timed }),
  z.object({ type: z.literal('flash'), color: Hex.default('#ffffff'), at: Seconds.default(0), duration: z.number().min(0.05).max(3).default(0.5) }),
  z.object({ type: z.literal('shockwave'), ...Point.partial().shape, color: Hex.default('#ffe6a8'), at: Seconds.default(0), duration: z.number().min(0.1).max(5).default(1.2) }),
  z.object({ type: z.literal('lightning'), intensity: z.number().min(0).max(1).default(0.6), ...Timed }),
  z.object({ type: z.literal('fire'), x: z.number().min(-0.5).max(1.5).default(0.5), y: z.number().min(0).max(1.2).default(0.9), scale: z.number().min(0.1).max(4).default(1), ...Timed }),
  z.object({ type: z.literal('fog'), intensity: z.number().min(0).max(1).default(0.5), color: Hex.default('#ffffff'), ...Timed }),
  z.object({ type: z.literal('speed-lines'), intensity: z.number().min(0).max(1).default(0.6), ...Timed }),
  z.object({ type: z.literal('tint'), variant: z.enum(TINTS).default('warm'), intensity: z.number().min(0).max(1).default(0.5), ...Timed }),
  z.object({ type: z.literal('vignette'), intensity: z.number().min(0).max(1).default(0.5), ...Timed }),
  z.object({ type: z.literal('grain'), intensity: z.number().min(0).max(1).default(0.35), ...Timed }),
]);
export type Fx = z.output<typeof FxSchema>;

export const OverlaySchema = z.object({
  kind: z.enum(OVERLAY_KINDS),
  text: z.string().min(1).max(120),
  subtitle: z.string().max(160).optional(),
  at: Seconds.default(0),
  duration: z.number().min(0.3).max(60).optional(),
});
export type Overlay = z.output<typeof OverlaySchema>;

export const WordSchema = z.object({ text: z.string(), start: z.number(), end: z.number() });
export type Word = z.output<typeof WordSchema>;

/** Filled by the engine after text-to-speech; never written by the AI. */
export const VoiceSchema = z.object({
  src: z.string(),
  duration: z.number().min(0),
  words: z.array(WordSchema).default([]),
});
export type Voice = z.output<typeof VoiceSchema>;

export const ShotSchema = z.object({
  id: Id,
  /** Seconds. The engine lengthens it if the voiceover runs longer. */
  duration: z.number().min(1).max(20),
  /** What the narrator (or the speaker) says during this shot. */
  narration: z.string().max(400).default(''),
  /** Actor id whose mouth moves with the narration. Omit for an off-screen narrator. */
  speaker: Id.optional(),
  /** Caption text override; defaults to the narration. */
  caption: z.string().max(200).optional(),
  background: z.object({ id: Id, time: TimeOfDaySchema.default('day') }),
  camera: z
    .object({
      move: CameraMoveSchema.default('static'),
      intensity: z.number().min(0).max(1).default(0.5),
      /** Point the camera zooms toward, e.g. a face. */
      focus: Point.optional(),
    })
    .prefault({}),
  actors: z.array(ActorSchema).max(6).default([]),
  props: z.array(PropSchema).max(10).default([]),
  fx: z.array(FxSchema).max(10).default([]),
  sfx: z.array(z.object({ id: SfxIdSchema, at: Seconds.default(0), volume: z.number().min(0).max(2).default(1) })).max(8).default([]),
  overlay: OverlaySchema.optional(),
  /** How this shot begins (transition from the previous shot). */
  transition: TransitionSchema.default('cut'),
  voice: VoiceSchema.optional(),
});
export type Shot = z.output<typeof ShotSchema>;
export type ShotInput = z.input<typeof ShotSchema>;

export const BrandSchema = z.object({
  handle: z.string().max(40).default(''),
  watermark: z.boolean().default(true),
  progressBar: z.boolean().default(false),
  accent: Hex.default('#ffd60a'),
});
export type Brand = z.output<typeof BrandSchema>;

export const EpisodeSchema = z.object({
  id: z.string().min(1),
  seriesId: z.string().optional(),
  number: z.number().int().min(1).default(1),
  title: z.string().min(1).max(120),
  hook: z.string().max(240).default(''),
  summary: z.string().max(1200).default(''),
  language: z.string().default('en'),
  fps: z.number().int().min(12).max(60).default(30),
  shots: z.array(ShotSchema).min(1).max(40),
  music: z
    .object({
      mood: MusicMoodSchema.default('devotional'),
      volume: z.number().min(0).max(1).default(0.32),
      /** Filled by the engine. */
      src: z.string().optional(),
    })
    .prefault({}),
  captions: z
    .object({
      style: CaptionStyleSchema.default('bold'),
      position: CaptionPositionSchema.default('bottom'),
      highlight: Hex.default('#ffd60a'),
    })
    .prefault({}),
  brand: BrandSchema.prefault({}),
});
export type Episode = z.output<typeof EpisodeSchema>;
export type EpisodeInput = z.input<typeof EpisodeSchema>;

// ── Series (project-level memory) ────────────────────────────────────────────

export const EPISODE_STATUSES = ['planned', 'writing', 'scripted', 'voiced', 'rendered', 'error'] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const CastMemberSchema = z.object({
  character: Id,
  name: z.string().min(1).max(60),
  role: z.string().max(240).default(''),
});
export type CastMember = z.output<typeof CastMemberSchema>;

export const EpisodeOutlineSchema = z.object({
  number: z.number().int().min(1),
  title: z.string().min(1).max(120),
  hook: z.string().max(240).default(''),
  summary: z.string().max(1200).default(''),
  beats: z.array(z.string().max(300)).max(16).default([]),
});
export type EpisodeOutline = z.output<typeof EpisodeOutlineSchema>;

export const SeriesSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  logline: z.string().max(400).default(''),
  idea: z.string().max(4000).default(''),
  language: z.string().default('en'),
  style: z.string().max(60).default('epic'),
  secondsPerEpisode: z.number().min(10).max(120).default(45),
  setting: z.string().max(600).default(''),
  tone: z.string().max(300).default(''),
  cast: z.array(CastMemberSchema).max(12).default([]),
  episodes: z
    .array(
      EpisodeOutlineSchema.extend({
        status: z.enum(EPISODE_STATUSES).default('planned'),
        updatedAt: z.string().optional(),
      }),
    )
    .default([]),
  memory: z
    .object({
      /** One summary per written episode, in order: what happened. */
      storySoFar: z.array(z.string()).default([]),
      /** Facts that must stay consistent (names, looks, promises, running jokes). */
      notes: z.string().max(4000).default(''),
    })
    .prefault({}),
  music: MusicMoodSchema.default('devotional'),
  captions: CaptionStyleSchema.default('bold'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Series = z.output<typeof SeriesSchema>;
export type SeriesInput = z.input<typeof SeriesSchema>;
