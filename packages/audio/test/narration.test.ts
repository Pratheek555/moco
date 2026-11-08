import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Delivery, ScriptLine } from "@moco/spec";
import { chatterboxAudio, performance, narrationFailure } from "../src/chatterbox.ts";
import { joinLines } from "../src/system.ts";
import { wavFrom } from "../src/system.ts";
import type { Line } from "../src/index.ts";

it("reports the actual memory failure ahead of dependency warnings", () => {
  expect(narrationFailure(1, "torch.OutOfMemoryError: CUDA out of memory"))
    .toMatch(/^Not enough GPU memory.*select CPU/);
  expect(narrationFailure(1, "UserWarning: pkg_resources deprecated\nTraceback (most recent call last):\nOSError: The paging file is too small (os error 1455)"))
    .toMatch(/^Not enough memory/);
  expect(narrationFailure(1, "UserWarning: unrelated\nTraceback (most recent call last):\n  worker.py\nValueError: Invalid audio"))
    .toBe("Neural narration failed (1). ValueError: Invalid audio");
});

it("serializes model workers across backend instances and releases the queue after failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-voice-queue-"));
  const worker = join(dir, "worker.mjs");
  const lock = join(dir, "model.lock");
  await writeFile(worker, `import {openSync,closeSync,unlinkSync} from 'node:fs';
    const lock = ${JSON.stringify(lock)};
    const fd = openSync(lock, 'wx');
    setTimeout(() => { closeSync(fd); unlinkSync(lock); console.error('Traceback (most recent call last):\\nValueError: expected test failure'); process.exit(1); }, 100);`);
  const results = await Promise.allSettled([1, 2].map((id) =>
    chatterboxAudio({ python: process.execPath, worker }).tts([{ id: 'a', text: 'Hello.' }],
      { voiceId: 'default', backend: 'chatterbox' }, 'en', join(dir, String(id)))));
  for (const result of results) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason.message).toContain('ValueError: expected test failure');
  }
});

it("keeps old scripts valid and validates performance directions", () => {
  expect(ScriptLine.parse({ id: "l01", text: "Rise.", beat: "rise" }).delivery).toBeUndefined();
  expect(Delivery.safeParse({ emotion: "tense", intensity: 1.5 }).success).toBe(false);
  expect(Delivery.safeParse({ pauseAfterMs: -1 }).success).toBe(false);
});

it("varies emotional energy without driving the model into extreme exaggeration", () => {
  const line = (emotion: "tense" | "warm", intensity: number): Line => ({ id: "l01", text: "Come home.", delivery: { emotion, intensity, pauseAfterMs: 0 } });
  expect(performance(line("tense", 0.9)).exaggeration).toBeGreaterThan(performance(line("warm", 0.3)).exaggeration);
  expect(performance(line("tense", 1), 1).exaggeration).toBeLessThan(1);
});

it("places the next line after its directed pause and never captions the silence", () => {
  const lines: Line[] = [
    { id: "a", text: "Wait.", delivery: { emotion: "tense", intensity: 0.5, pauseAfterMs: 750 } },
    { id: "b", text: "Now.", delivery: { emotion: "resolute", intensity: 0.6, pauseAfterMs: 0 } },
    { id: "c", text: "Go." },
  ];
  const clips = lines.map(() => ({ sampleRate: 1000, samples: new Float32Array(1000).fill(0.2) }));
  const result = joinLines(lines, clips);
  expect(result.words.map(({ start, end }) => [start, end])).toEqual([[0, 1], [1.75, 2.75], [2.75, 3.75]]);
  expect(result.pcm.samples.length).toBe(4150);
  expect([...result.pcm.samples.slice(1000, 1750)].every((value) => value === 0)).toBe(true);
  expect(() => joinLines(lines, clips.slice(1))).toThrow(/exactly one/);
});

it("fails clearly if the neural runtime is missing instead of quietly using robotic speech", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-voice-test-"));
  await expect(chatterboxAudio({ python: join(dir, "missing-python") }).tts([{ id: "a", text: "Hello." }], { voiceId: "narrator", backend: "chatterbox" }, "en", dir)).rejects.toThrow(/voice:setup/);
  expect(await readdir(dir)).toEqual([".voice-cache"]);
  expect(await readdir(join(dir, ".voice-cache"))).toEqual([]);
});

it("does not start synthesis for an already cancelled job", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(chatterboxAudio().tts([{ id: "a", text: "Hello." }], { voiceId: "narrator", backend: "chatterbox" }, "en", tmpdir(), controller.signal)).rejects.toThrow();
});

it("passes performance to the worker and reuses a take when only its pause changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-voice-bridge-"));
  const worker = join(dir, "worker.mjs");
  const capture = join(dir, "captured.json");
  const wav = wavFrom({ sampleRate: 1000, samples: new Float32Array(1000).fill(0.2) });
  await writeFile(worker, `import {readFileSync,writeFileSync} from 'node:fs';
    const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    writeFileSync(${JSON.stringify(capture)}, JSON.stringify(request));
    for (const line of request.lines) writeFileSync(line.file, Buffer.from(${JSON.stringify(wav.toString("base64"))}, 'base64'));`);
  const lines: Line[] = [{ id: "a", text: "Wait.", delivery: { emotion: "tense", intensity: 0.8, pauseAfterMs: 750 } }, { id: "b", text: "Now." }];
  const voice = { voiceId: "narrator", backend: "chatterbox" };
  const first = await chatterboxAudio({ python: process.execPath, worker, device: "gpu" }).tts(lines, voice, "en-IN", dir);
  const request = JSON.parse(await readFile(capture, "utf8"));
  expect(request.language).toBe("en");
  expect(request.device).toBe("gpu");
  expect(request.lines[0].emotion).toBe("tense");
  expect(request.lines[0].text).toBe("Wait.");
  lines[0]!.delivery!.pauseAfterMs = 0;
  const second = await chatterboxAudio({ python: process.execPath, worker: join(dir, "nonexistent.mjs"), device: "gpu" }).tts(lines, voice, "en-IN", dir);
  expect(first.durationSeconds - second.durationSeconds).toBeCloseTo(0.75);
  expect(second.words[1]!.start).toBe(1);
});

async function resumableWorker(body: string) {
  const dir = await mkdtemp(join(tmpdir(), "moco-voice-resume-"));
  const worker = join(dir, "worker.mjs");
  const wav = wavFrom({ sampleRate: 1000, samples: new Float32Array(1000).fill(0.2) });
  await writeFile(worker, `import {readFileSync,writeFileSync,renameSync} from 'node:fs';
    const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const wav = Buffer.from(${JSON.stringify(wav.toString("base64"))}, 'base64');
    const complete = (index) => {
      const line = request.lines[index];
      writeFileSync(line.temporaryFile, wav);
      renameSync(line.temporaryFile, line.file);
      console.log('MOCO_NARRATION_PROGRESS ' + JSON.stringify({completed:index + 1}));
    };
    ${body}`);
  const lines: Line[] = [{ id: "a", text: "First." }, { id: "b", text: "Second." }, { id: "c", text: "Third." }];
  return { dir, worker, lines, voice: { voiceId: "narrator", backend: "chatterbox" } };
}

it("lets a healthy episode exceed the stall deadline while reporting completed lines", async () => {
  const { dir, worker, lines, voice } = await resumableWorker(`
    for (let index = 0; index < request.lines.length; index++) {
      await new Promise(resolve => setTimeout(resolve, 600));
      complete(index);
    }`);
  const progress = vi.fn();
  const started = Date.now();
  const result = await chatterboxAudio({ python: process.execPath, worker, stallTimeoutMs: 1200 }).tts(lines, voice, "en", dir, undefined, progress);
  expect(Date.now() - started).toBeGreaterThan(1200);
  expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  expect(result.words.map(word => word.lineId)).toEqual(["a", "b", "c"]);
  expect((await readdir(join(dir, ".voice-cache"))).every(file => file.endsWith(".wav"))).toBe(true);
});

it("times out a stalled line despite repeated logs, then retries only missing takes with original seeds", async () => {
  const { dir, worker, lines, voice } = await resumableWorker(`
    complete(0);
    writeFileSync(request.lines[1].temporaryFile, 'unfinished audio');
    setInterval(() => {
      console.log('Still working');
      console.log('MOCO_NARRATION_PROGRESS invalid json');
      console.log('MOCO_NARRATION_PROGRESS {"completed":1}');
      console.log('MOCO_NARRATION_PROGRESS {"completed":99}');
    }, 200);`);
  await expect(chatterboxAudio({ python: process.execPath, worker, stallTimeoutMs: 1000 }).tts(lines, voice, "en", dir))
    .rejects.toThrow(/no line progress.*1\/3 new lines saved.*Retry to resume/);
  expect(await readdir(join(dir, ".voice-cache"))).toHaveLength(1);
  const capture = join(dir, "retry.json");
  const retry = await resumableWorker(`
    writeFileSync(${JSON.stringify(capture)}, JSON.stringify(request));
    request.lines.forEach((_, index) => complete(index));`);
  const progress = vi.fn();
  const result = await chatterboxAudio({ python: process.execPath, worker: retry.worker }).tts(lines, voice, "en", dir, undefined, progress);
  const request = JSON.parse(await readFile(capture, "utf8"));
  expect(request.lines.map((line: { text: string; seed: number }) => [line.text, line.seed])).toEqual([["Second.", 43], ["Third.", 44]]);
  expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  expect(result.words.map(word => word.lineId)).toEqual(["a", "b", "c"]);
  expect(await readdir(join(dir, ".voice-cache"))).toHaveLength(3);
});

it("keeps a committed take after cancellation and releases the worker queue for retry", async () => {
  const { dir, worker, lines, voice } = await resumableWorker(`complete(0); setInterval(() => {}, 1000);`);
  const controller = new AbortController();
  await expect(chatterboxAudio({ python: process.execPath, worker }).tts(lines, voice, "en", dir, controller.signal, (completed) => {
    if (completed === 1) controller.abort();
  })).rejects.toThrow(/cancelled/);
  expect(await readdir(join(dir, ".voice-cache"))).toHaveLength(1);
  const retry = await resumableWorker(`request.lines.forEach((_, index) => complete(index));`);
  await expect(chatterboxAudio({ python: process.execPath, worker: retry.worker }).tts(lines, voice, "en", dir)).resolves.toHaveProperty("file");
  expect(await readdir(join(dir, ".voice-cache"))).toHaveLength(3);
});

it("retains valid takes when a later line crashes and regenerates damaged cache entries", async () => {
  const { dir, worker, lines, voice } = await resumableWorker(`
    complete(0);
    writeFileSync(request.lines[1].file, 'damaged audio');
    process.exit(1);`);
  await expect(chatterboxAudio({ python: process.execPath, worker }).tts(lines, voice, "en", dir)).rejects.toThrow(/Neural narration failed/);
  const retry = await resumableWorker(`request.lines.forEach((_, index) => complete(index));`);
  const progress = vi.fn();
  await chatterboxAudio({ python: process.execPath, worker: retry.worker }).tts(lines, voice, "en", dir, undefined, progress);
  expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
});

it("routes character references per line and invalidates cached takes when their recording changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-dialogue-bridge-"));
  const worker = join(dir, "worker.mjs");
  const capture = join(dir, "captured.json");
  const reference = join(dir, "guide.wav");
  const wav = wavFrom({ sampleRate: 1000, samples: new Float32Array(1000).fill(0.2) });
  await writeFile(reference, wav);
  await writeFile(worker, `import {readFileSync,writeFileSync} from 'node:fs';
    const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    writeFileSync(${JSON.stringify(capture)}, JSON.stringify(request));
    for (const line of request.lines) writeFileSync(line.file, Buffer.from(${JSON.stringify(wav.toString("base64"))}, 'base64'));`);
  const audio = chatterboxAudio({ python: process.execPath, worker, voices: { guide: reference } });
  const lines: Line[] = [{ id: "a", text: "Listen." }, { id: "b", text: "I am here.", voiceId: "guide" }];
  const voice = { voiceId: "default", backend: "chatterbox" };
  await audio.tts(lines, voice, "en", dir);
  const request = JSON.parse(await readFile(capture, "utf8"));
  expect(request.lines.map((line: { reference?: string }) => line.reference)).toEqual([undefined, reference]);
  expect((await audio.voices()).map((voice) => voice.id)).toEqual(["default", "guide"]);
  await writeFile(reference, wavFrom({ sampleRate: 1000, samples: new Float32Array(1000).fill(0.3) }));
  const unavailableWorker = chatterboxAudio({ python: process.execPath, worker: join(dir, "missing.mjs"), voices: { guide: reference } });
  await expect(unavailableWorker.tts(lines, voice, "en", dir)).rejects.toThrow();
  await expect(audio.tts([{ id: "c", text: "No.", voiceId: "invented" }], voice, "en", dir)).rejects.toThrow(/Unknown Chatterbox voice/);
});
