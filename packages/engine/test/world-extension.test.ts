import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { advance, approveNext, scriptData, setup, testWorld } from "./helpers.ts";

it("extends a generated-world series without replacing its cast, world or approved narration directions", async () => {
  const delivery = { emotion: "resolute", intensity: 0.6, pauseAfterMs: 450 };
  const { engine, dir, ai } = await setup({
    bible: () => ({ cast: [], style: { palette: [], captionStyle: "bold", mood: "adventure" } }),
    world: () => testWorld(),
    script: () => { const script = scriptData(); return { ...script, lines: script.lines.map((line) => ({ ...line, delivery })) }; },
  });
  const seriesId = await engine.createSeries({ idea: "A sailor at an unfamiliar harbour", language: "en", episodes: 1 });
  for (let gate = 0; gate < 3; gate += 1) {
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
  }
  const saved = async (file: string) => readFile(join(dir, seriesId, file), "utf8");
  const world = await saved("artifacts/world.json");
  const bible = await saved("artifacts/bible.json");
  const script = await saved("episodes/ep-01/artifacts/script.json");
  const job = await engine.waitForJob(await engine.extendSeries(seriesId, { episodes: 1, note: "Continue the harbour adventure" }));
  expect(job.status).toBe("succeeded");
  await approveNext(engine, seriesId);
  expect((await engine.status(seriesId)).series.episodes).toBe(2);
  expect(await saved("artifacts/world.json")).toBe(world);
  expect(await saved("artifacts/bible.json")).toBe(bible);
  expect(await saved("episodes/ep-01/artifacts/script.json")).toBe(script);
  expect(JSON.parse(script).data.lines[0].delivery).toEqual(delivery);
  expect(ai.requests.filter((request) => request.system.includes("prompt: world"))).toHaveLength(1);
});
