import { expect, it, vi } from "vitest";
import type { AudioPort } from "../src/ports.ts";
import { advance, approveNext, scriptData, setup } from "./helpers.ts";

it("carries approved delivery directions all the way to the audio backend", async () => {
  const delivery = { emotion: "tense" as const, intensity: 0.7, pauseAfterMs: 600 };
  const { engine, audio } = await setup({ script: () => {
    const script = scriptData();
    return { ...script, lines: script.lines.map((line) => ({ ...line, delivery })) };
  } });
  const measured=vi.fn(async()=>{throw Error("Legacy productions must keep their existing narration route");});
  Object.assign(audio,{ttsMeasured:measured});
  const tts = vi.spyOn(audio, "tts");
  const seriesId = await engine.createSeries({ idea: "A difficult choice", language: "en", episodes: 1 });
  for (let gate = 0; gate < 3; gate += 1) {
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
  }
  await advance(engine, seriesId);
  expect(tts).toHaveBeenCalled();
  expect(measured).not.toHaveBeenCalled();
  expect(tts.mock.calls[0]![0][0]).toMatchObject({ delivery });
});

it("frees the renderer's browser before loading the voice, so both never sit in memory at once", async () => {
  const { engine, audio, render } = await setup();
  let releasedBeforeTts = -1;
  vi.spyOn(audio, "tts").mockImplementation(async function (this: typeof audio, ...args) {
    releasedBeforeTts = render.releases;
    return Object.getPrototypeOf(audio).tts.apply(this, args);
  });
  const seriesId = await engine.createSeries({ idea: "A quiet harbour", language: "en", episodes: 1 });
  for (let gate = 0; gate < 3; gate += 1) {
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
  }
  await advance(engine, seriesId);
  expect(releasedBeforeTts).toBe(1);
});

it("publishes saved-line progress in order before reporting speech complete", async () => {
  const { engine, audio } = await setup();
  const original = audio.tts.bind(audio);
  const speak = async (...[lines, voice, language, outDir, _signal, onProgress]: Parameters<AudioPort["tts"]>) => {
    onProgress?.(1, lines.length);
    onProgress?.(lines.length, lines.length);
    return original(lines, voice, language, outDir);
  };
  audio.tts = speak;
  const messages: string[] = [];
  engine.on("ai.activity", event => {
    if (event.data.key === "ep-01/voiceover") messages.push(String(event.data.message));
  });
  const seriesId = await engine.createSeries({ idea: "A slow ocean narration", language: "en", episodes: 1 });
  for (let gate = 0; gate < 3; gate += 1) {
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
  }
  await advance(engine, seriesId);
  const saved = messages.filter(message => message.startsWith("Narration:"));
  expect(saved).toEqual([
    "Narration: 1 of 8 lines saved. Completed lines will be reused on retry.",
    "Narration: 8 of 8 lines saved. Completed lines will be reused on retry.",
  ]);
  expect(messages.indexOf(saved[1]!)).toBeLessThan(messages.findIndex(message => message.startsWith("Speech generated.")));
});
