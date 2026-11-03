// The local tools the pipeline drives: measure.py and yt-dlp in .venv-learn (pnpm learn:setup), ffmpeg and ffprobe on PATH.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface Tools {
  python: string; // .venv-learn's interpreter
  ffmpeg: string;
  ffprobe: string;
}

export function defaultTools(): Tools {
  const venv = process.platform === "win32" ? "../../../.venv-learn/Scripts/python.exe" : "../../../.venv-learn/bin/python";
  return {
    python: process.env.MOCO_LEARN_PYTHON ?? fileURLToPath(new URL(venv, import.meta.url)),
    ffmpeg: process.env.MOCO_FFMPEG ?? "ffmpeg",
    ffprobe: process.env.MOCO_FFPROBE ?? "ffprobe",
  };
}

export const MEASURE_SCRIPT = fileURLToPath(new URL("../python/measure.py", import.meta.url));

export interface RunResult {
  stdout: string;
  stderr: string;
}

export class ToolError extends Error {}

// Runs a tool to completion. Fails with the tail of its output on a non-zero exit, a timeout or cancellation.
export function runTool(bin: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal; onLine?: (line: string) => void }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) options.onLine?.(line.trim());
    });

    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      // A venv python.exe on Windows starts a second process; kill the whole tree.
      if (process.platform === "win32" && child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGTERM");
    };
    const abort = () => stop(new ToolError("cancelled"));
    const timer = setTimeout(() => stop(new ToolError(`${bin} timed out after ${Math.round(options.timeoutMs / 1000)} s`)), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new ToolError(`could not start ${bin}: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new ToolError(`${bin} ${args[0] ?? ""} exited with code ${code}:\n${(stderr || stdout).trim().slice(-1500)}`));
      else resolve({ stdout, stderr });
    });
  });
}

export function runMeasure(tools: Tools, args: string[], options: { timeoutMs: number; signal?: AbortSignal; onLine?: (line: string) => void }): Promise<RunResult> {
  return runTool(tools.python, ["-I", MEASURE_SCRIPT, ...args], options);
}
