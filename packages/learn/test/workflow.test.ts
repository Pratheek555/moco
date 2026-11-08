import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AiBackend, AiRequest } from "@moco/ai";
import { describe, expect, it, vi } from "vitest";
import { learnStyle } from "../src/index.ts";
import { clip, measurements, meta, speak } from "./helpers.ts";

// Exercise orchestration/storage with measured fixture evidence. No network,
// model, Whisper runtime or FFmpeg is needed for these contract checks.
vi.mock("../src/fetch.ts", async (original) => ({
  ...await original<typeof import("../src/fetch.ts")>(),
  fetchReference: vi.fn(async (source: string, dir: string) => ({ ...meta, id: basename(dir), source })),
}));
vi.mock("../src/measure.ts", async (original) => ({
  ...await original<typeof import("../src/measure.ts")>(),
  measureReference: vi.fn(async (_dir: string, ref: typeof meta) => ({ measurements: { ...measurements(clip(180), speak("Reference wording belongs elsewhere.")), ref }, camera: [] })),
}));
vi.mock("../src/sheets.ts", async (original) => ({
  ...await original<typeof import("../src/sheets.ts")>(),
  renderSheets: vi.fn(async (_measurements: unknown, _camera: unknown, dir: string) => {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "chart.png");
    await writeFile(file, Buffer.from([137,80,78,71,13,10,26,10]));
    return { overview: [], transitions: [], events: [], bursts: [], charts: { camera: file, audio: file }, palettes: {} };
  }),
}));
vi.mock("../src/tools.ts", async (original) => ({
  ...await original<typeof import("../src/tools.ts")>(),
  runTool: vi.fn(async (_bin: string, args: string[]) => {
    await writeFile(args.at(-1)!, Buffer.from([137,80,78,71,13,10,26,10]));
    return { stdout: "", stderr: "" };
  }),
}));

const skill = { name: "Test style", description: "Use when illustrating facts.", summary: "Clear original explanations.", sections: [{ title: "Camera", intro: "Measured pacing", rules: [{ title: "Reveal", default: "One picture per beat", range: "Flexible", deviateWhen: "A diagram needs a longer hold", why: "Clarifies the mechanism" }] }], checklist: ["Readable signs"], avoid: ["Copied logos"] };
const template = {
  info: { name: "Test style", tagline: "Illustrated explanations", description: "A measured style", tags: ["Illustrated"], story: ["One causal question"], look: ["Original characters"], missing: ["No connected music service"], palette: { sky: ["#112233", "#223344"], ground: "#334455", accents: ["#445566"] }, world: "auto", episodes: 1, ideas: [] },
  stages: { series: "Original episodes", series_extend: "Original follow-ups", bible: "Original cast", world: "", script: "Own words", shots: "Purposeful cuts", scene: "Readable signs", publish: "Original titles" },
};
const card = { category: "motion_graphics", label: "Explanatory graphics", summary: "Diagram reveals", rules: [{ area: "camera", rule: "Keep the mechanism visible", value: "", evidence: "S1 f45", confidence: "medium" }], avoid: [], contentSpecifics: ["Captain Purple"] };

function fakeAi(): AiBackend & { requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  return {
    id: "fake-codex", requests,
    async available() { return { ok: true }; },
    async generate(request) {
      requests.push(request);
      const role = /<!-- prompt: (\w+)/.exec(request.system)?.[1];
      const json = role === "overview" ? { ...card, why: "Visible diagram", hasCharacters: false, hasOnScreenText: true, hasNarrator: true, findings: [], notes: "" }
        : role === "reference" ? card
        : role === "merge" ? skill
        : role === "template_artist" ? { ...template, stages: { ...template.stages, show: "Lock original cast identity", artist: "Reuse shared drawing and motion code" } }
        : role === "template" ? template
        : { findings: [], contentSpecifics: card.contentSpecifics, notes: "" };
      return { text: "", json, backend: "fake-codex" };
    },
  };
}

describe("reference learning handoff", () => {
  it("rejects colliding reference identities before measurements can overwrite each other", async () => {
    const ai = fakeAi();
    await expect(learnStyle({ name: "Test style", sources: ["first/video.mp4", "second/video.mp4"], stylesDir: "unused", ai })).rejects.toThrow(/distinct filenames/);
    expect(ai.requests).toEqual([]);
  });
  it("persists Canvas guidance, source frames and structured evidence without copying content into the reusable brief", async () => {
    const ai = fakeAi();
    const dir = await mkdtemp(join(tmpdir(), "learn-canvas-"));
    const production = { mode: "artist" as const, format: { width: 1920, height: 1080, fps: 60 }, targetSeconds: 12, localOnly: true };
    const png = `data:image/png;base64,${Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")}`;
    const result = await learnStyle({ name: "Test style", sources: ["first.mp4"], stylesDir: dir, ai, production, referenceImages: [png] });
    const read = async (name: string) => JSON.parse(await readFile(join(result.dir, name), "utf8"));
    const info = await read("moco-template.json");
    expect(info.production).toEqual(production);
    expect(info.creativePrompt).toContain("Default:");
    expect(info.creativePrompt).toContain("Lock original cast identity");
    expect(info.creativePrompt).toContain("Reuse shared drawing and motion code");
    expect(info.creativePrompt).not.toContain("Captain Purple");
    expect(info.referenceImages).toEqual(["references/0.png", "references/1.png"]);
    expect(info.missing).toEqual(["No connected music service"]);
    expect((await read("style-rules.json")).references[0].rules[0].evidence).toBe("S1 f45");
    expect((await read("style-rules.json")).measurements[0].how).toBe("ffprobe");
    expect((await read("content-exclusions.json")).references[0]).toMatchObject({ id: "file-first", contentSpecifics: ["Captain Purple"], words: ["Reference", "wording", "belongs", "elsewhere."] });
    expect((await read("reference-images.json")).images.map((image: { kind: string }) => image.kind)).toEqual(["uploaded-still", "video-frame"]);
    expect(result.leaks).toEqual([]);
    const compiler = ai.requests.find((request) => request.system.includes("prompt: template_artist"))!;
    expect(compiler.images).toHaveLength(2);
    expect(compiler.prompt).toContain("Motion findings come from the measured guide");
    expect(ai.requests.some((request) => request.system.includes("prompt: template v"))).toBe(false);
  });

  it("retains legacy compilation when artist mode is not selected", async () => {
    const ai = fakeAi();
    const dir = await mkdtemp(join(tmpdir(), "learn-legacy-"));
    const result = await learnStyle({ name: "Test style", sources: ["first.mp4"], stylesDir: dir, ai });
    const info = JSON.parse(await readFile(join(result.dir, "moco-template.json"), "utf8"));
    expect(info.production).toBeUndefined();
    expect(info.creativePrompt).toBeUndefined();
    expect(info.referenceImages).toBeUndefined();
    expect(ai.requests.some((request) => request.system.includes("prompt: template v"))).toBe(true);
  });
});
