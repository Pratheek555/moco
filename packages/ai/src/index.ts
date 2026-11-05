// @moco/ai — one interface over the AI backends the engine can call.
// Claude Code and Codex use the user's installed CLI and existing login.
// Calls run in an empty temp folder, with Claude's tools disabled and Codex restricted to read-only.
// Images use Claude's prompt message or Codex's explicit image attachments.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { codexCommand } from "./codex-command.ts";
export { createCodexAccountManager, type CodexAccountState } from "./codex-account.ts";
import { fileURLToPath } from "node:url";
import { startToolBridge, type ArtistTool } from "./tool-bridge.ts";
import { activityReader, ACTIVITY_GUIDANCE } from "./activity.ts";
export type { ArtistTool, ToolContent } from "./tool-bridge.ts";

export interface AiRequest {
  system: string; // full system prompt (replaces the backend's default)
  prompt: string;
  jsonSchema?: object; // structured output
  images?: string[]; // PNG/JPEG/WebP/GIF files shown to the model before the prompt text
  model?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  artistTools?: ArtistTool[]; // explicit, bounded app tools; ordinary JSON calls retain tools off
  onActivity?: (message: string) => void; // public progress messages, never reasoning or JSON
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
  seesImages?: boolean; // takes AiRequest.images; without it the engine never asks the AI to look at a render
  supportsArtist?: boolean;
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

export type AiProvider = "claude-cli" | "codex-cli";

export function aiBackend(provider: AiProvider = "codex-cli"): AiBackend {
  if (provider === "codex-cli") return codexCli();
  if (provider === "claude-cli") return claudeCli();
  throw new BackendError(`Unknown AI provider: ${provider}`);
}

// Codex's strict output schema cannot represent Moco's dynamic-key records.
// Supply the original schema in the prompt; the engine validates and repairs the result.
export function codexCli(options: { bin?: string; binArgs?: string[] } = {}): AiBackend {
  const command = options.bin ? { bin: options.bin, args: options.binArgs ?? [] } : codexCommand();
  const bin = command.bin;
  const run = (args: string[], stdin: string, timeout: number, signal?: AbortSignal, cwd?: string, onActivity?: (message: string) => void) =>
    runProcess(bin, [...command.args, ...args], stdin, timeout, signal, cwd, onActivity);
  return {
    id: "codex-cli",
    seesImages: true,
    supportsArtist: true,
    async available() {
      const versionRun = await run(["--version"], "", 15_000).catch(() => undefined);
      const version = /(\d+\.\d+\.\d+)/.exec(versionRun?.stdout ?? "")?.[1];
      if (!version || versionRun?.code !== 0) return { ok: false, reason: "Codex CLI is not installed. Install it with `npm install -g @openai/codex`." };
      const status = await run(["login", "status"], "", 15_000).catch(() => undefined);
      const detail = `${status?.stdout ?? ""}\n${status?.stderr ?? ""}`;
      const ok = status?.code === 0 && !status.timedOut && /logged in/i.test(detail);
      return { ok, version, authMethod: ok ? (/ChatGPT/i.test(detail) ? "ChatGPT" : "Codex CLI") : undefined,
        reason: ok ? undefined : "Codex is not logged in. Run `codex login` and sign in." };
    },
    async generate(req) {
      const cwd = await mkdtemp(join(tmpdir(), "moco-codex-"));
      const bridge = req.artistTools ? await startToolBridge(req.artistTools) : undefined;
      try {
        const systemFile = join(cwd, "system.md");
        await writeFile(systemFile, req.system + (req.onActivity ? ACTIVITY_GUIDANCE : ""));
        const args = ["exec", "--json", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
          "--sandbox", "read-only", "-c", 'approval_policy="never"',
          "-c", `model_instructions_file=${JSON.stringify(systemFile)}`,
          "-c", "features.shell_tool=false", "-c", "features.apply_patch_freeform=false",
          "-c", "features.view_image=false", "-c", "project_doc_max_bytes=0",
          "-c", 'web_search="disabled"'];
        if (bridge) {
          // Same application-owned MCP transport and tool contract as every artist backend.
          const server = "mcp_servers.moco_artist";
          args.push("-c", `${server}.command=${JSON.stringify(process.execPath)}`,
            "-c", `${server}.args=${JSON.stringify([fileURLToPath(new URL("./mcp-bridge.mjs", import.meta.url))])}`,
            "-c", `${server}.env={MOCO_ARTIST_URL=${JSON.stringify(bridge.url)},MOCO_ARTIST_TOKEN=${JSON.stringify(bridge.token)},ELECTRON_RUN_AS_NODE="1"}`,
            "-c", `${server}.enabled_tools=${JSON.stringify(req.artistTools!.map(tool => tool.name))}`,
            "-c", `${server}.required=true`, "-c", `${server}.tool_timeout_sec=180`,
            "-c", `${server}.default_tools_approval_mode="approve"`);
        }
        if (req.model) args.push("--model", req.model);
        for (const image of req.images ?? []) args.push("--image", image);
        args.push("--", "-");
        const prompt = req.jsonSchema
          ? `${req.prompt}\n\n${req.onActivity ? "Your final message must be" : "Return only"} a JSON value matching this JSON Schema, without Markdown fences:\n${JSON.stringify(req.jsonSchema)}`
          : req.prompt;
        const result = await run(args, prompt, req.timeoutMs, req.signal, cwd, req.onActivity);
        if (result.timedOut) throw new TimeoutError(`Codex did not finish within ${Math.round(req.timeoutMs / 60_000 * 10) / 10} minutes. This request was stopped. Try again to retry the unfinished stage.`);
        let text = "", sessionId: string | undefined, usage: AiResult["usage"], failure = "", completed = false;
        for (const line of result.stdout.split(/\r?\n/)) {
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === "thread.started") sessionId = event.thread_id;
          if (event.type === "item.completed" && event.item?.type === "agent_message") text = event.item.text ?? "";
          if (event.type === "turn.completed") {
            completed = true;
            usage = { inputTokens: event.usage?.input_tokens, outputTokens: event.usage?.output_tokens };
          }
          if (event.type === "turn.failed" || event.type === "error") failure = event.error?.message ?? event.message ?? "Codex request failed";
        }
        if (failure || result.code !== 0 || !completed) throw classifyFailure(failure || result.stderr.trim().slice(0, 500) || "Codex exited without completing a turn");
        let json: unknown;
        if (req.jsonSchema) {
          try { json = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1")); }
          catch { throw new SchemaRefusal(text || "Codex returned no JSON for the requested schema"); }
        }
        return { text, json, usage, backend: "codex-cli", model: req.model, sessionId };
      } finally {
        await bridge?.close();
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}

// ---------- claude-cli ----------

// Oldest Claude Code version the flag set below was verified against (2.1.312 on 30 Oct 2026, 2.1.302 on 1 Nov 2026).
// shortcut: set to the verified version; lower it only after testing older releases.
export const MIN_CLAUDE_VERSION = "2.1.302";

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
  binArgs?: string[]; // a JS CLI entrypoint run with Node, also usable on Windows
}

export function claudeCli(options: ClaudeCliOptions = {}): AiBackend {
  const bin = options.bin ?? "claude";

  return {
    id: "claude-cli",
    seesImages: true,
    supportsArtist: true,

    async available() {
      // Flags like --safe-mode and --json-schema need a recent Claude Code (reference R2).
      const versionRun = await runProcess(bin, [...options.binArgs ?? [], "--version"], "", 15_000).catch(() => undefined);
      const version = /(\d+\.\d+\.\d+)/.exec(versionRun?.stdout ?? "")?.[1];
      if (!version) return { ok: false, reason: "Claude Code is not installed. Install it from claude.com/code." };
      if (compareVersions(version, MIN_CLAUDE_VERSION) < 0) {
        return { ok: false, version, reason: `Claude Code ${version} is too old; update to ${MIN_CLAUDE_VERSION} or later (\`claude update\`).` };
      }

      // `claude auth status` prints JSON and exits 0 when logged in.
      const run = await runProcess(bin, [...options.binArgs ?? [], "auth", "status"], "", 15_000);
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
      const bridge = req.artistTools ? await startToolBridge(req.artistTools) : undefined;
      try {
        const systemFile = join(cwd, "system.md");
        await writeFile(systemFile, req.system + (req.onActivity ? ACTIVITY_GUIDANCE : ""));

        const images = req.images ?? [];
        const args = [
          "-p",
          // With images the prompt goes in as one stream-json user message; the reply then streams too.
          ...(images.length > 0 ? ["--input-format", "stream-json"] : []),
          ...(images.length > 0 || req.onActivity ? ["--output-format", "stream-json", "--verbose"] : ["--output-format", "json"]),
          "--system-prompt-file", systemFile,
          "--tools", "", // no built-in tools
          ...(bridge ? ["--allowedTools", "mcp__moco_artist__*"] : ["--disallowedTools", "mcp__*"]),
          "--strict-mcp-config", // with no --mcp-config: no MCP servers at all
          // Safe mode suppresses explicitly configured MCP servers too. Artist calls instead load no settings,
          // disable hooks/skills, keep built-ins off and allow only our strict application-owned MCP server.
          ...(bridge ? ["--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--disable-slash-commands"] : ["--safe-mode"]),
          "--no-session-persistence",
          "--permission-prompts", "none",
        ];
        if (bridge) {
          const configFile = join(cwd, "artist-mcp.json");
          await writeFile(configFile, JSON.stringify({ mcpServers: { moco_artist: {
            command: process.execPath, args: [fileURLToPath(new URL("./mcp-bridge.mjs", import.meta.url))],
            env: { MOCO_ARTIST_URL: bridge.url, MOCO_ARTIST_TOKEN: bridge.token, ELECTRON_RUN_AS_NODE: "1" },
          } } }), { mode: 0o600 });
          args.push("--mcp-config", configFile);
        }
        if (req.jsonSchema) args.push("--json-schema", JSON.stringify(req.jsonSchema));
        if (req.model) args.push("--model", req.model);

        // Prompt goes in via stdin, never through a shell string.
        const stdin = images.length > 0 ? await imageMessage(req.prompt, images) : req.prompt;
        const run = await runProcess(bin, [...options.binArgs ?? [], ...args], stdin, req.timeoutMs, req.signal, cwd, req.onActivity);
        return parseClaudeResult(run, req);
      } finally {
        await bridge?.close();
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}

const MEDIA_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

// One stream-json line: a user message with the images first, then the prompt.
async function imageMessage(prompt: string, images: string[]): Promise<string> {
  const content: object[] = [];
  for (const file of images) {
    const mediaType = MEDIA_TYPES[extname(file).toLowerCase()];
    if (!mediaType) throw new AiError(`unsupported image type: ${file}`);
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: (await readFile(file)).toString("base64") } });
  }
  content.push({ type: "text", text: prompt });
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
}

// Shape of `claude -p --output-format json` output, and of the final `result` event in stream-json (only the fields we read).
interface ClaudeJson {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

function parseClaudeResult(run: ProcessResult, req: AiRequest): AiResult {
  if (run.timedOut) throw new TimeoutError(`claude timed out after ${req.timeoutMs} ms`);

  const out = readClaudeJson(run.stdout);
  if (!out) {
    // No JSON at all: the CLI failed before answering. stderr says why.
    const detail = (run.stderr || run.stdout).trim().slice(0, 500);
    throw classifyFailure(detail || `claude exited with code ${run.code}`);
  }

  if (out.is_error) throw classifyFailure(out.result ?? out.subtype ?? "unknown error");

  if (req.jsonSchema && out.structured_output === undefined) {
    throw new SchemaRefusal(out.result?.trim() || "claude returned no structured_output for the requested schema");
  }

  return {
    text: out.result ?? "",
    json: out.structured_output,
    usage: {
      // Cached prompt tokens still count against the user's plan, so they are input too.
      inputTokens: out.usage
        ? (out.usage.input_tokens ?? 0) + (out.usage.cache_creation_input_tokens ?? 0) + (out.usage.cache_read_input_tokens ?? 0)
        : undefined,
      outputTokens: out.usage?.output_tokens,
      costUsdEstimate: out.total_cost_usd,
    },
    backend: "claude-cli",
    model: req.model ?? Object.keys(out.modelUsage ?? {})[0],
    sessionId: out.session_id,
  };
}

// One JSON object (--output-format json), or one event per line (stream-json) where the last `result` event is the answer.
function readClaudeJson(stdout: string): ClaudeJson | undefined {
  try {
    return JSON.parse(stdout) as ClaudeJson;
  } catch {
    for (const line of stdout.trim().split("\n").reverse()) {
      try {
        const event = JSON.parse(line) as ClaudeJson & { type?: string };
        if (event.type === "result") return event;
      } catch {
        // not a JSON line; keep looking
      }
    }
    return undefined;
  }
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
  onActivity?: (message: string) => void,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AiError("cancelled")); return; }
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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

    const activity = onActivity ? activityReader(onActivity) : undefined;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; activity?.write(chunk); });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(new BackendError(`could not start ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      activity?.end();
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(new AiError("cancelled"));
      else resolve({ code, stdout, stderr, timedOut });
    });

    child.stdin.end(stdin);
  });
}
