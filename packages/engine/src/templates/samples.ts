// A style sample is an ordinary one-episode artist project with pinned reference
// context. Approval preserves executable evidence; it never advances to publishing.
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, lstat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import * as z from "zod";
import { VideoFormat } from "@moco/spec";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { EngineError } from "../errors.ts";
import { hashData } from "../store/hash.ts";
import { exists, readJson, writeJsonAtomic } from "../store/workspace.ts";
import type { TemplateInfo } from "./index.ts";
import { templateText } from "./registry.ts";
const byteHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export const StyleChoices = z.object({
  palette: z.array(z.string().regex(/^#[\da-f]{6}$/i)).max(8),
  detail: z.enum(["simple", "balanced", "rich"]),
  acting: z.enum(["restrained", "expressive"]),
  pacing: z.enum(["calm", "balanced", "brisk"]),
  feedback: z.string().trim().max(2000),
});
export const StyleSampleInput = z.object({
  templateId: z.string(), topic: z.string().trim().min(1).max(12000),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/),
  seconds: z.number().positive().max(60), format: VideoFormat, choices: StyleChoices,
});
export type StyleSampleInput = z.infer<typeof StyleSampleInput>;
export interface StyleSampleInfo {
  templateId: string;
  revisionId: string;
  topic: string;
  choices: z.infer<typeof StyleChoices>;
}
export interface StyleSampleReview {
  contentHash: string;
  canApprove: boolean;
  blockers: string[];
  deviations: { kind: "measured" | "choice" | "limitation" | "judgment"; label: string; detail: string }[];
  rules: unknown;
  approved?: { contentHash: string; approvedAt: string };
  previewHash?: string;
  folder?: string;
}

async function optionalJson<T>(path: string, fallback: T): Promise<T> {
  if (!await exists(path)) return fallback;
  return readJson<T>(path); // malformed evidence must not silently become an empty pass
}

// Copy only regular files. Reference videos/sheets are deliberately left in the
// learning evidence folder; samples pin the compiled rules and selected images.
async function copyTree(from: string, to: string): Promise<void> {
  const info = await lstat(from);
  if (info.isSymbolicLink()) throw Error("Style context cannot contain links");
  if (info.isDirectory()) {
    await mkdir(to, { recursive: true });
    for (const name of await readdir(from)) await copyTree(join(from, name), join(to, name));
  } else if (info.isFile()) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}

export async function snapshotStyle(dir: string, template: TemplateInfo, input: StyleSampleInput) {
  if (!template.learned || !template.production) throw new EngineError("validation_failed", "Choose a learned or prompt Canvas template for a style sample");
  const revisionId = `sample-${randomUUID()}`;
  const root = join(dir, ".samples", revisionId);
  await mkdir(root, { recursive: true });
  try {
    const source = template.learned.dir;
    for (const name of ["skill", "references", "style-rules.json", "content-exclusions.json", "leaks.json", "reference-frames.json", "reference-images.json"]) {
      if (await exists(join(source, name))) await copyTree(join(source, name), join(root, name));
    }
    const creativePrompt = `${template.creativePrompt ?? templateText(template)}\n\nUser-selected visual choices (override learned defaults):\n${JSON.stringify(input.choices)}\nPalette values are actual drawing colors; an empty palette retains the learned palette. Detail controls visual complexity, acting controls pose/expression range, and pacing controls cut/reveal rhythm. Written feedback overrides these choices. Retain the learned technique without its topics, scripts, characters, names or logos. Create original characters for the user's topic. Never copy a supplied frame as finished artwork.`;
    await writeJsonAtomic(join(root, "moco-template.json"), {
      ...template, learned: undefined, id: revisionId, creativePrompt,
      production: { ...template.production, format: input.format, targetSeconds: input.seconds },
      palette: { ...template.palette, accents: input.choices.palette.length ? input.choices.palette : template.palette.accents }, defaults: { episodes: 1 },
    });
    await writeJsonAtomic(join(root, "style.json"), { sources: template.learned.sources, updatedAt: new Date().toISOString(), sourceTemplate: input.templateId });
    await writeJsonAtomic(join(root, "request.json"), input);
    await writeFile(join(root, "moco-template.md"), creativePrompt);
    return { revisionId, root };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export function sampleBrief(input: StyleSampleInput): string {
  return `Make ONE original illustrated explainer SAMPLE about: ${input.topic}\nTarget ${input.seconds} seconds, exactly 2 or 3 shots, not a full series. Show a recurring ORIGINAL character, a concrete diagram or visual mechanism with readable text, purposeful acting, and motivated cuts. Match the selected reference TECHNIQUES while inventing all narration, characters and content. The sample tests visual language, motion and continuity. Use the explicitly selected production format. Visual choices: ${JSON.stringify(input.choices)}. Written feedback overrides defaults. Keep scope achievable within this short sample.`;
}

interface Exclusions { references: { id: string; contentSpecifics: string[]; words: string[] }[] }
const normalize = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const genericWords = new Set("a an the and or but if then so of to in on at by for with from into over under about as is are was were be been being it its this that these those there here he she they them his her their we you your i me my our not no just can will would could should one two all any some more each than too also only up down again who what when where why how which".split(" "));
// Conservative checks identify verbatim script overlap, not semantic originality.
export function copiedPhrases(text: string, exclusions: Exclusions): string[] {
  const haystack = ` ${normalize(text)} `;
  const found = new Set<string>();
  for (const reference of exclusions.references) {
    const words = normalize(reference.words.join(" ")).split(" ");
    for (let index = 0; index + 4 <= words.length; index++) {
      const phrase = words.slice(index, index + 4).join(" ");
      if (phrase.length >= 12 && words.slice(index, index + 4).filter(word => !genericWords.has(word)).length >= 2 && haystack.includes(` ${phrase} `)) found.add(`${reference.id}: ${phrase}`);
    }
  }
  return [...found];
}

async function fingerprints(root: string, prefix = ""): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  if (!await exists(root)) return found;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error("Sample evidence cannot contain links");
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(found, await fingerprints(join(root, entry.name), key));
    else if (entry.isFile()) found[key] = byteHash(await readFile(join(root, entry.name)));
  }
  return found;
}

export async function styleSampleReview(ctx: StageContext, template: TemplateInfo): Promise<StyleSampleReview> {
  if (!ctx.series.styleSample || !template.learned) throw Error("This project is not a style sample");
  const root = template.learned.dir;
  const rules = await optionalJson<unknown>(join(root, "style-rules.json"), null);
  const leaks = await optionalJson<unknown[]>(join(root, "leaks.json"), []);
  const blockers: string[] = [];
  const deviations: StyleSampleReview["deviations"] = [
    { kind: "choice", label: "Your visual choices", detail: JSON.stringify(ctx.series.styleSample.choices) },
    ...((template.missing ?? []).map(detail => ({ kind: "limitation" as const, label: "Reference technique unavailable", detail }))),
    { kind: "limitation", label: "Originality check", detail: "Checks verbatim four-word narration matches and retained learning warnings. Visual identity and semantic originality still need your review; references are technique evidence, never characters or scripts to reproduce." },
    { kind: "judgment", label: "Motion and style", detail: "The artist review uses sampled frames. Watch the entire sample for acting, continuity, pacing and readability before approving; sampled checks do not prove smooth motion between frames." },
  ];
  if (leaks.length) blockers.push(`${leaks.length} reference-content warning(s) remain in the learned style. Correct the style and learn again before approving a sample.`);
  const ep = ctx.episodeIds()[0];
  const preview = ep ? ctx.ledger.stage(`${ep}/preview`) : undefined;
  if (!preview || !["awaiting_approval", "approved"].includes(preview.status)) blockers.push("Generate and review the complete sample preview first.");
  const artifacts: Record<string, string> = {};
  let media: Record<string, string> = {};
  if (ep && ctx.store.has(files.shotList(ep)) && ctx.store.has(files.voiceover(ep))) {
    const shots = (await ctx.store.read(files.shotList(ep), "ShotList")).data.shots;
    const voice = (await ctx.store.read(files.voiceover(ep), "VoiceoverTrack")).data;
    if (shots.length < 2 || shots.length > 3) blockers.push("The sample must contain 2–3 shots to demonstrate cuts and continuity.");
    const quality = ctx.store.has(files.critique(ep)) ? (await ctx.store.read(files.critique(ep), "Critique")).data.quality : undefined;
    if (!quality || quality.status !== "passed" || quality.voiceoverHash !== ctx.store.hashOf(files.voiceover(ep)) || quality.shotListHash !== ctx.store.hashOf(files.shotList(ep)) || shots.length !== Object.keys(quality.sceneHashes).length || shots.some(shot => quality.sceneHashes[shot.id] !== ctx.store.hashOf(files.shotSpec(ep, shot.id)))) blockers.push("The sample needs a passing visual review bound to the current scenes and narration.");
    const exclusions = await optionalJson<Exclusions>(join(root, "content-exclusions.json"), { references: [] });
    const script = (await ctx.store.read(files.script(ep), "EpisodeScript")).data;
    const copied = copiedPhrases(script.lines.map(line => line.text).join(" "), exclusions);
    if (copied.length) blockers.push(`Possible copied reference narration: ${copied.slice(0, 6).join("; ")}. Rewrite the sample before approval.`);
    for (const [file, kind] of [[files.seriesPlan, "SeriesPlan"], [files.show, "ShowBible"], [files.bible, "SeriesBible"], [files.script(ep), "EpisodeScript"], [files.voiceover(ep), "VoiceoverTrack"], [files.shotList(ep), "ShotList"], [files.critique(ep), "Critique"], [files.previewReport(ep), "RenderReport"], ...shots.map(shot => [files.shotSpec(ep, shot.id), "SceneSpec"])] as const) {
      if (ctx.store.has(file)) { await ctx.store.read(file, kind as import("@moco/spec").ArtifactKind); artifacts[file] = ctx.store.hashOf(file)!; }
    }
    if (ctx.store.has(files.previewReport(ep))) {
      const report = await ctx.store.read(files.previewReport(ep), "RenderReport");
      const inputs = [...shots.map(shot => ctx.store.inputRef(files.shotSpec(ep, shot.id))), ctx.store.inputRef(files.voiceover(ep))];
      const expected = hashData({ report: report.meta.contentHash, inputs: inputs.map(({ kind, contentHash }) => ({ kind, contentHash })) });
      if (expected !== preview?.artifactHash) blockers.push("The playable preview is stale. Render it again before approval.");
      media = await fingerprints(join(ctx.dir, "episodes", ep, "renders"));
      const audio = join(ctx.dir, voice.file);
      if (!await exists(audio)) blockers.push("Sample narration file is missing.");
      else media["voiceover"] = byteHash(await readFile(audio));
      if (!await exists(join(ctx.dir, files.rendersDir(ep), "preview.mp4"))) blockers.push("Sample video is missing.");
    }
    const duration = voice.durationSeconds;
    const words = voice.words.length;
    const pictureEvery = duration / shots.length;
    const capabilities = await optionalJson<{ requirements?: { text: string; support: string; reason: string }[] }>(join(ctx.dir, "artifacts/artist-capabilities.json"), {});
    deviations.push(...(capabilities.requirements ?? []).filter(requirement => requirement.support !== "available").map(requirement => ({ kind: "limitation" as const, label: requirement.text, detail: requirement.reason })));
    deviations.push({ kind: "measured", label: "Sample timing", detail: `${duration.toFixed(2)} s measured narration; target ${ctx.series.production?.targetSeconds} s. ${shots.length} shots; new picture every ${pictureEvery.toFixed(2)} s; ${Math.round(words / duration * 60)} words/minute.` });
    const measurements = (rules as { measurements?: { key: string; label: string; values: number[]; unit: string }[] } | null)?.measurements;
    for (const [key, sample] of [["pictureEvery", pictureEvery], ["wpm", words / duration * 60]] as const) {
      const metric = measurements?.find(row => row.key === key);
      const values = metric?.values.filter(value => typeof value === "number" && Number.isFinite(value)) ?? [];
      if (metric && values.length) deviations.push({ kind: "measured", label: metric.label, detail: `Sample ${sample.toFixed(2)} ${metric.unit}; reference range ${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)} ${metric.unit}. ${sample < Math.min(...values) || sample > Math.max(...values) ? "Outside" : "Inside"} observed range. Differences can be intentional.` });
    }
  }
  const context: Record<string, string> = {};
  for (const name of ["moco-template.json", "moco-template.md", "style.json", "request.json", "style-rules.json", "content-exclusions.json", "leaks.json", "reference-frames.json", "reference-images.json"]) if (await exists(join(root, name))) context[name] = byteHash(await readFile(join(root, name)));
  Object.assign(context, await fingerprints(join(root, "references"), "references"), await fingerprints(join(root, "skill"), "skill"));
  const contentHash = hashData({ series: ctx.series, preview: preview?.artifactHash, artifacts, media, context, deviations, artist: ep ? await fingerprints(join(ctx.dir, "episodes", ep, "artist")) : {} });
  const approval = await optionalJson<StyleSampleReview["approved"]>(join(root, "approval.json"), undefined);
  return { contentHash, canApprove: blockers.length === 0 && preview?.status === "awaiting_approval", blockers, deviations, rules, folder: root, previewHash: preview?.artifactHash, approved: approval?.contentHash === contentHash && preview?.status === "approved" ? approval : undefined };
}

export async function retainApprovedSample(ctx: StageContext, template: TemplateInfo, expectedHash: string) {
  const review = await styleSampleReview(ctx, template);
  if (review.contentHash !== expectedHash) throw new EngineError("gate_mismatch", "Sample changed since you reviewed it. Reload and review this revision again.");
  if (!review.canApprove) throw new EngineError("stage_blocked", review.blockers.join("\n") || "This sample is already approved");
  const ep = ctx.episodeIds()[0]!;
  const root = template.learned!.dir;
  const temp = join(root, `.approval-${randomUUID()}`);
  const destination = join(root, "approved");
  try {
    await copyTree(join(ctx.dir, "artifacts"), join(temp, "artifacts"));
    await copyTree(join(ctx.dir, "episodes", ep), join(temp, "episode"));
    await copyFile(join(ctx.dir, "series.json"), join(temp, "series.json"));
    const voice = (await ctx.store.read(files.voiceover(ep), "VoiceoverTrack")).data;
    // Include narration even when the audio backend saves outside the episode folder.
    await copyFile(join(ctx.dir, voice.file), join(temp, "narration.wav"));
    await writeJsonAtomic(join(temp, "review.json"), review);
    await writeJsonAtomic(join(temp, "manifest.json"), { version: 1, sampleHash: expectedHash, files: await fingerprints(temp), sourceProject: ctx.seriesId, sourceEpisode: ep, narrationSource: relative(ctx.dir, join(ctx.dir, voice.file)) });
    // A failed approval can be retried; never overwrite a completed approval.
    if (await exists(destination)) await rm(destination, { recursive: true, force: true });
    await rename(temp, destination);
    return { contentHash: expectedHash, approvedAt: new Date().toISOString() };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
