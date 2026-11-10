import { app, safeStorage } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DeepPartial, Settings } from "../shared/api.ts";

export function defaultSettings(): Settings {
  return {
    aiProvider: "codex-cli",
    onboarded: false,
    theme: "dark",
    projectsDir: path.join(app.getPath("documents"), "Moco"),
    voice: { voice: "", rate: 1, backend: "system", device: "auto", reference: "", expressiveness: 0.65 },
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
let encryptedElevenLabsKey: string | undefined;

function requireSecureStorage() {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
    throw new Error("Secure credential storage is unavailable. Enable your OS keychain before saving an ElevenLabs API key.");
  }
}

// Only main and the private engine-host configuration receive the decrypted key.
export function elevenLabsApiKey(): string {
  if (!encryptedElevenLabsKey) return "";
  requireSecureStorage();
  try { return safeStorage.decryptString(Buffer.from(encryptedElevenLabsKey, "base64")); } catch {
    throw new Error("Could not unlock your ElevenLabs API key. Enter it again in Settings → Voice & narration.");
  }
}

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  let stored: DeepPartial<Settings> = {};
  if (existsSync(file())) {
    try {
      const { secrets, ...settings } = JSON.parse((await readFile(file(), "utf8")).replace(/^\uFEFF/, ""));
      encryptedElevenLabsKey = typeof secrets?.elevenLabsApiKey === "string" ? secrets.elevenLabsApiKey : undefined;
      stored = settings;
    } catch {
      stored = {};
    }
  }
  const s = merge(defaultSettings(), stored);
  if (s.voice.elevenlabs || encryptedElevenLabsKey) {
    const { apiKey: _key, hasApiKey: _status, ...options } = s.voice.elevenlabs ?? {};
    s.voice.elevenlabs = { ...options, hasApiKey: Boolean(encryptedElevenLabsKey) };
  }
  cached = s;
  return s;
}

export async function saveSettings(
  patch: DeepPartial<Settings>,
): Promise<Settings> {
  const next = merge(await loadSettings(), patch);
  if (next.render.backend !== undefined && !["remotion", "blender"].includes(next.render.backend)) throw new Error("Choose Remotion or Blender for rendering.");
  if (next.render.blenderPath !== undefined && (typeof next.render.blenderPath !== "string" || next.render.blenderPath.includes("\0"))) throw new Error("Enter a valid Blender executable path.");
  if (next.render.blenderSamples !== undefined && (!Number.isInteger(next.render.blenderSamples) || next.render.blenderSamples < 1 || next.render.blenderSamples > 256)) throw new Error("Blender samples must be between 1 and 256.");
  if (next.voice.backend !== undefined && !["system", "chatterbox", "elevenlabs"].includes(next.voice.backend)) {
    throw new Error("Choose System speech, Chatterbox or ElevenLabs for narration.");
  }
  if (next.voice.device !== undefined && !["auto", "cpu", "gpu"].includes(next.voice.device)) {
    throw new Error("Choose Automatic, CPU or GPU for narration processing.");
  }
  const voices = next.voice.characterVoices ?? [];
  const ids = voices.map((voice) => voice.id);
  if (voices.some(({ id, reference }) => !/^[a-z0-9][a-z0-9-]*$/.test(id) || id === "default" || !reference.trim()) || new Set(ids).size !== ids.length) {
    throw new Error("Character voices need unique lowercase ids (other than default) and a recording path.");
  }
  let encryptedKey = encryptedElevenLabsKey;
  const key = patch.voice?.elevenlabs?.apiKey;
  if (key !== undefined && typeof key !== "string") throw new Error("Enter a valid ElevenLabs API key.");
  if (key !== undefined) {
    if (key.trim()) {
      requireSecureStorage();
      encryptedKey = safeStorage.encryptString(key.trim()).toString("base64");
    } else encryptedKey = undefined;
  }
  if (next.voice.elevenlabs) {
    const { apiKey: _key, hasApiKey: _status, ...options } = next.voice.elevenlabs;
    next.voice.elevenlabs = { ...options, voiceId: options.voiceId?.trim(), hasApiKey: Boolean(encryptedKey) };
  }
  if (next.voice.backend === "elevenlabs") {
    if (!encryptedKey) throw new Error("Add your ElevenLabs API key before using ElevenLabs narration.");
    if (!next.voice.elevenlabs?.voiceId) throw new Error("Choose an ElevenLabs voice or enter its voice ID.");
    if (!Number.isFinite(next.voice.rate) || next.voice.rate < 0.7 || next.voice.rate > 1.2) throw new Error("ElevenLabs narration speed must be between 0.7 and 1.2.");
  }
  await mkdir(path.dirname(file()), { recursive: true });
  const temporary = `${file()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ ...next, ...(encryptedKey && { secrets: { elevenLabsApiKey: encryptedKey } }) }, null, 2), { mode: 0o600 });
    await rename(temporary, file());
  } finally { await rm(temporary, { force: true }); }
  encryptedElevenLabsKey = encryptedKey;
  cached = next;
  return next;
}
