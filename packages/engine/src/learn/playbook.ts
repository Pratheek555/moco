// Learning (v2 phase 4): after each episode, the retro reads what the critic saw (the episode's Critique: every shot's
// first score, its problems, and whether a repair helped) and the user's notes, and keeps the series' playbook:
// - every active lesson is checked against the new episode: `held` if no shot broke it, `broken` if one did;
// - new lessons are added only with evidence: the shots and scores they came from;
// - a lesson that keeps breaking retires, so the playbook stays a short list of things that work.
// Lessons reach later episodes through each stage's prompt (lessonsSection). Lessons that held in a series are recorded in
// a craft notebook shared by all series; ones that held in PROVEN_IN series are offered to new showrunners.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import { PLAYBOOK_STAGES, type Critique, type Playbook, type PlaybookLesson } from "@moco/spec";
import { joinSections, jsonSection, promptRef } from "../generator/prompts.ts";
import type { Issue } from "../loop/feedback.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { planWithAi } from "../planner/common.ts";

type Stage = (typeof PLAYBOOK_STAGES)[number];

// A lesson retires once it has broken twice and more often than it held.
const RETIRE_AFTER = 2;
// A lesson goes into the craft notebook once it has held this often in one series...
const HELD_TO_RECORD = 2;
// ...and is offered to new series once it has done that in this many series.
export const PROVEN_IN = 3;
const MAX_NEW = 4;

export async function readPlaybook(ctx: StageContext): Promise<Playbook> {
  return ctx.store.has(files.playbook) ? (await ctx.store.read(files.playbook, "Playbook")).data : { lessons: [] };
}

// What a stage is told: its active lessons, with how often each held, so it can weigh them.
export function lessonsSection(playbook: Playbook, stage: Stage): string {
  const lessons = playbook.lessons.filter((lesson) => lesson.status === "active" && lesson.stage === stage);
  if (lessons.length === 0) return "";
  return jsonSection("Playbook — lessons this series learned from its own shots; follow them", lessons.map(({ id, rule, held, broken }) => ({ id, rule, held, broken })));
}

// ---------- the retro ----------

// What the AI writes.
const RetroDraft = z.object({
  checks: z.array(z.object({ id: z.string(), outcome: z.enum(["held", "broken", "untested"]), note: z.string() })),
  lessons: z.array(z.object({
    rule: z.string().min(1),
    stage: z.enum(PLAYBOOK_STAGES),
    source: z.enum(["critic", "user"]),
    evidence: z.array(z.object({ shotId: z.string().optional(), note: z.string().min(1) })).min(1).max(4),
  })).max(MAX_NEW),
});
type RetroDraft = z.infer<typeof RetroDraft>;

// The user's notes on this episode's reviews (recorded by reject()), the strongest evidence there is.
function userNotes(ctx: StageContext, episodeId: string): { stage: string; note: string }[] {
  return ctx.ledger.data.decisions.filter((decision) => decision.category === "feedback" && decision.subject.startsWith(`${episodeId}/`)).map((decision) => ({ stage: decision.subject, note: decision.detail }));
}

export async function runRetro(ctx: StageContext, episodeId: string): Promise<Playbook | undefined> {
  const critique = ctx.store.has(files.critique(episodeId)) ? (await ctx.store.read(files.critique(episodeId), "Critique")).data : undefined;
  const notes = userNotes(ctx, episodeId);
  if (!critique && notes.length === 0) return undefined; // nothing was seen, so nothing can be learned
  const playbook = await readPlaybook(ctx);
  const active = playbook.lessons.filter((lesson) => lesson.status === "active");

  const draft = await planWithAi(ctx, {
    scope: episodeId,
    promptName: "retro",
    schema: RetroDraft,
    prompt: joinSections([
      critique ? jsonSection("What the critic saw in this episode", critique) : "",
      notes.length > 0 ? jsonSection("The user's notes on this episode", notes) : "",
      jsonSection("Active lessons to check", active.map(({ id, rule, stage }) => ({ id, rule, stage }))),
      jsonSection("Retired lessons (don't add these again)", playbook.lessons.filter((lesson) => lesson.status === "retired").map((lesson) => lesson.rule)),
    ]),
    check: (data) => checkRetro(data, active, critique, playbook),
  });

  const merged = mergeRetro(playbook, draft, episodeId, critique);
  await ctx.store.save(files.playbook, "Playbook", merged, {
    producedBy: "ai",
    backend: ctx.ai.backendId,
    inputs: [...(critique ? [ctx.store.inputRef(files.critique(episodeId))] : []), promptRef("retro")],
  });
  const added = merged.lessons.length - playbook.lessons.length;
  const count = (outcome: string) => draft.checks.filter((check) => check.outcome === outcome).length;
  const retired = merged.lessons.filter((lesson) => lesson.status === "retired").length - playbook.lessons.filter((lesson) => lesson.status === "retired").length;
  ctx.ledger.decide("learn", episodeId, `${added} new lessons, ${count("held")} held, ${count("broken")} broken, ${retired} retired`);
  await ctx.bus.emit(ctx.seriesId, "learn.retro", { episodeId, added, held: count("held"), broken: count("broken"), retired });
  await recordInNotebook(ctx, merged);
  return merged;
}

const normalise = (rule: string) => rule.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function checkRetro(draft: RetroDraft, active: PlaybookLesson[], critique: Critique | undefined, playbook: Playbook): Issue[] {
  const issues: Issue[] = [];
  const ids = active.map((lesson) => lesson.id);
  const checked = draft.checks.map((check) => check.id);
  for (const id of ids.filter((id) => !checked.includes(id))) issues.push({ path: "checks", problem: `lesson ${id} isn't checked`, fix: "Check every active lesson once: held, broken or untested." });
  draft.checks.forEach((check, index) => {
    if (!ids.includes(check.id)) issues.push({ path: `checks[${index}].id`, problem: `"${check.id}" is not an active lesson`, allowed: ids });
  });
  const shotIds = critique?.shots.map((shot) => shot.shotId) ?? [];
  const known = new Set(playbook.lessons.map((lesson) => normalise(lesson.rule)));
  draft.lessons.forEach((lesson, index) => {
    if (known.has(normalise(lesson.rule))) issues.push({ path: `lessons[${index}].rule`, problem: "the playbook already has this lesson", fix: "Leave it out, or check the existing one instead." });
    lesson.evidence.forEach((evidence, at) => {
      if (evidence.shotId && !shotIds.includes(evidence.shotId)) issues.push({ path: `lessons[${index}].evidence[${at}].shotId`, problem: `"${evidence.shotId}" is not a shot of this episode`, allowed: shotIds });
    });
  });
  return issues;
}

export function mergeRetro(playbook: Playbook, draft: RetroDraft, episodeId: string, critique: Critique | undefined): Playbook {
  const outcome = new Map(draft.checks.map((check) => [check.id, check]));
  const lessons = playbook.lessons.map((lesson): PlaybookLesson => {
    const check = outcome.get(lesson.id);
    if (!check || check.outcome === "untested" || lesson.status !== "active") return lesson;
    const held = lesson.held + (check.outcome === "held" ? 1 : 0);
    const broken = lesson.broken + (check.outcome === "broken" ? 1 : 0);
    const evidence = check.outcome === "broken" ? [...lesson.evidence, { episodeId, note: check.note }].slice(-12) : lesson.evidence;
    const status = broken >= RETIRE_AFTER && broken > held ? "retired" : "active";
    return { ...lesson, held, broken, evidence, status };
  });
  let next = playbook.lessons.length;
  for (const lesson of draft.lessons) {
    next += 1;
    const evidence = lesson.evidence.map((item) => {
      const shot = critique?.shots.find((candidate) => candidate.shotId === item.shotId);
      return { episodeId, shotId: item.shotId, note: item.note, before: shot?.score, after: shot?.repaired?.score };
    });
    lessons.push({ id: `L${String(next).padStart(3, "0")}`, rule: lesson.rule, stage: lesson.stage, source: lesson.source, since: episodeId, evidence, held: 0, broken: 0, status: "active" });
  }
  return { lessons: lessons.slice(-60) };
}

// ---------- the craft notebook, shared by every series ----------

export interface NotebookEntry {
  rule: string;
  stage: Stage;
  series: string[]; // series it held in
}

const notebookFile = (ctx: Pick<StageContext, "config">) => join(ctx.config.projectsDir, "craft-notebook.json");

export async function readNotebook(ctx: Pick<StageContext, "config">): Promise<NotebookEntry[]> {
  try {
    return (JSON.parse(await readFile(notebookFile(ctx), "utf8")) as { entries: NotebookEntry[] }).entries;
  } catch {
    return [];
  }
}

// Lessons a new series is offered: ones that held in at least PROVEN_IN different series.
export async function provenLessons(ctx: Pick<StageContext, "config">): Promise<NotebookEntry[]> {
  return (await readNotebook(ctx)).filter((entry) => entry.series.length >= PROVEN_IN);
}

async function recordInNotebook(ctx: StageContext, playbook: Playbook): Promise<void> {
  const proven = playbook.lessons.filter((lesson) => lesson.status === "active" && lesson.held >= HELD_TO_RECORD);
  if (proven.length === 0) return;
  const entries = await readNotebook(ctx);
  for (const lesson of proven) {
    const entry = entries.find((candidate) => normalise(candidate.rule) === normalise(lesson.rule));
    if (!entry) entries.push({ rule: lesson.rule, stage: lesson.stage, series: [ctx.seriesId] });
    else if (!entry.series.includes(ctx.seriesId)) entry.series.push(ctx.seriesId);
  }
  await writeFile(notebookFile(ctx), JSON.stringify({ entries }, null, 2));
}
