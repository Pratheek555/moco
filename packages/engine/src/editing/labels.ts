import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import { CanvasLabel, SceneSpec, type CanvasLabel as Label } from "@moco/spec";
import type { ShotRef } from "../index.ts";
import { EngineError } from "../errors.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files } from "../pipeline/stages.ts";
import { hashData } from "../store/hash.ts";
import { assertSafeId, exists, readJson } from "../store/workspace.ts";

export interface LabelEditPreview {
  id: string;
  labelId: string;
  beforeText: string;
  text: string;
  frames: number[];
  before: string[]; // series-relative paths; desktop resolves these to asset URLs
  after: string[];
}
export interface LabelEditorState {
  sceneHash: string;
  labels: Label[];
  format: { width: number; height: number; fps: number };
  undoId?: string;
  stills?: string[];
}
interface Draft extends LabelEditPreview {
  shotId: string;
  base: string;
  candidateHash: string;
  versions: ReturnType<StageContext["render"]["versions"]>;
}
interface Undo { id: string; after: string }
const conflict = () => new EngineError("gate_mismatch", "This episode changed since the label preview. Reload and preview the edit again.");
const draftFile = (ref: ShotRef, id: string) => `episodes/${ref.episodeId}/edits/${id}/draft.json`;
const undoFile = (ref: ShotRef) => `episodes/${ref.episodeId}/edits/${ref.shotId}-undo.json`;
const stillsFile = (ref: ShotRef) => `episodes/${ref.episodeId}/edits/${ref.shotId}-stills.json`;

export function validateLabelRef(ref: ShotRef) {
  assertSafeId(ref.episodeId, "episode id");
  assertSafeId(ref.shotId, "shot id");
}

// Verify data against disk as well as ledger, and include revisions to catch ABA
// changes (edit then undo) while a comparison is open. Include every shot so the
// comparison is always anchored to the same cut and narration.
async function fingerprint(ctx: StageContext, ref: ShotRef) {
  const list = (await ctx.store.read(files.shotList(ref.episodeId), "ShotList")).data;
  if (!list.shots.some(shot => shot.id === ref.shotId)) throw new EngineError("not_found", "Shot is no longer in the cut");
  const dependencies: [string, "ShotList" | "VoiceoverTrack" | "SceneSpec"][] = [
    [files.shotList(ref.episodeId), "ShotList"], [files.voiceover(ref.episodeId), "VoiceoverTrack"],
    ...list.shots.map(shot => [files.shotSpec(ref.episodeId, shot.id), "SceneSpec"] as [string, "SceneSpec"]),
  ];
  for (const [file, kind] of dependencies) await ctx.store.read(file, kind);
  return hashData(dependencies.map(([file]) => [file, ctx.store.inputRef(file)]));
}

async function current(ctx: StageContext, ref: ShotRef) {
  if (ctx.ledger.stage(`${ref.episodeId}/scenes`).status !== "done") throw new EngineError("stage_blocked", "Finish the current scenes before editing labels");
  const saved = await ctx.store.read(files.shotSpec(ref.episodeId, ref.shotId), "SceneSpec");
  if (!saved.data.canvas) throw new EngineError("validation_failed", "This shot has no editable Canvas labels");
  for (const file of [files.voiceover(ref.episodeId), files.shotList(ref.episodeId)]) {
    const required = ctx.store.inputRef(file);
    if (!saved.meta.inputs.some(input => input.kind === required.kind && input.contentHash === required.contentHash)) throw new EngineError("stage_blocked", "The artwork is stale against narration or cuts; regenerate it before editing labels");
  }
  return saved;
}

function replaceText(spec: SceneSpec, labelId: string, text: string) {
  const labels = spec.canvas?.labels;
  const label = labels?.find(item => item.id === labelId);
  if (!label || labels!.filter(item => item.id === labelId).length !== 1) throw new EngineError("validation_failed", "Choose a supported, uniquely identified label. Text baked into artwork cannot be edited here.");
  const parsed = CanvasLabel.shape.text.safeParse(text);
  if (!parsed.success) throw new EngineError("validation_failed", "Use 1–300 characters on one line, without control characters");
  if (parsed.data === label.text) throw new EngineError("validation_failed", "Change the label text before previewing");
  // No patch/object from the client is accepted. This is the complete mutation.
  return SceneSpec.parse({ ...spec, canvas: { ...spec.canvas, labels: labels!.map(item => item.id === labelId ? { ...item, text: parsed.data } : item) } });
}

export async function labelEditor(ctx: StageContext, ref: ShotRef): Promise<LabelEditorState> {
  const saved = await ctx.store.read(files.shotSpec(ref.episodeId, ref.shotId), "SceneSpec");
  const undo = await readJson<Undo>(join(ctx.dir, undoFile(ref))).catch(() => undefined);
  const stills = await readJson<{ sceneHash: string; files: string[] }>(join(ctx.dir, stillsFile(ref))).catch(() => undefined);
  return { sceneHash: saved.meta.contentHash, labels: saved.data.canvas?.labels ?? [], format: saved.data.format ?? { width: 1080, height: 1920, fps: 30 },
    stills: stills?.sceneHash === saved.meta.contentHash ? stills.files : stills && saved.meta.producedBy === "human" ? [] : undefined,
    undoId: undo && undo.after === await fingerprint(ctx, ref) ? undo.id : undefined };
}

export async function previewLabelEdit(ctx: StageContext, ref: ShotRef, input: { sceneHash: string; labelId: string; text: string }): Promise<LabelEditPreview> {
  const saved = await current(ctx, ref);
  if (saved.meta.contentHash !== input.sceneHash) throw conflict();
  const base = await fingerprint(ctx, ref);
  const candidate = replaceText(saved.data, input.labelId, input.text);
  const label = candidate.canvas!.labels!.find(item => item.id === input.labelId)!;
  const frames = [...new Set([label.startFrame, Math.floor((label.startFrame + label.endFrame - 1) / 2), label.endFrame - 1])];
  const id = randomUUID(), folder = `episodes/${ref.episodeId}/edits/${id}`;
  const render = async (spec: SceneSpec, side: string) => {
    const result = await ctx.renderSlots.run(() => ctx.render.check(spec, { frames, outDir: join(ctx.dir, folder, side) }));
    if (!result.ok) throw new EngineError("validation_failed", result.errors.map(error => error.message).join("; "));
    if (result.stills.length !== frames.length) throw new EngineError("validation_failed", "Label comparison is missing preview frames");
    return result.stills.map(file => relative(ctx.dir, file).replaceAll("\\", "/"));
  };
  const before = await render(saved.data, "before"), after = await render(candidate, "after");
  if (base !== await fingerprint(ctx, ref)) throw conflict();
  const draft: Draft = { id, shotId: ref.shotId, labelId: input.labelId, text: label.text, beforeText: saved.data.canvas!.labels!.find(item => item.id === label.id)!.text, frames, before, after, base, candidateHash: hashData(candidate), versions: ctx.render.versions() };
  await ctx.store.writeRaw(draftFile(ref, id), draft);
  return { id, labelId: draft.labelId, text: draft.text, beforeText: draft.beforeText, frames, before, after };
}

export async function applyLabelEdit(ctx: StageContext, ref: ShotRef, id: string) {
  assertSafeId(id, "edit id");
  const draft = await readJson<Draft>(join(ctx.dir, draftFile(ref, id)));
  const saved = await current(ctx, ref);
  if (draft.shotId !== ref.shotId || draft.base !== await fingerprint(ctx, ref) || hashData(draft.versions) !== hashData(ctx.render.versions())) throw conflict();
  const candidate = replaceText(saved.data, draft.labelId, draft.text);
  if (hashData(candidate) !== draft.candidateHash || !(await Promise.all([...draft.before, ...draft.after].map(file => exists(join(ctx.dir, file))))).every(Boolean)) throw conflict();
  await ctx.store.writeRaw(stillsFile(ref), { sceneHash: draft.candidateHash, files: draft.after });
  await ctx.store.save(files.shotSpec(ref.episodeId, ref.shotId), "SceneSpec", candidate, { producedBy: "human", inputs: saved.meta.inputs });
  await ctx.store.writeRaw(undoFile(ref), { id, after: await fingerprint(ctx, ref) } satisfies Undo);
  ctx.ledger.decide("edit", `${ref.episodeId}/${ref.shotId}`, `applied label edit ${id}: ${draft.labelId}`);
}

export async function undoLabelEdit(ctx: StageContext, ref: ShotRef, id: string) {
  assertSafeId(id, "edit id");
  const undo = await readJson<Undo>(join(ctx.dir, undoFile(ref)));
  if (undo.id !== id || undo.after !== await fingerprint(ctx, ref)) throw conflict();
  const draft = await readJson<Draft>(join(ctx.dir, draftFile(ref, id)));
  const saved = await current(ctx, ref);
  if (saved.meta.contentHash !== draft.candidateHash) throw conflict();
  if (!(await Promise.all(draft.before.map(file => exists(join(ctx.dir, file))))).every(Boolean)) throw new EngineError("not_found", "The saved comparison frames are missing; the accepted shot was kept");
  const restored = replaceText(saved.data, draft.labelId, draft.beforeText);
  await ctx.store.writeRaw(stillsFile(ref), { sceneHash: hashData(restored), files: draft.before });
  await ctx.store.save(files.shotSpec(ref.episodeId, ref.shotId), "SceneSpec", restored, { producedBy: "human", inputs: saved.meta.inputs });
  // The previous pointer no longer matches the cut, so undo cannot be replayed.
  ctx.ledger.decide("restore", `${ref.episodeId}/${ref.shotId}`, `undid label edit ${id}: ${draft.labelId}`);
}
