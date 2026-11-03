// The measurements as compact text for the agents: tables they can cite, not raw per-frame arrays.
import { describeSpread, frames30, type Measurements } from "./measure.ts";
import type { SheetSet } from "./sheets.ts";
import { median, round } from "./stats.ts";

const num = (value: number, digits = 1) => (Number.isFinite(value) ? String(round(value, digits)) : "n/a");

export function headline(m: Measurements): string {
  const { ref, video, speech, pace } = m;
  const kinds = countBy(video.transitions.map((transition) => transition.kind));
  return [
    `Reference: "${ref.title}"${ref.channel ? ` by ${ref.channel}` : ""}, ${num(video.duration)} s, ${video.width}x${video.height}, ${num(video.fps, 2)} fps.`,
    `Shots: ${video.shots.length}, a new picture every ${num(pace.pictureEvery, 2)} s; shot length ${describeSpread(pace.shotSeconds, " s", 2)}.`,
    `Transitions: ${video.transitions.length} (${Object.entries(kinds).map(([kind, count]) => `${count} ${kind}`).join(", ") || "none"}); first change at ${num(pace.firstChange, 2)} s.`,
    `Narration: ${speech.words} words in ${speech.language}, ${num(speech.wpm)} wpm wall to wall (${num(speech.articulationWpm)} wpm while speaking), speech covers ${num(speech.speechRatio * 100, 0)}% of the short.`,
  ].join("\n");
}

export function cameraSummary(m: Measurements): string {
  const shots = m.video.shots.filter((shot) => shot.camera.measured >= 0.5);
  const moving = shots.reduce((total, shot) => total + shot.camera.moving * (shot.end - shot.start + 1), 0) / Math.max(1, shots.reduce((total, shot) => total + shot.end - shot.start + 1, 0));
  const profiles = countBy(shots.map((shot) => shot.camera.profile));
  return [
    `Camera moving (above ${num(1.5, 1)} %/s) in ${num(moving * 100, 0)}% of measured frames.`,
    `Shot profiles: ${Object.entries(profiles).map(([profile, count]) => `${profile} ×${count}`).join(", ")}.`,
    `Median shake (frame-to-frame jerk): ${num(median(shots.map((shot) => shot.camera.shake)), 3)} % of frame per frame.`,
    `Leftover motion of tracked points while the camera holds: ${num(m.video.holdStillness, 2)} px/frame at source resolution.`,
  ].join("\n");
}

export function shotTable(m: Measurements): string {
  const fps = m.video.fps;
  const rows = m.video.shots.map((shot) => {
    const c = shot.camera;
    return [
      `S${shot.index}`,
      `${num(shot.start / fps, 2)}–${num((shot.end + 1) / fps, 2)}s`,
      `${num(shot.duration, 2)}s`,
      c.measured < 0.5 ? `camera unmeasured (${num(c.measured * 100, 0)}% tracked)` : `${c.dominant} ${c.profile}; zoom ${num(c.zoomTotal)}% pan ${num(c.panTotalX)}/${num(c.panTotalY)}%; speed start/mid/end ${num(c.speedStart)}/${num(c.speedMid)}/${num(c.speedEnd)} %/s; moving ${num(c.moving * 100, 0)}%; shake ${num(c.shake, 3)}`,
      `activity ${num(shot.activity, 3)}`,
      `"${m.shotWords[shot.index - 1] ?? ""}"`,
    ].join(" | ");
  });
  return ["shot | time | length | camera | actor activity | words", ...rows].join("\n");
}

export function transitionTable(m: Measurements): string {
  const fps = m.video.fps;
  const rows = m.video.transitions.map((transition, i) => {
    const length = transition.end - transition.start + 1;
    return [
      `T${i + 1}`,
      `S${shotAt(m, transition.at - 1)}→S${shotAt(m, transition.at)}`,
      `${num(transition.at / fps, 2)}s`,
      transition.kind,
      `${length} frame${length === 1 ? "" : "s"} (${frames30(length, fps)} @30)`,
      `in ${num(transition.speedIn, 2)} %/fr ${transition.direction ?? "-"}`,
      `out ${num(transition.speedOut, 2)} %/fr ${transition.directionOut ?? "-"}`,
      `word at cut: ${wordAt(m, transition.at / fps)}`,
    ].join(" | ");
  });
  return ["transition | shots | at | kind | blur length | speed+direction in | out | word", ...rows].join("\n");
}

export function syncSummary(m: Measurements): string {
  const s = m.sync;
  return [
    `Transitions within ±2 frames of a word onset: ${num(s.cutsOnWord * 100, 0)}% (chance ${num(s.cutsOnWordChance * 100, 0)}%).`,
    `Transitions within ±4 frames of a clause/sentence start: ${num(s.cutsOnClause * 100, 0)}% (chance ${num(s.cutsOnClauseChance * 100, 0)}%).`,
    `Motion bursts finishing before the next clause start: ${describeSpread(s.motionLead, " frames@30")} over ${s.motionBursts} bursts (a rough guide: count on the sheets).`,
  ].join("\n");
}

export function eventTable(m: Measurements, indices: number[]): string {
  const fps = m.video.fps;
  const rows = indices.map((index) => {
    const event = m.video.events[index]!;
    const around = m.words.filter((word) => word.end * fps >= event.onset - 15 && word.start * fps <= event.end + 15);
    return [
      `M${index + 1}`,
      `S${event.shot}`,
      `frames ${event.onset}–${event.end} (peak ${event.peak}, ${frames30(event.frames, fps)} frames@30)`,
      `strength ${num(event.strength, 3)}`,
      `words: ${around.map((word) => `${word.w}@f${Math.round(word.start * fps)}`).join(" ")}`,
    ].join(" | ");
  });
  return ["burst | shot | frames | strength | nearby words (first frame)", ...rows].join("\n");
}

export function transcript(m: Measurements): string {
  const fps = m.video.fps;
  const sentences = m.speech.sentences.map((sentence) => `${num(sentence.start, 2)}–${num(sentence.end, 2)}s (${sentence.words} words): ${sentence.text}`);
  const words = m.words.map((word) => `${word.w}@${num(word.start, 2)}s/f${Math.round(word.start * fps)}`).join(" ");
  return [`Sentences:`, ...sentences, ``, `Every word with its start (seconds/frame):`, words].join("\n");
}

export function audioSummary(m: Measurements): string {
  const { speech, pace } = m;
  const loud = speech.loudness;
  return [
    `Pauses: after sentences ${describeSpread(speech.pauses.sentence, " s", 2)}; after clauses ${describeSpread(speech.pauses.clause, " s", 2)}; between other words ${describeSpread(speech.pauses.word, " s", 2)}.`,
    `Voice pitch: median ${num(speech.pitch.medianHz, 0)} Hz, range ${num(speech.pitch.rangeSemitones)} semitones (p10–p90; music can inflate it).`,
    `Loudness: ${loud ? `${num(loud.integrated)} LUFS integrated, range ${num(loud.range)} LU, true peak ${num(loud.truePeak)} dBFS` : "not measured"}.`,
    `Music bed: ${speech.levels.bed}${speech.levels.voiceOverBed !== null ? `, voice about ${num(speech.levels.voiceOverBed)} dB above it (voice ${num(speech.levels.speechDb)} dB, pauses ${num(speech.levels.gapDb ?? Number.NaN)} dB)` : ""}.`,
    `Hook: first sentence ends at ${num(pace.hook.end, 2)} s: "${pace.hook.text}"`,
    `Ending: last sentence from ${num(pace.ending.start, 2)} s: "${pace.ending.text}"`,
    `Last frame vs first frame similarity: ${num(pace.loopFrameSimilarity, 2)} (1 = the same picture).`,
    `Words per shot: ${describeSpread(pace.wordsPerShot, "")}.`,
  ].join("\n");
}

export function paletteSummary(m: Measurements, sheets: SheetSet): string {
  const rows = m.video.shots.map((shot) => {
    const swatches = sheets.palettes[`S${shot.index}`] ?? [];
    return `S${shot.index}: ${swatches.map((swatch) => `${swatch.hex} ${Math.round(swatch.share * 100)}%`).join(", ")}`;
  });
  return [`Dominant colours of each shot's middle frame (share of the frame):`, ...rows].join("\n");
}

function shotAt(m: Measurements, frame: number): number {
  return m.video.shots.find((shot) => frame >= shot.start && frame <= shot.end)?.index ?? 0;
}

function wordAt(m: Measurements, t: number): string {
  const word = m.words.find((candidate) => candidate.start <= t + 0.07 && candidate.end >= t - 0.07);
  return word ? `${word.w} (starts ${num((word.start - t) * m.video.fps, 0)} frames from the cut)` : "(pause)";
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
