import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runStages } from "../src/pipeline/run.ts";
import { Ledger } from "../src/store/ledger.ts";
import { allStageKeys } from "../src/pipeline/stages.ts";
import type { StageContext } from "../src/pipeline/context.ts";
import { runRender } from "../src/pipeline/render.ts";

vi.mock("../src/generator/generate.ts", () => ({ runScenes: vi.fn(async () => "repaired"), runSample: vi.fn() }));
vi.mock("../src/pipeline/render.ts", () => ({ runRender: vi.fn(async () => "new-preview") }));

it.each([undefined, "ep-01/final"])("resumes failed review on retry %s and requires approval of repaired preview", async firstKey => {
  const ledger = await Ledger.load(await mkdtemp(join(tmpdir(), "moco-retry-")));
  for (const key of allStageKeys(["ep-01"])) ledger.setStage(key, { status: "done", artifactHash: "old" });
  ledger.setStage("ep-01/final", { status: "failed" });
  const ctx = {
    ledger, episodeIds: () => ["ep-01"], signal: new AbortController().signal,
    store: { has: () => true, read: async () => ({ data: { quality: { status: "needs_attention" } } }) },
    bus: { emit: async () => {} }, seriesId: "test",
  } as unknown as StageContext;
  vi.mocked(runRender).mockClear();
  expect(await runStages(ctx, firstKey)).toEqual(["ep-01/scenes", "ep-01/preview"]);
  expect(ledger.stage("ep-01/preview").status).toBe("awaiting_approval");
  expect(runRender).toHaveBeenCalledExactlyOnceWith(ctx, "ep-01", "preview");
});
