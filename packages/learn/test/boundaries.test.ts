// Package rules (reference §3.1): learn talks to the AI only through @moco/ai and never touches the engine or renderer.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("learn imports only @moco/ai, zod and Node built-ins", async () => {
  const dir = fileURLToPath(new URL("../src", import.meta.url));
  const files = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".ts"));
  const imports = await Promise.all(
    files.map(async (entry) => [...(await readFile(join(entry.parentPath, entry.name), "utf8")).matchAll(/^(?:import|export)\s[^;]*?from\s+["']([^"'.][^"']*)["']/gm)].map((match) => match[1]!)),
  );
  expect([...new Set(imports.flat())].filter((name) => !name.startsWith("node:") && name !== "zod" && name !== "@moco/ai")).toEqual([]);
});
