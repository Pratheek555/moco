import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GeminiSettings, validateGeminiKey, validateGeminiVoice, type SecretStorage } from "../src/main/gemini-settings.ts";
import { checkGeminiKey } from "../src/main/gemini-check.ts";

let temp: string;
// Deliberately opaque fake cipher; no real credentials, Electron, or network.
const secrets = new Map<string, string>();
const storage: SecretStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: key => { secrets.set("opaque-ciphertext", key); return Buffer.from("opaque-ciphertext"); },
  decryptString: bytes => { const key = secrets.get(bytes.toString()); if (!key) throw new Error("Cannot decrypt"); return key; },
};
beforeEach(async () => { temp = await mkdtemp(path.join(tmpdir(), "moco-gemini-")); secrets.clear(); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
describe("encrypted narration settings", () => {
  it.each(["linux", "win32", "darwin"])("saves, reloads, selects a voice and clears without plaintext in the file or status on %s", async platform => {
    const settings = new GeminiSettings(temp, storage, platform); await settings.load();
    expect(settings.status()).toMatchObject({ keySet: false, voice: "Charon", encryptionAvailable: true, unreadable: false });
    await settings.setKey(" test-key-123 "); await settings.setVoice("Kore");
    const file = await readFile(path.join(temp, "narration.json"), "utf8");
    expect(file).not.toContain("test-key-123"); expect(file).not.toContain("opaque-ciphertext");
    expect(JSON.stringify(settings.status())).not.toContain("test-key");
    const reopened = new GeminiSettings(temp, storage, platform); await reopened.load();
    expect(reopened.credentials()).toEqual({ key: "test-key-123", voice: "Kore" });
    await reopened.clear(); expect(reopened.credentials()).toBeUndefined();
    const cleared = new GeminiSettings(temp, storage, platform); await cleared.load();
    expect(cleared.status()).toMatchObject({ keySet: false, voice: "Kore" });
    expect(await readFile(path.join(temp, "narration.json"), "utf8")).not.toContain("encryptedKey");
  });
  it.each(["unavailable", "basic_text", "missing backend method"])("refuses %s encryption without fallback", async backend => {
    const encryptString = vi.fn(storage.encryptString);
    const settings = new GeminiSettings(temp, { ...storage, encryptString, isEncryptionAvailable: () => backend !== "unavailable", getSelectedStorageBackend: backend === "missing backend method" ? undefined : () => backend }, "linux");
    expect(settings.status().encryptionAvailable).toBe(false);
    await expect(settings.setKey("test-key-123")).rejects.toThrow(/keychain|keyring/);
    expect(encryptString).not.toHaveBeenCalled();
    await expect(readFile(path.join(temp, "narration.json"))).rejects.toThrow();
  });
  it("treats undecryptable blobs and damaged files as no key, with a recoverable status", async () => {
    await writeFile(path.join(temp, "narration.json"), JSON.stringify({ encryptedKey: Buffer.from("old-machine").toString("base64"), voice: "Kore" }));
    const settings = new GeminiSettings(temp, storage); await settings.load();
    expect(settings.status()).toMatchObject({ keySet: false, unreadable: true, voice: "Kore" });
    expect(settings.credentials()).toBeUndefined();
    await settings.setKey("test-key-123"); expect(settings.status().unreadable).toBe(false);
    await writeFile(path.join(temp, "narration.json"), "damaged");
    const damaged = new GeminiSettings(temp, storage); await damaged.load();
    expect(damaged.status()).toMatchObject({ keySet: false, unreadable: true });
  });
  it("never exposes encryption exception text", async () => {
    const settings = new GeminiSettings(temp, { ...storage, encryptString: () => { throw new Error("test-key-123"); } });
    await expect(settings.setKey("test-key-123")).rejects.toThrow("OS keychain encryption failed");
  });
});
it("validates key and voice input without echoing rejected values", () => {
  expect(validateGeminiKey(" test-key-123 ")).toBe("test-key-123");
  for (const key of [undefined, {}, "", " ", "test key", "test\nkey", "test\tkey", "test\0key", "test\x7fkey", "test\u0085key", "x".repeat(257)]) expect(() => validateGeminiKey(key)).toThrow();
  expect(validateGeminiVoice("Charon")).toBe("Charon");
  for (const voice of [undefined, "charon", " Kore ", {}, "Unknown"]) expect(() => validateGeminiVoice(voice)).toThrow();
});
describe("metadata key check", () => {
  const fake = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);
  it("accepts a listed model, uses a header, a timeout and no secret in the URL", async () => {
    const fetcher = fake(Response.json({ models: [{ name: "models/gemini-3.8-flash-tts" }] }));
    expect(await checkGeminiKey("test-key-123", fetcher)).toMatchObject({ outcome: "accepted", ttsModelListed: true });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).not.toContain("test-key"); expect(options?.headers).toEqual({ "x-goog-api-key": "test-key-123" });
    expect(options?.signal).toBeInstanceOf(AbortSignal); expect(options?.redirect).toBe("error"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not fail a valid key when TTS is absent", async () => {
    expect(await checkGeminiKey("test-key-123", fake(Response.json({ models: [] })))).toMatchObject({ outcome: "accepted", ttsModelListed: false });
  });
  it.each([400, 401, 403])("maps HTTP %s to rejected without returning the response body", async status => {
    const result = await checkGeminiKey("test-key-123", fake(new Response("test-key-123", { status })));
    expect(result.outcome).toBe("rejected"); expect(JSON.stringify(result)).not.toContain("test-key");
  });
  it("maps network failures and timeouts without exception text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("test-key-123"));
    expect(await checkGeminiKey("test-key-123", fetcher)).toMatchObject({ outcome: "network" });
  });
  it.each([new Response("bad", { status: 500 }), Response.json({}), new Response("not JSON")])("maps unexpected responses", async response => {
    expect((await checkGeminiKey("test-key-123", fake(response))).outcome).toBe("unexpected");
  });
});
