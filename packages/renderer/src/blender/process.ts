import { spawn } from "node:child_process";

// Arguments never pass through a shell, including user-selected paths with spaces.
export async function runTool(bin: string, args: string[], options: {
  signal?: AbortSignal; timeoutMs?: number; onLine?: (line: string) => void;
} = {}): Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "", pending = "", failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill(); };
    const abort = () => stop(new Error("Render cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop(new Error(`${bin} timed out`)), options.timeoutMs ?? 20 * 60_000);
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
    const receive = (chunk: Buffer) => {
      const text = chunk.toString(); tail = (tail + text).slice(-16000); pending += text;
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? "";
      for (const line of lines) options.onLine?.(line);
      if (pending.length > 16000) pending = pending.slice(-16000);
    };
    child.stdout.on("data", receive); child.stderr.on("data", receive);
    child.once("error", error => { cleanup(); reject(new Error(`Could not start ${bin}: ${error.message}`)); });
    child.once("close", code => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${bin} exited with code ${code}:\n${tail}`));
      else resolve(tail);
    });
    if (options.signal?.aborted) abort();
  });
}
