import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, safeStorage: {
  isEncryptionAvailable: vi.fn(() => true), getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
  encryptString: vi.fn((key: string) => Buffer.from([...key].reverse().join(""))),
  decryptString: vi.fn((bytes: Buffer) => [...bytes.toString()].reverse().join("")),
} }));

let dir: string;
beforeEach(async () => {
  vi.resetModules();
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  dir = await mkdtemp(join(tmpdir(), "moco-elevenlabs-settings-"));
  vi.mocked(app.getPath).mockReturnValue(dir);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const key = "sk-dummy-elevenlabs-key";
const enabled = { voice: { backend: "elevenlabs" as const, elevenlabs: { apiKey: ` ${key} `, voiceId: " narrator " } } };

it("encrypts the key at rest, redacts public settings, and unlocks only for main/engine use after restart", async () => {
  const settings = await import("../src/main/settings.ts");
  const saved = await settings.saveSettings(enabled);
  expect(saved.voice.elevenlabs).toEqual({ hasApiKey: true, voiceId: "narrator" });
  expect(JSON.stringify(saved)).not.toContain(key);
  expect(JSON.stringify(saved)).not.toContain("secrets");
  const persisted = await readFile(join(dir, "settings.json"), "utf8");
  expect(persisted).not.toContain(key);
  expect(JSON.parse(persisted).secrets.elevenLabsApiKey).toBeTruthy();
  expect(settings.elevenLabsApiKey()).toBe(key);
  vi.resetModules();
  const restarted = await import("../src/main/settings.ts");
  expect((await restarted.loadSettings()).voice.elevenlabs).toEqual({ hasApiKey: true, voiceId: "narrator" });
  expect(restarted.elevenLabsApiKey()).toBe(key);
});

it("retains, replaces and explicitly removes the key, without trusting a client hasApiKey flag", async () => {
  const settings = await import("../src/main/settings.ts");
  await settings.saveSettings(enabled);
  await settings.saveSettings({ theme: "light" });
  expect(settings.elevenLabsApiKey()).toBe(key);
  await settings.saveSettings({ voice: { elevenlabs: { apiKey: "replacement", hasApiKey: false } } });
  expect(settings.elevenLabsApiKey()).toBe("replacement");
  expect((await settings.loadSettings()).voice.elevenlabs?.hasApiKey).toBe(true);
  await settings.saveSettings({ voice: { backend: "system", elevenlabs: { apiKey: "", hasApiKey: true } } });
  expect(settings.elevenLabsApiKey()).toBe("");
  expect((await settings.loadSettings()).voice.elevenlabs?.hasApiKey).toBe(false);
  expect(JSON.parse(await readFile(join(dir, "settings.json"), "utf8")).secrets).toBeUndefined();
});

it("refuses to store plaintext when OS credential protection is unavailable", async () => {
  const settings = await import("../src/main/settings.ts");
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
  await expect(settings.saveSettings(enabled)).rejects.toThrow(/Secure credential storage/);
  expect((await settings.loadSettings()).voice.backend).toBe("system");
  await expect(readFile(join(dir, "settings.json"))).rejects.toThrow();
});

it("rejects incomplete ElevenLabs settings without damaging the saved key", async () => {
  const settings = await import("../src/main/settings.ts");
  await expect(settings.saveSettings({ voice: { backend: "elevenlabs", elevenlabs: { hasApiKey: true, voiceId: "voice" } } })).rejects.toThrow(/API key/);
  await expect(settings.saveSettings({ voice: { backend: "elevenlabs", elevenlabs: { apiKey: key } } })).rejects.toThrow(/voice ID/);
  await settings.saveSettings(enabled);
  const original = await readFile(join(dir, "settings.json"), "utf8");
  await expect(settings.saveSettings({ voice: { rate: 1.4 } })).rejects.toThrow(/speed/);
  await expect(settings.saveSettings({ voice: { elevenlabs: { apiKey: "" } } })).rejects.toThrow(/API key/);
  expect(await readFile(join(dir, "settings.json"), "utf8")).toBe(original);
  expect(settings.elevenLabsApiKey()).toBe(key);
});
