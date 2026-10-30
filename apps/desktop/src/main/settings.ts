import { app } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeepPartial, Settings } from "../shared/api.ts";

export function defaultSettings(): Settings {
  return {
    onboarded: false,
    theme: "system",
    projectsDir: path.join(app.getPath("documents"), "Moco"),
    voice: { voice: "", rate: 1 },
    defaults: { episodes: 1, language: "en" },
    render: { concurrency: 0 },
  };
}

const file = () => path.join(app.getPath("userData"), "settings.json");

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] =
      cur &&
      typeof cur === "object" &&
      !Array.isArray(cur) &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
        ? merge(cur, v as DeepPartial<typeof cur>)
        : v;
  }
  return out as T;
}

let cached: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  let stored: DeepPartial<Settings> = {};
  if (existsSync(file())) {
    try {
      stored = JSON.parse(await readFile(file(), "utf8"));
    } catch {
      stored = {};
    }
  }
  const s = merge(defaultSettings(), stored);
  cached = s;
  return s;
}

export async function saveSettings(
  patch: DeepPartial<Settings>,
): Promise<Settings> {
  const next = merge(await loadSettings(), patch);
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), JSON.stringify(next, null, 2));
  cached = next;
  return next;
}
