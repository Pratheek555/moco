import { describe, expect, it } from "vitest";
import { amplitudeVisemes, parseWav, WavError } from "../src/lipsync.ts";

const RATE = 16_000;

// A 16-bit WAV with a 220 Hz tone whose loudness follows `envelope` (one value per 1/30 s), deterministic.
function toneWav(envelope: number[], channels = 1): Buffer {
  const perFrame = RATE / 30;
  const samples = Math.round(envelope.length * perFrame); // 16 kHz / 30 fps is not a whole number, like real files
  const dataBytes = samples * 2 * channels;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 2 * channels, 28);
  wav.writeUInt16LE(2 * channels, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples * channels; i += 1) {
    const sample = Math.floor(i / channels);
    const level = envelope[Math.floor(sample / perFrame)]!;
    wav.writeInt16LE(Math.round(level * 20000 * Math.sin((2 * Math.PI * 220 * sample) / RATE)), 44 + i * 2);
  }
  return wav;
}

describe("lip sync v0", () => {
  // 10 frames silent, a word of rising loudness (frames 10–30), 10 frames silent.
  const envelope = [...Array(10).fill(0), ...Array.from({ length: 20 }, (_, i) => (i + 1) / 20), ...Array(10).fill(0)];
  const words = [{ text: "namaste", start: 10 / 30, end: 30 / 30, lineId: "l1" }];

  it("rests outside words and opens wider as the voice gets louder", () => {
    const track = amplitudeVisemes(parseWav(toneWav(envelope)), words);
    expect(track[0]).toEqual({ frame: 0, viseme: "X" });
    expect(track.at(-1)).toEqual({ frame: 30, viseme: "X" });
    const shapes = track.slice(1, -1).map((key) => key.viseme);
    expect(shapes).toEqual(["A", "B", "C", "D"]); // quietest to loudest, in order
  });

  it("gives a resting mouth for silent audio and is the same for stereo", () => {
    expect(amplitudeVisemes(parseWav(toneWav(Array(40).fill(0))), words)).toEqual([{ frame: 0, viseme: "X" }]);
    expect(amplitudeVisemes(parseWav(toneWav(envelope, 2)), words)).toEqual(amplitudeVisemes(parseWav(toneWav(envelope)), words));
  });

  it("refuses files it can't read", () => {
    expect(() => parseWav(Buffer.from("not audio"))).toThrow(WavError);
    const float = toneWav(envelope);
    float.writeUInt16LE(3, 20); // IEEE float
    expect(() => parseWav(float)).toThrow(/16-bit PCM/);
  });
});
