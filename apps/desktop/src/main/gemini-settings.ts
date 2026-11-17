import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_GEMINI_VOICE, GEMINI_VOICES } from "../shared/gemini.ts";
import type { GeminiVoice, NarrationStatus } from "../shared/gemini.ts";
import type { GeminiNarration } from "../../../../packages/agent/src/types.ts";

export interface SecretStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export function validateGeminiKey(value: unknown): string {
  if (typeof value !== "string" || /[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error("Enter a key without control characters.");
  const key = value.trim();
  if (!key || key.length > 256 || /\s/.test(key) || !/^[\x21-\x7e]+$/.test(key)) throw new Error("Enter a key of 1–256 characters without spaces.");
  return key;
}
export function validateGeminiVoice(value: unknown): GeminiVoice {
  if (typeof value !== "string" || !GEMINI_VOICES.includes(value as GeminiVoice)) throw new Error("Choose a Gemini prebuilt voice.");
  return value as GeminiVoice;
}

/** Main-process only. No plaintext secrets in files, returned status, or errors. */
export class GeminiSettings {
  private file: string;
  private storage: SecretStorage;
  private platform: string;
  private key?: string;
  private encryptedKey?: string;
  private voice: GeminiVoice = DEFAULT_GEMINI_VOICE;
  private unreadable = false;
  private writes = Promise.resolve();
  constructor(dataDir: string, storage: SecretStorage, platform = process.platform) {
    this.file = path.join(dataDir, "narration.json"); this.storage = storage; this.platform = platform;
  }
  private encryptionReason(): string | undefined {
    try {
      if (!this.storage.isEncryptionAvailable()) return "OS keychain encryption is unavailable. Moco cannot save a key on this computer.";
      if (this.platform === "linux" && (!this.storage.getSelectedStorageBackend || this.storage.getSelectedStorageBackend() === "basic_text"))
        return "A secure Linux keyring is unavailable (basic_text is not secure). Enable a system keyring to save a key.";
      return undefined;
    } catch { return "OS keychain encryption is unavailable. Moco cannot save a key on this computer."; }
  }
  async load(): Promise<void> {
    this.key = undefined; this.encryptedKey = undefined; this.unreadable = false; this.voice = DEFAULT_GEMINI_VOICE;
    try {
      const data = JSON.parse(await readFile(this.file, "utf8")) as Record<string, unknown>;
      if (GEMINI_VOICES.includes(data.voice as GeminiVoice)) this.voice = data.voice as GeminiVoice;
      if (typeof data.encryptedKey === "string" && data.encryptedKey) {
        this.encryptedKey = data.encryptedKey;
        try {
          if (this.encryptionReason()) throw new Error();
          this.key = validateGeminiKey(this.storage.decryptString(Buffer.from(data.encryptedKey, "base64")));
        } catch { this.key = undefined; this.unreadable = true; }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.unreadable = true;
    }
  }
  status(): NarrationStatus {
    const encryptionReason = this.encryptionReason();
    return { keySet: !!this.key, voice: this.voice, encryptionAvailable: !encryptionReason, encryptionReason, unreadable: this.unreadable };
  }
  /** Only used for in-memory main → utility host hand-off and the main-process check. */
  credentials(): GeminiNarration | undefined { return this.key ? { key: this.key, voice: this.voice } : undefined; }
  private change(work: () => Promise<void>): Promise<NarrationStatus> {
    const next = this.writes.catch(() => {}).then(work);
    this.writes = next;
    return next.then(() => this.status());
  }
  private async persist(voice: GeminiVoice, encryptedKey?: string): Promise<void> {
    try {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ voice, ...(encryptedKey ? { encryptedKey } : {}) }), { mode: 0o600 });
      await rename(temp, this.file);
    } catch { throw new Error("Could not save narration settings on this computer."); }
  }
  setKey(value: unknown): Promise<NarrationStatus> {
    const key = validateGeminiKey(value);
    return this.change(async () => {
      const reason = this.encryptionReason(); if (reason) throw new Error(reason);
      let encrypted: string;
      try { encrypted = this.storage.encryptString(key).toString("base64"); }
      catch { throw new Error("OS keychain encryption failed. The key was not saved."); }
      await this.persist(this.voice, encrypted);
      this.key = key; this.encryptedKey = encrypted; this.unreadable = false;
    });
  }
  clear(): Promise<NarrationStatus> {
    return this.change(async () => {
      await this.persist(this.voice);
      this.key = undefined; this.encryptedKey = undefined; this.unreadable = false;
    });
  }
  setVoice(value: unknown): Promise<NarrationStatus> {
    const voice = validateGeminiVoice(value);
    return this.change(async () => { await this.persist(voice, this.encryptedKey); this.voice = voice; });
  }
}
