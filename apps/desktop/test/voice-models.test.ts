import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createVoiceModelManager, MODEL_FILES, modelForLanguage, modelReady, voiceRuntimePaths, type VoiceCommand, type VoiceRuntime } from "../src/main/voice-models.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "moco-models-"));
  return { dir, runtime: voiceRuntimePaths(dir, join(dir, "worker")) };
}
async function installModel(runtime: VoiceRuntime, id: "english" | "multilingual") {
  const dir = join(runtime.modelsDir, id);
  await mkdir(dir, { recursive: true });
  const sizes: Record<string, number> = {};
  for (const file of MODEL_FILES[id]) { await writeFile(join(dir, file), "model"); sizes[file] = 5; }
  await writeFile(join(dir, "ready.json"), JSON.stringify({ modelId: id, files: sizes }));
}

it("does no installation when listing optional models, including old settings with no backend", async () => {
  const { runtime } = await fixture();
  const run = vi.fn<VoiceCommand>();
  const manager = createVoiceModelManager(runtime, run);
  expect((await manager.list()).map((model) => model.state)).toEqual(["not-installed", "not-installed"]);
  expect(run).not.toHaveBeenCalled();
  expect(modelForLanguage("en-IN")).toBe("english");
  expect(modelForLanguage("hi-IN")).toBe("multilingual");
});

it("marks a model ready only after runtime installation and complete model validation", async () => {
  const { runtime } = await fixture();
  const run = vi.fn<VoiceCommand>(async (command, args, _signal, output) => {
    if (command === "uv" && args[0] === "venv") {
      await mkdir(join(runtime.python, ".."), { recursive: true });
      await writeFile(runtime.python, "runtime");
    }
    if (args[0]?.endsWith("download_model.py")) {
      output('{"message":"Downloading","progress":0.5}\n');
      await installModel(runtime, "english");
    }
  });
  const manager = createVoiceModelManager(runtime, run);
  manager.download("english");
  expect(() => manager.download("multilingual")).toThrow(/already downloading/);
  await vi.waitFor(async () => expect((await manager.list())[0]!.state).toBe("ready"));
  expect(run.mock.calls.map((call) => call[1][0])).toEqual(["venv", "pip", "-c", join(runtime.workerDir, "download_model.py")]);
  await rm(join(runtime.modelsDir, "english", MODEL_FILES.english[0]));
  expect((await manager.list())[0]!.state).toBe("not-installed");
});

it("does not accept partial downloads or a marker with the wrong sizes", async () => {
  const { runtime } = await fixture();
  await installModel(runtime, "english");
  expect(await modelReady(runtime.modelsDir, "english")).toBe(true);
  await writeFile(join(runtime.modelsDir, "english", "t3_cfg.safetensors"), "partial");
  expect(await modelReady(runtime.modelsDir, "english")).toBe(false);
});

it("preserves aggregate bytes across fragmented worker messages and bases the percentage on bytes", async () => {
  const { runtime } = await fixture();
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => { finish = resolve; });
  const run: VoiceCommand = async (command, args, _signal, output) => {
    if (command === "uv" && args[0] === "venv") {
      await mkdir(join(runtime.python, ".."), { recursive: true });
      await writeFile(runtime.python, "runtime");
    }
    if (args[0]?.endsWith("download_model.py")) {
      output('{"message":"Downloading","progress":0.9,"downloadedBytes":25');
      output('0,"totalBytes":1000}\n');
      await hold;
      await installModel(runtime, "english");
    }
  };
  const manager = createVoiceModelManager(runtime, run);
  manager.download("english");
  try {
    await vi.waitFor(async () => expect((await manager.list())[0]).toMatchObject({ state: "downloading", downloadedBytes: 250, totalBytes: 1000, progress: 0.25 }));
  } finally { finish(); }
  await vi.waitFor(async () => expect((await manager.list())[0]!.state).toBe("ready"));
});

it("cancels and allows retry without treating an interrupted download as installed", async () => {
  const { runtime } = await fixture();
  const run: VoiceCommand = async (_command, _args, signal) => {
    await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  };
  const manager = createVoiceModelManager(runtime, run);
  manager.download("english");
  // Wait until the command has started, rather than cancelling before its listener exists.
  await new Promise((resolve) => setTimeout(resolve, 30));
  manager.cancel();
  await vi.waitFor(async () => expect((await manager.list())[0]!.message).toMatch(/cancelled/));
  expect(await modelReady(runtime.modelsDir, "english")).toBe(false);
});

it("reports installer failures and permits retry", async () => {
  const { runtime } = await fixture();
  const manager = createVoiceModelManager(runtime, async () => { throw new Error("Install uv first"); });
  manager.download("english");
  await vi.waitFor(async () => expect((await manager.list())[0]!.message).toBe("Install uv first"));
  manager.download("english");
  await vi.waitFor(async () => expect((await manager.list())[0]!.state).toBe("error"));
});
