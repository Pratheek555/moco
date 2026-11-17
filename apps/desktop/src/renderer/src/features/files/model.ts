// Pure logic for the files panel. No React, no window.moco: unit-tested in apps/desktop/test/files-model.test.ts.
import type { Task, WorkspaceFile } from "../../../../shared/api.ts";

/** Workspace-relative paths always use forward slashes and never start with "./". */
export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
}

/** True when two listings show the same files in the same order (path, size and modification time). */
export function sameFiles(a: readonly WorkspaceFile[], b: readonly WorkspaceFile[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    if (x.path !== y.path || x.size !== y.size || x.modifiedAt !== y.modifiedAt) return false;
  }
  return true;
}

export function isMedia(file: Pick<WorkspaceFile, "kind">): boolean {
  return file.kind === "image" || file.kind === "video" || file.kind === "audio";
}

const textExtensions = new Set([".txt", ".md", ".json", ".srt", ".vtt", ".csv", ".log", ".mjs", ".js", ".ts", ".py", ".yaml", ".yml", ".toml", ".html", ".css", ".xml"]);

export function extension(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Files the viewer previews as text through api.readTextFile. */
export function isTextLike(path: string): boolean {
  return textExtensions.has(extension(path));
}

/** Files the viewer can show: media and text. Anything else opens in the default app. */
export function isViewable(file: WorkspaceFile): boolean {
  return isMedia(file) || isTextLike(file.path);
}

const byNewest = (a: WorkspaceFile, b: WorkspaceFile) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0);

/** Explicit deliveries plus every image, video and audio file outside uploads/, newest first, each once. */
export function outputFiles(files: readonly WorkspaceFile[], delivered: readonly string[]): WorkspaceFile[] {
  const handed = new Set(delivered.map(normalizePath));
  const seen = new Set<string>();
  const result: WorkspaceFile[] = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    if (seen.has(path)) continue;
    if (handed.has(path) || (isMedia(file) && !path.startsWith("uploads/"))) {
      seen.add(path);
      result.push(file);
    }
  }
  // Array.prototype.sort is stable, so equal times keep the listing's order.
  return result.sort(byNewest);
}

// ── Folder tree ─────────────────────────────────────────────────────────────

export interface FolderNode {
  type: "folder";
  /** Stable React key. */
  key: string;
  name: string;
  /** Workspace-relative folder path without a trailing slash. */
  path: string;
  children: TreeNode[];
}
export interface FileNode {
  type: "file";
  key: string;
  name: string;
  path: string;
  file: WorkspaceFile;
}
export type TreeNode = FolderNode | FileNode;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** "frame 2" before "frame 10"; case-insensitive, with a deterministic tie-break. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => (a.type === b.type ? naturalCompare(a.name, b.name) : a.type === "folder" ? -1 : 1));
  for (const node of nodes) if (node.type === "folder") sortNodes(node.children);
}

/** Builds a folder tree from the flat listing: folders first, then files, each in natural name order. */
export function buildTree(files: readonly WorkspaceFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folders = new Map<string, FolderNode>();
  const added = new Set<string>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || added.has(path)) continue;
    added.add(path);
    const parts = path.split("/").filter(Boolean);
    let siblings = root;
    let prefix = "";
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      let folder = folders.get(prefix);
      if (!folder) {
        folder = { type: "folder", key: `d:${prefix}`, name: part, path: prefix, children: [] };
        folders.set(prefix, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    siblings.push({ type: "file", key: `f:${path}`, name: parts[parts.length - 1] ?? path, path, file });
  }
  sortNodes(root);
  return root;
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
  /** Folders only. */
  expanded?: boolean;
}

/** The rows on screen: only the contents of expanded folders are visited. */
export function visibleRows(nodes: readonly TreeNode[], expanded: ReadonlySet<string>, depth = 0, out: TreeRow[] = []): TreeRow[] {
  for (const node of nodes) {
    if (node.type === "folder") {
      const open = expanded.has(node.path);
      out.push({ node, depth, expanded: open });
      if (open) visibleRows(node.children, expanded, depth + 1, out);
    } else out.push({ node, depth });
  }
  return out;
}

/** Number of files anywhere under a folder. */
export function countFiles(folder: FolderNode): number {
  let count = 0;
  for (const child of folder.children) count += child.type === "folder" ? countFiles(child) : 1;
  return count;
}

/** Files of one folder (not its subfolders), in tree order: the list the viewer steps through from All files. */
export function folderFiles(files: readonly WorkspaceFile[], folder: string): WorkspaceFile[] {
  const inFolder = files.filter(file => {
    const slash = file.path.lastIndexOf("/");
    return (slash < 0 ? "" : file.path.slice(0, slash)) === folder;
  });
  return inFolder.sort((a, b) => naturalCompare(a.name, b.name));
}

export function parentFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** Freeze the source order at open time; public view() falls back to all media. */
export function viewerList(path: string, source: readonly string[], files: readonly WorkspaceFile[]): string[] {
  const target = normalizePath(path);
  const paths = [...new Set(source.map(normalizePath))];
  if (paths.includes(target)) return paths;
  const media = [...new Set(files.filter(isMedia).map(file => normalizePath(file.path)))];
  return media.includes(target) ? media : [target, ...media];
}

// ── Seen tracking (the blue dot) ────────────────────────────────────────────

/** Path → modifiedAt of the version the person viewed. */
export type SeenMap = Record<string, string>;

export function isUnseen(seen: SeenMap, file: Pick<WorkspaceFile, "path" | "modifiedAt">): boolean {
  return seen[file.path] !== file.modifiedAt;
}

/** Every current file counted as seen: used the first time a project opens on this machine. */
export function seenFromListing(files: readonly WorkspaceFile[]): SeenMap {
  return Object.fromEntries(files.map(file => [file.path, file.modifiedAt]));
}

/** Records a viewed file and drops entries for files that are gone, so storage stays small. */
export function markSeen(seen: SeenMap, file: Pick<WorkspaceFile, "path" | "modifiedAt">, files: readonly WorkspaceFile[]): SeenMap {
  if (seen[file.path] === file.modifiedAt) return seen;
  const present = new Set(files.map(f => f.path));
  return { ...Object.fromEntries(Object.entries(seen).filter(([path]) => present.has(path))), [file.path]: file.modifiedAt };
}

/** Parses a stored seen map; anything malformed reads as missing. */
export function parseSeen(raw: string | null): SeenMap | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value);
    if (entries.some(([, modifiedAt]) => typeof modifiedAt !== "string")) return undefined;
    return Object.fromEntries(entries);
  } catch {
    return undefined;
  }
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed";
export function taskStatus(task: Pick<Task, "status">): TaskStatus {
  return task.status === "completed" || task.status === "in_progress" ? task.status : "pending";
}
export function taskCounts(tasks: readonly Task[]): { done: number; total: number } {
  return { done: tasks.filter(task => taskStatus(task) === "completed").length, total: tasks.length };
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Video length for a card badge: "0:07", "3:12", "1:04:05". */
export function mediaDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
