import type { NarrationEngine, Project, ProjectEvent, ProjectView, ProviderId, ProviderStatus, RunState, Skill, Task, WorkspaceFile } from "@moco/agent/types";
import type { GeminiNarration } from "@moco/agent/types";
import type { GeminiVoice, KeyCheck, NarrationStatus } from "./gemini.ts";
export type { NarrationEngine, Project, ProjectEvent, ProjectView, ProviderId, ProviderStatus, RunState, Skill, Task, WorkspaceFile };
export const providerLabels: Record<ProviderId, string> = { codex: "Codex", "claude-code": "Claude Code" };

export type Theme = "light" | "dark" | "system";
export type Platform = "win32" | "darwin" | "linux";
export interface AppInfo {
  version: string;
  projectsDir: string;
  theme: Theme;
  /** Desktop notifications when a project finishes or needs an answer while Moco is in the background. */
  notifications: boolean;
  platform: Platform;
}
/** A skill shipped with the app that the user can add to their library in one click. */
export interface StarterSkill { name: string; description: string }
/** Commands the main process sends to the renderer (application menu, notification clicks). */
export type AppCommand = { type: "open-project"; projectId: string } | { type: "new-project" } | { type: "settings" };
export interface TextPreview { text: string; truncated: boolean }

export interface ServiceMethods {
  status: { args: [provider?: ProviderId]; result: ProviderStatus };
  skills: { args: []; result: Skill[] };
  importSkill: { args: [source: string]; result: Skill };
  removeSkill: { args: [id: string]; result: void };
  projects: { args: []; result: Project[] };
  create: { args: [name: string, skillId: string, provider?: ProviderId, narrationEngine?: NarrationEngine]; result: Project };
  setNarrationEngine: { args: [id: string, engine: NarrationEngine | null]; result: Project };
  project: { args: [id: string]; result: ProjectView };
  rename: { args: [id: string, name: string]; result: Project };
  /** Stops the session and deletes the project's app-data record. Returns the deleted project; the workspace folder is untouched. */
  remove: { args: [id: string]; result: Project };
  /** Run state of every project that is not idle. */
  states: { args: []; result: Record<string, RunState> };
  send: { args: [id: string, text: string, files: string[]]; result: void };
  answer: { args: [id: string, questionId: string, answers: Record<string, string>]; result: void };
  stop: { args: [id: string]; result: void };
  attach: { args: [id: string, sources: string[]]; result: string[] };
  attachData: { args: [id: string, name: string, data: Uint8Array]; result: string[] };
  files: { args: [id: string]; result: WorkspaceFile[] };
  shutdown: { args: []; result: void };
}
export type Method = keyof ServiceMethods;
export interface HostRequest { id: number; method: Method; args: unknown[] }
/** Private main/host channel, never exposed by preload or recorded as service calls. */
export interface HostNarrationUpdate { narration: GeminiNarration | undefined }
export interface HostReply { id: number; result?: unknown; error?: string }
export type Update = { projectId: string; record?: ProjectEvent; state?: RunState } | { error: string };

export interface MocoAPI {
  // App and preferences
  info(): Promise<AppInfo>;
  setTheme(theme: Theme): Promise<void>;
  setNotifications(enabled: boolean): Promise<void>;
  narrationStatus(): Promise<NarrationStatus>;
  setGeminiKey(key: string): Promise<NarrationStatus>;
  clearGeminiKey(): Promise<NarrationStatus>;
  setGeminiVoice(voice: GeminiVoice): Promise<NarrationStatus>;
  /** Checks the typed key when supplied; otherwise checks the saved key in main. */
  checkGeminiKey(key?: string): Promise<KeyCheck>;
  /** Opens an https:// link in the default browser. Anything else is rejected. */
  openExternal(url: string): Promise<void>;
  openProjectsFolder(): Promise<void>;
  copyText(text: string): Promise<void>;
  /** Menu accelerators and notification clicks. Returns an unsubscribe function. */
  onCommand(listener: (command: AppCommand) => void): () => void;

  // Providers
  status(provider?: ProviderId): Promise<ProviderStatus>;

  // Skill library
  skills(): Promise<Skill[]>;
  /** Native picker. Resolves null when the user cancels. */
  importSkill(kind: "file" | "folder"): Promise<Skill | null>;
  /** A SKILL.md file or skill folder dropped onto the window. */
  importSkillDropped(file: File): Promise<Skill>;
  /** Removes a skill from the library. Projects keep their own copy. */
  deleteSkill(id: string): Promise<void>;
  starterSkills(): Promise<StarterSkill[]>;
  addStarterSkill(name: string): Promise<Skill>;

  // Projects
  projects(): Promise<Project[]>;
  /** Run state of every project that is not idle (missing id = idle). */
  projectStates(): Promise<Record<string, RunState>>;
  create(name: string, skillId: string, provider?: ProviderId, narrationEngine?: NarrationEngine): Promise<Project>;
  /** Applies to subsequent messages; null keeps the story's own voice settings. */
  setNarrationEngine(id: string, engine: NarrationEngine | null): Promise<Project>;
  project(id: string): Promise<ProjectView>;
  renameProject(id: string, name: string): Promise<Project>;
  /** Deletes the project and its conversation. With removeFiles the workspace folder moves to the Recycle Bin / Trash. */
  deleteProject(id: string, removeFiles: boolean): Promise<void>;

  // Conversation
  send(id: string, text: string, files: string[]): Promise<void>;
  answer(id: string, questionId: string, answers: Record<string, string>): Promise<void>;
  stop(id: string): Promise<void>;
  /** Native picker. Resolves workspace-relative paths under uploads/. */
  attach(id: string): Promise<string[]>;
  /** Files dropped onto the window or pasted from the file manager. */
  attachDropped(id: string, files: File[]): Promise<string[]>;
  /** Clipboard data without a file on disk, such as a pasted screenshot. */
  attachPasted(id: string, name: string, data: Uint8Array): Promise<string[]>;

  // Workspace files
  files(id: string): Promise<WorkspaceFile[]>;
  openFile(id: string, relative: string, reveal: boolean): Promise<void>;
  openWorkspace(id: string): Promise<void>;
  /** Native Save dialog; copies the file out of the workspace. Resolves false when cancelled. */
  saveFileAs(id: string, relative: string): Promise<boolean>;
  /** Text preview of a small text-like workspace file (scripts, subtitles, notes, JSON). */
  readTextFile(id: string, relative: string): Promise<TextPreview>;
  /** Call from a dragstart handler (after preventDefault) to drag the file out to another app. */
  dragFile(id: string, relative: string): void;

  onUpdate(listener: (update: Update) => void): () => void;
}
export function mediaUrl(id: string, file: string, revision = ""): string {
  return `moco-media://project/${encodeURIComponent(id)}/${file.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(revision)}`;
}
