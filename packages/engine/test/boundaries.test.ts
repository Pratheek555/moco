// Package rules (reference §3.1): the engine never imports Remotion, React or the kit's components.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".ts")).map((entry) => join(entry.parentPath, entry.name));
}

it("engine imports no rendering code", async () => {
  const files = await sourceFiles(new URL("../src", import.meta.url).pathname);
  const sources = await Promise.all(files.map(async (file) => ({ file, text: await readFile(file, "utf8") })));
  const offenders = sources.filter(({ text }) => /from\s+["'](remotion|@remotion\/[^"']+|react|@moco\/renderer)["']/.test(text));
  expect(offenders.map(({ file }) => file)).toEqual([]);
});
