import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { elevenLabsAudio, elevenLabsVoices } from "../src/elevenlabs.ts";
import { parseWav } from "../src/lipsync.ts";
import type { Line } from "../src/index.ts";

const directories: string[] = [];
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "moco-elevenlabs-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

const key = "sk-test-only-never-a-real-key";
const voice = { voiceId: "approved-narrator", backend: "elevenlabs" };
const options = { apiKey: key, voiceId: "current-settings-voice", rate: 1.1 };
function take(text: string) {
  const characters = [...text];
  return {
    audio_base64: Buffer.alloc(22_050 * 2).toString("base64"),
    alignment: { characters,
      character_start_times_seconds: characters.map((_, i) => i * 0.8 / characters.length),
      character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.8 / characters.length) },
  };
}
function workingFetch() {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => Response.json(take(JSON.parse(String(init?.body)).text)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

it("loads all account voices with pagination, without silently dropping private voices", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ voices: [{ voice_id: "one", name: "One", labels: { language: "en" } }], has_more: true, next_page_token: "next/page" }))
    .mockResolvedValueOnce(Response.json({ voices: [{ voice_id: "two", name: "My clone" }], has_more: false }));
  vi.stubGlobal("fetch", fetch);
  expect(await elevenLabsVoices(key)).toEqual([{ id: "one", name: "One", locale: "en" }, { id: "two", name: "My clone", locale: "" }]);
  expect(fetch.mock.calls[1]![0]).toBe("https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false&next_page_token=next%2Fpage");
  expect(fetch.mock.calls[0]![1].headers["xi-api-key"]).toBe(key);
});

it("writes playable WAV, preserves approved narrator/character voices, measured Unicode timings and directed pauses", async () => {
  const fetch = workingFetch();
  const lines: Line[] = [{ id: "a", text: "Wait here.", delivery: { emotion: "tense", intensity: 0.7, pauseAfterMs: 750 } }, { id: "b", text: "हाँ 🌟", speaker: "guide", voiceId: "my-clone" }];
  const progress = vi.fn();
  const dir = await directory();
  const audio = elevenLabsAudio(options);
  const spoken = await audio.tts(lines, voice, "hi-IN", dir, undefined, progress);
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    "https://api.elevenlabs.io/v1/text-to-speech/approved-narrator/with-timestamps?output_format=pcm_22050",
    "https://api.elevenlabs.io/v1/text-to-speech/my-clone/with-timestamps?output_format=pcm_22050",
  ]);
  expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ text: "Wait here.", model_id: "eleven_multilingual_v2", voice_settings: { speed: 1.1 }, next_text: "हाँ 🌟" });
  expect(spoken.backend).toBe("elevenlabs");
  expect(spoken.durationSeconds).toBeCloseTo(3.15, 4);
  expect(spoken.words.map(word => [word.lineId, word.text])).toEqual([["a", "Wait"], ["a", "here."], ["b", "हाँ"], ["b", "🌟"]]);
  expect(spoken.words[0]!.end).toBeCloseTo(0.8 * 4 / 10); // measured speech ends before the clip ends
  expect(spoken.words[2]!.start).toBeCloseTo(1.75, 4);
  expect(spoken.words[3]!.end).toBeCloseTo(2.55, 4);
  const wav = parseWav(await readFile(spoken.file));
  expect(wav.sampleRate).toBe(22_050);
  expect(wav.samples.length / wav.sampleRate).toBeCloseTo(spoken.durationSeconds);
  expect(await audio.visemes(spoken.file, spoken.words)).not.toHaveLength(0);
  expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
  for (const file of await readdir(join(dir, ".voice-cache"))) {
    expect(await readFile(join(dir, ".voice-cache", file), "utf8")).not.toContain(key);
  }
});

it("reuses saved takes after a paid request fails and after only a pause changes", async () => {
  const dir = await directory();
  const lines: Line[] = [{ id: "a", text: "Stay." }, { id: "b", text: "Go." }];
  const fetch = workingFetch();
  fetch.mockImplementationOnce(async () => Response.json(take("Stay.")))
    .mockImplementationOnce(async () => Response.json({ detail: { message: key } }, { status: 429 }));
  const audio = elevenLabsAudio(options);
  await expect(audio.tts(lines, voice, "en", dir)).rejects.toThrow(/429.*credit limit/);
  expect(await readdir(join(dir, ".voice-cache"))).toHaveLength(1);
  await audio.tts(lines, voice, "en", dir);
  expect(fetch).toHaveBeenCalledTimes(3);
  const changedPause = await audio.tts([{ ...lines[0]!, delivery: { emotion: "neutral", intensity: 0.5, pauseAfterMs: 500 } }, lines[1]!], voice, "en", dir);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(changedPause.words[1]!.start).toBeCloseTo(1.5);
  const cache = (await readdir(join(dir, ".voice-cache")))[0]!;
  await writeFile(join(dir, ".voice-cache", cache), "damaged");
  await audio.tts(lines, voice, "en", dir);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("invalidates takes when the actual voice or speed changes, without key-dependent cache entries", async () => {
  const dir = await directory();
  const fetch = workingFetch();
  const lines = [{ id: "a", text: "Hello." }];
  await elevenLabsAudio(options).tts(lines, voice, "en", dir);
  await elevenLabsAudio({ ...options, apiKey: "rotated-test-key" }).tts(lines, voice, "en", dir);
  expect(fetch).toHaveBeenCalledTimes(1);
  await elevenLabsAudio({ ...options, rate: 1.2 }).tts(lines, voice, "en", dir);
  await elevenLabsAudio(options).tts(lines, { ...voice, voiceId: "another-voice" }, "en", dir);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each([401, 403, 402, 429, 500])("reports HTTP %i with actionable errors and never echoes provider secrets", async (status) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ detail: { message: key } }, { status }));
  vi.stubGlobal("fetch", fetch);
  const error = await elevenLabsVoices(key).catch(error => error as Error);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain(String(status));
  expect(String(error)).not.toContain(key);
  expect(fetch).toHaveBeenCalledTimes(1); // no automatic retry of potentially billed requests
});

it("identifies an exhausted character allowance even when ElevenLabs returns HTTP 401", async () => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({detail:{status:"quota_exceeded",message:key}},{status:401})));
  const error=await elevenLabsVoices(key).catch(error=>error as Error);
  expect(String(error)).toContain("character allowance");
  expect(String(error)).toContain("completed narration takes will be reused");
  expect(String(error)).not.toContain(key);
});

it("cancels an in-flight request and never starts an already cancelled synthesis", async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async (_url, init) => {
    controller.abort();
    init.signal.throwIfAborted();
  });
  vi.stubGlobal("fetch", fetch);
  const audio = elevenLabsAudio(options);
  await expect(audio.tts([{ id: "a", text: "Hello." }], voice, "en", await directory(), controller.signal)).rejects.toThrow(/abort/i);
  await expect(audio.tts([{ id: "a", text: "Hello." }], voice, "en", await directory(), controller.signal)).rejects.toThrow(/abort/i);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects missing credentials, unsupported languages and invalid speed before sending text", async () => {
  const fetch = workingFetch();
  const dir = await directory(), lines = [{ id: "a", text: "Hello." }];
  await expect(elevenLabsAudio({ ...options, apiKey: "" }).tts(lines, voice, "en", dir)).rejects.toThrow(/API key/);
  await expect(elevenLabsAudio({ ...options, voiceId: "" }).tts(lines, { ...voice, voiceId: "default" }, "en", dir)).rejects.toThrow(/Choose.*voice/);
  await expect(elevenLabsAudio(options).tts(lines, voice, "te", dir)).rejects.toThrow(/does not support/);
  await expect(elevenLabsAudio({ ...options, rate: 1.4 }).tts(lines, voice, "en", dir)).rejects.toThrow(/speed/);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["missing", "mismatch", "out-of-bounds"])("rejects %s timestamps instead of estimating word boundaries", async (kind) => {
  const result = take("Hello.");
  if (kind === "missing") Object.assign(result, { alignment: null });
  if (kind === "mismatch") result.alignment.characters[0] = "Y";
  if (kind === "out-of-bounds") result.alignment.character_end_times_seconds[0] = 99;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(result)));
  const dir = await directory();
  await expect(elevenLabsAudio(options).tts([{ id: "a", text: "Hello." }], voice, "en", dir)).rejects.toThrow(/timestamps|timing/);
  expect(await readdir(join(dir, ".voice-cache"))).toEqual([]);
});
