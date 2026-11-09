// Stage shot_list: the AI picks where to cut (by word index) and what each shot shows;
// the engine turns cut points into exact start/end times from the measured voiceover.
// That way shot boundaries always land on word boundaries and every word is in exactly one shot.
import * as z from "zod";
import type { Catalog } from "@moco/kit";
import { ActionCheck, VoiceoverTrack, type SeriesBible, type Shot, type ShotList, type TimedWord } from "@moco/spec";
import type { EngineConfig } from "../config.ts";
import { feedbackSection, joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { checkIds, planWithAi } from "./common.ts";
import { readShow, shotSecondsFor, shotsPack } from "./show.ts";
import { readBible } from "../canon/merge.ts";
import { lessonsSection, readPlaybook } from "../learn/playbook.ts";

// What the AI writes.
const ShotDraft = z.object({
  id: z.string(),
  fromWord: z.number().int().nonnegative(),
  intent: z.string().min(1),
  characters: z.array(z.string()),
  location: z.string(),
  cameraHint: z.string().optional(),
  actionChecks: z.array(ActionCheck).max(8).optional(),
});
const ShotDraftList = z.object({ shots: z.array(ShotDraft).min(1) });
type ShotDraftList = z.infer<typeof ShotDraftList>;

export async function runShotList(ctx: StageContext, episodeId: string, feedback?: string): Promise<string> {
  const voiceover = (await ctx.store.read(files.voiceover(episodeId), "VoiceoverTrack")).data;
  const script = (await ctx.store.read(files.script(episodeId), "EpisodeScript")).data;
  const bible = await readBible(ctx);
  const numberedWords = voiceover.words.map((word, index) => ({ index, text: word.text, start: word.start }));
  // When re-cutting after an edit, show the previous cut so unchanged shots stay the same (and their specs get reused).
  const previous = await previousShotList(ctx, episodeId);
  const show = await readShow(ctx);
  const shotSeconds = shotSecondsFor(ctx.config, show);

  const draft = await planWithAi(ctx, {
    scope: episodeId,
    promptName: "shots",
    schema: ShotDraftList,
    prompt: joinSections([
      jsonSection("Shot length", { minSeconds: shotSeconds.min, maxSeconds: shotSeconds.max, totalSeconds: voiceover.durationSeconds }),
      show ? jsonSection("Show bible — pacing, camera grammar and places", shotsPack(show)) : "",
      lessonsSection(await readPlaybook(ctx), "shots"),
      jsonSection("Narration beats", script.lines.map((line) => ({ id: line.id, beat: line.beat, speaker: line.speaker }))),
      script.shotPlan ? jsonSection("Approved estimated shot plan — preserve these pictures, retime to measured words", script.shotPlan) : "",
      jsonSection("Words", numberedWords),
      ctx.series.production ? "Every shot must include 1-3 actionChecks={id,description,fromWord,toWord}. Use whole-track word indices inside this shot. Describe visible contact, hand shape, gaze or body movement (e.g. hand cups opposite elbow, eyes turn toward sign), not vague feelings. These become acceptance checks." : "",
      jsonSection("Cast ids", bible.cast.map((member) => member.id)),
      jsonSection("Locations", ctx.series.production ? show?.places : ctx.catalog.backgrounds.map(({ id, hint, stage }) => ({ id, hint, places: stage?.places, cameras: stage?.cameras }))),
      previous ? jsonSection("Previous cut — keep shots whose words didn't change exactly as they were", previous) : "",
      feedbackSection(feedback),
    ]),
    check: (data) => [...checkShotDrafts(data, voiceover, bible, ctx.catalog, shotSeconds, ctx.series.production ? show?.places.map((place) => place.id) : undefined), ...(ctx.series.styleSample && (data.shots.length < 2 || data.shots.length > 3) ? [{ path: "shots", problem: "A style sample must have exactly 2 or 3 shots to demonstrate cuts and recurring artwork" }] : []), ...(ctx.series.production ? data.shots.flatMap((shot, index) => !shot.actionChecks?.length ? [{path:`shots[${index}].actionChecks`,problem:"Declare observable actions with word indices"}] : []) : [])],
  });

  const shotList: ShotList = { shots: timeShots(draft, voiceover) };
  const inputs = [ctx.store.inputRef(files.voiceover(episodeId)), ctx.store.inputRef(files.bible), ...(show ? [ctx.store.inputRef(files.show)] : []), promptRef("shots", ctx.series.template)];
  const saved = await ctx.store.save(files.shotList(episodeId), "ShotList", shotList, { producedBy: "ai", backend: ctx.ai.backendId, inputs });
  return saved.meta.contentHash;
}

// The previous shots with the words they covered. Times are only meaningful against the voiceover
// that shot list was cut from, so that revision is read back from history via the shot list's inputs.
async function previousShotList(ctx: StageContext, episodeId: string) {
  if (!ctx.store.has(files.shotList(episodeId))) return undefined;
  const previous = await ctx.store.read(files.shotList(episodeId), "ShotList");
  const voRef = previous.meta.inputs.find((input) => input.kind === "VoiceoverTrack");
  if (!voRef) return undefined;
  const oldVoiceover = VoiceoverTrack.parse(await ctx.store.readRevision(files.voiceover(episodeId), voRef.revision));
  return previous.data.shots.map((shot) => ({
    id: shot.id,
    words: wordsBetween(oldVoiceover, shot.start, shot.end),
    intent: shot.intent,
    characters: shot.characters,
    location: shot.location,
    cameraHint: shot.cameraHint,
    actionChecks: shot.actionChecks,
  }));
}

function wordsBetween(voiceover: VoiceoverTrack, start: number, end: number): string {
  return voiceover.words.filter((word) => word.start >= start && word.start < end).map((word) => word.text).join(" ");
}

// Cut points → times. Shot i runs from its first word to the next shot's first word;
// the first shot starts at 0 and the last ends with the audio, so shots cover the whole track.
export function timeShots(draft: ShotDraftList, voiceover: VoiceoverTrack): Shot[] {
  return draft.shots.map((shot, index) => {
    const next = draft.shots[index + 1];
    const start = index === 0 ? 0 : voiceover.words[shot.fromWord]!.start;
    const end = next ? voiceover.words[next.fromWord]!.start : voiceover.durationSeconds;
    const shotWords = voiceover.words.slice(shot.fromWord, next?.fromWord);
    const { fromWord: _fromWord, ...rest } = shot;
    return { ...rest, start, end, lineIds: uniqueLineIds(shotWords) };
  });
}

function uniqueLineIds(words: TimedWord[]): string[] {
  return [...new Set(words.map((word) => word.lineId))];
}

export function checkShotDrafts(draft: ShotDraftList, voiceover: VoiceoverTrack, bible: SeriesBible, catalog: Catalog, shotSeconds: EngineConfig["shotSeconds"], locationsOverride?: string[]): Issue[] {
  const cutIssues = checkCutPoints(draft, voiceover.words.length);
  // Only time the shots once the cut points are valid; otherwise lengths are meaningless.
  if (cutIssues.length > 0) return cutIssues;

  const castIds = bible.cast.map((member) => member.id);
  const locations = locationsOverride ?? catalog.backgrounds.map((background) => background.id);
  const timed = timeShots(draft, voiceover);
  return [
    ...checkIds(draft.shots.map((shot) => shot.id), "shots", /^s\d{2,3}$/, "s01"),
    ...timed.flatMap((shot, index) => checkShot(shot, `shots[${index}]`, castIds, locations, shotSeconds)),
    ...draft.shots.flatMap((shot,index)=> (shot.actionChecks ?? []).flatMap((action)=> {
      const end=draft.shots[index+1]?.fromWord ?? voiceover.words.length;
      return action.fromWord < shot.fromWord || action.toWord < action.fromWord || action.toWord >= end ? [{path:`shots[${index}].actionChecks`,problem:`Action ${action.id} must use word indices within this shot`}] : [];
    })),
  ];
}

function checkCutPoints(draft: ShotDraftList, wordCount: number): Issue[] {
  return draft.shots.flatMap((shot, index) => {
    const path = `shots[${index}].fromWord`;
    if (index === 0 && shot.fromWord !== 0) return [{ path, problem: "the first shot must start at word 0", fix: "Set it to 0." }];
    if (shot.fromWord >= wordCount) return [{ path, problem: `there are only ${wordCount} words (0–${wordCount - 1})` }];
    const previous = draft.shots[index - 1];
    if (previous && shot.fromWord <= previous.fromWord) return [{ path, problem: "must be after the previous shot's first word", fix: "Keep fromWord increasing." }];
    return [];
  });
}

function checkShot(shot: Shot, path: string, castIds: string[], locations: string[], shotSeconds: EngineConfig["shotSeconds"]): Issue[] {
  const issues: Issue[] = [];
  const length = shot.end - shot.start;
  const { min, max } = shotSeconds;
  if (length < min || length > max) {
    issues.push({ path, problem: `lasts ${length.toFixed(2)} s, shots must be ${min}–${max} s`, fix: "Move the cut points." });
  }
  if (!locations.includes(shot.location)) {
    issues.push({ path: `${path}.location`, problem: `"${shot.location}" is not a kit background`, allowed: locations, fix: "Pick one." });
  }
  const unknown = shot.characters.filter((character) => !castIds.includes(character));
  if (unknown.length > 0) {
    issues.push({ path: `${path}.characters`, problem: `${unknown.join(", ")} not in the cast`, allowed: castIds, fix: "Use cast ids only." });
  }
  return issues;
}
