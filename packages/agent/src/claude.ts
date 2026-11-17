import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { handOffFile } from "./handoff.ts";
export { handOffFile } from "./handoff.ts";
import { MessageMapper } from "./messages.ts";
import { QuestionBroker } from "./questions.ts";
import { narrationEnvironment } from "./narration-environment.ts";
import type { AgentProvider, AgentSession, ProviderStatus, SessionOptions } from "./types.ts";

const exec = promisify(execFile);

// Consumer login only. Do not inherit a developer key, gateway, or alternate cloud provider.
export function subscriptionEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^ANTHROPIC_|^CLAUDE_CODE_(?:OAUTH_TOKEN|USE_|API_KEY)|^CLAUDECODE$/.test(key)));
}

export async function findClaude(): Promise<string | undefined> {
  const home = homedir();
  const dirs = [path.join(home, ".local", "bin"), ...(process.env.PATH ?? process.env.Path ?? "").split(path.delimiter), "/usr/local/bin", "/opt/homebrew/bin"];
  const candidates = process.platform === "win32"
    ? [...dirs.map(dir => path.join(dir.replace(/^"|"$/g, ""), "claude.exe")), ...dirs.map(dir => path.join(dir.replace(/^"|"$/g, ""), "node_modules", "@anthropic-ai", "claude-code", "cli.js")), path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js")]
    : dirs.map(dir => path.join(dir, "claude"));
  for (const candidate of candidates) {
    try { await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); return candidate; } catch { /* next */ }
  }
  return undefined;
}

async function loginStatus(executable: string): Promise<ProviderStatus> {
  const isJs = executable.endsWith(".js");
  const run = (args: string[]) => exec(isJs ? "node" : executable, isJs ? [executable, ...args] : args, { env: subscriptionEnvironment(), windowsHide: true, timeout: 15_000 });
  let version: string | undefined;
  try {
    version = (await run(["--version"])).stdout.trim();
    // Claude may exit nonzero for a signed-out account but still return valid auth JSON.
    const { stdout } = await run(["auth", "status"]).catch((error: unknown) => {
      if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string" && error.stdout.trim()) return { stdout: error.stdout };
      throw error;
    });
    const auth = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
    if (!auth.loggedIn || auth.authMethod !== "claude.ai" || !auth.subscriptionType)
      return { ok: false, issue: "signed-out", version, reason: "Claude Code is signed out. Run claude in a terminal and sign in to your Claude subscription, then check again. Moco does not accept API keys." };
    return { ok: true, version };
  } catch {
    return { ok: false, issue: "unavailable", version, reason: "Claude Code could not connect. Run claude in a terminal to check your connection and sign-in, then check again." };
  }
}

class InputStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;
  push(text: string): void {
    if (this.closed) throw new Error("Session has stopped.");
    this.queue.push({ type: "user", uuid: randomUUID(), session_id: "", parent_tool_use_id: null, message: { role: "user", content: text } });
    this.wake?.();
  }
  close() { this.closed = true; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (!this.closed) {
      const item = this.queue.shift();
      if (item) yield item;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}

function startSession(options: SessionOptions, executable: string): AgentSession {
  const { cwd, onEvent: emit } = options;
  const input = new InputStream();
  const abort = new AbortController();
  const questions = new QuestionBroker(emit);
  const mapper = new MessageMapper(options.tasks);
  let stopped = false;
  let interrupted = false;
  let active = false;
  const delivery = createSdkMcpServer({ name: "moco", version: "1.0.0", tools: [tool(
    "SendUserFile", "Hand a file to the user (preview or final). Path must be inside this project workspace; copy external files into outbox first.",
    { path: z.string(), label: z.string().optional() },
    async ({ path: file, label }) => {
      try {
        const delivered = await handOffFile(cwd, file, label, emit);
        return { content: [{ type: "text" as const, text: `Delivered ${delivered} to the user.` }] };
      } catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(error) }] }; }
    }, { alwaysLoad: true },
  )] });
  const session: Query = query({ prompt: input, options: {
    cwd, pathToClaudeCodeExecutable: executable, executable: "node",
    env: narrationEnvironment(subscriptionEnvironment(), options.narration), abortController: abort,
    resume: options.sessionId,
    settingSources: ["project"],
    systemPrompt: { type: "preset", preset: "claude_code", append: `Use the user's chosen skill: ${options.skill} (.claude/skills/${options.skill}/SKILL.md). User uploads are in uploads/; messages give their paths. Hand preview and final files to the user with mcp__moco__SendUserFile. Deliver files within this workspace; copy files created elsewhere into outbox/ before handing them over. Media files in this workspace also appear in the file panel.` },
    tools: { type: "preset", preset: "claude_code" },
    permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    mcpServers: { moco: delivery },
    canUseTool: async (name, args, context) => name === "AskUserQuestion"
      ? questions.ask(context.toolUseID, args, context.signal)
      : { behavior: "allow", updatedInput: args },
  } });
  const done = (async () => {
    try {
      for await (const message of session) {
        for (let event of mapper.map(message)) {
          if (event.type === "turn_end") {
            active = false;
            if (interrupted) event = { type: "turn_end", status: "interrupted" };
            interrupted = false;
          }
          emit(event);
        }
      }
      if (!stopped && active) emit({ type: "error", message: "Claude Code exited before finishing the turn. Send a message to resume." });
    } catch (error) {
      if (!stopped) { emit({ type: "error", message: error instanceof Error ? error.message : String(error) }); emit({ type: "turn_end", status: "error" }); }
    } finally { questions.cancel(); input.close(); }
  })();
  return {
    done,
    send(text) { if (stopped) throw new Error("Session has stopped."); active = true; input.push(text); },
    answer(id, answers) { questions.answer(id, answers); },
    async interrupt() { interrupted = true; questions.cancel(); await session.interrupt(); },
    async stop() {
      if (stopped) return;
      stopped = true; questions.cancel(); input.close(); abort.abort(); session.close();
      await done;
    },
  };
}

export function claudeProvider(): AgentProvider {
  return {
    id: "claude-code",
    async status() {
      const executable = await findClaude();
      return executable ? loginStatus(executable) : { ok: false, issue: "not-installed", reason: "Claude Code is not installed. Install it from claude.ai/install, run claude in a terminal, and sign in with your Claude subscription. Then check again." };
    },
    async start(options) {
      const executable = await findClaude();
      if (!executable) throw new Error("Claude Code is not installed. Install Claude Code and sign in, then retry.");
      const status = await loginStatus(executable);
      if (!status.ok) throw new Error(status.reason);
      return startSession(options, executable);
    },
  };
}
