import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { SeriesPlan } from "@moco/spec";
import { advance, approveNext, setup } from "./helpers.ts";

it("views another engine's committed extension without a false tamper error or ledger writes", async () => {
  const viewer = await setup();
  const id = await viewer.engine.createSeries({ idea: "A harbour adventure", language: "en", episodes: 1 });
  await advance(viewer.engine, id);
  await approveNext(viewer.engine, id);
  await viewer.engine.readArtifact({ seriesId: id, file: "artifacts/series_plan.json" });
  const writer = await setup({}, viewer.dir);
  const job = await writer.engine.waitForJob(await writer.engine.extendSeries(id, { episodes: 1, note: "A new harbour" }));
  expect(job.status).toBe("succeeded");
  const ledgerPath = join(viewer.dir, id, "ledger.json");
  const before = await readFile(ledgerPath, "utf8");
  const artifact = await viewer.engine.readArtifact({ seriesId: id, file: "artifacts/series_plan.json" }) as { data: SeriesPlan };
  expect(artifact.data.episodes).toHaveLength(2);
  expect((await viewer.engine.status(id)).series.episodes).toBe(2);
  expect((await viewer.engine.history({ seriesId: id, file: "artifacts/series_plan.json" })).map((entry) => entry.revision)).toEqual([0, 1]);
  expect(await readFile(ledgerPath, "utf8")).toBe(before);
  // A real edit without an engine commit must still be rejected.
  const path = join(viewer.dir, id, "artifacts/series_plan.json");
  const edited = JSON.parse(await readFile(path, "utf8"));
  edited.data.title = "Uncommitted edit";
  await writeFile(path, JSON.stringify(edited));
  await expect(viewer.engine.readArtifact({ seriesId: id, file: "artifacts/series_plan.json" })).rejects.toMatchObject({ code: "modified_externally" });
});

it("does not mark another engine's active generation interrupted merely by opening it", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const writer = await setup({ series: (request) => {
    started();
    return new Promise((_, reject) => request.signal!.addEventListener("abort", () => reject(new Error("cancelled"))));
  } });
  const id = await writer.engine.createSeries({ idea: "Still generating", language: "en", episodes: 1 });
  const job = await writer.engine.runStage({ seriesId: id });
  await ready;
  try {
    const path = join(writer.dir, id, "ledger.json");
    const before = await readFile(path, "utf8");
    const viewer = await setup({}, writer.dir);
    const status = await viewer.engine.status(id);
    expect(status.jobs.find((entry) => entry.id === job)?.status).toBe("running");
    expect(status.next).toMatchObject({ kind: "waiting", status: "running" });
    expect(await readFile(path, "utf8")).toBe(before);
  } finally {
    await writer.engine.cancel(job);
    await writer.engine.waitForJob(job);
  }
});
