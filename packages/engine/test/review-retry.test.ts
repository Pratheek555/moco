import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runStages } from "../src/pipeline/run.ts";
import { Ledger } from "../src/store/ledger.ts";
import { allStageKeys } from "../src/pipeline/stages.ts";
import type { StageContext } from "../src/pipeline/context.ts";
import { runRender } from "../src/pipeline/render.ts";
import { runScenes } from "../src/generator/generate.ts";
import { EngineError } from "../src/errors.ts";

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

it("surfaces interrupted review as a failed stage without another preview approval",async()=>{
  const ledger=await Ledger.load(await mkdtemp(join(tmpdir(),"moco-review-stop-")));
  for(const key of allStageKeys(["ep-01"]))ledger.setStage(key,{status:"done",artifactHash:"old"});
  ledger.setStage("ep-01/scenes",{status:"pending"});
  const ctx={ledger,episodeIds:()=>["ep-01"],signal:new AbortController().signal,bus:{emit:async()=>{}},seriesId:"test"} as unknown as StageContext;
  vi.mocked(runScenes).mockRejectedValueOnce(new EngineError("validation_failed","Visual review interrupted; retry to resume"));
  vi.mocked(runRender).mockClear();
  await expect(runStages(ctx)).rejects.toThrow(/retry to resume/);
  expect(ledger.stage("ep-01/scenes")).toMatchObject({status:"failed",error:{code:"validation_failed"}});
  expect(vi.mocked(runRender)).not.toHaveBeenCalled();
  expect(ledger.stage("ep-01/preview").status).toBe("done");
});
