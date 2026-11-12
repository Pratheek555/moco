import type { AgentEvent, Question, Task } from "./types.ts";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === "string" ? value : "";

export function questionsFromInput(input: Record<string, unknown>): Question[] {
  if (!Array.isArray(input.questions) || !input.questions.length) throw new Error("The agent sent an empty question.");
  return input.questions.map(value => {
    const q = object(value);
    if (!string(q.question)) throw new Error("The agent sent an invalid question.");
    return {
      question: string(q.question), header: string(q.header), multiSelect: q.multiSelect === true,
      options: Array.isArray(q.options) ? q.options.map(value => {
        const option = object(value);
        return { label: string(option.label), description: string(option.description) };
      }) : [],
    };
  });
}

// Pure translation, shared by the live SDK adapter and fixture tests. No workflow decisions.
export class MessageMapper {
  private current = new Map<string, string>();
  private streamed = new Set<string>();
  private tools = new Set<string>();
  private tasks = new Map<string, Task>();
  private creates = new Map<string, string>();
  constructor(tasks: Task[] = []) { this.tasks = new Map(tasks.map(task => [task.id, task])); }

  map(value: unknown): AgentEvent[] {
    const message = object(value);
    const events: AgentEvent[] = [];
    const parent = string(message.parent_tool_use_id) || "main";
    if (message.type === "stream_event") {
      const event = object(message.event);
      if (event.type === "message_start") this.current.set(parent, string(object(event.message).id) || string(message.uuid));
      if (event.type === "content_block_delta") {
        const delta = object(event.delta);
        const id = this.current.get(parent) ?? string(message.uuid);
        if (delta.type === "text_delta" || delta.type === "thinking_delta") {
          const type = delta.type === "text_delta" ? "text" : "thinking";
          this.streamed.add(`${id}:${type}`);
          events.push({ type, messageId: id, text: string(delta.text ?? delta.thinking) });
        }
      }
    }
    if (message.type === "assistant") {
      const body = object(message.message);
      const id = string(body.id) || string(message.uuid);
      if (message.error) events.push({ type: "error", message: `Claude Code: ${string(message.error)}` });
      for (const raw of Array.isArray(body.content) ? body.content : []) {
        const block = object(raw);
        if (block.type === "text" || block.type === "thinking") {
          const type = block.type;
          if (!this.streamed.has(`${id}:${type}`)) events.push({ type, messageId: id, text: string(block.text ?? block.thinking) });
        }
        if (block.type === "tool_use" && !this.tools.has(string(block.id))) {
          const toolId = string(block.id), name = string(block.name), input = object(block.input);
          this.tools.add(toolId);
          events.push({ type: "tool_call", id: toolId, name, input: block.input });
          if (name === "TodoWrite" && Array.isArray(input.todos)) {
            this.tasks.clear();
            input.todos.forEach((v, i) => {
              const todo = object(v), key = String(i);
              this.tasks.set(key, { id: key, subject: string(todo.content), status: string(todo.status) });
            });
            events.push({ type: "tasks", tasks: [...this.tasks.values()] });
          }
          if (name === "TaskCreate") {
            this.tasks.set(toolId, { id: toolId, subject: string(input.subject), status: "pending" });
            this.creates.set(toolId, toolId);
            events.push({ type: "tasks", tasks: [...this.tasks.values()] });
          }
          if (name === "TaskUpdate") {
            const key = string(input.taskId), old = this.tasks.get(key);
            if (input.status === "deleted") this.tasks.delete(key);
            else this.tasks.set(key, { id: key, subject: string(input.subject) || old?.subject || key, status: string(input.status) || old?.status || "pending" });
            events.push({ type: "tasks", tasks: [...this.tasks.values()] });
          }
        }
      }
    }
    if (message.type === "user") {
      const content = object(message.message).content;
      for (const raw of Array.isArray(content) ? content : []) {
        const block = object(raw);
        if (block.type !== "tool_result") continue;
        const id = string(block.tool_use_id);
        events.push({ type: "tool_result", id, content: block.content, isError: block.is_error === true });
        if (this.creates.has(id)) {
          const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          const number = /Task #([\d]+)/.exec(text)?.[1] ?? string(object(message.tool_use_result).taskId);
          const old = this.tasks.get(id);
          if (number && old) { this.tasks.delete(id); this.tasks.set(number, { ...old, id: number }); }
          if (block.is_error) this.tasks.delete(id);
          events.push({ type: "tasks", tasks: [...this.tasks.values()] });
          this.creates.delete(id);
        }
      }
    }
    if (message.type === "system") {
      if (message.subtype === "init") events.push({ type: "session", sessionId: string(message.session_id), skills: Array.isArray(message.skills) ? message.skills.filter((x): x is string => typeof x === "string") : [] });
      if (["task_started", "task_progress", "task_notification"].includes(string(message.subtype))) {
        events.push({ type: "activity", id: string(message.task_id), description: string(message.description ?? message.summary), status: string(message.status) || "running", kind: "background" });
      }
    }
    if (message.type === "tool_progress") events.push({ type: "activity", id: string(message.tool_use_id), description: `${string(message.tool_name)} · ${Number(message.elapsed_time_seconds) || 0}s`, status: "running", kind: "tool" });
    if (message.type === "result") {
      const usage = object(message.usage);
      events.push({ type: "usage", inputTokens: Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0), costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : undefined });
      const failed = message.is_error === true || message.subtype !== "success";
      if (failed) events.push({ type: "error", message: Array.isArray(message.errors) ? message.errors.join("\n") : string(message.result) || string(message.subtype) });
      events.push({ type: "turn_end", status: failed ? "error" : "completed" });
    }
    return events;
  }
}
