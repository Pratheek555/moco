import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { joinLines, parseWav, systemAudio } from "../src/index.ts";

it("joins lines with a pause and times each line's words inside its own audio", () => {
  const second = (sampleRate: number) => ({ sampleRate, samples: new Float32Array(sampleRate) });
  const lines = [
    { id: "l01", text: "go now" },
    { id: "l02", text: "rise" },
  ];
  const { pcm, words } = joinLines(lines, [second(1000), second(1000)]);
  expect(pcm.samples.length).toBe(1000 + 250 + 1000 + 400); // line, pause, line, tail
  expect(words.map((word) => [word.text, word.lineId, word.start, word.end])).toEqual([
    ["go", "l01", 0, 0.4],
    ["now", "l01", 0.4, 1],
    ["rise", "l02", 1.25, 2.25],
  ]);
  expect(() => joinLines(lines, [second(1000), second(2000)])).toThrow(/2000 Hz/);
});

it.runIf(process.platform === "darwin")("speaks with macOS say into one WAV whose length matches the words", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-say-"));
  const lines = [
    { id: "l01", text: "Arjuna, stand up." },
    { id: "l02", text: "Do your duty." },
  ];
  const result = await systemAudio().tts(lines, { voiceId: "default", backend: "system" }, "en", dir);
  const pcm = parseWav(await readFile(result.file));
  expect(pcm.samples.length / pcm.sampleRate).toBeCloseTo(result.durationSeconds, 3);
  expect(result.words.map((word) => word.text)).toEqual(["Arjuna,", "stand", "up.", "Do", "your", "duty."]);
  expect(result.words.at(-1)!.end).toBeLessThan(result.durationSeconds);
  expect(Math.max(...pcm.samples.map(Math.abs))).toBeGreaterThan(0.05); // not silence
}, 30_000);
