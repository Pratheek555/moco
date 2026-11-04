import { expect, it, vi } from "vitest";
import { advance, approveNext, scriptData, setup } from "./helpers.ts";

it("carries approved delivery directions all the way to the audio backend", async () => {
  const delivery = { emotion: "tense" as const, intensity: 0.7, pauseAfterMs: 600 };
  const { engine, audio } = await setup({ script: () => {
    const script = scriptData();
    return { ...script, lines: script.lines.map((line) => ({ ...line, delivery })) };
  } });
  const tts = vi.spyOn(audio, "tts");
  const seriesId = await engine.createSeries({ idea: "A difficult choice", language: "en", episodes: 1 });
  for (let gate = 0; gate < 3; gate += 1) {
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
  }
  await advance(engine, seriesId);
  expect(tts).toHaveBeenCalled();
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
