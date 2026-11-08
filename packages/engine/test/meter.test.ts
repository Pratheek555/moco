import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RateLimitError } from "@moco/ai";
import { defaultConfig } from "../src/config.ts";
import { EventBus } from "../src/events/bus.ts";
import { Semaphore } from "../src/jobs/semaphore.ts";
import { Ledger } from "../src/store/ledger.ts";
import { FakeAi } from "../src/testing/fakes.ts";
import { meteredAi } from "../src/usage/meter.ts";

const request = { system: "Test", prompt: "Test" };
async function fixture(cap = 2) {
  const dir = await mkdtemp(join(tmpdir(), "moco-meter-"));
  const ledger = await Ledger.load(join(dir, "test"));
  const ai = new FakeAi(() => ({}));
  const bus = new EventBus(dir), config = defaultConfig(dir);
  config.limits.maxAiCallsPerEpisode = cap;
  const makeMeter = () => meteredAi(ai, new Semaphore(1), ledger, bus, "test", config);
  return { ai, ledger, bus, meter: makeMeter(), makeMeter };
}

it("counts nested image calls in the scene allowance and shares it across retries and repair views", async () => {
  const { meter, ledger, ai } = await fixture();
  ai.generate = async req => {
    ai.requests.push(req);
    if (req.artistTools) await meter.forTask!("scene s01").generate({ ...request, imageGeneration: true }, "ep-01");
    return { text: "done", backend: ai.id };
  };
  await meter.forTask!("scene s01").generate({ ...request, artistTools: [] }, "ep-01");
  // Reopening the same task, even through a different view, must not reset it.
  await expect(meter.forTask!("visual review s01").forTask!("scene s01").generate(request, "ep-01"))
    .rejects.toMatchObject({ code: "cap_reached", message: expect.stringContaining("scene s01") });
  await meter.forTask!("scene s02").generate(request, "ep-01");
  await meter.forTask!("visual review s01").generate(request, "ep-01");
  await meter.generate(request, "ep-01");
  expect(ai.requests).toHaveLength(5);
  expect(ledger.data.usage.aiCalls["ep-01"]).toBe(5);
  expect(ledger.today().calls).toBe(5);
});

it("reserves task calls atomically before waiting for an AI slot", async () => {
  const { meter, ai } = await fixture();
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => meter.forTask!("scene s01").generate(request, "ep-01")));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
  expect(results.filter(r => r.status === "rejected").map(r => r.reason.code)).toEqual(["cap_reached", "cap_reached"]);
  expect(ai.requests).toHaveLength(2);
});

it("keeps the planning cap, separates episodes and grants a new allowance only for a new job", async () => {
  const { meter, makeMeter } = await fixture(1);
  await meter.generate(request, "ep-01");
  await expect(meter.generate(request, "ep-01")).rejects.toMatchObject({ code: "cap_reached" });
  await meter.generate(request, "ep-02");
  await meter.forTask!("scene s01").generate(request, "ep-01");
  await meter.forTask!("scene s01").generate(request, "ep-02");
  await makeMeter().forTask!("scene s01").generate(request, "ep-01");
});

it("still surfaces provider limits and stops cancelled scene work", async () => {
  const { meter, ai, ledger } = await fixture();
  ai.generate = async () => { throw new RateLimitError("Plan exhausted"); };
  await expect(meter.forTask!("scene s01").generate(request, "ep-01")).rejects.toMatchObject({ code: "rate_limited" });
  expect(ledger.today().rateLimits).toBe(1);
  await expect(meter.forTask!("scene s02").generate({ ...request, signal: AbortSignal.abort() }, "ep-01")).rejects.toThrow();
  expect(ledger.data.usage.aiCalls["ep-01"]).toBe(1);
});
