import type { ProjectEvent } from "../../shared/api.ts";
import type { Question } from "@moco/agent/types";
interface Tool { id: string; name: string; input: unknown; result?: unknown; isError?: boolean }
type Block =
  | { type: "text"; id: string; role: "user" | "assistant"; text: string; files?: string[] }
  | { type: "thinking"; id: string; text: string }
  | { type: "tools"; id: string; tools: Tool[] }
  | { type: "question"; id: string; questionId: string; questions: Question[]; answers?: Record<string, string> }
  | { type: "file"; id: string; path: string; label?: string }
  | { type: "activity"; id: string; description: string; status: string }
  | { type: "error"; id: string; message: string }
  | { type: "stopped"; id: string };

export function transcript(records: ProjectEvent[]): Block[] {
  const blocks: Block[] = [];
  const messages = new Map<string, Extract<Block, { type: "text" | "thinking" }>>();
  const tools = new Map<string, Tool>();
  const questions = new Map<string, Extract<Block, { type: "question" }>>();
  const activity = new Map<string, Extract<Block, { type: "activity" }>>();
  for (const { id, event } of records) {
    switch (event.type) {
      case "user": blocks.push({ type: "text", id, role: "user", text: event.text, files: event.files }); break;
      case "text": case "thinking": {
        const key = `${event.type}:${event.messageId}`;
        const existing = messages.get(key);
        if (existing) existing.text += event.text;
        else {
          const block = event.type === "text" ? { type: "text" as const, id, role: "assistant" as const, text: event.text } : { type: "thinking" as const, id, text: event.text };
          blocks.push(block); messages.set(key, block);
        }
        break;
      }
      case "tool_call": {
        const tool = { id: event.id, name: event.name, input: event.input };
        tools.set(event.id, tool);
        const last = blocks.at(-1);
        if (last?.type === "tools") last.tools.push(tool);
        else blocks.push({ type: "tools", id, tools: [tool] });
        break;
      }
      case "tool_result": {
        const tool = tools.get(event.id); if (tool) { tool.result = event.content; tool.isError = event.isError; }
        const progress = activity.get(event.id); if (progress) progress.status = event.isError ? "failed" : "completed";
        break;
      }
      case "question": { const block = { ...event, id, questionId: event.id }; blocks.push(block); questions.set(event.id, block); break; }
      case "answer": { const question = questions.get(event.id); if (question) question.answers = event.answers; break; }
      case "file": blocks.push({ ...event, id }); break;
      case "activity": {
        const old = activity.get(event.id);
        if (old) { old.description = event.description; old.status = event.status; }
        else { const block = { ...event, id }; blocks.push(block); activity.set(event.id, block); }
        break;
      }
      case "error": blocks.push({ ...event, id }); break;
      case "turn_end": if (event.status === "interrupted") blocks.push({ type: "stopped", id }); break;
    }
  }
  return blocks;
}
