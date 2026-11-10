import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuthoredLibrary } from "@moco/spec";
import type { StageContext } from "../pipeline/context.ts";
import { workspacePath } from "./workspace.ts";

export const libraryFile = "artifacts/authored-library.json";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// The artifact is series memory, independent of the lifetime/order of episode workspaces.
// Source and assets are still embedded into each shot, pinning old renders to exact bytes.
export async function restoreLibrary(ctx: StageContext, root: string): Promise<Set<string>> {
  const library = ctx.store.has(libraryFile) ? (await ctx.store.read(libraryFile, "AuthoredLibrary")).data : { files: {} };
  for (const [path, entry] of Object.entries(library.files)) {
    if (!path.startsWith("shared/") && !path.startsWith("assets/")) throw Error("Invalid authored library path");
    const file = await workspacePath(root, path);
    const bytes = Buffer.from(entry.content, entry.encoding);
    if (digest(bytes) !== entry.hash) throw Error(`Authored library hash mismatch: ${path}`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  return new Set(Object.keys(library.files));
}

export async function publishLibrary(ctx: StageContext, root: string): Promise<void> {
  const library: AuthoredLibrary = ctx.store.has(libraryFile) ? (await ctx.store.read(libraryFile, "AuthoredLibrary")).data : { files: {} };
  const collect = async (path: string): Promise<void> => {
    const folder = await workspacePath(root, path);
    const entries = await readdir(folder, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw Error("Workspace links are not allowed");
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) { await collect(name); continue; }
      const bytes = await readFile(await workspacePath(root, name));
      const hash = digest(bytes);
      if (library.files[name] && library.files[name].hash !== hash) throw Error(`Published design is immutable: ${name}. Use a new versioned name.`);
      library.files[name] = { content: bytes.toString("base64"), encoding: "base64", hash };
    }
  };
  await collect("shared");
  await collect("assets");
  await ctx.store.save(libraryFile, "AuthoredLibrary", library, { producedBy: "engine" });
}
