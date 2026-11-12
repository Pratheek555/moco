import path from "node:path";
import { confinedFile } from "./paths.ts";
import type { AgentEvent } from "./types.ts";

export async function handOffFile(cwd: string, file: string, label: string | undefined, emit: (event: AgentEvent) => void): Promise<string> {
  const relative = path.isAbsolute(file) ? path.relative(cwd, file) : file;
  await confinedFile(cwd, relative);
  const normalized = relative.replaceAll(path.sep, "/");
  emit({ type: "file", path: normalized, label });
  return normalized;
}
