import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

// Check every component, including root: no traversal, links or Windows streams.
export async function workspacePath(root: string, name: string): Promise<string> {
  if (!name || isAbsolute(name) || name.includes("\\") || name.includes(":") || name.split("/").some(part => !part || part === "." || part === "..")) throw Error("Use a relative workspace path without traversal");
  const target = resolve(root, name);
  if (relative(root, target).startsWith("..")) throw Error("Path escapes workspace");
  for (const current of [resolve(root), ...name.split("/").map((_, index, parts) => resolve(root, ...parts.slice(0, index + 1)))]) {
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (info?.isSymbolicLink()) throw Error("Workspace links are not allowed");
  }
  return target;
}
