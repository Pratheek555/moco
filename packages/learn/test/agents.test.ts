import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiBackend, AiRequest } from "@moco/ai";
import { describe, expect, it } from "vitest";
import { planSpecialists, runAgent, SpecialistOutput, type AgentContext, type OverviewOutput } from "../src/agents.ts";
import type { SheetSet } from "../src/sheets.ts";
import { clip, measurements, speak } from "./helpers.ts";

// Ten bursts of motion, one every 40 frames.
const m = measurements(clip(400, (f) => (f % 40 >= 10 && f % 40 < 14 ? { active: 0.3 } : {})), speak("A short line of narration."));

function sheets(transitions: number, events: number): SheetSet {
  return {
    overview: ["overview-1.png"],
    transitions: Array.from({ length: transitions }, (_, index) => ({ file: `t${index}.png`, index })),
    events: Array.from({ length: events }, (_, index) => ({ file: `m${index}.png`, index })),
    bursts: [{ file: "b1.png", shot: 1 }],
    charts: { camera: "chart-camera.png", audio: "chart-audio.png" },
    palettes: {},
  };
}

const overview = (patch: Partial<OverviewOutput>): OverviewOutput => ({
  findings: [], contentSpecifics: [], notes: "", category: "3d_cartoon", label: "3D cartoon short", why: "", hasCharacters: true, hasOnScreenText: false, hasNarrator: true, ...patch,
});

describe("agent plan", () => {
  it("always studies camera and story; adds motion only when characters act", () => {
    expect(planSpecialists(m, sheets(3, 4), overview({ hasCharacters: false })).map((task) => task.name)).toEqual(["camera", "story"]);
    expect(planSpecialists(m, sheets(3, 4), overview({})).map((task) => task.name)).toEqual(["camera", "motion", "story"]);
  });

  it("splits busy references across more agents, so each reads at most six sheets", () => {
    const tasks = planSpecialists(m, sheets(14, 8), overview({ hasOnScreenText: true }));
    expect(tasks.map((task) => task.name)).toEqual(["camera-1", "camera-2", "camera-3", "motion-1", "motion-2", "graphics", "story"]);
    const read = tasks.filter((task) => task.role === "camera").flatMap((task) => task.images.filter((image) => image.startsWith("t")));
    expect(read).toHaveLength(14); // every transition sheet is read once
    expect(tasks[0]!.images[0]).toBe("chart-camera.png");
  });

  it("sends explainer formats to the graphics analyst even without captions", () => {
    expect(planSpecialists(m, sheets(2, 0), overview({ category: "motion_graphics", hasCharacters: false })).map((task) => task.name)).toEqual(["camera", "graphics", "story"]);
  });
});

describe("runAgent", () => {
  function fakeAi(answers: unknown[]): AiBackend & { requests: AiRequest[] } {
    const requests: AiRequest[] = [];
    return {
      id: "fake",
      requests,
      async available() {
        return { ok: true };
      },
      async generate(req) {
        requests.push(req);
        return { text: "", json: answers[requests.length - 1], backend: "fake", usage: { costUsdEstimate: 0.01 } };
      },
    };
  }
  const context = (ai: AiBackend): AgentContext => ({ ai, timeoutMs: 1000, limit: (task) => task(), log: () => {}, usage: { calls: 0, cached: 0, costUsd: 0 } });
  const valid = { findings: [], contentSpecifics: ["a name"], notes: "" };

  it("retries once with the schema errors, then reuses the saved answer while its inputs are unchanged", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "learn-agent-")), "camera.json");
    const ai = fakeAi([{ findings: "not a list" }, valid]);
    const task = { name: "camera", role: "camera" as const, prompt: "measured numbers", images: [] };
    const ctx = context(ai);
    expect(await runAgent(ctx, task, SpecialistOutput, out)).toEqual(valid);
    expect(ai.requests).toHaveLength(2);
    expect(ai.requests[1]!.prompt).toContain("did not match the schema");
    expect(ai.requests[0]!.system).toContain("Technique, not content"); // the shared rules ride along

    expect(await runAgent(ctx, task, SpecialistOutput, out)).toEqual(valid);
    expect(ai.requests).toHaveLength(2);
    expect(ctx.usage).toMatchObject({ calls: 2, cached: 1 });

    await expect(runAgent(context(fakeAi([valid])), { ...task, prompt: "new numbers" }, SpecialistOutput, out)).resolves.toEqual(valid);
  });
});
