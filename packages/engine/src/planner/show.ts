// The show bible: the series' own rules, written by the AI before anything is built (see ShowBible in @moco/spec).
// It runs at the start of the bible stage. Every later stage reads only its slice of it (a context pack), so the
// style of a series lives in its own show bible instead of in the engine's prompts. The engine keeps only the rules
// that make a reel valid: here, that the episode length and shot lengths stay inside its limits.
import { ShowBible, type SeriesPlan, type Shot } from "@moco/spec";
import type { EngineConfig } from "../config.ts";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkIds, planWithAi, previousSection } from "./common.ts";
import { readAdditions, showWithAdditions } from "../canon/merge.ts";
import { provenLessons, type NotebookEntry } from "../learn/playbook.ts";
import { imageGenerationCapability } from "../artist/permissions.ts";

export async function runShow(ctx: StageContext, plan: SeriesPlan, feedback?: string): Promise<ShowBible> {
  const limits = ctx.series.production && ctx.series.production.targetSeconds === undefined
    ? { shotSeconds: ctx.config.shotSecondsBounds, episodeDuration: "User-controlled. Use the requested length in the creative brief. If none is given, propose an appropriate target in the show plan for user approval. There is no preset episode length." }
    : showLimits(ctx.config);
  const voices = await ctx.audio.voices?.(plan.language) ?? [];
  const show = await planWithAi(ctx, {
    scope: "series",
    promptName: "show",
    schema: ShowBible,
    prompt: joinSections([
      ctx.series.production ? `Extract the brief's concrete nonnegotiable requirements into requirements=[{id,text,support,reason}]. Available: custom Canvas vector art, file editing, reusable character code, embedded provided raster assets, text on physical surfaces, IK helpers and measured-word cues. Lilita One and Montserrat are bundled offline and loaded before rendering when requested; do not substitute a system font for either. Moco captures temporal PNG previews, creates aspect-correct episode contact sheets, independently reviews and repairs visible actions, and exports H.264 through its existing renderer at the configured dimensions/fps. The configured narration backend is ${ctx.config.voice.backend}; never invent a different backend. Exact pitch/timbre matching, in-page GPU WebCodecs, a specific motion-blur subframe count, stock music/SFX acquisition and automatic soundtrack mixing are not exposed capabilities. Mark those partial honestly rather than claiming they ran. Requested GPT Image 2 generation is available only when the supplied image capability says enabled; use the Codex login and animate its saved PNG assets in Canvas. Other image providers, external font downloaders and music search are not exposed here. Do not drop requirements to get a valid plan.` : "",
      jsonSection("Image generation available to this project", imageGenerationCapability(ctx.series, ctx.ai)),
      jsonSection("Idea", ctx.series.idea),
      jsonSection("Series plan", plan),
      jsonSection("Engine limits", limits),
      notebookSection(await provenLessons(ctx)),
      jsonSection("Available voices", voices),
      jsonSection("Ready-made kit characters (only worth using if a story character truly is one)", ctx.catalog.characters.map((character) => character.id)),
      await previousSection(ctx, files.show, "ShowBible", feedback),
      feedbackSection(feedback),
    ]),
    check: (data) => [...checkShow(data, ctx.config), ...data.cast.flatMap((member, index) => member.voiceId && !voices.some((voice) => voice.id === member.voiceId)
      ? [{ path: `cast[${index}].voiceId`, problem: "voice is not available", allowed: voices.map((voice) => voice.id), fix: "Choose an offered voice or omit voiceId." }] : [])],
  });
  await ctx.store.save(files.show, "ShowBible", show, {
    producedBy: "ai",
    backend: ctx.ai.backendId,
    inputs: [ctx.store.inputRef(files.seriesPlan), promptRef("show", ctx.series.template)],
  });
  if (ctx.series.production) {
    await ctx.store.writeRaw("artifacts/artist-capabilities.json", { originalBrief: ctx.series.idea, production: ctx.series.production, requirements: show.requirements ?? [], limitations: show.requirements?.filter((requirement) => requirement.support !== "available") });
    if (!show.requirements?.length) throw new Error("Artist planning must record the brief's requirements before creating artwork");
    const unavailable = show.requirements.filter((requirement) => requirement.support === "unavailable");
    if (unavailable.length) throw new Error(`Unsupported requirements need a revised brief before artwork generation: ${unavailable.map((requirement) => `${requirement.text}: ${requirement.reason}`).join("; ")}`);
  }
  return show;
}

// Lessons that held across several series, offered to a new showrunner: adopt the ones that fit this show.
function notebookSection(entries: NotebookEntry[]): string {
  return entries.length === 0 ? "" : jsonSection("Craft notebook — lessons proven across other series; adopt only those that fit this show, as rules or rubric checks", entries.map(({ rule, stage, series }) => ({ rule, stage, heldIn: series.length })));
}

// A series made before show bibles has none; every stage then runs as it did.
// With the cast and places later episodes added (canon/merge.ts).
export async function readShow(ctx: StageContext): Promise<ShowBible | undefined> {
  if (!ctx.store.has(files.show)) return undefined;
  return showWithAdditions((await ctx.store.read(files.show, "ShowBible")).data, await readAdditions(ctx.dir, ctx.store));
}

function showLimits(config: EngineConfig) {
  return { episodeSeconds: config.targetSeconds, shotSeconds: config.shotSecondsBounds };
}

export function checkShow(show: ShowBible, config: EngineConfig): Issue[] {
  const { episodeSeconds, shotSeconds } = showLimits(config);
  const issues: Issue[] = [
    ...checkIds(show.cast.map((member) => member.id), "cast", /^[a-z0-9][a-z0-9-]*$/, "hanuman"),
    ...(show.cast.some((member) => member.id === "narrator") ? [{ path: "cast", problem: "narrator is reserved for off-screen narration" }] : []),
    ...checkIds(show.places.map((place) => place.id), "places", /^[a-z0-9][a-z0-9-]*$/, "lanka-shore"),
  ];
  const { targetSeconds } = show.format;
  if (targetSeconds < episodeSeconds.min || targetSeconds > episodeSeconds.max) {
    issues.push({ path: "format.targetSeconds", problem: `must be between ${episodeSeconds.min} and ${episodeSeconds.max}` });
  }
  const shots = show.format.shotSeconds;
  if (shots.min < shotSeconds.min || shots.max > shotSeconds.max || shots.min >= shots.max) {
    issues.push({ path: "format.shotSeconds", problem: `must be a range inside ${shotSeconds.min}–${shotSeconds.max} s with min below max` });
  }
  const tokens = show.look.palette.map((colour) => colour.token);
  const repeated = tokens.filter((token, index) => tokens.indexOf(token) !== index);
  if (repeated.length > 0) issues.push({ path: "look.palette", problem: `token ${repeated.join(", ")} is used twice`, fix: "Make tokens unique." });
  if (show.cast.length === 0) issues.push({ path: "cast", problem: "is empty", fix: "Every series has at least one on-screen character, or a narrator figure." });
  return issues;
}

// ---------- the engine's limits, as the show bible sets them ----------

export function episodeSeconds(config: EngineConfig, show: ShowBible | undefined): number {
  const { min, max } = config.targetSeconds;
  return show ? Math.min(max, Math.max(min, show.format.targetSeconds)) : Math.round((min + max) / 2);
}

export function shotSecondsFor(config: EngineConfig, show: ShowBible | undefined): { min: number; max: number } {
  if (!show) return config.shotSeconds;
  const bounds = config.shotSecondsBounds;
  return { min: Math.max(bounds.min, show.format.shotSeconds.min), max: Math.min(bounds.max, show.format.shotSeconds.max) };
}

// ---------- context packs: what each stage sees of the show bible ----------

const castBy = (show: ShowBible, ids: string[]) => show.cast.filter((member) => ids.includes(member.id));

export function scriptPack(show: ShowBible) {
  const { logline, genre, tone, narration, format, rules } = show;
  return { logline, genre, tone, narration, pacing: format.pacing, rules, cast: show.cast.map(({ id, name, role, personality, voice }) => ({ id, name, role, personality, voice })) };
}

export function shotsPack(show: ShowBible) {
  return { pacing: show.format.pacing, camera: show.look.camera, rules: show.rules, places: show.places, cast: show.cast.map(({ id, name, role }) => ({ id, name, role })) };
}

export function scenePack(show: ShowBible, shot: Shot) {
  const { statement, palette, lighting, camera, captions } = show.look;
  return {
    tone: show.tone,
    look: { statement, palette, lighting, camera, captions },
    rules: show.rules,
    rubric: show.rubric,
    cast: castBy(show, shot.characters).map(({ id, name, appearance, personality, movement, signature }) => ({ id, name, appearance, personality, movement, signature })),
    place: show.places.find((place) => place.id === shot.location),
  };
}

export function worldPack(show: ShowBible) {
  return { genre: show.genre, tone: show.tone, look: show.look, cast: show.cast.map(({ id, name, role, appearance, movement, signature }) => ({ id, name, role, appearance, movement, signature })), places: show.places };
}

export function biblePack(show: ShowBible) {
  return { tone: show.tone, look: { statement: show.look.statement, palette: show.look.palette, captions: show.look.captions }, cast: show.cast.map(({ id, name, role, appearance }) => ({ id, name, role, appearance })) };
}

export function critiquePack(show: ShowBible) {
  return { tone: show.tone, look: show.look.statement, camera: show.look.camera, rubric: show.rubric, requirements: show.requirements };
}

// The show's cast id for a world model, so the art director judges a model against the character it plays.
export function appearanceOf(show: ShowBible | undefined, castId: string | undefined): string | undefined {
  return show?.cast.find((member) => member.id === castId)?.appearance;
}
