// Across references: the measured numbers side by side (computed here, never by the AI), the style editor that merges
// the reference cards into one rule set, the check that no reference content leaked into it, and the template writer.
import * as z from "zod";
import type { ReferenceCard } from "./agents.ts";
import { frames30, type Measurements } from "./measure.ts";
import { formatRange, median, round } from "./stats.ts";

export interface MetricRow {
  key: string;
  label: string;
  unit: string;
  values: number[]; // one per reference
  within: string[]; // the spread inside each reference, where it has one
  how: string; // how it was measured
}

export function metricTable(all: Measurements[]): MetricRow[] {
  const rows: MetricRow[] = [];
  const add = (key: string, label: string, unit: string, how: string, value: (m: Measurements) => number, within?: (m: Measurements) => string) =>
    rows.push({ key, label, unit, how, values: all.map((m) => round(value(m), 3)), within: all.map((m) => within?.(m) ?? "") });
  const shotsMeasured = (m: Measurements) => m.video.shots.filter((shot) => shot.camera.measured >= 0.5);
  const transitionShare = (m: Measurements, kinds: string[]) => m.video.transitions.filter((t) => kinds.includes(t.kind)).length / Math.max(1, m.video.transitions.length);

  add("duration", "Length", "s", "ffprobe", (m) => m.video.duration);
  add("pictureEvery", "A new picture every", "s", "duration ÷ shots", (m) => m.pace.pictureEvery, (m) => `${formatRange(m.pace.shotSeconds.p10, m.pace.shotSeconds.p90, 2)} s (p10–p90)`);
  add("firstChange", "First picture change", "s", "first detected transition", (m) => m.pace.firstChange);
  add("hardCuts", "Hard cuts", "% of transitions", "one-frame change", (m) => transitionShare(m, ["cut"]) * 100);
  add("blurTransitions", "Zoom/whip/blur transitions", "% of transitions", "multi-frame motion blur where tracking collapses", (m) => transitionShare(m, ["zoom", "whip", "blur"]) * 100);
  add("blurLength", "Blur transition length", "frames@30", "frames in each multi-frame transition", (m) =>
    median(m.video.transitions.filter((t) => t.kind !== "cut").map((t) => frames30(t.end - t.start + 1, m.video.fps))));
  add("cameraMoving", "Camera moving", "% of frames", "frames above 1.5 %/s, shots with ≥50% tracking", (m) => {
    const shots = shotsMeasured(m);
    const frames = shots.reduce((total, shot) => total + shot.end - shot.start + 1, 0);
    return (shots.reduce((total, shot) => total + shot.camera.moving * (shot.end - shot.start + 1), 0) / Math.max(1, frames)) * 100;
  });
  add("speedMid", "Camera speed mid-shot", "%/s", "median of each shot's median speed (pan + zoom)", (m) => median(shotsMeasured(m).map((shot) => shot.camera.speedMid)),
    (m) => `${formatRange(...extent(shotsMeasured(m).map((shot) => shot.camera.speedMid)))} %/s across shots`);
  add("zoomRate", "Zoom rate mid-shot", "%/s", "median |zoom| per shot", (m) => median(shotsMeasured(m).map((shot) => shot.camera.zoomRate)));
  add("panRate", "Pan rate mid-shot", "%/s", "median pan per shot", (m) => median(shotsMeasured(m).map((shot) => shot.camera.panRate)));
  add("arrival", "Speed arriving vs mid-shot", "×", "first 3 measured frames ÷ shot median", (m) => median(shotsMeasured(m).map((shot) => shot.camera.speedStart / shot.camera.speedMid)));
  add("exit", "Speed leaving vs mid-shot", "×", "last 3 measured frames ÷ shot median", (m) => median(shotsMeasured(m).map((shot) => shot.camera.speedEnd / shot.camera.speedMid)));
  add("shake", "Camera shake", "% of frame/frame", "RMS frame-to-frame jerk away from transitions", (m) => median(shotsMeasured(m).map((shot) => shot.camera.shake)));
  add("holdStillness", "Leftover motion in holds", "px/frame", "median residual of tracked points while the camera holds", (m) => m.video.holdStillness);
  add("motionBursts", "Motion bursts", "per 10 s", "picture regions moving on their own after undoing the camera", (m) => (m.video.events.length / m.video.duration) * 10);
  add("burstLength", "Motion burst length", "frames@30", "frames above the shot's baseline", (m) => median(m.video.events.map((event) => frames30(event.frames, m.video.fps))));
  add("wpm", "Speaking rate", "wpm", "whisper words ÷ whole length", (m) => m.speech.wpm);
  add("articulationWpm", "Speaking rate while talking", "wpm", "words ÷ time inside words", (m) => m.speech.articulationWpm);
  add("speechRatio", "Speech coverage", "% of the short", "union of word spans (gaps under 0.1 s joined)", (m) => m.speech.speechRatio * 100);
  add("sentencePause", "Pause after a sentence", "s", "gap after . ! ?", (m) => m.speech.pauses.sentence.median, (m) => `${formatRange(m.speech.pauses.sentence.p10, m.speech.pauses.sentence.p90, 2)} s`);
  add("clausePause", "Pause after a clause", "s", "gap after , ; : —", (m) => m.speech.pauses.clause.median);
  add("wordsPerShot", "Words per picture", "words", "words whose midpoint falls in the shot", (m) => m.pace.wordsPerShot.median, (m) => `${formatRange(m.pace.wordsPerShot.p10, m.pace.wordsPerShot.p90, 0)} words`);
  add("hookEnd", "Hook (first sentence) ends", "s", "end of the first sentence", (m) => m.pace.hook.end);
  add("cutsOnClause", "Transitions on a clause start", "%", "within ±4 frames", (m) => m.sync.cutsOnClause * 100, (m) => `chance ${round(m.sync.cutsOnClauseChance * 100, 0)}%`);
  add("loudness", "Loudness", "LUFS", "ffmpeg ebur128 integrated", (m) => m.speech.loudness?.integrated ?? Number.NaN);
  add("voiceOverBed", "Voice above music bed", "dB", "median level in words − in pauses (estimate)", (m) => m.speech.levels.voiceOverBed ?? Number.NaN, (m) => m.speech.levels.bed);
  add("pitch", "Voice pitch", "Hz", "autocorrelation inside words", (m) => m.speech.pitch.medianHz);
  add("pitchRange", "Voice pitch range", "semitones", "p10–p90 inside words", (m) => m.speech.pitch.rangeSemitones);
  add("loopSimilarity", "Last frame vs first frame", "correlation", "colour histogram correlation", (m) => m.pace.loopFrameSimilarity);
  return rows;
}

export function metricText(rows: MetricRow[], ids: string[]): string {
  const header = `metric | default (median) | range (min–max) | ${ids.join(" | ")}`;
  const lines = rows.map((row) => {
    const finite = row.values.filter(Number.isFinite);
    const fallback = row.within.find(Boolean);
    const range = finite.length > 1 ? formatRange(Math.min(...finite), Math.max(...finite)) : fallback ? `within: ${fallback}` : "one value";
    const perRef = row.values.map((value, i) => `${Number.isFinite(value) ? round(value, 2) : "n/a"}${row.within[i] ? ` (${row.within[i]})` : ""}`);
    return `${row.label} [${row.unit}] | ${finite.length ? round(median(finite), 2) : "n/a"} | ${range} | ${perRef.join(" | ")}`;
  });
  return [header, ...lines].join("\n");
}

function extent(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  return finite.length ? [Math.min(...finite), Math.max(...finite)] : [Number.NaN, Number.NaN];
}

// ---------- the style editor ----------

export const SkillDraft = z.object({
  name: z.string(),
  description: z.string().describe('when to use this skill, starting "Use when"'),
  summary: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      intro: z.string(),
      rules: z.array(z.object({ title: z.string(), default: z.string(), range: z.string(), deviateWhen: z.string(), why: z.string() })),
    }),
  ),
  checklist: z.array(z.string()),
  avoid: z.array(z.string()),
});
export type SkillDraft = z.infer<typeof SkillDraft>;

export function mergePrompt(name: string, cards: ReferenceCard[], table: string, ids: string[]): string {
  return [
    `The style is called "${name}". ${cards.length} reference(s): ${ids.join(", ")}.`,
    `## Measured numbers per reference\n${table}`,
    ...cards.map((card, i) => `## Rule card ${ids[i]} (${card.label})\n${JSON.stringify({ summary: card.summary, rules: card.rules, avoid: card.avoid }, null, 1)}`),
    `## Content of the references (must not appear in your output)\n${[...new Set(cards.flatMap((card) => card.contentSpecifics))].join("; ")}`,
  ].join("\n\n");
}

export function revisePrompt(original: string, draft: unknown, leaks: Leak[]): string {
  return [
    original,
    `## Your previous draft\n${JSON.stringify(draft, null, 1)}`,
    `## Revise it\nThese words or phrases come from the references' content, not their technique: ${leaks.map((leak) => `"${leak.phrase}"`).join(", ")}.\nRewrite every place they appear so the rule stays the same but works for any story (use a generic example or none). Change nothing else.`,
  ].join("\n\n");
}

// ---------- content leaks ----------

export interface Leak {
  phrase: string;
  source: string; // which reference it came from and why it counts as content
}

const STOP = new Set(
  "a an the and or but if then so of to in on at by for with from into onto over under about as is are was were be been being it its this that these those there here he she they them his her their we you your i me my our not no just very can will would could should one two three all any some more most much many each every just than too also only out up down off again once who what when where why how which while after before during".split(" "),
);
// Words a style guide uses about film-making itself; never content.
const CRAFT = new Set(
  "camera shot shots frame frames character characters caption captions voice music sound scene scenes word words line lines hook loop cut cuts zoom pan push light lighting colour color face faces eyes mouth gesture story picture pictures video short shorts narrator narration sentence clause beat second seconds".split(" "),
);

function normalise(text: string): string {
  return ` ${text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

export function findLeaks(text: string, refs: { measurements: Measurements; card: ReferenceCard }[]): Leak[] {
  const haystack = normalise(text);
  const leaks = new Map<string, Leak>();
  const flag = (phrase: string, source: string) => {
    const needle = normalise(phrase);
    if (needle.trim() && haystack.includes(needle) && !leaks.has(needle.trim())) leaks.set(needle.trim(), { phrase: needle.trim(), source });
  };

  const generic = (word: string) => STOP.has(word.toLowerCase()) || CRAFT.has(word.toLowerCase()) || word.length < 4;
  for (const { measurements: m, card } of refs) {
    const id = m.ref.id;
    for (const specific of card.contentSpecifics) {
      const parts = atoms(specific);
      for (const atom of parts) {
        const words = normalise(atom).trim().split(" ").filter(Boolean);
        // A phrase is matched whole. A single word only when the agents named it on its own ("tornado"), not when it is
        // a label ("title '…'") or one line of a list ("caption lines: …, 'outside'").
        const named = words.length >= 2 ? words.some((word) => !generic(word)) : parts.length === 1 && !generic(words[0] ?? "");
        if (named) flag(atom, `${id}: content named by the agents`);
        // Names inside a phrase ("team names Alabama and …"); not a capitalised first word, nor a title-cased line.
        const first = atom.split(/\s+/)[0]!.replace(/[^\p{L}\p{N}'-]/gu, "");
        for (const run of capitalisedRuns(atom.split(/\s+/))) {
          if (run.length <= 2 && !run.every(generic) && !(run.length === 1 && run[0] === first)) flag(run.join(" "), `${id}: name in "${atom}"`);
        }
      }
    }
    // Names from the narration: capitalised words that don't start a sentence and aren't part of a title-cased line.
    const spokenWords = m.words.map((word) => word.w);
    const titled = new Set(capitalisedRuns(spokenWords, true).filter((run) => run.length >= 3).flat());
    spokenWords.forEach((word, i) => {
      const bare = word.replace(/[^\p{L}\p{N}'-]/gu, "");
      const sentenceStart = i === 0 || /[.!?]$/.test(spokenWords[i - 1]!);
      if (!sentenceStart && !titled.has(word) && bare.length >= 3 && /^\p{Lu}/u.test(bare) && !STOP.has(bare.toLowerCase())) flag(bare, `${id}: name from the narration`);
    });
    // Lines lifted from the narration: any four words in a row with at least two that carry meaning.
    const spoken = normalise(m.words.map((word) => word.w).join(" ")).trim().split(" ");
    for (let i = 0; i + 4 <= spoken.length; i += 1) {
      const gram = spoken.slice(i, i + 4);
      if (gram.filter((word) => !STOP.has(word)).length >= 2) flag(gram.join(" "), `${id}: words from the narration`);
    }
  }
  return [...leaks.values()];
}

// Agents often pack a list into one string ("caption text: 'a', 'b'; team names X and Y"): split it back into items.
function atoms(specific: string): string[] {
  return specific
    .split(/[,;/()"“”‘’:]|'(?=\s|$)|(?<=\s|^)'|\s+and\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// Runs of consecutive capitalised words ("Mississippi State"). With `all`, the words themselves (as written) are kept.
function capitalisedRuns(words: string[], all = false): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const word of words) {
    const bare = word.replace(/[^\p{L}\p{N}'-]/gu, "");
    if (/^\p{Lu}/u.test(bare)) run.push(all ? word : bare);
    if (!/^\p{Lu}/u.test(bare) || /[.!?,;:]$/.test(word)) {
      if (run.length) runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

// ---------- the template writer ----------

export const TemplateDraft = z.object({
  info: z.object({
    name: z.string(),
    tagline: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    story: z.array(z.string()),
    look: z.array(z.string()),
    missing: z.array(z.string()).default([]), // techniques of the references moco can't render yet
    palette: z.object({ sky: z.array(z.string()).min(2).max(2), ground: z.string(), accents: z.array(z.string()) }),
    world: z.enum(["world", "auto"]),
    episodes: z.number().int().min(1).max(10),
    ideas: z.array(z.object({ label: z.string(), idea: z.string() })),
  }),
  stages: z.object({
    series: z.string(),
    series_extend: z.string(),
    bible: z.string(),
    world: z.string(),
    script: z.string(),
    shots: z.string(),
    scene: z.string(),
    publish: z.string(),
  }),
});
export type TemplateDraft = z.infer<typeof TemplateDraft>;

// Canvas guidance is an explicit opt-in. The legacy compiler and saved templates
// keep their existing schema and renderer choices.
export const ArtistTemplateDraft = TemplateDraft.extend({
  stages: TemplateDraft.shape.stages.extend({ show: z.string(), artist: z.string() }),
});
export type ArtistTemplateDraft = z.infer<typeof ArtistTemplateDraft>;

export function templatePrompt(skill: string, example: string | undefined): string {
  return [
    `## The skill to translate\n${skill}`,
    example ? `## Example template (format and tone only; its style is not this one)\n${example}` : "",
    "Return `info` and one guidance text per stage. Each stage text is the body under that stage's heading: plain lines and bullet points, no heading of its own.",
  ].filter(Boolean).join("\n\n");
}
