// Stage voiceover: speak the script, get word timings, then check the measured length against the target.
// Too far off → send the script back with a precise instruction (capped), so shots are cut to real timing.
import { relative } from "node:path";
import { join } from "node:path";
import type { TimedWord, VoiceoverTrack } from "@moco/spec";
import { wordsPerMinute } from "../config.ts";
import type { StageContext } from "../pipeline/context.ts";
import { files, stageKey } from "../pipeline/stages.ts";
import { readShow } from "./show.ts";
import { readBible } from "../canon/merge.ts";
import { EngineError } from "../errors.ts";

const DURATION_TOLERANCE = 0.1; // ±10% of the target

export type VoiceoverOutcome = { kind: "done"; hash: string } | { kind: "sent_back" };

export async function runVoiceover(ctx: StageContext, episodeId: string): Promise<VoiceoverOutcome> {
  const script = await ctx.store.read(files.script(episodeId), "EpisodeScript");
  const bible = { data: await readBible(ctx) }; // with cast later episodes added
  if (bible.data.narrator.backend !== ctx.config.voice.backend) {
    throw new EngineError("stage_blocked", `The approved narrator requires ${bible.data.narrator.backend}, but this runner is configured for ${ctx.config.voice.backend}. Configure the selected narration backend before generating speech; no substitute voice was used.`);
  }
  const show = await readShow(ctx);
  const available = await ctx.audio.voices?.(bible.data.narrator.language);
  const lines = script.data.lines.map((line) => {
    if (line.speaker !== "narrator" && !bible.data.cast.some((member) => member.id === line.speaker)) throw new Error(`Unknown speaker: ${line.speaker}`);
    const voiceId = line.speaker === "narrator" ? undefined : show?.cast.find((member) => member.id === line.speaker)?.voiceId;
    if (voiceId && available && !available.some((voice) => voice.id === voiceId)) throw new Error(`Voice ${voiceId} for ${line.speaker} is no longer available`);
    return { id: line.id, text: line.text, delivery: line.delivery, voiceId, speaker: line.speaker };
  });
  const { narrator } = bible.data;
  const activity = (message: string) => ctx.bus.emit(ctx.seriesId, "ai.activity", { key: stageKey("voiceover", episodeId), episodeId, phase: "working", message });

  await activity("Preparing the narration engine and script for speech.");
  await ctx.render.release?.(); // see RenderPort.release
  const speak = ctx.series.template && ctx.series.production && ctx.audio.ttsMeasured ? ctx.audio.ttsMeasured : ctx.audio.tts;
  const spoken = await ctx.ttsSlots.run(async () => {
    await activity(`Converting ${lines.length} script ${lines.length === 1 ? "line" : "lines"} to voice${narrator.backend === "chatterbox" ? " with the neural voice model" : ""}.`);
    let updates = Promise.resolve();
    try {
      return await speak.call(ctx.audio, lines, narrator, narrator.language, join(ctx.dir, files.audioDir(episodeId)), ctx.signal, (completed, total) => {
        updates = updates.then(() => activity(`Narration: ${completed} of ${total} lines saved. Completed lines will be reused on retry.`)).catch(() => {});
      });
    } finally { await updates; }
  });
  await activity(spoken.words ? "Speech generated. Checking word timings and narration length." : "Speech generated. Aligning words to the recorded voice.");
  const words: TimedWord[] = spoken.words ?? (await ctx.audio.align(spoken.file, lines, narrator.language));

  const target = script.data.targetSeconds;
  const drift = (spoken.durationSeconds - target) / target;
  const tolerance = ctx.series.template && ctx.series.production ? 0.05 : DURATION_TOLERANCE;
  if (Math.abs(drift) > tolerance) {
    const sentBack = await handleDrift(ctx, episodeId, spoken.durationSeconds, target, narrator.language);
    if (sentBack) return { kind: "sent_back" };
  }

  await activity("Building mouth movements and matching speakers to the voice track.");
  const sourceVisemes = await ctx.audio.visemes(spoken.file, words);
  const fps = ctx.series.production?.format.fps ?? 30;
  const visemes = fps === 30 ? sourceVisemes : sourceVisemes.map((key) => ({ ...key, frame: Math.round(key.frame * fps / 30) }));
  const speakers = script.data.lines.flatMap((line) => {
    const timed = words.filter((word) => word.lineId === line.id);
    return timed.length ? [{ speaker: line.speaker, start: timed[0]!.start, end: timed.at(-1)!.end }] : [];
  });
  const track: VoiceoverTrack = { file: relative(ctx.dir, spoken.file), durationSeconds: spoken.durationSeconds, words, visemes, speakers, ...(ctx.series.production && { fps }) };
  const saved = await ctx.store.save(files.voiceover(episodeId), "VoiceoverTrack", track, {
    producedBy: "engine",
    backend: spoken.backend ?? narrator.backend,
    inputs: [ctx.store.inputRef(files.script(episodeId)), ctx.store.inputRef(files.bible), ...(show ? [ctx.store.inputRef(files.show)] : [])],
  });
  return { kind: "done", hash: saved.meta.contentHash };
}

// Returns true if the script was sent back; false once the cap is used up (then the user is told instead).
async function handleDrift(ctx: StageContext, episodeId: string, measured: number, target: number, language: string): Promise<boolean> {
  const voKey = stageKey("voiceover", episodeId);
  const sendBacks = ctx.ledger.stage(voKey).sendBacks ?? 0;
  const seconds = Math.round(Math.abs(measured - target));
  const current = (await ctx.store.read(files.script(episodeId), "EpisodeScript")).data;
  const currentWords = current.lines.reduce((count, line) => count + line.text.split(/\s+/).filter(Boolean).length, 0);
  const revisedBudget = Math.max(1, Math.round(currentWords * target / measured));
  const words = ctx.series.production ? Math.abs(currentWords - revisedBudget) : Math.round((seconds * wordsPerMinute(ctx.config, language)) / 60);
  const verb = measured > target ? "Cut" : "Add";
  const instruction = `The narration runs ${measured.toFixed(1)} s but the target is ${target} s. ${verb} about ${words} words, keeping the story beats.`;

  if (sendBacks >= ctx.config.limits.maxSendBacks) {
    ctx.ledger.decide("duration_off_target", episodeId, instruction);
    await ctx.bus.emit(ctx.seriesId, "script.duration_off_target", { episodeId, measured, target });
    return false;
  }

  ctx.ledger.setStage(voKey, { sendBacks: sendBacks + 1 });
  ctx.ledger.setStage(stageKey("script", episodeId), { status: "pending", feedback: instruction, ...(ctx.series.production && { narrationWordBudget: revisedBudget }) });
  ctx.ledger.decide("send_back", episodeId, instruction);
  await ctx.bus.emit(ctx.seriesId, "script.sent_back", { episodeId, instruction, sendBack: sendBacks + 1 });
  return true;
}
