// Lip sync v0: mouth shapes from loudness. For each video frame, the voiceover's loudness (RMS) inside a
// spoken word picks how open the mouth is; outside words the mouth rests. No phoneme recognition, no new
// dependency. docs/adr/lip-sync.md compares this with Rhubarb Lip Sync (v1 candidate).
import { FPS, type TimedWord, type VisemeTrack } from "@moco/spec";

export class WavError extends Error {}

export interface Pcm {
  sampleRate: number;
  samples: Float32Array; // mono, -1..1
}

// Reads a 16-bit PCM WAV (mono or stereo, any sample rate), skipping chunks it doesn't need.
export function parseWav(wav: Buffer): Pcm {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new WavError("not a WAV file");
  }
  let format: { channels: number; sampleRate: number; bits: number; encoding: number } | undefined;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = wav.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") {
      format = { encoding: body.readUInt16LE(0), channels: body.readUInt16LE(2), sampleRate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    }
    if (id === "data") data = body;
    offset += 8 + size + (size % 2); // chunks are padded to an even length
  }
  if (!format || !data) throw new WavError("WAV has no fmt or data chunk");
  if (format.encoding !== 1 || format.bits !== 16) {
    throw new WavError(`only 16-bit PCM WAV is supported, got encoding ${format.encoding} at ${format.bits} bits`);
  }

  // Mix every channel down to mono.
  const frameCount = Math.floor(data.length / (2 * format.channels));
  const samples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount * format.channels; i += 1) {
    samples[Math.floor(i / format.channels)]! += data.readInt16LE(i * 2) / 32768 / format.channels;
  }
  return { sampleRate: format.sampleRate, samples };
}

// Loudness thresholds inside a word, relative to the voice's typical loud frame (90th percentile).
// Quietest to loudest: A closed (M B P), B slightly open, C open, D wide open.
const OPENNESS: { below: number; viseme: string }[] = [
  { below: 0.15, viseme: "A" },
  { below: 0.4, viseme: "B" },
  { below: 0.7, viseme: "C" },
  { below: Infinity, viseme: "D" },
];

// Every shape amplitudeVisemes can emit; the kit must draw each one (renderer/test/visemes.test.ts).
export const AMPLITUDE_VISEMES = ["X", ...OPENNESS.map((step) => step.viseme)];

// One key per change of mouth shape, in whole-episode frames. Silent audio gives a resting mouth throughout.
export function amplitudeVisemes(pcm: Pcm, words: TimedWord[], fps = FPS): VisemeTrack {
  const samplesPerFrame = pcm.sampleRate / fps;
  const frameCount = Math.ceil(pcm.samples.length / samplesPerFrame);

  // Loudness per video frame: sum of squares in one pass over the samples, then the root of the mean.
  const sumOfSquares = new Float64Array(frameCount);
  pcm.samples.forEach((sample, index) => {
    sumOfSquares[Math.floor(index / samplesPerFrame)]! += sample * sample;
  });
  const loudness = Array.from(sumOfSquares, (sum) => Math.sqrt(sum / samplesPerFrame));

  // Which frames are inside a spoken word.
  const speaking = new Uint8Array(frameCount);
  words.forEach((word) => speaking.fill(1, Math.round(word.start * fps), Math.round(word.end * fps)));

  const spokenLoudness = loudness.filter((_, frame) => speaking[frame] === 1).sort((a, b) => a - b);
  const reference = spokenLoudness[Math.floor(spokenLoudness.length * 0.9)] ?? 0;

  const perFrame = loudness.map((level, frame) => {
    if (speaking[frame] !== 1 || reference === 0) return "X";
    return OPENNESS.find((step) => level / reference < step.below)!.viseme;
  });
  return toKeys(withoutFlicker(perFrame));
}

// A shape shown for a single frame reads as flicker: it takes the previous frame's shape instead.
function withoutFlicker(perFrame: string[]): string[] {
  return perFrame.map((viseme, frame) => {
    const before = perFrame[frame - 1];
    const after = perFrame[frame + 1];
    const isolated = before !== undefined && after !== undefined && viseme !== before && viseme !== after;
    return isolated ? before : viseme;
  });
}

function toKeys(perFrame: string[]): VisemeTrack {
  return perFrame.flatMap((viseme, frame) => (viseme === perFrame[frame - 1] ? [] : [{ frame, viseme }]));
}

