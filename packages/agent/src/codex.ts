import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CodexConnection } from "./codex-rpc.ts";
import { CodexMessageMapper } from "./codex-messages.ts";
import { handOffFile } from "./handoff.ts";
import { QuestionBroker } from "./questions.ts";
import { narrationEnvironment } from "./narration-environment.ts";
import type { AgentProvider, AgentSession, ProviderStatus, SessionOptions } from "./types.ts";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === "string" ? value : "";
const signIn = "Run codex login in a terminal and sign in with ChatGPT, then check again. Moco uses your ChatGPT subscription and does not accept API keys.";

export function codexEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^(?:OPENAI_|CODEX_(?:API_KEY|ACCESS_TOKEN|BASE_URL|INTERNAL_ORIGINATOR_OVERRIDE))/i.test(key)));
}

export async function findCodex(): Promise<string | undefined> {
  const home = homedir();
  const dirs = [path.join(home, ".local", "bin"), path.join(home, ".cargo", "bin"), ...(process.env.PATH ?? process.env.Path ?? "").split(path.delimiter), "/usr/local/bin", "/opt/homebrew/bin"].filter(Boolean).map(dir => dir.replace(/^"|"$/g, ""));
  const candidates = process.platform === "win32" ? [
    ...dirs.map(dir => path.join(dir, "codex.exe")),
    path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
    ...dirs.map(dir => path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js")),
    path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "npm", "node_modules", "@openai", "codex", "bin", "codex.js"),
  ] : [...dirs.map(dir => path.join(dir, "codex")), "/Applications/Codex.app/Contents/Resources/codex"];
  for (const candidate of candidates) {
    try { await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); return candidate; } catch { /* next */ }
  }
  return undefined;
}

async function accountStatus(connection: CodexConnection, version: string): Promise<ProviderStatus> {
  const { account } = await connection.request<{ account: { type: string } | null }>("account/read", { refreshToken: false });
  return account?.type === "chatgpt" ? { ok: true, version } : { ok: false, issue: "signed-out", version, reason: signIn };
}

const tools = [
  {
    type: "function", name: "moco_SendUserFile",
    description: "Hand an existing workspace file to the user for preview or final delivery. Copy external files into outbox/ first.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, label: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    type: "function", name: "moco_AskUserQuestion",
    description: "Ask the user questions and wait for their answers. Use for skill intake, choices, and clarification. Supports options, multiple selections, and free text.",
    inputSchema: { type: "object", properties: { questions: { type: "array", minItems: 1, items: {
      type: "object", properties: {
        question: { type: "string" }, header: { type: "string" }, multiSelect: { type: "boolean" },
        options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"], additionalProperties: false } },
      }, required: ["question"], additionalProperties: false,
    } } }, required: ["questions"], additionalProperties: false },
  },
];
const toolResult = (text: string, success = true) => ({ contentItems: [{ type: "inputText", text }], success });

async function startSession(options: SessionOptions, connection: CodexConnection): Promise<AgentSession> {
  const { cwd, skill, onEvent: emit } = options;
  const questions = new QuestionBroker(emit);
  let abort = new AbortController();
  const mapper = new CodexMessageMapper();
  let threadId = "", activeTurn: string | undefined, stopped = false;
  let sending = Promise.resolve();
  const completed = new Set<string>();
  connection.onNotification = ({ method, params = {} }) => {
    if (stopped || (params.threadId && params.threadId !== threadId)) return;
    if (method === "turn/started") activeTurn = string(object(params.turn).id);
    if (method === "turn/completed") {
      const id = string(object(params.turn).id);
      completed.add(id);
      if (activeTurn === id) activeTurn = undefined;
      questions.cancel();
    }
    for (const event of mapper.map(method ?? "", params)) emit(event);
  };
  connection.onRequest = async ({ method, params = {} }) => {
    if (stopped) throw new Error("Session has stopped.");
    if (params.threadId && params.threadId !== threadId) throw new Error("Unknown Codex thread.");
    if (method === "item/tool/call") {
      const input = object(params.arguments);
      try {
        if (params.tool === "moco_SendUserFile") {
          const file = await handOffFile(cwd, string(input.path), typeof input.label === "string" ? input.label : undefined, emit);
          return toolResult(`Delivered ${file} to the user.`);
        }
        if (params.tool === "moco_AskUserQuestion") {
          const result = await questions.ask(`codex-${randomUUID()}`, input, abort.signal);
          return result.behavior === "allow" ? toolResult(JSON.stringify(result.updatedInput?.answers)) : toolResult("Question interrupted.", false);
        }
        return toolResult(`Unknown Moco tool: ${string(params.tool)}`, false);
      } catch (error) { return toolResult(error instanceof Error ? error.message : String(error), false); }
    }
    if (method === "item/tool/requestUserInput") {
      const native = Array.isArray(params.questions) ? params.questions.map(object) : [];
      if (native.some(q => q.isSecret === true)) throw new Error("Enter credentials in the provider's own sign-in flow, not the project conversation.");
      const result = await questions.ask(`codex-${randomUUID()}`, { questions: native }, abort.signal);
      const answers = object(result.behavior === "allow" ? result.updatedInput?.answers : undefined);
      return { answers: Object.fromEntries(native.map(q => [string(q.id), { answers: typeof answers[string(q.question)] === "string" ? [answers[string(q.question)]] : [] }])) };
    }
    // Ordinary tools run without per-tool approvals, matching the Claude provider.
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") return { decision: "accept" };
    if (method === "mcpServer/elicitation/request") return { action: "decline", content: null };
    throw new Error(`Unsupported Codex request: ${method}`);
  };
  const config = {
    cwd, approvalPolicy: "never", sandbox: "danger-full-access",
    developerInstructions: `Use the user's chosen skill: ${skill} (.agents/skills/${skill}/SKILL.md). User uploads are in uploads/; messages give their paths. When the skill asks you to question the user or use AskUserQuestion, call moco_AskUserQuestion and wait for the answer. Hand preview and final files to the user with moco_SendUserFile (the Moco file-delivery tool). Deliver files within this workspace; copy files created elsewhere into outbox/ before handing them over. Media files in this workspace also appear in the file panel.`,
  };
  const result = await connection.request<{ thread: { id: string } }>(options.sessionId ? "thread/resume" : "thread/start", options.sessionId
    // Moco already persists the conversation. Request only live metadata:
    // full display-history hydration is deprecated for paginated threads.
    ? { ...config, threadId: options.sessionId, excludeTurns: true }
    : { ...config, dynamicTools: tools }, 60_000);
  threadId = result.thread.id;
  if (!threadId) throw new Error("Codex did not return a thread ID. Update Codex and retry.");
  emit({ type: "session", sessionId: threadId, skills: [skill] });
  void connection.done.then(() => {
    questions.cancel(); abort.abort();
    if (!stopped) {
      emit({ type: "error", message: connection.failure?.message ?? "Codex stopped unexpectedly. Send a message to resume." });
      emit({ type: "turn_end", status: "error" });
    }
  });
  async function startTurn(text: string) {
    const response = await connection.request<{ turn: { id: string; status: string } }>("turn/start", {
      threadId, input: [
        { type: "text", text },
        { type: "skill", name: skill, path: path.join(cwd, ".agents", "skills", skill, "SKILL.md") },
      ],
    });
    if (!completed.has(response.turn.id) && response.turn.status === "inProgress") activeTurn = response.turn.id;
  }
  return {
    done: connection.done,
    send(text) {
      if (stopped) throw new Error("Session has stopped.");
      sending = sending.then(async () => {
        if (stopped) return;
        const turnId = activeTurn;
        if (turnId) {
          try { await connection.request("turn/steer", { threadId, expectedTurnId: turnId, input: [{ type: "text", text }] }); }
          catch (error) {
            // A turn may finish between reading activeTurn and sending the steer request.
            if (activeTurn === turnId && !/no active turn/i.test(String(error))) throw error;
            if (!stopped) await startTurn(text);
          }
        } else await startTurn(text);
      }).catch(error => {
        if (!stopped) { emit({ type: "error", message: error instanceof Error ? error.message : String(error) }); emit({ type: "turn_end", status: "error" }); }
      });
    },
    answer(id, answers) { questions.answer(id, answers); },
    async interrupt() {
      questions.cancel(); abort.abort(); abort = new AbortController();
      if (activeTurn) await connection.request("turn/interrupt", { threadId, turnId: activeTurn });
    },
    async stop() {
      if (stopped) return connection.done;
      stopped = true; questions.cancel(); abort.abort();
      try { if (activeTurn) await connection.request("turn/interrupt", { threadId, turnId: activeTurn }, 1000); }
      catch { /* Close the process even if it cannot acknowledge the interrupt. */ }
      await connection.close(); await sending;
    },
  };
}

export function codexProvider(options: { executable?: string } = {}): AgentProvider {
  const executable = () => options.executable ? Promise.resolve(options.executable) : findCodex();
  return {
    id: "codex",
    async status() {
      const binary = await executable();
      if (!binary) return { ok: false, issue: "not-installed", reason: "Codex is not installed. Install the Codex CLI from developers.openai.com/codex/cli, then run codex login and sign in with ChatGPT." };
      const connection = new CodexConnection(binary, codexEnvironment());
      try { return await accountStatus(connection, await connection.initialize()); }
      catch (error) { return { ok: false, issue: "unavailable", reason: `Codex could not connect: ${error instanceof Error ? error.message : String(error)} ${signIn}` }; }
      finally { await connection.close(); }
    },
    async start(sessionOptions) {
      const binary = await executable();
      if (!binary) throw new Error("Codex is not installed. Install the Codex CLI and sign in with ChatGPT, then retry.");
      const connection = new CodexConnection(binary, narrationEnvironment(codexEnvironment(), sessionOptions.narration), sessionOptions.cwd);
      try {
        const status = await accountStatus(connection, await connection.initialize());
        if (!status.ok) throw new Error(status.reason);
        return await startSession(sessionOptions, connection);
      } catch (error) { await connection.close(); throw error; }
    },
  };
}
