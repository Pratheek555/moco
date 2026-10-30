// @moco/ai — one interface over the AI backends the engine can call.
// For now only `claude-cli`: the user's own Claude Code session (`claude -p`), no API keys.
// The AI is always called with tools disabled, in an empty temp folder: it can only return text/JSON.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AiRequest {
  system: string; // full system prompt (replaces the backend's default)
  prompt: string;
  jsonSchema?: object; // structured output
  model?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AiResult {
  text: string;
  json?: unknown; // structured output, if requested and produced
  usage?: { inputTokens?: number; outputTokens?: number; costUsdEstimate?: number };
  backend: string;
  model?: string;
  sessionId?: string;
}

export interface AiBackend {
  id: string;
  available(): Promise<{ ok: boolean; reason?: string; authMethod?: string; version?: string }>;
  generate(req: AiRequest): Promise<AiResult>;
}

// ---------- Typed errors ----------

export class AiError extends Error {}
export class AuthError extends AiError {}
export class RateLimitError extends AiError {}
export class SchemaRefusal extends AiError {} // asked for structured output, got none
export class TimeoutError extends AiError {}
export class BackendError extends AiError {}

// ---------- claude-cli ----------

// Oldest Claude Code version the flag set below was verified against (2.1.312 on 30 Oct 2026).
// shortcut: set to the verified version; lower it only after testing older releases.
export const MIN_CLAUDE_VERSION = "2.1.312";

// -1, 0 or 1, comparing "a.b.c" numerically.
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  const index = left.findIndex((part, i) => part !== right[i]);
  if (index < 0) return 0;
  return left[index]! < right[index]! ? -1 : 1;
}

export interface ClaudeCliOptions {
  bin?: string; // path to the `claude` binary; tests pass a fake one
}

export function claudeCli(options: ClaudeCliOptions = {}): AiBackend {
  const bin = options.bin ?? "claude";

  return {
    id: "claude-cli",

    async available() {
      // Flags like --safe-mode and --json-schema need a recent Claude Code (reference R2).
      const versionRun = await runProcess(bin, ["--version"], "", 15_000).catch(() => undefined);
      const version = /(\d+\.\d+\.\d+)/.exec(versionRun?.stdout ?? "")?.[1];
      if (!version) return { ok: false, reason: "Claude Code is not installed. Install it from claude.com/code." };
      if (compareVersions(version, MIN_CLAUDE_VERSION) < 0) {
        return { ok: false, version, reason: `Claude Code ${version} is too old; update to ${MIN_CLAUDE_VERSION} or later (\`claude update\`).` };
      }

      // `claude auth status` prints JSON and exits 0 when logged in.
      const run = await runProcess(bin, ["auth", "status"], "", 15_000);
      if (run.code !== 0) {
        return { ok: false, version, reason: "Claude Code is not logged in. Run `claude` once and sign in." };
      }
      try {
        const status = JSON.parse(run.stdout) as { loggedIn?: boolean; authMethod?: string };
        const loggedIn = status.loggedIn === true && status.authMethod !== "none";
        return { ok: loggedIn, version, authMethod: status.authMethod, reason: loggedIn ? undefined : "Claude Code is not logged in." };
      } catch {
        return { ok: false, version, reason: "Could not read `claude auth status` output." };
      }
    },

    async generate(req) {
      // Each call gets its own empty folder, so no project hooks, settings or MCP config can load.
      const cwd = await mkdtemp(join(tmpdir(), "moco-ai-"));
      try {
        const systemFile = join(cwd, "system.md");
        await writeFile(systemFile, req.system);

        const args = [
          "-p",
          "--output-format", "json",
          "--system-prompt-file", systemFile,
          "--tools", "", // no built-in tools
          "--disallowedTools", "mcp__*",
          "--strict-mcp-config", // with no --mcp-config: no MCP servers at all
          "--safe-mode", // no CLAUDE.md, skills, plugins, hooks or memory; keeps login
          "--no-session-persistence",
          "--permission-prompts", "none",
        ];
        if (req.jsonSchema) args.push("--json-schema", JSON.stringify(req.jsonSchema));
        if (req.model) args.push("--model", req.model);

        // Prompt goes in via stdin, never through a shell string.
        const run = await runProcess(bin, args, req.prompt, req.timeoutMs, req.signal, cwd);
        return parseClaudeResult(run, req);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}

// Shape of `claude -p --output-format json` output (only the fields we read).
interface ClaudeJson {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseClaudeResult(run: ProcessResult, req: AiRequest): AiResult {
  if (run.timedOut) throw new TimeoutError(`claude timed out after ${req.timeoutMs} ms`);

  let out: ClaudeJson;
  try {
    out = JSON.parse(run.stdout) as ClaudeJson;
  } catch {
    // No JSON at all: the CLI failed before answering. stderr says why.
    const detail = (run.stderr || run.stdout).trim().slice(0, 500);
    throw classifyFailure(detail || `claude exited with code ${run.code}`);
  }

  if (out.is_error) throw classifyFailure(out.result ?? out.subtype ?? "unknown error");

  if (req.jsonSchema && out.structured_output === undefined) {
    throw new SchemaRefusal("claude returned no structured_output for the requested schema");
  }

  return {
    text: out.result ?? "",
    json: out.structured_output,
    usage: {
      inputTokens: out.usage?.input_tokens,
      outputTokens: out.usage?.output_tokens,
      costUsdEstimate: out.total_cost_usd,
    },
    backend: "claude-cli",
    model: req.model,
    sessionId: out.session_id,
  };
}

// Turn an error message from the CLI into the right typed error.
function classifyFailure(message: string): AiError {
  if (/rate.?limit|usage limit|429/i.test(message)) return new RateLimitError(message);
  if (/not logged in|log ?in|auth|401/i.test(message)) return new AuthError(message);
  return new BackendError(message);
}

// ---------- process helper ----------

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(
  bin: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  signal?: AbortSignal,
  cwd?: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // SIGINT first so Claude ends its turn cleanly; SIGTERM if it doesn't exit.
    const stop = () => {
      child.kill("SIGINT");
      setTimeout(() => child.kill("SIGTERM"), 3_000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new BackendError(`could not start ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(new AiError("cancelled"));
      else resolve({ code, stdout, stderr, timedOut });
    });

    child.stdin.end(stdin);
  });
}
