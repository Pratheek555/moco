import { WorkspaceStore, confinedFile } from "../../../../packages/agent/src/storage.ts";
import type { AgentEvent, AgentProvider, AgentSession, GeminiNarration, NarrationEngine, ProviderId, RunState } from "@moco/agent/types";
import type { Method, ServiceMethods, Update } from "../shared/api.ts";
import path from "node:path";
import { narrationContext } from "./narration.ts";

export class ProjectService {
  private store: WorkspaceStore;
  private providers: Map<ProviderId, AgentProvider>;
  private emit: (update: Update) => void;
  private sessions = new Map<string, AgentSession>();
  private starting = new Map<string, Promise<AgentSession>>();
  private runStates = new Map<string, RunState>();
  private pending = new Set<Promise<unknown>>();
  private revisions = new Map<string, number>();
  private background = new Map<string, Set<string>>();
  private turnActive = new Set<string>();
  private generations = new Map<string, object>();
  private removing = new Set<string>();
  private projectWork = new Map<string, Set<Promise<unknown>>>();
  private stopping = new Map<string, Promise<void>>();
  private narration?: GeminiNarration;
  private narrationRevision = 0;
  private sessionNarration = new Map<string, { revision: number; available: boolean }>();
  updateNarration(narration?: GeminiNarration): void {
    if (narration?.key === this.narration?.key && narration?.voice === this.narration?.voice) return;
    this.narration = narration ? { ...narration } : undefined;
    this.narrationRevision++;
  }
  constructor(store: WorkspaceStore, providers: AgentProvider | AgentProvider[], emit: (update: Update) => void) {
    this.store = store; this.providers = new Map((Array.isArray(providers) ? providers : [providers]).map(provider => [provider.id, provider])); this.emit = emit;
  }
  private provider(id: unknown = "codex"): AgentProvider {
    const provider = this.providers.get(id as ProviderId);
    if (!provider) throw new Error("Choose an available AI provider.");
    return provider;
  }
  private state(id: string, state: RunState) {
    if (this.runStates.get(id) === state) return;
    if (state === "idle") this.runStates.delete(id); else this.runStates.set(id, state);
    this.emit({ projectId: id, state });
  }
  private track<T>(work: Promise<T>): Promise<T> { this.pending.add(work); void work.finally(() => this.pending.delete(work)).catch(() => {}); return work; }
  private record(id: string, event: AgentEvent) {
    if (this.removing.has(id)) return;
    void this.track(this.store.record(id, event).then(record => {
      this.emit({ projectId: id, record });
    })).catch(error => { this.state(id, "error"); this.emit({ error: `Could not save conversation: ${String(error)}` }); });
    if (["text", "thinking", "tool_call", "answer"].includes(event.type)) {
      this.turnActive.add(id);
      if (this.runStates.get(id) !== "waiting" || event.type === "answer") this.state(id, "running");
    }
    if (event.type === "question") this.state(id, "waiting");
    if (event.type === "activity" && event.kind === "background") {
      const tasks = this.background.get(id) ?? new Set<string>();
      if (["completed", "failed", "stopped"].includes(event.status)) tasks.delete(event.id);
      else tasks.add(event.id);
      this.background.set(id, tasks);
      if (!this.turnActive.has(id) && this.runStates.get(id) !== "waiting" && this.runStates.get(id) !== "error") this.state(id, tasks.size ? "running" : "idle");
    }
    if (event.type === "error") this.state(id, "error");
    if (event.type === "turn_end") {
      this.turnActive.delete(id);
      this.state(id, event.status === "error" ? "error" : this.background.get(id)?.size ? "running" : "idle");
    }
  }
  private async session(id: string, renewIdle = false): Promise<AgentSession> {
    const creating = this.starting.get(id);
    if (creating) return creating;
    const existing = this.sessions.get(id);
    if (existing && (!renewIdle || this.sessionNarration.get(id)?.revision === this.narrationRevision)) return existing;
    const generation = {};
    this.generations.set(id, generation);
    const start = (async () => {
      if (existing) {
        this.sessions.delete(id);
        await existing.stop();
        // Persist the session ID before resuming the provider with a fresh process env.
        await this.store.conversation(id);
      }
      const narration = this.narration ? { ...this.narration } : undefined;
      this.sessionNarration.set(id, { revision: this.narrationRevision, available: !!narration });
      const project = await this.store.project(id);
      const events = await this.store.conversation(id);
      const latestTasks = [...events].reverse().find(record => record.event.type === "tasks")?.event;
      const session = await this.provider(project.provider).start({ cwd: project.workspace, skill: project.skill.name, sessionId: project.sessionId, narration, tasks: latestTasks?.type === "tasks" ? latestTasks.tasks : [], onEvent: event => {
        if (this.generations.get(id) === generation) this.record(id, event);
      } });
      this.sessions.set(id, session);
      void session.done.finally(() => {
        if (this.sessions.get(id) !== session) return;
        this.sessions.delete(id);
        if (this.generations.get(id) !== generation) return;
        this.generations.delete(id);
        if (["running", "waiting"].includes(this.runStates.get(id) ?? "")) this.state(id, "error");
      }).catch(() => {});
      return session;
    })();
    this.starting.set(id, start);
    try { return await start; } finally { this.starting.delete(id); }
  }
  // Each exposed method has a typed result; the IPC boundary accepts only this allowlist.
  async call<M extends Method>(method: M, args: ServiceMethods[M]["args"]): Promise<ServiceMethods[M]["result"]> {
    const projectId = ["project", "rename", "setNarrationEngine", "remove", "files", "attach", "attachData", "send", "answer", "stop"].includes(method) ? args[0] as string : undefined;
    if (projectId && this.removing.has(projectId)) throw new Error("This project is being deleted.");
    const work = this.dispatch(method, args as unknown[]);
    const operations = projectId && method !== "remove" ? this.projectWork.get(projectId) ?? new Set<Promise<unknown>>() : undefined;
    if (projectId && operations) { operations.add(work); this.projectWork.set(projectId, operations); }
    try {
      return await (method === "shutdown" ? work : this.track(work)) as ServiceMethods[M]["result"];
    } finally {
      operations?.delete(work);
      if (projectId && !operations?.size) this.projectWork.delete(projectId);
    }
  }
  private async stopSession(id: string): Promise<void> {
    const stopping = this.stopping.get(id);
    if (stopping) return stopping;
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    this.generations.delete(id);
    const work = (async () => {
      // Failed startup still needs to leave Stop/Delete usable.
      const session = this.sessions.get(id) ?? await this.starting.get(id)?.catch(() => undefined);
      if (session) { this.sessions.delete(id); await session.stop(); }
      this.background.delete(id); this.turnActive.delete(id);
    })();
    this.stopping.set(id, work);
    try { await work; } finally { this.stopping.delete(id); }
  }
  private async dispatch(method: Method, args: unknown[]): Promise<unknown> {
    const [id, second, third, fourth] = args;
    const projectId = typeof id === "string" ? id : "";
    switch (method) {
      case "status": return this.provider(id).status();
      case "skills": return this.store.skills();
      case "importSkill": return this.store.importSkill(projectId);
      case "removeSkill": return this.store.deleteSkill(projectId);
      case "projects": return this.store.projects();
      case "states": return Object.fromEntries(this.runStates);
      case "create": return this.store.createProject(projectId, String(second), this.provider(third).id, fourth as NarrationEngine | undefined);
      case "project": return { project: await this.store.project(projectId), events: await this.store.conversation(projectId), state: this.runStates.get(projectId) ?? "idle" };
      case "rename": return this.store.renameProject(projectId, second as string);
      case "setNarrationEngine": {
        if (["running", "waiting"].includes(this.runStates.get(projectId) ?? "") || this.starting.has(projectId))
          throw new Error("Stop the project before changing its narration voice.");
        return this.store.setNarrationEngine(projectId, second as NarrationEngine | null);
      }
      case "remove": {
        this.removing.add(projectId);
        try {
          await this.stopSession(projectId);
          await Promise.allSettled([...(this.projectWork.get(projectId) ?? [])]);
          const project = await this.store.deleteProject(projectId);
          this.runStates.delete(projectId); this.revisions.delete(projectId);
          this.sessions.delete(projectId); this.starting.delete(projectId); this.generations.delete(projectId);
          this.background.delete(projectId); this.turnActive.delete(projectId); this.projectWork.delete(projectId);
          this.emit({ projectId, state: "idle" });
          return project;
        } finally { this.removing.delete(projectId); }
      }
      case "files": return this.store.files(projectId);
      case "attach": return this.store.attach(projectId, second as string[]);
      case "attachData": return this.store.attachData(projectId, second as string, third as Uint8Array);
      case "send": {
        const revision = this.revisions.get(projectId) ?? 0;
        const text = typeof second === "string" ? second.trim() : "";
        const files = Array.isArray(third) ? third.filter((v): v is string => typeof v === "string") : [];
        if (!text && !files.length) throw new Error("Write a message or attach a file.");
        const project = await this.store.project(projectId);
        for (const file of files) {
          if (!file.startsWith("uploads/")) throw new Error("Choose an uploaded file.");
          await confinedFile(project.workspace, file);
        }
        if (this.removing.has(projectId)) return;
        if (revision !== (this.revisions.get(projectId) ?? 0)) throw new Error("Message was not sent because the project stopped. Your draft is kept.");
        const renewIdle = !this.turnActive.has(projectId) && !this.background.get(projectId)?.size && this.runStates.get(projectId) !== "waiting";
        this.state(projectId, "running");
        this.turnActive.add(projectId);
        try {
          const session = await this.session(projectId, renewIdle);
          if (this.removing.has(projectId)) return;
          if (revision !== (this.revisions.get(projectId) ?? 0)) throw new Error("Message was not sent because the project stopped. Your draft is kept.");
          const record = await this.store.record(projectId, { type: "user", text, files });
          this.emit({ projectId, record });
          const uploaded = files.length ? `\n\nUploaded files (workspace paths):\n${files.map(file => path.join(project.workspace, file)).join("\n")}` : "";
          if (!this.removing.has(projectId) && revision === (this.revisions.get(projectId) ?? 0)) session.send(text + uploaded + narrationContext(project, this.sessionNarration.get(projectId)?.available));
        } catch (error) {
          if (this.removing.has(projectId)) return;
          if (revision !== (this.revisions.get(projectId) ?? 0)) throw new Error("Message was not sent because the project stopped. Your draft is kept.");
          this.record(projectId, { type: "error", message: String(error) }); throw error;
        }
        return;
      }
      case "answer": {
        const session = this.sessions.get(projectId);
        if (session && this.runStates.get(projectId) === "waiting") session.answer(String(second), third as Record<string, string>);
        else {
          // After restart the old callback no longer exists. Resume with the user's answer as a new turn.
          const view = await this.store.conversation(projectId);
          if (this.removing.has(projectId)) return;
          const question = view.find(record => record.event.type === "question" && record.event.id === second);
          if (!question || view.some(record => record.event.type === "answer" && record.event.id === second)) throw new Error("This question is no longer waiting.");
          const answers = third as Record<string, string>;
          if (question.event.type === "question" && question.event.questions.some(q => typeof answers[q.question] !== "string" || !answers[q.question]!.trim())) throw new Error("Answer each question before continuing.");
          const record = await this.store.record(projectId, { type: "answer", id: String(second), answers });
          this.emit({ projectId, record });
          await this.dispatch("send", [projectId, Object.entries(answers).map(([question, answer]) => `${question}: ${answer}`).join("\n"), []]);
        }
        return;
      }
      case "stop": {
        await this.stopSession(projectId);
        if (this.removing.has(projectId)) return;
        await this.store.record(projectId, { type: "turn_end", status: "interrupted" }).then(record => this.emit({ projectId, record }));
        this.state(projectId, "idle"); return;
      }
      case "shutdown": {
        await Promise.allSettled([...this.starting.values()]);
        await Promise.allSettled([...this.sessions.keys()].map(id => this.dispatch("stop", [id])));
        await Promise.allSettled([...this.pending]);
        return;
      }
      default: throw new Error("Unknown agent request.");
    }
  }
}
