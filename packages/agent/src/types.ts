export type ProviderId = "claude-code" | "codex";

export interface Question {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
}
export interface Task {
  id: string;
  subject: string;
  status: string;
}
export type AgentEvent =
  | { type: "session"; sessionId: string; skills: string[] }
  | { type: "text" | "thinking"; messageId: string; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; content: unknown; isError: boolean }
  | { type: "tasks"; tasks: Task[] }
  | { type: "activity"; id: string; description: string; status: string; kind?: "tool" | "background" }
  | { type: "question"; id: string; questions: Question[] }
  | { type: "answer"; id: string; answers: Record<string, string> }
  | { type: "permission"; id: string; tool: string; input: unknown }
  | { type: "file"; path: string; label?: string }
  | { type: "error"; message: string }
  | { type: "turn_end"; status: "completed" | "interrupted" | "error" }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd?: number };

export interface AgentSession {
  send(text: string): void;
  answer(id: string, answers: Record<string, string>): void;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  readonly done: Promise<void>;
}
export interface ProviderStatus {
  ok: boolean;
  reason?: string;
  version?: string;
}
export interface SessionOptions {
  cwd: string;
  skill: string;
  sessionId?: string;
  tasks?: Task[];
  onEvent(event: AgentEvent): void;
}
export interface AgentProvider {
  readonly id: ProviderId;
  status(): Promise<ProviderStatus>;
  start(options: SessionOptions): Promise<AgentSession>;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  importedAt: string;
}
export interface Project {
  id: string;
  name: string;
  workspace: string;
  provider: ProviderId;
  skill: Skill;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
}
export type ConversationEvent = AgentEvent | { type: "user"; text: string; files: string[] };
export interface ProjectEvent {
  id: string;
  at: string;
  event: ConversationEvent;
}
export type RunState = "idle" | "running" | "waiting" | "error";
export interface ProjectView {
  project: Project;
  events: ProjectEvent[];
  state: RunState;
}
export interface WorkspaceFile {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  kind: "image" | "video" | "audio" | "file";
}
