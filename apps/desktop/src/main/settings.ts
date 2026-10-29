import { app, safeStorage } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeepPartial, Settings } from "../shared/api.ts";

const SECRET_KEYS = [
  ["ai", "anthropicKey"],
  ["ai", "openaiKey"],
  ["voice", "elevenlabsKey"],
  ["render", "remotionLicenseKey"],
] as const;

export function defaultSettings(): Settings {
  return {
    onboarded: false,
    theme: "system",
    projectsDir: path.join(app.getPath("documents"), "Moco"),
    ai: {
      provider: "claude-cli",
      model: "",
      anthropicKey: "",
      openaiKey: "",
      effort: "medium",
      maxRepairs: 2,
    },
    voice: { provider: "system", voice: "", rate: 1, elevenlabsKey: "" },
    defaults: { episodes: 3, seconds: 45, language: "en", style: "epic" },
    brand: {
      handle: "",
      watermark: true,
      progressBar: false,
      accent: "#ffd60a",
    },
    render: { quality: "standard", concurrency: 0, remotionLicenseKey: "" },
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

// API keys are encrypted at rest with the OS keychain when available.
const seal = (s: string) =>
  s && safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(s).toString("base64")}`
    : s;
const unseal = (s: string) => {
  if (!s?.startsWith("enc:")) return s ?? "";
  try {
    return safeStorage.decryptString(Buffer.from(s.slice(4), "base64"));
  } catch {
    return "";
  }
};

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
  for (const [group, key] of SECRET_KEYS) {
    const section = s[group] as unknown as Record<string, string>;
    section[key] = unseal(section[key] ?? "");
  }
  cached = s;
  return s;
}

export async function saveSettings(
  patch: DeepPartial<Settings>,
): Promise<Settings> {
  const next = merge(await loadSettings(), patch);
  const onDisk = structuredClone(next);
  for (const [group, key] of SECRET_KEYS) {
    const section = onDisk[group] as unknown as Record<string, string>;
    section[key] = seal(section[key] ?? "");
  }
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), JSON.stringify(onDisk, null, 2));
  cached = next;
  return next;
}
