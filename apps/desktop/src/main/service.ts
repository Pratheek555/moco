import { WorkspaceStore, confinedFile } from "../../../../packages/agent/src/storage.ts";
import type { AgentEvent, AgentProvider, AgentSession, ProviderId, RunState } from "@moco/agent/types";
import type { Method, ServiceMethods, Update } from "../shared/api.ts";
import path from "node:path";

export class ProjectService {
  private store: WorkspaceStore;
  private providers: Map<ProviderId, AgentProvider>;
  private emit: (update: Update) => void;
  private sessions = new Map<string, AgentSession>();
  private starting = new Map<string, Promise<AgentSession>>();
  private states = new Map<string, RunState>();
  private pending = new Set<Promise<unknown>>();
  private revisions = new Map<string, number>();
  private background = new Map<string, Set<string>>();
  private turnActive = new Set<string>();
  constructor(store: WorkspaceStore, providers: AgentProvider | AgentProvider[], emit: (update: Update) => void) {
    this.store = store; this.providers = new Map((Array.isArray(providers) ? providers : [providers]).map(provider => [provider.id, provider])); this.emit = emit;
  }
  private provider(id: unknown = "codex"): AgentProvider {
    const provider = this.providers.get(id as ProviderId);
    if (!provider) throw new Error("Choose an available AI provider.");
    return provider;
  }
  private state(id: string, state: RunState) {
    if (this.states.get(id) === state) return;
    this.states.set(id, state); this.emit({ projectId: id, state });
  }
  private track<T>(work: Promise<T>): Promise<T> { this.pending.add(work); void work.finally(() => this.pending.delete(work)).catch(() => {}); return work; }
  private record(id: string, event: AgentEvent) {
    void this.track(this.store.record(id, event).then(record => {
      this.emit({ projectId: id, record });
    })).catch(error => { this.state(id, "error"); this.emit({ error: `Could not save conversation: ${String(error)}` }); });
    if (["text", "thinking", "tool_call", "answer"].includes(event.type)) {
      this.turnActive.add(id);
      if (this.states.get(id) !== "waiting" || event.type === "answer") this.state(id, "running");
    }
    if (event.type === "question") this.state(id, "waiting");
    if (event.type === "activity" && event.kind === "background") {
      const tasks = this.background.get(id) ?? new Set<string>();
      if (["completed", "failed", "stopped"].includes(event.status)) tasks.delete(event.id);
      else tasks.add(event.id);
      this.background.set(id, tasks);
      if (!this.turnActive.has(id) && this.states.get(id) !== "waiting" && this.states.get(id) !== "error") this.state(id, tasks.size ? "running" : "idle");
    }
    if (event.type === "error") this.state(id, "error");
    if (event.type === "turn_end") {
      this.turnActive.delete(id);
      this.state(id, event.status === "error" ? "error" : this.background.get(id)?.size ? "running" : "idle");
    }
  }
  private async session(id: string): Promise<AgentSession> {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const creating = this.starting.get(id);
    if (creating) return creating;
    const start = (async () => {
      const project = await this.store.project(id);
      const events = await this.store.conversation(id);
      const latestTasks = [...events].reverse().find(record => record.event.type === "tasks")?.event;
      const session = await this.provider(project.provider).start({ cwd: project.workspace, skill: project.skill.name, sessionId: project.sessionId, tasks: latestTasks?.type === "tasks" ? latestTasks.tasks : [], onEvent: event => this.record(id, event) });
      this.sessions.set(id, session);
      void session.done.finally(() => {
        if (this.sessions.get(id) !== session) return;
        this.sessions.delete(id);
        if (["running", "waiting"].includes(this.states.get(id) ?? "")) this.state(id, "error");
      });
      return session;
    })();
    this.starting.set(id, start);
    try { return await start; } finally { this.starting.delete(id); }
  }
  // Each exposed method has a typed result; the IPC boundary accepts only this allowlist.
  async call<M extends Method>(method: M, args: ServiceMethods[M]["args"]): Promise<ServiceMethods[M]["result"]> {
    const work = this.dispatch(method, args as unknown[]);
    const result = await (method === "shutdown" ? work : this.track(work));
    return result as ServiceMethods[M]["result"];
  }
  private async dispatch(method: Method, args: unknown[]): Promise<unknown> {
    const [id, second, third] = args;
    const projectId = typeof id === "string" ? id : "";
    switch (method) {
      case "status": return this.provider(id).status();
      case "skills": return this.store.skills();
      case "importSkill": return this.store.importSkill(projectId);
      case "projects": return this.store.projects();
      case "create": return this.store.createProject(projectId, String(second), this.provider(third).id);
      case "project": return { project: await this.store.project(projectId), events: await this.store.conversation(projectId), state: this.states.get(projectId) ?? "idle" };
      case "files": return this.store.files(projectId);
      case "attach": return this.store.attach(projectId, second as string[]);
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
        this.state(projectId, "running");
        this.turnActive.add(projectId);
        try {
          const session = await this.session(projectId);
          if (revision !== (this.revisions.get(projectId) ?? 0)) return;
          const record = await this.store.record(projectId, { type: "user", text, files });
          this.emit({ projectId, record });
          const uploaded = files.length ? `\n\nUploaded files (workspace paths):\n${files.map(file => path.join(project.workspace, file)).join("\n")}` : "";
          if (revision === (this.revisions.get(projectId) ?? 0)) session.send(text + uploaded);
        } catch (error) {
          this.record(projectId, { type: "error", message: String(error) }); throw error;
        }
        return;
      }
      case "answer": {
        const session = this.sessions.get(projectId);
        if (session && this.states.get(projectId) === "waiting") session.answer(String(second), third as Record<string, string>);
        else {
          // After restart the old callback no longer exists. Resume with the user's answer as a new turn.
          const view = await this.store.conversation(projectId);
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
        this.revisions.set(projectId, (this.revisions.get(projectId) ?? 0) + 1);
        const session = this.sessions.get(projectId) ?? await this.starting.get(projectId);
        if (session) { this.sessions.delete(projectId); await session.stop(); }
        this.background.delete(projectId); this.turnActive.delete(projectId);
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
