import type { AgentEvent } from "./types.ts";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === "string" ? value : "";

// Translate app-server notifications into the same persisted events as Claude Code.
export class CodexMessageMapper {
  private streamed = new Set<string>();
  private tools = new Set<string>();
  private failed = new Set<string>();
  map(method: string, params: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = [];
    const turn = string(params.turnId);
    const id = `${turn}:${string(params.itemId)}`;
    if (method === "item/agentMessage/delta" || method === "item/reasoning/summaryTextDelta") {
      const type = method === "item/agentMessage/delta" ? "text" : "thinking";
      this.streamed.add(`${id}:${type}`);
      events.push({ type, messageId: id, text: string(params.delta) });
    }
    if (method === "item/started" || method === "item/completed") {
      const item = object(params.item);
      const key = `${turn}:${string(item.id)}`;
      const completed = method === "item/completed";
      if (completed && (item.type === "agentMessage" || item.type === "reasoning")) {
        const type = item.type === "agentMessage" ? "text" : "thinking";
        const text = type === "text" ? string(item.text) : (Array.isArray(item.summary) ? item.summary.map(string).join("\n") : "");
        if (text && !this.streamed.has(`${key}:${type}`)) {
          this.streamed.add(`${key}:${type}`);
          events.push({ type, messageId: key, text });
        }
      }
      const tool = item.type === "commandExecution" ? { name: "Shell", input: { command: item.command, cwd: item.cwd }, result: item.aggregatedOutput }
        : item.type === "fileChange" ? { name: "File changes", input: item.changes, result: item.changes }
        : item.type === "mcpToolCall" ? { name: `mcp__${string(item.server)}__${string(item.tool)}`, input: item.arguments, result: item.error ?? item.result }
        : item.type === "dynamicToolCall" ? { name: string(item.tool), input: item.arguments, result: item.contentItems }
        : item.type === "webSearch" ? { name: "Web search", input: item.action ?? { query: item.query }, result: item.action ?? item.query }
        : undefined;
      if (tool) {
        if (!this.tools.has(key)) { this.tools.add(key); events.push({ type: "tool_call", id: key, name: tool.name, input: tool.input }); }
        if (completed) events.push({ type: "tool_result", id: key, content: tool.result ?? item.status ?? "Completed", isError: ["failed", "declined"].includes(string(item.status)) || item.success === false || !!item.error || (typeof item.exitCode === "number" && item.exitCode !== 0) });
      }
    }
    if (method === "turn/plan/updated" && Array.isArray(params.plan)) {
      events.push({ type: "tasks", tasks: params.plan.map((value, index) => {
        const step = object(value);
        return { id: String(index), subject: string(step.step), status: string(step.status).replace("inProgress", "in_progress") };
      }) });
    }
    if (method === "thread/tokenUsage/updated") {
      const usage = object(object(params.tokenUsage).last);
      events.push({ type: "usage", inputTokens: Number(usage.inputTokens) || 0, outputTokens: Number(usage.outputTokens) || 0 });
    }
    if (method === "error" && params.willRetry !== true) {
      this.failed.add(turn);
      events.push({ type: "error", message: string(object(params.error).message) || "Codex could not complete the turn." });
    }
    if (method === "turn/completed") {
      const result = object(params.turn), turnId = string(result.id);
      const status = result.status === "completed" ? "completed" : result.status === "interrupted" ? "interrupted" : "error";
      if (status === "error" && !this.failed.has(turnId)) events.push({ type: "error", message: string(object(result.error).message) || "Codex could not complete the turn." });
      events.push({ type: "turn_end", status });
    }
    return events;
  }
}
