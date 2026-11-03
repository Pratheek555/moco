// Turns measure.py's transcript, loudness envelope and pitch track into the numbers a narration has to hit:
// speaking rate, how much of the short is speech, pause lengths, voice range and how loud the music sits under it.
import { median, quantile, round, spread, type Spread } from "./stats.ts";

export interface Word {
  w: string;
  start: number; // seconds
  end: number;
  p: number; // whisper's confidence
}

export interface AudioRaw {
  tool: string;
  model: string;
  language: string;
  languageProbability: number;
  duration: number;
  words: Word[];
  segments: { start: number; end: number; text: string }[];
  levels: { hop: number; db: number[] };
  pitch: { hop: number; hz: number[] };
}

export interface Loudness {
  integrated: number; // LUFS
  range: number; // LU
  truePeak: number; // dBFS
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
  words: number;
}

export interface SpeechAnalysis {
  language: string;
  words: number;
  wpm: number; // words per minute over the whole short, wall to wall
  articulationWpm: number; // words per minute of actual speech
  speechRatio: number; // fraction of the short with a voice
  pauses: { sentence: Spread; clause: Spread; word: Spread }; // seconds
  sentences: Sentence[];
  clauseStarts: number[]; // seconds: the first word of every sentence or clause
  pitch: { medianHz: number; rangeSemitones: number }; // range is p10–p90
  levels: { speechDb: number; gapDb: number | null; voiceOverBed: number | null; bed: "music" | "silence" | "unknown" };
  loudness?: Loudness;
}

const SENTENCE_END = /[.!?…]["')\]]*$/;
const CLAUSE_END = /[,;:—–-]["')\]]*$/;

export function analyseSpeech(raw: AudioRaw, duration: number, loudness?: Loudness): SpeechAnalysis {
  const words = raw.words.filter((word) => word.end > word.start);
  const sentences = splitSentences(words);
  const clauseStarts = words.filter((word, i) => i === 0 || SENTENCE_END.test(words[i - 1]!.w) || CLAUSE_END.test(words[i - 1]!.w)).map((word) => word.start);

  const gaps = { sentence: [] as number[], clause: [] as number[], word: [] as number[] };
  for (let i = 0; i < words.length - 1; i += 1) {
    const gap = Math.max(0, words[i + 1]!.start - words[i]!.end);
    if (SENTENCE_END.test(words[i]!.w)) gaps.sentence.push(gap);
    else if (CLAUSE_END.test(words[i]!.w)) gaps.clause.push(gap);
    else gaps.word.push(gap);
  }

  const speaking = speechSpans(words, 0.1);
  const spoken = speaking.reduce((total, [a, b]) => total + (b - a), 0);
  return {
    language: raw.language,
    words: words.length,
    wpm: round((words.length / Math.max(duration, 1e-3)) * 60, 1),
    articulationWpm: round((words.length / Math.max(spoken, 1e-3)) * 60, 1),
    speechRatio: round(spoken / Math.max(duration, 1e-3), 3),
    pauses: { sentence: spread(gaps.sentence), clause: spread(gaps.clause), word: spread(gaps.word) },
    sentences,
    clauseStarts,
    pitch: pitchRange(raw.pitch, words),
    levels: levelsUnderVoice(raw.levels, words),
    loudness,
  };
}

function splitSentences(words: Word[]): Sentence[] {
  const sentences: Sentence[] = [];
  let current: Word[] = [];
  for (const word of words) {
    current.push(word);
    if (SENTENCE_END.test(word.w)) {
      sentences.push(sentenceOf(current));
      current = [];
    }
  }
  if (current.length > 0) sentences.push(sentenceOf(current));
  return sentences;
}

function sentenceOf(words: Word[]): Sentence {
  return { text: words.map((word) => word.w).join(" "), start: words[0]!.start, end: words.at(-1)!.end, words: words.length };
}

// Word intervals merged across gaps shorter than `join` seconds (co-articulation, not pauses).
export function speechSpans(words: Word[], join: number): [number, number][] {
  const spans: [number, number][] = [];
  for (const word of words) {
    const last = spans.at(-1);
    if (last && word.start - last[1] < join) last[1] = Math.max(last[1], word.end);
    else spans.push([word.start, word.end]);
  }
  return spans;
}

function pitchRange(pitch: AudioRaw["pitch"], words: Word[]): SpeechAnalysis["pitch"] {
  const voiced = pitch.hz.filter((hz, i) => hz > 0 && words.some((word) => i * pitch.hop >= word.start && i * pitch.hop <= word.end));
  const low = quantile(voiced, 0.1);
  const high = quantile(voiced, 0.9);
  return { medianHz: round(median(voiced), 1), rangeSemitones: round(12 * Math.log2(high / low), 1) };
}

// Voice level inside words vs the level in the gaps between sentences, where only the music bed (if any) plays.
// An estimate: reverb tails leak into short gaps, so the real difference is a little larger.
function levelsUnderVoice(levels: AudioRaw["levels"], words: Word[]): SpeechAnalysis["levels"] {
  const speech: number[] = [];
  const gap: number[] = [];
  levels.db.forEach((db, i) => {
    const t = (i + 0.5) * levels.hop;
    if (words.some((word) => t > word.start + 0.03 && t < word.end - 0.03)) speech.push(db);
    else if (isInGap(t, words)) gap.push(db);
  });
  const speechDb = round(median(speech), 1);
  if (gap.length < 3) return { speechDb, gapDb: null, voiceOverBed: null, bed: "unknown" };
  const gapDb = round(median(gap), 1);
  if (gapDb < -55) return { speechDb, gapDb, voiceOverBed: null, bed: "silence" };
  return { speechDb, gapDb, voiceOverBed: round(speechDb - gapDb, 1), bed: "music" };
}

// In a pause of at least 0.15 s, at least 0.05 s from the words on either side (or before the first/after the last).
function isInGap(t: number, words: Word[]): boolean {
  const next = words.findIndex((word) => word.start > t);
  const before = next === -1 ? words.at(-1) : words[next - 1];
  const after = next === -1 ? undefined : words[next];
  const from = before ? before.end : 0;
  const to = after ? after.start : Number.POSITIVE_INFINITY;
  return to - from >= 0.15 && t - from >= 0.05 && to - t >= 0.05;
}

// Reads the summary ffmpeg's ebur128 filter prints at the end of stderr.
export function parseEbur128(stderr: string): Loudness | undefined {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const value = (pattern: RegExp) => Number(pattern.exec(summary)?.[1]);
  const loudness = { integrated: value(/I:\s+(-?[\d.]+) LUFS/), range: value(/LRA:\s+(-?[\d.]+) LU/), truePeak: value(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
  return Number.isFinite(loudness.integrated) ? loudness : undefined;
}
