import type { Project, ProjectEvent, ProjectView, ProviderId, ProviderStatus, RunState, Skill, WorkspaceFile } from "@moco/agent/types";
export type { Project, ProjectEvent, ProjectView, ProviderId, ProviderStatus, RunState, Skill, WorkspaceFile };
export const providerLabels: Record<ProviderId, string> = { codex: "Codex", "claude-code": "Claude Code" };

export interface ServiceMethods {
  status: { args: [provider?: ProviderId]; result: ProviderStatus };
  skills: { args: []; result: Skill[] };
  importSkill: { args: [source: string]; result: Skill };
  projects: { args: []; result: Project[] };
  create: { args: [name: string, skillId: string, provider?: ProviderId]; result: Project };
  project: { args: [id: string]; result: ProjectView };
  send: { args: [id: string, text: string, files: string[]]; result: void };
  answer: { args: [id: string, questionId: string, answers: Record<string, string>]; result: void };
  stop: { args: [id: string]; result: void };
  attach: { args: [id: string, sources: string[]]; result: string[] };
  files: { args: [id: string]; result: WorkspaceFile[] };
  shutdown: { args: []; result: void };
}
export type Method = keyof ServiceMethods;
export interface HostRequest { id: number; method: Method; args: unknown[] }
export interface HostReply { id: number; result?: unknown; error?: string }
export type Update = { projectId: string; record?: ProjectEvent; state?: RunState } | { error: string };
export interface MocoAPI {
  info(): Promise<{ version: string; projectsDir: string; theme: "light" | "dark" | "system" }>;
  setTheme(theme: "light" | "dark" | "system"): Promise<void>;
  status(provider?: ProviderId): Promise<ProviderStatus>;
  skills(): Promise<Skill[]>;
  importSkill(kind: "file" | "folder"): Promise<Skill | null>;
  projects(): Promise<Project[]>;
  create(name: string, skillId: string, provider?: ProviderId): Promise<Project>;
  project(id: string): Promise<ProjectView>;
  send(id: string, text: string, files: string[]): Promise<void>;
  answer(id: string, questionId: string, answers: Record<string, string>): Promise<void>;
  stop(id: string): Promise<void>;
  attach(id: string): Promise<string[]>;
  files(id: string): Promise<WorkspaceFile[]>;
  openFile(id: string, relative: string, reveal: boolean): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  onUpdate(listener: (update: Update) => void): () => void;
}
export function mediaUrl(id: string, file: string, revision = ""): string {
  return `moco-media://project/${encodeURIComponent(id)}/${file.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(revision)}`;
}
