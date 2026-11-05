// Local neural narration. Python/model dependencies are isolated from Electron/Node.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TimedWord } from "@moco/spec";
import type { Line } from "./index.ts";
import { amplitudeVisemes, parseWav } from "./lipsync.ts";
import { joinLines, wavFrom } from "./system.ts";

export interface ChatterboxOptions {
  python?: string;
  worker?: string;
  modelDir?: string;
  device?: "auto" | "cpu" | "cuda" | "mps";
  reference?: string;
  voices?: Record<string, string>; // trusted, configured speaker id -> reference WAV
  // A performance reference for an emotion gives more control than exaggeration alone.
  emotionReferences?: Partial<Record<NonNullable<Line["delivery"]>["emotion"], string>>;
  expressiveness?: number;
  rate?: number;
  seed?: number;
}

export function voicePython(): string {
  return process.env.MOCO_VOICE_PYTHON ?? fileURLToPath(new URL(
    process.platform === "win32" ? "../../../.venv-voice/Scripts/python.exe" : "../../../.venv-voice/bin/python", import.meta.url));
}

export function performance(line: Line, expressiveness = 0.65) {
  const emotion = line.delivery?.emotion ?? "neutral";
  const intensity = line.delivery?.intensity ?? 0.5;
  const base = { neutral: 0.35, warm: 0.45, tense: 0.65, awed: 0.6, grieving: 0.4, resolute: 0.55 }[emotion];
  // Keep the creative control below 1: extreme exaggeration increases rushing/hallucination.
  const exaggeration = Math.min(0.95, Math.max(0.2, base + (intensity - 0.5) * 0.3 + (expressiveness - 0.5) * 0.25));
  return { emotion, exaggeration, cfg_weight: exaggeration > 0.65 ? 0.3 : 0.5, temperature: 0.75 };
}

export function chatterboxAudio(options: ChatterboxOptions = {}) {
  return {
    async voices() { return [{ id: "default", name: "Configured narrator" }, ...Object.keys(options.voices ?? {}).map((id) => ({ id, name: id }))]; },
    async tts(lines: Line[], _voice: { voiceId: string; backend: string }, language: string, outDir: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (!lines.length || lines.some((line) => !line.text.trim())) throw new Error("Narration must contain non-empty lines");
      const work = await mkdtemp(join(tmpdir(), "moco-chatterbox-"));
      try {
        const cacheDir = join(outDir, ".voice-cache");
        await mkdir(cacheDir, { recursive: true });
        for (const line of lines) {
          if (line.voiceId && line.voiceId !== "default" && !options.voices?.[line.voiceId]) throw new Error(`Unknown Chatterbox voice: ${line.voiceId}`);
        }
        const references = [options.reference, ...Object.values(options.voices ?? {}), ...Object.values(options.emotionReferences ?? {})].filter((path): path is string => Boolean(path));
        const referenceHashes = Object.fromEntries(await Promise.all(references.map(async (path) => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
        const request = {
          language: language.split(/[-_]/)[0]!.toLowerCase(), device: options.device ?? "auto", seed: options.seed ?? 42,
          reference: options.reference || undefined, rate: options.rate ?? 1,
          modelDir: options.modelDir,
          lines: lines.map((line, index) => ({ text: line.text, ...performance(line, options.expressiveness),
            reference: line.voiceId && line.voiceId !== "default" ? options.voices![line.voiceId] : options.emotionReferences?.[line.delivery?.emotion ?? "neutral"], seed: (options.seed ?? 42) + index, file: join(work, `${index}.wav`) })),
        };
        const cached = await Promise.all(request.lines.map(async (line) => {
          const { file: _file, ...performance } = line;
          const hash = createHash("sha256").update(JSON.stringify({ version: 2, modelDir: options.modelDir, language: request.language, rate: request.rate,
            device: request.device, defaultReference: request.reference, referenceHashes, ...performance })).digest("hex");
          const file = join(cacheDir, `${hash}.wav`);
          const bytes = await readFile(file).catch(() => undefined);
          if (bytes) {
            try { return { file, pcm: parseWav(bytes) }; } catch { /* Regenerate a damaged cached clip. */ }
          }
          return { file, pcm: undefined };
        }));
        const input = join(work, "request.json");
        const missing = request.lines.filter((_, index) => !cached[index]!.pcm);
        if (missing.length) {
          await writeFile(input, JSON.stringify({ ...request, lines: missing }));
          await runWorker(options.python ?? voicePython(), options.worker ?? fileURLToPath(new URL("../python/narrate.py", import.meta.url)), input, signal);
        }
        signal?.throwIfAborted();
        const spoken = await Promise.all(request.lines.map(async (line, index) => {
          const entry = cached[index]!;
          if (entry.pcm) return entry.pcm;
          const bytes = await readFile(line.file);
          const pcm = parseWav(bytes);
          await writeFile(entry.file, bytes);
          return pcm;
        }));
        const joined = joinLines(lines, spoken);
        await mkdir(outDir, { recursive: true });
        const file = join(outDir, "vo.wav");
        await writeFile(file, wavFrom(joined.pcm));
        // Word positions are estimates within each measured clip, not forced alignment.
        return { file, durationSeconds: joined.pcm.samples.length / joined.pcm.sampleRate, words: joined.words };
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
    async align(): Promise<TimedWord[]> { throw new Error("Chatterbox returns estimated word timings from tts()"); },
    async visemes(file: string, words: TimedWord[]) { return amplitudeVisemes(parseWav(await readFile(file)), words); },
  };
}

let workerQueue: Promise<void> = Promise.resolve();

async function runWorker(python: string, worker: string, input: string, signal?: AbortSignal): Promise<void> {
  // All backend instances share the queue, including previews and episode jobs.
  const previous = workerQueue;
  let release!: () => void;
  workerQueue = new Promise<void>((resolve) => { release = resolve; });
  try {
    await previous;
    signal?.throwIfAborted();
    await startWorker(python, worker, input, signal);
  } finally { release(); }
}

export function narrationFailure(code: number | null, diagnostics: string): string {
  if (/paging file is too small|os error 1455|out of memory|cannot allocate memory|DefaultCPUAllocator/i.test(diagnostics)) {
    return "Not enough memory to load the narration model. Close memory-heavy apps or increase Windows virtual memory (paging file), then retry.";
  }
  const traceback = diagnostics.lastIndexOf("Traceback (most recent call last):");
  const detail = traceback >= 0 ? diagnostics.slice(traceback).trim().split(/\r?\n/).at(-1) : diagnostics.trim();
  return `Neural narration failed (${code}). ${detail}`;
}

function startWorker(python: string, worker: string, input: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [worker, input], {
      windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    const collect = (chunk: Buffer) => { diagnostics = (diagnostics + String(chunk)).slice(-6000); };
    child.stdout.on("data", collect);
    child.stdout.on("data", (chunk: Buffer) => {
      const status = String(chunk).trim();
      if (status) console.info(`[narration] ${status}`);
    });
    child.stderr.on("data", collect);
    let stopping = false;
    const stop = (error: Error) => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      // Windows venv python.exe can launch another Python process. Kill the tree,
      // otherwise Stop would leave the model consuming CPU/RAM in the background.
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => { child.kill(); reject(error); });
        killer.on("close", () => reject(error));
      } else {
        child.kill();
        child.once("close", () => reject(error));
      }
    };
    const abort = () => stop(new Error("Neural narration cancelled"));
    const timer = setTimeout(() => stop(new Error("Neural narration timed out after 30 minutes.")), 30 * 60_000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.aborted ? error : new Error(`Cannot start neural narration. Run pnpm voice:setup first, or set MOCO_VOICE_PYTHON. ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (stopping) return;
      if (code === 0) resolve();
      else {
        console.error(`[narration] Worker failed (${code}): ${diagnostics.trim()}`);
        reject(new Error(narrationFailure(code, diagnostics)));
      }
    });
  });
}
