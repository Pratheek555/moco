import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { placeholderAudio } from "../src/index.ts";

it("writes a silent WAV as long as the narration, with ordered word timings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-audio-"));
  const result = await placeholderAudio({ wordsPerMinute: 120 }).tts([{ id: "l01", text: "one two three four" }], { voiceId: "v", backend: "b" }, "en", dir);
  expect(result.durationSeconds).toBeCloseTo(3 * 0.5 + 0.85 * 0.5 + 0.4);
  expect(result.words.map((word) => word.lineId)).toEqual(["l01", "l01", "l01", "l01"]);
  const wav = await readFile(result.file);
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.readUInt32LE(40)).toBe(Math.round(result.durationSeconds * 16_000) * 2);
});
