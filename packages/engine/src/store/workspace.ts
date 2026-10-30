// Project folder layout and safe file writes.
// Layout: projects/<series>/{series.json, artifacts/, history/, episodes/<ep>/…, events.jsonl, ledger.json}
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EngineError } from "../errors.ts";

// Ids become folder names, so they must be plain slugs (no "..", no slashes).
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertSafeId(id: string, what: string): void {
  if (!SAFE_ID.test(id)) {
    throw new EngineError("invalid_id", `${what} "${id}" must be lowercase letters, digits and dashes`);
  }
}

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

// "The Mahabharat: Part 1" → "the-mahabharat-part-1"
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "series";
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Atomic write: temp file → fsync → rename. A crash never leaves a half-written file.
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`; // unique, so parallel writers never share a temp file
  const handle = await open(tempPath, "w");
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, path);
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export function seriesDir(projectsDir: string, seriesId: string): string {
  assertSafeId(seriesId, "series id");
  return join(projectsDir, seriesId);
}
