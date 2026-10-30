// @moco/audio — voiceover, timings, music.
// `systemAudio` speaks with the OS voices (macOS say, Windows SAPI, espeak-ng); the neural TTS choice is still open
// (docs/reference.md R5). `placeholderAudio` is the silent stand-in for tests and machines with no voice:
// it writes a silent WAV as long as the narration would take and spaces the words evenly,
// so the whole pipeline (shot timing, captions, renders) runs end to end.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TimedWord } from "@moco/spec";
import { amplitudeVisemes, parseWav } from "./lipsync.ts";

export { AMPLITUDE_VISEMES, amplitudeVisemes, parseWav, WavError } from "./lipsync.ts";
export { joinLines, systemAudio, systemVoices, type SystemAudioOptions, type VoiceInfo } from "./system.ts";

export interface Line {
  id: string;
  text: string;
}

export interface PlaceholderOptions {
  wordsPerMinute?: number; // speaking rate to fake; default 150 (English)
}

const SAMPLE_RATE = 16_000;
const TAIL_SECONDS = 0.4; // silence after the last word

// Same shape as the engine's AudioPort.
export function placeholderAudio(options: PlaceholderOptions = {}) {
  const secondsPerWord = 60 / (options.wordsPerMinute ?? 150);

  const time = (lines: Line[]): TimedWord[] => {
    const tokens = lines.flatMap((line) => line.text.split(/\s+/).filter(Boolean).map((text) => ({ text, lineId: line.id })));
    return tokens.map((token, index) => ({ ...token, start: index * secondsPerWord, end: (index + 0.85) * secondsPerWord }));
  };

  return {
    // shortcut: silent audio with even timings; replace with real TTS once the R5 spike picks an engine.
    async tts(lines: Line[], _voice: { voiceId: string; backend: string }, _language: string, outDir: string) {
      const words = time(lines);
      const durationSeconds = (words.at(-1)?.end ?? 0) + TAIL_SECONDS;
      await mkdir(outDir, { recursive: true });
      const file = join(outDir, "vo.wav");
      await writeFile(file, silentWav(durationSeconds));
      return { file, durationSeconds, words };
    },
    async align(_file: string, lines: Line[]) {
      return time(lines);
    },
    // Lip sync v0 works on any 16-bit WAV; on the silent placeholder it gives a resting mouth.
    async visemes(file: string, words: TimedWord[]) {
      return amplitudeVisemes(parseWav(await readFile(file)), words);
    },
  };
}

// 16-bit mono PCM WAV of silence.
export function silentWav(seconds: number): Buffer {
  const samples = Math.round(seconds * SAMPLE_RATE);
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes); // zero-filled = silence
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  wav.writeUInt16LE(2, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}
