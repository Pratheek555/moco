import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

// App-server uses newline-delimited JSON-RPC over stdio, without the jsonrpc field.
export class CodexConnection {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private closing = false;
  private ended = false;
  private finish!: () => void;
  readonly done: Promise<void>;
  failure?: Error;
  onNotification: (message: RpcMessage) => void = () => {};
  onRequest: (message: RpcMessage) => Promise<unknown> = async message => { throw new Error(`Unsupported Codex request: ${message.method}`); };

  constructor(executable: string, env: NodeJS.ProcessEnv, cwd?: string) {
    this.done = new Promise(resolve => { this.finish = resolve; });
    const isJs = /\.m?js$/.test(executable);
    this.child = spawn(isJs ? "node" : executable, [
      ...(isJs ? [executable] : []), "app-server", "--listen", "stdio://",
      "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"',
    ], { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", line => {
      try { this.receive(JSON.parse(line) as RpcMessage); }
      catch { this.fail(new Error("Codex sent an invalid app-server message. Update Codex and retry.")); this.child.kill(); }
    });
    // Drain stderr so diagnostic output cannot block the subprocess.
    this.child.stderr.resume();
    this.child.stdin.on("error", error => { if (!this.closing) this.fail(error); });
    this.child.on("error", error => this.fail(error));
    this.child.on("close", code => {
      if (!this.closing && !this.failure) this.fail(new Error(`Codex app-server exited (${code ?? "signal"}). Send a message to resume.`));
      this.ended = true; lines.close(); this.finish();
    });
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  private write(message: RpcMessage) {
    if (this.closing || this.failure) throw this.failure ?? new Error("Codex session has stopped.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  private receive(message: RpcMessage) {
    if (message.method) {
      if (message.id === undefined) this.onNotification(message);
      else void this.onRequest(message).then(
        result => { if (!this.closing && !this.failure) this.write({ id: message.id, result }); },
        error => { if (!this.closing && !this.failure) this.write({ id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }); },
      ).catch(error => this.fail(error instanceof Error ? error : new Error(String(error))));
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }
  request<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out. Retry or update Codex.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value as T); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      try { this.write({ id, method, params }); }
      catch (error) {
        this.pending.delete(id); clearTimeout(timer); reject(error);
      }
    });
  }
  async initialize(): Promise<string> {
    const result = await this.request<{ userAgent: string }>("initialize", {
      clientInfo: { name: "moco", title: "Moco", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.write({ method: "initialized", params: {} });
    return result.userAgent;
  }
  async close(): Promise<void> {
    if (this.closing) return this.done;
    this.closing = true;
    this.fail(new Error("Codex session has stopped."));
    if (this.ended) return;
    this.child.stdin.end();
    const timeout = setTimeout(() => {
      // Include shell/render descendants when stopping an unrestricted agent on Windows.
      if (process.platform === "win32" && this.child.pid) {
        execFile("taskkill.exe", ["/pid", String(this.child.pid), "/t", "/f"], { windowsHide: true, timeout: 2000 }, () => { this.child.kill(); });
      } else this.child.kill("SIGKILL");
    }, 500);
    try { await this.done; } finally { clearTimeout(timeout); }
  }
}
