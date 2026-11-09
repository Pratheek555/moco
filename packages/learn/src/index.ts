// @moco/learn: reference videos in, a style skill out.
// fetch → measure (every frame and word, by tools) → tile sheets → agents per reference (overview, then the specialists
// the format needs, then a reference lead) → one style editor over all references → content-leak check → SKILL.md,
// then a moco template compiled from it. Every step's output is kept, so a re-run resumes where it stopped.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiBackend } from "@moco/ai";
import { extractReferenceFrames, LearnProduction, parseStyleImages } from "./artist.ts";
import {
  OverviewOutput, overviewTask, planSpecialists, ReferenceCard, referenceTask, runAgent, SpecialistOutput,
  type AgentContext, type AgentTask,
} from "./agents.ts";
import { fetchReference, referenceId, type ReferenceMeta } from "./fetch.ts";
import { measureReference, type Measurements } from "./measure.ts";
import { ArtistTemplateDraft, findLeaks, mergePrompt, metricTable, metricText, revisePrompt, SkillDraft, TemplateDraft, templatePrompt, type Leak } from "./merge.ts";
import { renderSheets, type SheetSet } from "./sheets.ts";
import { renderCard, renderMeasurements, renderSkill, renderTemplate, skillSlug, templateInfo, writeOutputs } from "./skill.ts";
import { defaultTools, type Tools } from "./tools.ts";

export { defaultTools, type Tools } from "./tools.ts";
export { referenceId } from "./fetch.ts";
export type { Measurements } from "./measure.ts";
export type { Leak } from "./merge.ts";
export type { LearnProduction } from "./artist.ts";

export interface LearnOptions {
  name: string; // the style's name, e.g. "Cartoon fact shorts"
  sources: string[]; // YouTube links or local video files
  stylesDir: string; // results go to <stylesDir>/<slug>/
  ai: AiBackend;
  tools?: Tools;
  whisperModel?: string; // faster-whisper model, default "small"
  language?: string; // narration language; detected when omitted
  model?: string; // model for the agents; the Claude Code default when omitted
  concurrency?: number; // agent calls at once, default 3
  timeoutMs?: number; // per agent call, default 20 minutes
  exampleTemplate?: string; // an existing moco template, shown to the template writer as a format example
  production?: LearnProduction; // explicit Canvas opt-in; omitted = legacy template compilation
  referenceImages?: string[]; // optional appearance-only PNG/JPEG/WebP data URLs; up to five, under 3 MB each
  stopAfter?: "measure"; // measure and draw sheets, no agents
  signal?: AbortSignal;
  onEvent?: (event: LearnEvent) => void;
}

export interface LearnEvent {
  step: "fetch" | "measure" | "sheets" | "agents" | "merge" | "template" | "done";
  ref?: string;
  message: string;
}

export interface LearnResult {
  dir: string;
  slug: string;
  skillFile?: string;
  templateFile?: string;
  references: { id: string; title: string; category?: string; agents: number }[];
  leaks: Leak[]; // reference content still found in the outputs after one revision
  usage: AgentContext["usage"];
}

interface Prepared {
  id: string;
  dir: string;
  meta: ReferenceMeta;
  measurements: Measurements;
  sheets: SheetSet;
}

export async function learnStyle(options: LearnOptions): Promise<LearnResult> {
  if (options.sources.length < 1 || options.sources.length > 10) throw Error("Add 1–10 reference videos");
  if (new Set(options.sources.map(referenceId)).size !== options.sources.length) throw Error("Use each reference video once and give local videos distinct filenames so their measurements stay separate");
  const production = options.production && LearnProduction.parse(options.production);
  const uploadedImages = parseStyleImages(options.referenceImages ?? []);
  if (uploadedImages.length && !production) throw Error("Style frames require Canvas artist production settings");
  const tools = options.tools ?? defaultTools();
  const slug = skillSlug(options.name);
  const dir = join(options.stylesDir, slug);
  const emit = (step: LearnEvent["step"], message: string, ref?: string) => options.onEvent?.({ step, ref, message });
  await mkdir(join(dir, "agents"), { recursive: true });
  await writeFile(join(dir, "style.json"), JSON.stringify({ name: options.name, slug, sources: options.sources, updatedAt: new Date().toISOString() }, null, 2));

  // One reference at a time: measuring decodes every frame and is CPU-bound.
  const prepared: Prepared[] = [];
  for (const source of options.sources) {
    const id = referenceId(source);
    const refDir = join(dir, "refs", id);
    emit("fetch", source, id);
    const meta = await fetchReference(source, refDir, tools, options.signal, (line) => emit("fetch", line, id));
    emit("measure", `${meta.title} (${meta.duration.toFixed(1)} s, ${meta.width}x${meta.height} @ ${meta.fps.toFixed(2)} fps)`, id);
    const { measurements, camera } = await measureReference(refDir, meta, tools, {
      whisperModel: options.whisperModel ?? "small",
      language: options.language,
      signal: options.signal,
      log: (line) => emit("measure", line, id),
    });
    const { video, speech } = measurements;
    emit("measure", `${video.shots.length} shots, ${video.transitions.length} transitions, ${video.events.length} motion bursts, ${speech.words} words at ${speech.wpm} wpm`, id);
    const sheets = await renderSheets(measurements, camera, refDir, tools, options.signal);
    emit("sheets", `${sheets.overview.length} overview, ${sheets.transitions.length} transition, ${sheets.events.length} motion, ${sheets.bursts.length} burst sheets`, id);
    prepared.push({ id, dir: refDir, meta, measurements, sheets });
  }

  const usage = { calls: 0, cached: 0, costUsd: 0 };
  if (options.stopAfter === "measure") {
    emit("done", `measured ${prepared.length} reference(s) in ${dir}`);
    return { dir, slug, references: prepared.map((ref) => ({ id: ref.id, title: ref.meta.title, agents: 0 })), leaks: [], usage };
  }

  const ctx: AgentContext = {
    ai: options.ai,
    model: options.model,
    timeoutMs: options.timeoutMs ?? 20 * 60_000,
    limit: limiter(options.concurrency ?? 3),
    log: (message) => emit("agents", message),
    usage,
  };

  // All references at once: the limiter keeps the number of live agents down.
  const analysed = await Promise.all(prepared.map((ref) => analyseReference(ctx, ref, (message) => emit("agents", message, ref.id))));

  // One rule set across references.
  const ids = prepared.map((_, i) => `R${i + 1}`);
  const all = prepared.map((ref) => ref.measurements);
  const rows = metricTable(all);
  const refsWithCards = prepared.map((ref, i) => ({ measurements: ref.measurements, card: analysed[i]!.card }));
  const metas = prepared.map((ref) => ref.meta);
  const date = new Date().toISOString().slice(0, 10);
  emit("merge", `merging ${prepared.length} rule card(s)`);
  const mergeTask: AgentTask = { name: "merge", role: "merge", images: [], prompt: mergePrompt(options.name, analysed.map((entry) => entry.card), metricText(rows, ids), ids) };
  let draft = await runAgent(ctx, mergeTask, SkillDraft, join(dir, "agents", "merge.json"));
  let skill = renderSkill(draft, slug, metas, date);
  let leaks = findLeaks(skill, refsWithCards);
  if (leaks.length > 0) {
    emit("merge", `revising: reference content found (${leaks.map((leak) => leak.phrase).slice(0, 6).join(", ")}${leaks.length > 6 ? ", …" : ""})`);
    draft = await runAgent(ctx, { ...mergeTask, name: "merge-revise", prompt: revisePrompt(mergeTask.prompt, draft, leaks) }, SkillDraft, join(dir, "agents", "merge-revise.json"));
    skill = renderSkill(draft, slug, metas, date);
    leaks = findLeaks(skill, refsWithCards);
  }
  await writeOutputs(dir, {
    "skill/SKILL.md": skill,
    "skill/references/measurements.md": renderMeasurements(rows, all),
    ...Object.fromEntries(prepared.map((ref, i) => [`refs/${ref.id}/report.md`, renderCard(analysed[i]!.card, ref.meta)])),
    "style-rules.json": JSON.stringify({ version: 1, sections: draft.sections, checklist: draft.checklist, avoid: draft.avoid, measurements: rows, references: prepared.map((ref, i) => ({ id: ref.id, source: ref.meta.source, rules: analysed[i]!.card.rules })) }, null, 2),
    // Kept separately from the reusable skill: these are exclusion evidence,
    // never examples to copy into a new script or character design.
    "content-exclusions.json": JSON.stringify({ version: 1, references: prepared.map((ref, i) => ({ id: ref.id, contentSpecifics: analysed[i]!.card.contentSpecifics, words: ref.measurements.words.map((word) => word.w) })) }, null, 2),
  });

  // The same rules as a moco template.
  emit("template", "compiling the moco template");
  const referenceImages: string[] = [];
  if (production) {
    await mkdir(join(dir, "references"), { recursive: true });
    for (const [index, image] of uploadedImages.entries()) {
      const path = `references/${index}.${image.extension}`;
      await writeFile(join(dir, path), image.bytes);
      referenceImages.push(path);
    }
    const frames = await extractReferenceFrames(all, dir, tools, options.signal, uploadedImages.length);
    referenceImages.push(...frames.map((frame) => frame.path));
    await writeFile(join(dir, "reference-images.json"), JSON.stringify({ version: 1, images: [...referenceImages.slice(0, uploadedImages.length).map((path) => ({ path, kind: "uploaded-still" })), ...frames.map((frame) => ({ ...frame, kind: "video-frame" }))] }, null, 2));
    emit("template", `Style context: ${uploadedImages.length} uploaded appearance frame(s), ${frames.length} sampled video frame(s); motion evidence remains in the measured frame sheets`);
  }
  const templateTask: AgentTask = { name: "template", role: production ? "template_artist" : "template", images: referenceImages.map((path) => join(dir, path)), prompt: templatePrompt(skill, options.exampleTemplate) + (production ? "\n\nProduction settings (user-selected, never replace):\n" + JSON.stringify(production) + "\nAttached source frames guide illustration appearance only. Motion findings come from the measured guide, never inferred from uploaded stills. Create original characters and artwork; source frames are not assets to embed in the new sample." : "") };
  const templateSchema = production ? ArtistTemplateDraft : TemplateDraft;
  let template = await runAgent(ctx, templateTask, templateSchema, join(dir, "agents", "template.json"));
  const templateText = () => `${renderTemplate(template, slug, metas)}\n${JSON.stringify(template.info)}`;
  let templateLeaks = findLeaks(templateText(), refsWithCards);
  if (templateLeaks.length > 0) {
    emit("template", `revising: reference content found (${templateLeaks.map((leak) => leak.phrase).slice(0, 6).join(", ")})`);
    template = await runAgent(ctx, { ...templateTask, name: "template-revise", prompt: revisePrompt(templateTask.prompt, template, templateLeaks) }, templateSchema, join(dir, "agents", "template-revise.json"));
    templateLeaks = findLeaks(templateText(), refsWithCards);
  }
  const remaining = [...leaks, ...templateLeaks];
  await writeOutputs(dir, {
    "moco-template.md": renderTemplate(template, slug, metas),
    "moco-template.json": `${JSON.stringify({ ...templateInfo(template, slug), ...(production && { production, creativePrompt: `${skill}\n\n${Object.entries(template.stages).filter(([, body]) => body.trim()).map(([stage, body]) => `## Guidance for ${stage}\n${body}`).join("\n\n")}`, referenceImages }) }, null, 2)}\n`,
    "leaks.json": `${JSON.stringify(remaining, null, 2)}\n`,
  });

  emit("done", `${usage.calls} agent calls (${usage.cached} reused), about $${usage.costUsd.toFixed(2)} of plan usage`);
  return {
    dir,
    slug,
    skillFile: join(dir, "skill", "SKILL.md"),
    templateFile: join(dir, "moco-template.md"),
    references: prepared.map((ref, i) => ({ id: ref.id, title: ref.meta.title, category: analysed[i]!.card.category, agents: analysed[i]!.agents })),
    leaks: remaining,
    usage,
  };
}

async function analyseReference(ctx: AgentContext, ref: Prepared, log: (message: string) => void): Promise<{ card: ReferenceCard; agents: number }> {
  const agentsDir = join(ref.dir, "agents");
  await mkdir(agentsDir, { recursive: true });
  const out = (name: string) => join(agentsDir, `${name}.json`);
  const overview = await runAgent(ctx, overviewTask(ref.measurements, ref.sheets), OverviewOutput, out("overview"));
  const tasks = planSpecialists(ref.measurements, ref.sheets, overview);
  log(`${overview.label} (${overview.category}): ${tasks.map((task) => task.name).join(", ")}`);
  const specialists = await Promise.all(tasks.map(async (task) => ({ task, output: await runAgent(ctx, task, SpecialistOutput, out(task.name)) })));
  const card = await runAgent(ctx, referenceTask(ref.measurements, overview, specialists), ReferenceCard, out("reference"));
  return { card, agents: tasks.length + 2 };
}

// At most `limit` tasks at once; the rest wait their turn.
function limiter(limit: number): AgentContext["limit"] {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
