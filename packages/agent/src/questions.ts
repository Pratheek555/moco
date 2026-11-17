import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { questionsFromInput } from "./messages.ts";
import type { AgentEvent } from "./types.ts";

export class QuestionBroker {
  private pending = new Map<string, { input: Record<string, unknown>; resolve: (value: PermissionResult) => void }>();
  private emit: (event: AgentEvent) => void;
  constructor(emit: (event: AgentEvent) => void) { this.emit = emit; }

  ask(id: string, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    const questions = questionsFromInput(input);
    if (signal.aborted) return Promise.resolve({ behavior: "deny", message: "Question interrupted." });
    return new Promise(resolve => {
      const abort = () => {
        this.pending.delete(id);
        resolve({ behavior: "deny", message: "Question interrupted." });
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { input, resolve: result => { signal.removeEventListener("abort", abort); resolve(result); } });
      this.emit({ type: "question", id, questions });
    });
  }
  answer(id: string, answers: Record<string, string>): void {
    const pending = this.pending.get(id);
    if (!pending) throw new Error("This question is no longer waiting. Send your answer as a message to continue.");
    for (const q of questionsFromInput(pending.input)) if (typeof answers[q.question] !== "string" || !answers[q.question]!.trim()) throw new Error("Answer each question before continuing.");
    this.pending.delete(id);
    this.emit({ type: "answer", id, answers });
    pending.resolve({ behavior: "allow", updatedInput: { ...pending.input, answers } });
  }
  cancel(): void {
    for (const pending of this.pending.values()) pending.resolve({ behavior: "deny", message: "Interrupted by the user." });
    this.pending.clear();
  }
}
