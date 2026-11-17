import type { WorkStep } from "../../conversation.ts";

export type ToolIcon = "read" | "edit" | "terminal" | "search" | "web" | "thinking" | "activity" | "skill" | "tool";
export interface ToolDescription { icon: ToolIcon; title: string; detail?: string }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const line = (value: unknown, limit = 100): string => { const clean = text(value).replace(/\s+/g, " ").trim(); return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean; };
const filename = (value: unknown): string => line(text(value).split(/[\\/]/).filter(Boolean).at(-1));
const leaf = (name: string): string => name.split("__").at(-1) ?? name;

/** These already have a dedicated question, delivered-file or progress UI. */
export function isPresentationTool(name: string): boolean {
  return /^(?:moco_)?(?:AskUserQuestion|SendUserFile|TodoWrite|TodoRead|TaskCreate|TaskUpdate|TaskList|TaskGet|update_plan|request_user_input)$/i.test(leaf(name));
}

export function describeTool(name: string, input: unknown): ToolDescription {
  const data = object(input), tool = leaf(name).replace(/^moco_/, "");
  const path = filename(data.file_path ?? data.path ?? data.target_file ?? data.notebook_path);
  const detail = line(data.description, 180) || undefined;
  switch (tool.toLowerCase()) {
    case "read": case "read_file": return { icon: "read", title: path ? `Read ${path}` : "Read a file", detail };
    case "write": case "edit": case "multiedit": case "notebookedit": case "write_file": case "apply_patch":
      return { icon: "edit", title: path ? `Edited ${path}` : "Edited files", detail };
    case "file changes": {
      const changes = Array.isArray(input) ? input : Array.isArray(data.changes) ? data.changes : [];
      const paths = changes.map(change => filename(object(change).path)).filter(Boolean);
      return { icon: "edit", title: paths.length === 1 ? `Edited ${paths[0]}` : paths.length ? `Edited ${paths.length} files` : "Edited files", detail: paths.length > 1 ? line(paths.join(", "), 180) : undefined };
    }
    case "bash": case "shell": case "exec_command": case "shell_command": {
      const command = line(data.command ?? data.cmd ?? (typeof input === "string" ? input : ""));
      return { icon: "terminal", title: command ? `Ran ${command}` : "Ran a command", detail };
    }
    case "glob": case "grep": case "search": case "search_files": {
      const query = line(data.pattern ?? data.query, 80);
      return { icon: "search", title: query ? `Searched files for ${query}` : "Searched files", detail };
    }
    case "websearch": case "web search": case "web_search": {
      const query = line(data.query ?? (Array.isArray(data.queries) ? data.queries.join(", ") : ""), 80);
      if (data.type === "openPage" || data.type === "open_page") return { icon: "web", title: "Opened a web page", detail: line(data.url, 180) || undefined };
      if (data.type === "findInPage" || data.type === "find_in_page") return { icon: "web", title: "Searched a web page", detail: line(data.pattern, 180) || undefined };
      return { icon: "web", title: query ? `Searched the web for ${query}` : "Searched the web", detail };
    }
    case "webfetch": case "web_fetch": return { icon: "web", title: "Read a web page", detail: line(data.url, 180) || undefined };
    case "task": case "agent": return { icon: "activity", title: line(data.description) || "Worked on a task", detail: line(data.subagent_type, 180) || undefined };
    case "skill": return { icon: "skill", title: text(data.skill) ? `Used ${line(data.skill)}` : "Used a skill", detail };
    case "taskoutput": return { icon: "activity", title: "Checked progress", detail };
    case "taskstop": case "killbash": return { icon: "activity", title: "Stopped a task", detail };
    case "askuserquestion": return { icon: "activity", title: "Asked a question" };
    case "senduserfile": return { icon: "read", title: path ? `Shared ${path}` : "Shared a file" };
    case "todowrite": case "taskcreate": case "taskupdate": case "tasklist": case "taskget": case "update_plan": return { icon: "activity", title: "Updated progress" };
    default: {
      const parts = name.split("__"), tidy = (value: string) => line(value.replace(/[_-]+/g, " "));
      return { icon: "tool", title: parts[0] === "mcp" && parts.length >= 3 ? `${tidy(parts.slice(2).join(" ")) || "Tool"} (${tidy(parts[1]!)})` : tidy(name.replace(/^moco_/, "")) || "Tool", detail };
    }
  }
}

export function liveStepTitle(step: WorkStep | undefined): string {
  if (!step) return "Working…";
  if (step.type === "thinking") return "Thinking…";
  if (step.type === "activity") return line(step.description, 140) || "Working…";
  const description = describeTool(step.name, step.input);
  const labels: Partial<Record<ToolIcon, string>> = { read: "Reading a file…", edit: "Editing files…", terminal: "Running a command…", search: "Searching files…", web: "Searching the web…", skill: "Reading a skill…" };
  return labels[description.icon] ?? `${description.title}…`;
}

/** A stable order makes a long run readable even as new kinds of work arrive. */
export function summarizeWork(steps: readonly WorkStep[]): string {
  const counts = new Map<ToolIcon, number>();
  let editedFile = "";
  for (const step of steps) {
    const icon = step.type === "thinking" ? "thinking" : step.type === "activity" ? "activity" : describeTool(step.name, step.input).icon;
    let count = 1;
    if (step.type === "tool" && step.name === "File changes" && Array.isArray(step.input)) count = Math.max(1, step.input.length);
    counts.set(icon, (counts.get(icon) ?? 0) + count);
    if (icon === "edit" && step.type === "tool") editedFile = describeTool(step.name, step.input).title;
  }
  const parts: string[] = [];
  const add = (icon: ToolIcon, singular: string, plural: (n: number) => string) => { const n = counts.get(icon) ?? 0; if (n) parts.push(n === 1 ? singular : plural(n)); };
  add("read", "Read 1 file", n => `Read ${n} files`);
  add("terminal", "Ran 1 command", n => `Ran ${n} commands`);
  add("edit", editedFile || "Edited 1 file", n => `Edited ${n} files`);
  add("search", "Searched files", () => "Searched files");
  add("web", "Searched the web", () => "Searched the web");
  add("skill", "Used a skill", n => `Used ${n} skills`);
  add("thinking", "Thought for a moment", () => "Thought for a moment");
  add("activity", "Worked on a task", n => `Worked on ${n} tasks`);
  add("tool", "Used a tool", n => `Used ${n} tools`);
  return parts.slice(0, 4).join(" · ") || "Worked for a moment";
}
