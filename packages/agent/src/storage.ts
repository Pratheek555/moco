import { randomUUID } from "node:crypto";
import { copyFile, cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { confinedFile, inside, mediaType } from "./paths.ts";
import type { ConversationEvent, Project, ProjectEvent, ProviderId, Skill, WorkspaceFile } from "./types.ts";

export { confinedFile, mediaType } from "./paths.ts";

export function parseSkill(text: string): { name: string; description: string } {
  const match = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error("SKILL.md needs YAML frontmatter with a name and description.");
  const document = parseDocument(match[1]!);
  if (document.errors.length) throw new Error(`Invalid skill frontmatter: ${document.errors[0]!.message}`);
  const value: unknown = document.toJS({ maxAliasCount: 20 });
  if (!value || typeof value !== "object") throw new Error("Invalid skill frontmatter.");
  const { name, description } = value as Record<string, unknown>;
  if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)
    throw new Error("Skill name must be at most 64 lowercase letters, numbers, and single hyphens.");
  if (typeof description !== "string" || !description.trim()) throw new Error("Skill frontmatter needs a description.");
  return { name, description: description.trim() };
}

async function noLinks(source: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error("Skill imports cannot contain symbolic links or junctions. Copy the actual files instead.");
  if (info.isDirectory()) for (const entry of await readdir(source)) await noLinks(path.join(source, entry));
  else if (!info.isFile()) throw new Error("Skills may contain only regular files and folders.");
}
async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, file);
}
function safeId(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid project or skill id.");
  return id;
}
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";

export class WorkspaceStore {
  readonly dataDir: string;
  readonly projectsDir: string;
  private writes = new Map<string, Promise<unknown>>();
  constructor(dataDir: string, projectsDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.projectsDir = path.resolve(projectsDir);
  }
  private skillDir(id: string) { return path.join(this.dataDir, "skills", safeId(id)); }
  private projectDir(id: string) { return path.join(this.dataDir, "projects", safeId(id)); }
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.writes.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.writes.set(id, next);
    return next;
  }
  async importSkill(source: string): Promise<Skill> {
    const info = await lstat(source);
    const folder = info.isDirectory();
    if (!folder && path.basename(source).toLowerCase() !== "skill.md") throw new Error("Choose a SKILL.md file or a folder containing SKILL.md.");
    const entry = folder ? path.join(source, "SKILL.md") : source;
    const text = await readFile(entry, "utf8").catch(() => { throw new Error("This skill folder has no readable SKILL.md."); });
    const metadata = parseSkill(text);
    await noLinks(source);
    const skill: Skill = { id: randomUUID(), ...metadata, importedAt: new Date().toISOString() };
    const dir = this.skillDir(skill.id);
    try {
      await mkdir(path.join(dir, "content"), { recursive: true });
      if (folder) await cp(source, path.join(dir, "content"), { recursive: true, dereference: false });
      else await copyFile(source, path.join(dir, "content", "SKILL.md"));
      await atomicJson(path.join(dir, "skill.json"), skill);
      return skill;
    } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  }
  private async ids(dir: string): Promise<string[]> {
    return (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory() && /^[a-f0-9-]{36}$/.test(e.name)).map(e => e.name);
  }
  async skills(): Promise<Skill[]> {
    return Promise.all((await this.ids(path.join(this.dataDir, "skills"))).map(async id => JSON.parse(await readFile(path.join(this.skillDir(id), "skill.json"), "utf8")) as Skill));
  }
  async createProject(name: string, skillId: string, provider: ProviderId = "codex"): Promise<Project> {
    if (provider !== "claude-code" && provider !== "codex") throw new Error("Choose Claude Code or Codex.");
    name = name.trim();
    if (!name || name.length > 120) throw new Error("Give the project a name of 1–120 characters.");
    const skill = (await this.skills()).find(s => s.id === skillId);
    if (!skill) throw new Error("Choose an imported skill.");
    const id = randomUUID();
    const workspace = path.join(this.projectsDir, `${slug(name)}-${id.slice(0, 8)}`);
    await mkdir(workspace, { recursive: true });
    await this.installSkill(skillId, workspace, provider);
    await Promise.all([mkdir(path.join(workspace, "uploads")), mkdir(path.join(workspace, "outbox"))]);
    const now = new Date().toISOString();
    const project: Project = { id, name, workspace, provider, skill, createdAt: now, updatedAt: now };
    await atomicJson(path.join(this.projectDir(id), "project.json"), project);
    return project;
  }
  async installSkill(skillId: string, workspace: string, provider: ProviderId = "codex"): Promise<void> {
    const skill = JSON.parse(await readFile(path.join(this.skillDir(skillId), "skill.json"), "utf8")) as Skill;
    const source = path.join(this.skillDir(skillId), "content");
    const dest = path.join(workspace, provider === "codex" ? ".agents" : ".claude", "skills", skill.name);
    await noLinks(source);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(source, dest, { recursive: true, dereference: false, errorOnExist: true, force: false });
  }
  async project(id: string): Promise<Project> {
    const project = JSON.parse(await readFile(path.join(this.projectDir(id), "project.json"), "utf8")) as Project;
    // Projects created before provider selection always used Claude Code.
    return { ...project, provider: project.provider ?? "claude-code" };
  }
  async projects(): Promise<Project[]> {
    const projects = await Promise.all((await this.ids(path.join(this.dataDir, "projects"))).map(id => this.project(id)));
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async record(id: string, event: ConversationEvent): Promise<ProjectEvent> {
    return this.serial(id, async () => {
      const record: ProjectEvent = { id: randomUUID(), at: new Date().toISOString(), event };
      await appendFile(path.join(this.projectDir(id), "conversation.jsonl"), JSON.stringify(record) + "\n", "utf8");
      if (event.type === "session" || event.type === "user" || event.type === "turn_end") {
        const project = await this.project(id);
        project.updatedAt = record.at;
        if (event.type === "session") project.sessionId = event.sessionId;
        await atomicJson(path.join(this.projectDir(id), "project.json"), project);
      }
      return record;
    });
  }
  async conversation(id: string): Promise<ProjectEvent[]> {
    await this.writes.get(id);
    await this.project(id);
    const text = await readFile(path.join(this.projectDir(id), "conversation.jsonl"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
    const lines = text.split("\n");
    const events: ProjectEvent[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.trim()) continue;
      try { events.push(JSON.parse(lines[i]!) as ProjectEvent); }
      catch (error) { if (i !== lines.length - 1) throw error; /* interrupted final write */ }
    }
    return events;
  }
  async attach(id: string, sources: string[]): Promise<string[]> {
    const project = await this.project(id);
    const files: string[] = [];
    for (const source of sources) {
      if (!(await stat(source)).isFile()) throw new Error("Attach regular files only.");
      const relative = path.join("uploads", `${randomUUID().slice(0, 8)}-${path.basename(source)}`);
      const uploads = path.join(project.workspace, "uploads");
      await mkdir(uploads, { recursive: true });
      // A replaced uploads directory must not route a copy outside the workspace.
      if (!inside(await realpath(project.workspace), await realpath(uploads))) throw new Error("Uploads folder is outside the workspace.");
      await copyFile(source, path.join(project.workspace, relative));
      files.push(relative.replaceAll(path.sep, "/"));
    }
    return files;
  }
  async files(id: string): Promise<WorkspaceFile[]> {
    const { workspace } = await this.project(id);
    const result: WorkspaceFile[] = [];
    const walk = async (relative: string) => {
      for (const entry of await readdir(path.join(workspace, relative), { withFileTypes: true })) {
        if (entry.name.startsWith(".") || ["node_modules", "venv", "__pycache__"].includes(entry.name) || entry.isSymbolicLink()) continue;
        const file = path.join(relative, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile()) {
          try {
            const full = await confinedFile(workspace, file);
            const info = await stat(full);
            const mime = mediaType(file);
            const kind = mime?.split("/")[0] as "image" | "video" | "audio" | undefined;
            result.push({ path: file.replaceAll(path.sep, "/"), name: entry.name, size: info.size, modifiedAt: info.mtime.toISOString(), kind: kind ?? "file" });
          } catch { /* file may be being replaced by the agent */ }
        }
      }
    };
    await walk("");
    return result.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }
}
