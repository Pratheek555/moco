// L2 semantic checks for a SceneSpec: everything the zod schema can't know on its own —
// the kit catalog, the bible cast, the shot's timing and its voiceover words, and the cinematography rules
// (something moves at least every 3 s, emphasis gets a camera move, no 3 same-looking shots in a row).
// Each check returns issues phrased for the model (see feedback.ts).
import type { Catalog, CatalogCharacter } from "@moco/kit";
import { CameraMove as CameraMoveSchema, type CameraMove, type Caption, type SceneAction, type SceneActor, type SceneSpec, type SeriesBible, type Shot } from "@moco/spec";
import type { Issue } from "./feedback.ts";

// Everything a scene is checked against.
export interface SceneBrief {
  shot: Shot;
  durationFrames: number; // fixed by the shot list, not chosen by the AI
  words: { text: string; startFrame: number; endFrame: number }[]; // VO words, frames relative to shot start
  avoid?: ShotLook; // looks the shots around this one already repeat twice (see repeatedLook)
}

// How a shot reads on screen, for the "no 3 in a row" rule. Each list holds values to avoid, or shown values.
export interface ShotLook {
  cameraPreset: string[];
  shotSize: string[];
}

export interface SceneRules {
  brief: SceneBrief;
  bible: SeriesBible;
  catalog: Catalog;
}

// Keep actors inside the 9:16 safe area (away from Instagram's UI at the top and bottom).
const SAFE_AREA = { minX: 0.08, maxX: 0.92, minY: 0.12, maxY: 0.88 };

export function validateScene(spec: SceneSpec, rules: SceneRules): Issue[] {
  return [
    ...checkShotIdentity(spec, rules.brief),
    ...checkCastPresent(spec, rules.brief),
    ...checkSomethingMoves(spec),
    ...checkBackground(spec, rules),
    ...checkLooks(spec, rules.catalog),
    ...spec.actors.flatMap((actor, index) => checkActor(actor, `actors[${index}]`, spec, rules)),
    ...spec.props.flatMap((prop, index) => checkKnownId(prop.id, `props[${index}].id`, "prop", rules.catalog.props.map((p) => p.id))),
    ...spec.fx.flatMap((fx, index) => checkFx(fx, `fx[${index}]`, spec, rules.catalog)),
    ...spec.camera.flatMap((move, index) => checkCamera(move, `camera[${index}]`, spec)),
    ...spec.captions.flatMap((caption, index) => checkFrameRange(caption, `captions[${index}]`, spec.durationFrames)),
    ...checkCaptionText(spec.captions, rules.brief),
    ...spec.captions.flatMap((caption, index) => checkEmphasis(caption, `captions[${index}]`, spec.camera)),
    ...checkAvoid(spec, rules.brief.avoid),
  ];
}

function checkShotIdentity(spec: SceneSpec, brief: SceneBrief): Issue[] {
  const issues: Issue[] = [];
  if (spec.shotId !== brief.shot.id) {
    issues.push({ path: "shotId", problem: `must be "${brief.shot.id}"`, fix: `Set shotId to "${brief.shot.id}".` });
  }
  if (spec.durationFrames !== brief.durationFrames) {
    issues.push({
      path: "durationFrames",
      problem: `must be ${brief.durationFrames} (fixed by the voiceover timing)`,
      fix: `Set durationFrames to ${brief.durationFrames}.`,
    });
  }
  if (spec.fallback) issues.push({ path: "fallback", problem: "is reserved for the engine", fix: "Set fallback to false." });
  return issues;
}

// Characters the shot list put in this shot must be on screen.
function checkCastPresent(spec: SceneSpec, brief: SceneBrief): Issue[] {
  const onScreen = spec.actors.map((actor) => actor.castId);
  const missing = brief.shot.characters.filter((castId) => !onScreen.includes(castId));
  if (missing.length === 0) return [];
  return [{ path: "actors", problem: `missing ${missing.join(", ")} (the shot list puts them in this shot)`, fix: "Add them as actors." }];
}

// Slideshow risk: more than 3 s where neither the camera nor anyone moves. Blinks don't count (idle motion
// already blinks), and neither do fx or idle breathing: on a phone they read as a still picture.
const MAX_STILL_FRAMES = 90;
function checkSomethingMoves(spec: SceneSpec): Issue[] {
  const moving = [
    ...spec.camera.filter((move) => move.move !== "static"),
    ...spec.actors.flatMap((actor) => actor.actions).filter((action) => action.name !== "blink"),
  ];
  const still = longestGap(moving, spec.durationFrames);
  if (still.endFrame - still.startFrame <= MAX_STILL_FRAMES) return [];
  return [{
    path: "",
    problem: `nothing moves from frame ${still.startFrame} to ${still.endFrame} (${((still.endFrame - still.startFrame) / 30).toFixed(1)} s; the limit is 3 s)`,
    fix: `Add a camera move (push_in, pull_out, pan_left, pan_right, focus_on) or an actor action (not blink) between frames ${still.startFrame} and ${still.endFrame}.`,
  }];
}

// The longest stretch of [0, durationFrames) that no range covers.
function longestGap(ranges: { startFrame: number; endFrame: number }[], durationFrames: number) {
  const sorted = [...ranges].sort((a, b) => a.startFrame - b.startFrame);
  let longest = { startFrame: 0, endFrame: 0 };
  let coveredUntil = 0;
  // One pass in start order: a gap is the space between what's covered so far and the next range's start.
  for (const range of [...sorted, { startFrame: durationFrames, endFrame: durationFrames }]) {
    if (range.startFrame - coveredUntil > longest.endFrame - longest.startFrame) longest = { startFrame: coveredUntil, endFrame: range.startFrame };
    coveredUntil = Math.max(coveredUntil, range.endFrame);
  }
  return longest;
}

// Ids the renderer looks up in the kit: atmosphere effects, the background layers they sit on, and the time of
// day. Actions are checked per actor in checkAction. Mouth shapes aren't checked here: the AI's copy is always
// replaced by the engine's lip-sync track, which renderer/test/visemes.test.ts checks against the catalog.
function checkLooks(spec: SceneSpec, catalog: Catalog): Issue[] {
  const background = catalog.backgrounds.find((candidate) => candidate.id === spec.background.id);
  const layers = background?.layers.map((layer) => layer.id) ?? [];
  const atmospheres = catalog.atmosphere.map((known) => known.id);
  return [
    ...spec.atmosphere.flatMap((entry, index) => checkKnownId(entry.id, `atmosphere[${index}].id`, "atmosphere", atmospheres)),
    ...spec.atmosphere.flatMap((entry, index) => (entry.layer === undefined || !background ? [] : checkKnownId(entry.layer, `atmosphere[${index}].layer`, `${background.id} layer`, layers))),
    ...(spec.timeOfDay === undefined || !background ? [] : checkKnownId(spec.timeOfDay, "timeOfDay", `${background.id} time of day`, background.timeOfDay)),
  ];
}

// An emphasised caption is the shot's key line: the camera should move in on it.
const EMPHASIS_MOVES = ["push_in", "focus_on"];
function checkEmphasis(caption: Caption, path: string, camera: CameraMove[]): Issue[] {
  if (!caption.emphasis) return [];
  const overlaps = camera.some((move) => EMPHASIS_MOVES.includes(move.move) && move.startFrame < caption.endFrame && move.endFrame > caption.startFrame);
  if (overlaps) return [];
  return [{
    path: `${path}.emphasis`,
    problem: `the emphasised line "${caption.text}" (frames ${caption.startFrame}–${caption.endFrame}) has no push_in or focus_on during it`,
    allowed: EMPHASIS_MOVES,
    fix: `Add a camera move that overlaps frames ${caption.startFrame}–${caption.endFrame}, or set emphasis to false.`,
  }];
}

// ---------- shot looks: no 3 consecutive shots with the same camera preset or shot size ----------

export const CAMERA_PRESETS: string[] = CameraMoveSchema.shape.move.options.filter((move) => move !== "shake");
// Shot size from the largest actor's scale (1 = a full-height character); a focus_on move makes it a close-up.
export const SHOT_SIZES = [
  { size: "wide", belowScale: 0.55 },
  { size: "medium", belowScale: 0.9 },
  { size: "close", belowScale: Infinity },
];
const SIZE_RULE = "wide = largest actor scale below 0.55 (or no actors); medium = 0.55 to 0.9; close = 0.9 or more, or any focus_on move";

// The move that runs longest ("static" when the camera never moves), and the shot size.
export function shotLook(spec: SceneSpec): { cameraPreset: string; shotSize: string } {
  const moving = spec.camera.filter((move) => move.move !== "static" && move.move !== "shake");
  const longest = [...moving].sort((a, b) => b.endFrame - b.startFrame - (a.endFrame - a.startFrame))[0];
  const largest = Math.max(0, ...spec.actors.map((actor) => actor.position.scale));
  const sized = SHOT_SIZES.find((size) => largest < size.belowScale)!.size;
  return { cameraPreset: longest?.move ?? "static", shotSize: spec.camera.some((move) => move.move === "focus_on") ? "close" : sized };
}

// The first shot (not in `skip`) that makes 3 in a row, and what it must avoid so no run passes through it.
export function repeatedLook(looks: { cameraPreset: string; shotSize: string }[], skip: Set<number>): { index: number; avoid: ShotLook } | null {
  const presets = looks.map((look) => look.cameraPreset);
  const sizes = looks.map((look) => look.shotSize);
  const index = looks.findIndex((_, at) => at >= 2 && !skip.has(at) && (runEndsAt(presets, at) || runEndsAt(sizes, at)));
  if (index < 0) return null;
  return { index, avoid: avoidFor(looks, index) };
}

// What the shot at `index` must avoid so it doesn't complete a run of 3 with its neighbours.
export function avoidFor(looks: { cameraPreset: string; shotSize: string }[], index: number): ShotLook {
  return { cameraPreset: avoidAt(looks.map((look) => look.cameraPreset), index), shotSize: avoidAt(looks.map((look) => look.shotSize), index) };
}

function runEndsAt(values: string[], at: number): boolean {
  return values[at] === values[at - 1] && values[at] === values[at - 2];
}

// Values that would complete a run of 3 at `at`: shared by the two shots before it, the two after it, or the
// ones either side.
function avoidAt(values: string[], at: number): string[] {
  const pairs: [number, number][] = [[at - 2, at - 1], [at - 1, at + 1], [at + 1, at + 2]];
  const repeated = pairs.filter(([a, b]) => values[a] !== undefined && values[a] === values[b]).map(([a]) => values[a]!);
  return [...new Set(repeated)];
}

function checkAvoid(spec: SceneSpec, avoid: ShotLook | undefined): Issue[] {
  if (!avoid) return [];
  const look = shotLook(spec);
  const issues: Issue[] = [];
  if (avoid.cameraPreset.includes(look.cameraPreset)) {
    issues.push({
      path: "camera",
      problem: `the main camera move is "${look.cameraPreset}", which would make 3 shots in a row with the same move`,
      allowed: CAMERA_PRESETS.filter((preset) => !avoid.cameraPreset.includes(preset)),
      fix: "Make one of these the longest camera move (\"static\" = no move).",
    });
  }
  if (avoid.shotSize.includes(look.shotSize)) {
    issues.push({
      path: "actors",
      problem: `this is a ${look.shotSize} shot, which would make 3 ${look.shotSize} shots in a row`,
      allowed: SHOT_SIZES.map((size) => size.size).filter((size) => !avoid.shotSize.includes(size)),
      fix: `Change the actors' scale or camera to get one of these. ${SIZE_RULE}.`,
    });
  }
  return issues;
}

function checkBackground(spec: SceneSpec, rules: SceneRules): Issue[] {
  const ids = rules.catalog.backgrounds.map((background) => background.id);
  const issues = checkKnownId(spec.background.id, "background.id", "background", ids);
  if (spec.background.id !== rules.brief.shot.location && issues.length === 0) {
    issues.push({ path: "background.id", problem: `the shot list puts this shot in "${rules.brief.shot.location}"`, fix: `Use "${rules.brief.shot.location}".` });
  }
  return issues;
}

function checkActor(actor: SceneActor, path: string, spec: SceneSpec, rules: SceneRules): Issue[] {
  const castIds = rules.bible.cast.map((member) => member.id);
  const member = rules.bible.cast.find((candidate) => candidate.id === actor.castId);
  if (!member) {
    return [{ path: `${path}.castId`, problem: `"${actor.castId}" is not in the series cast`, allowed: castIds, fix: "Pick a cast id." }];
  }
  if (actor.kitCharacterId !== member.kitCharacterId) {
    return [{ path: `${path}.kitCharacterId`, problem: `${actor.castId} is played by "${member.kitCharacterId}"`, fix: `Set kitCharacterId to "${member.kitCharacterId}".` }];
  }
  const character = rules.catalog.characters.find((candidate) => candidate.id === actor.kitCharacterId);
  if (!character) {
    return [{ path: `${path}.kitCharacterId`, problem: `"${actor.kitCharacterId}" is not installed in the kit` }];
  }

  return [
    ...checkSafeArea(actor, path),
    ...actor.actions.flatMap((action, index) => checkAction(action, `${path}.actions[${index}]`, character, spec.durationFrames)),
    ...checkActionOverlap(actor.actions, path),
    ...actor.expression.flatMap((expression, index) => checkExpression(expression, `${path}.expression[${index}]`, character, spec.durationFrames)),
  ];
}

function checkSafeArea(actor: SceneActor, path: string): Issue[] {
  const { x, y } = actor.position;
  const inside = x >= SAFE_AREA.minX && x <= SAFE_AREA.maxX && y >= SAFE_AREA.minY && y <= SAFE_AREA.maxY;
  if (inside) return [];
  return [{
    path: `${path}.position`,
    problem: `(${x}, ${y}) is outside the safe area`,
    fix: `Keep x in ${SAFE_AREA.minX}–${SAFE_AREA.maxX} and y in ${SAFE_AREA.minY}–${SAFE_AREA.maxY}.`,
  }];
}

function checkAction(action: SceneAction, path: string, character: CatalogCharacter, durationFrames: number): Issue[] {
  const rig = character.actions.find((candidate) => candidate.name === action.name);
  if (!rig) {
    return [{
      path: `${path}.name`,
      problem: `"${action.name}" is not in ${character.id}'s rig`,
      allowed: character.actions.map((candidate) => candidate.name),
      fix: "Pick one.",
    }];
  }
  const issues = checkFrameRange(action, path, durationFrames);
  const length = action.endFrame - action.startFrame;
  if (length < rig.minFrames) {
    issues.push({ path, problem: `"${action.name}" needs at least ${rig.minFrames} frames, got ${length}`, fix: "Make it longer." });
  }
  return [...issues, ...checkActionParams(action, path, rig.params ?? {})];
}

function checkActionParams(action: SceneAction, path: string, allowedParams: Record<string, string[]>): Issue[] {
  return Object.entries(action.params ?? {}).flatMap(([name, value]) => {
    const allowed = allowedParams[name];
    if (!allowed) {
      return [{ path: `${path}.params.${name}`, problem: `"${action.name}" has no param "${name}"`, allowed: Object.keys(allowedParams), fix: "Remove it." }];
    }
    if (!allowed.includes(String(value))) {
      return [{ path: `${path}.params.${name}`, problem: `"${String(value)}" is not allowed`, allowed, fix: "Pick one." }];
    }
    return [];
  });
}

// One actor can't do two things at once (e.g. raise_hand and point). Blinks are allowed to overlap.
function checkActionOverlap(actions: SceneAction[], path: string): Issue[] {
  const exclusive = actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => action.name !== "blink")
    .sort((a, b) => a.action.startFrame - b.action.startFrame);
  return exclusive.slice(1).flatMap((current, i) => {
    const previous = exclusive[i]!; // slice(1) shifts indexes by one, so exclusive[i] is the one before
    if (current.action.startFrame >= previous.action.endFrame) return [];
    return [{
      path: `${path}.actions[${current.index}]`,
      problem: `"${current.action.name}" overlaps "${previous.action.name}" (actions[${previous.index}])`,
      fix: `Start it at frame ${previous.action.endFrame} or later.`,
    }];
  });
}

function checkExpression(expression: { name: string; atFrame: number }, path: string, character: CatalogCharacter, durationFrames: number): Issue[] {
  const issues = checkKnownId(expression.name, `${path}.name`, `${character.id} expression`, character.expressions);
  if (expression.atFrame >= durationFrames) {
    issues.push({ path: `${path}.atFrame`, problem: `frame ${expression.atFrame} is past the end (${durationFrames})`, fix: `Use a frame below ${durationFrames}.` });
  }
  return issues;
}

function checkFx(fx: SceneSpec["fx"][number], path: string, spec: SceneSpec, catalog: Catalog): Issue[] {
  const known = catalog.fx.find((candidate) => candidate.id === fx.id);
  if (!known) return checkKnownId(fx.id, `${path}.id`, "fx", catalog.fx.map((candidate) => candidate.id));
  const issues = checkFrameRange(fx, path, spec.durationFrames);
  if (fx.endFrame - fx.startFrame > known.maxDurationFrames) {
    issues.push({ path, problem: `"${fx.id}" can last at most ${known.maxDurationFrames} frames`, fix: "Shorten it." });
  }
  return issues;
}

function checkCamera(move: CameraMove, path: string, spec: SceneSpec): Issue[] {
  const issues = checkFrameRange(move, path, spec.durationFrames);
  // Big shakes look broken on a phone screen.
  if (move.move === "shake" && move.amount > 0.3) {
    issues.push({ path: `${path}.amount`, problem: "shake amount above 0.3 is too violent", fix: "Use 0.3 or less." });
  }
  return issues;
}

// The captions, read in order, must say exactly the shot's voiceover words.
function checkCaptionText(captions: Caption[], brief: SceneBrief): Issue[] {
  const spoken = normaliseWords(brief.words.map((word) => word.text).join(" "));
  const shown = normaliseWords(captions.map((caption) => caption.text).join(" "));
  if (spoken === shown) return [];
  return [{
    path: "captions",
    problem: "caption text doesn't match the voiceover for this shot",
    fix: `Captions, read in order, must say exactly: "${brief.words.map((word) => word.text).join(" ")}".`,
  }];
}

// Lowercase, no punctuation, single spaces. Unicode-aware so Hindi words compare correctly.
function normaliseWords(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean).join(" ");
}

function checkFrameRange(range: { startFrame: number; endFrame: number }, path: string, durationFrames: number): Issue[] {
  if (range.endFrame <= range.startFrame) {
    return [{ path, problem: `endFrame (${range.endFrame}) must be after startFrame (${range.startFrame})` }];
  }
  if (range.endFrame > durationFrames) {
    return [{ path: `${path}.endFrame`, problem: `${range.endFrame} is past the end of the shot (${durationFrames})`, fix: `Use ${durationFrames} or less.` }];
  }
  return [];
}

function checkKnownId(id: string, path: string, what: string, allowed: string[]): Issue[] {
  if (allowed.includes(id)) return [];
  return [{ path, problem: `"${id}" is not a known ${what}`, allowed, fix: "Pick one." }];
}
