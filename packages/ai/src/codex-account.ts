import { spawn } from "node:child_process";
import { codexCommand } from "./codex-command.ts";

export interface CodexAccountState {
  state: "idle" | "signing-out" | "signing-in" | "succeeded" | "cancelled" | "error";
  message?: string;
  loginUrl?: string;
}

export function codexLoginUrl(output: string): string | undefined {
  for (const candidate of output.match(/https:\/\/[^\s\x1b<>"']+/g) ?? []) {
    try {
      const url = new URL(candidate);
      if (url.origin === "https://auth.openai.com" && url.pathname === "/oauth/authorize" && !url.username && !url.password)
        return url.href;
    } catch { /* Incomplete process output. */ }
  }
}

type Run = (args: string[], signal: AbortSignal, timeoutMs: number, output: (text: string) => void) => Promise<void>;

function runner(command: { bin: string; args: string[] }): Run {
  return (args, signal, timeoutMs, output) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(Error("cancelled")); return; }
    const child = spawn(command.bin, [...command.args, ...args], { windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    const stop = () => {
      if (!child.pid) return;
      // npm's Node launcher starts a native Codex child. Kill the entire login
      // process tree so a cancelled browser flow cannot write credentials later.
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); };
    child.stdout.on("data", chunk => output(chunk.toString()));
    child.stderr.on("data", chunk => output(chunk.toString()));
    child.once("error", () => { cleanup(); reject(Error("Could not run Codex")); });
    child.once("close", code => {
      cleanup();
      if (timedOut) reject(Error("timeout"));
      else if (signal.aborted) reject(Error("cancelled"));
      else code === 0 ? resolve() : reject(Error(`Codex exited (${code})`));
    });
  });
}

// Owns CLI processes only. Credentials stay in Codex's supported credential store.
// No raw command output or tokens are returned to the renderer or logged.
export function createCodexAccountManager(options: { run?: Run; command?: { bin: string; args: string[] } } = {}) {
  let state: CodexAccountState = { state: "idle" };
  let controller: AbortController | undefined;
  let task: Promise<void> | undefined;
  const run = options.run ?? runner(options.command ?? codexCommand());
  const status = (): CodexAccountState => ({ ...state });
  return {
    status,
    get busy() { return Boolean(controller); },
    start() {
      if (controller) throw Error("An account switch is already in progress");
      const active = new AbortController();
      controller = active;
      state = { state: "signing-out", message: "Signing out of the shared Codex CLI account…" };
      task = (async () => {
        let signedOut = false;
        try {
          await run(["logout"], active.signal, 15_000, () => {});
          signedOut = true;
          active.signal.throwIfAborted();
          state = { state: "signing-in", message: "Choose your intended ChatGPT account in the browser. If it selects the wrong account, sign out there first." };
          let output = "";
          await run(["login"], active.signal, 5 * 60_000, chunk => {
            output = (output + chunk).slice(-16_384);
            const loginUrl = codexLoginUrl(output);
            if (loginUrl) state = { ...state, loginUrl };
          });
          active.signal.throwIfAborted();
          await run(["login", "status"], active.signal, 15_000, () => {});
          state = { state: "succeeded", message: "Codex sign-in completed. Moco will use this CLI account for new requests." };
        } catch (error) {
          const cancelled = active.signal.aborted;
          state = {
            state: cancelled ? "cancelled" : "error",
            message: cancelled
              ? "Sign-in cancelled. Check the connection before generating; signing out is not undone."
              : `${error instanceof Error && error.message === "timeout" ? "Codex sign-in timed out." : "Could not complete the Codex account switch."} ${signedOut ? "The previous account was signed out. Try signing in again." : "Check that Codex is installed and allows ChatGPT sign-in."}`,
          };
        } finally { controller = undefined; }
      })();
      return status();
    },
    async cancel() {
      controller?.abort();
      await task;
      return status();
    },
  };
}
