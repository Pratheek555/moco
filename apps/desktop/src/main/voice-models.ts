import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VoiceModelId, VoiceModelStatus } from "../shared/api.ts";

export const MODEL_FILES = {
  english: ["ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"],
  multilingual: ["ve.pt", "t3_mtl23ls_v2.safetensors", "s3gen.pt", "grapheme_mtl_merged_expanded_v1.json", "conds.pt", "Cangjie5_TC.json"],
} as const;
export const MODEL_CATALOG = [
  { id: "english", name: "Chatterbox · English", size: "About 3 GB + shared voice runtime" },
  { id: "multilingual", name: "Chatterbox · Multilingual", size: "About 3 GB + shared voice runtime · includes Hindi" },
] as const;
export interface VoiceRuntime { python: string; workerDir: string; modelsDir: string }
export function voiceRuntimePaths(userData: string, workerDir: string): VoiceRuntime {
  return { python: join(userData, "voice", "runtime", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    workerDir, modelsDir: join(userData, "voice", "models") };
}
export function modelForLanguage(language: string): VoiceModelId {
  return language.toLowerCase().split(/[-_]/)[0] === "en" ? "english" : "multilingual";
}
export async function modelReady(modelsDir: string, id: VoiceModelId): Promise<boolean> {
  try {
    const dir = join(modelsDir, id);
    const marker = JSON.parse(await readFile(join(dir, "ready.json"), "utf8"));
    if (marker.modelId !== id) return false;
    const valid = await Promise.all(MODEL_FILES[id].map(async (file) => {
      const info = await stat(join(dir, file));
      return info.isFile() && info.size > 0 && info.size === marker.files?.[file];
    }));
    return valid.every(Boolean);
  } catch { return false; }
}

export type VoiceCommand = (command: string, args: string[], signal: AbortSignal, output: (text: string) => void) => Promise<void>;
export function createVoiceModelManager(runtime: VoiceRuntime, run: VoiceCommand = runVoiceCommand) {
  const states = new Map<VoiceModelId, Pick<VoiceModelStatus, "state" | "message" | "progress" | "downloadedBytes" | "totalBytes">>();
  let active: { id: VoiceModelId; controller: AbortController } | undefined;
  const runtimeDir = join(runtime.modelsDir, "..", "runtime");
  const runtimeMarker = join(runtimeDir, "ready.json");
  const runtimeReady = async () => {
    try { return JSON.parse(await readFile(runtimeMarker, "utf8")).version === "0.1.7" && (await stat(runtime.python)).isFile(); }
    catch { return false; }
  };
  return {
    async list(): Promise<VoiceModelStatus[]> {
      const installed = await runtimeReady();
      return Promise.all(MODEL_CATALOG.map(async (model) => {
        const state = states.get(model.id);
        if (state?.state === "downloading") return { ...model, ...state };
        if (installed && await modelReady(runtime.modelsDir, model.id)) return { ...model, state: "ready", progress: 1 };
        return { ...model, ...(state?.state === "error" ? state : { state: "not-installed" as const, progress: 0 }) };
      }));
    },
    download(id: VoiceModelId) {
      if (!MODEL_CATALOG.some((model) => model.id === id)) throw new Error("Unknown voice model");
      if (active) throw new Error("A voice model is already downloading");
      const controller = new AbortController();
      active = { id, controller };
      states.set(id, { state: "downloading", progress: 0, message: "Preparing optional voice runtime…" });
      const task = async () => {
        const update = (message: string, progress = 0, downloadedBytes?: number, totalBytes?: number) =>
          states.set(id, { state: "downloading", message, progress, downloadedBytes, totalBytes });
        if (!await runtimeReady()) {
          await mkdir(runtimeDir, { recursive: true });
          await run("uv", ["venv", runtimeDir, "--python", "3.11", "--allow-existing"], controller.signal, () => {});
          update("Installing voice runtime. This may take several minutes…");
          await run("uv", ["pip", "install", "--python", runtime.python, "chatterbox-tts==0.1.7", "setuptools==80.9.0"], controller.signal, () => {});
          update("Checking voice runtime…");
          await run(runtime.python, ["-c", "import chatterbox, perth; assert callable(perth.PerthImplicitWatermarker), 'Voice watermark dependency is unavailable'; perth.PerthImplicitWatermarker()"], controller.signal, () => {});
          await writeFile(runtimeMarker, JSON.stringify({ version: "0.1.7" }));
        }
        controller.signal.throwIfAborted();
        let buffer = "";
        await run(runtime.python, [join(runtime.workerDir, "download_model.py"), id, join(runtime.modelsDir, id)], controller.signal, (chunk) => {
          buffer += chunk;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (typeof event.message === "string") {
                const total = typeof event.totalBytes === "number" && Number.isSafeInteger(event.totalBytes) && event.totalBytes > 0 ? event.totalBytes : undefined;
                const downloaded = total !== undefined && typeof event.downloadedBytes === "number" && Number.isSafeInteger(event.downloadedBytes)
                  ? Math.max(0, Math.min(total, event.downloadedBytes)) : undefined;
                update(event.message, downloaded !== undefined && total !== undefined ? downloaded / total : Math.max(0, Math.min(1, Number(event.progress) || 0)), downloaded, total);
              }
            } catch { /* Non-protocol dependency output is kept by the command runner for errors. */ }
          }
        });
        controller.signal.throwIfAborted();
        if (!await modelReady(runtime.modelsDir, id)) throw new Error("The download is incomplete. Retry to resume it.");
        states.delete(id);
      };
      void task().catch((error: unknown) => {
        states.set(id, { state: "error", progress: 0, message: controller.signal.aborted ? "Download cancelled. Retry to resume." : error instanceof Error ? error.message : String(error) });
      }).finally(() => { active = undefined; });
    },
    cancel() { active?.controller.abort(); },
  };
}

function runVoiceCommand(command: string, args: string[], signal: AbortSignal, output: (text: string) => void): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" } });
    let diagnostics = "";
    const collect = (chunk: Buffer) => { diagnostics = (diagnostics + String(chunk)).slice(-2500); };
    child.stdout.on("data", (chunk: Buffer) => { collect(chunk); output(String(chunk)); });
    child.stderr.on("data", collect);
    const abort = () => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.on("error", () => { signal.removeEventListener("abort", abort); reject(new Error(command === "uv" ? "Install uv from astral.sh/uv, then retry the optional voice download." : "Could not start the voice runtime. Retry the download.")); });
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new Error("Download cancelled"));
      else if (code === 0) resolve();
      else reject(new Error(`Voice installation failed. ${diagnostics.trim()}`));
    });
  });
}
