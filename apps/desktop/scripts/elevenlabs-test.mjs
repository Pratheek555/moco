// Real Settings / IPC / encrypted storage / audio playback, with stubbed provider
// responses. No real credentials, network calls, or ElevenLabs credits required.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-elevenlabs-ui-"));
const testKey = "sk-elevenlabs-ui-fixture-not-a-real-key";
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ onboarded: true, projectsDir: path.join(profile, "projects") }));
const env = { ...process.env, MOCO_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env });
try {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("moco:ai.status");
    ipcMain.handle("moco:ai.status", () => ({ ok: true, version: "fixture" }));
    globalThis.__elevenRequests = [];
    globalThis.fetch = async (url, init) => {
      const target = new URL(String(url));
      assertProviderHost(target.hostname);
      globalThis.__elevenRequests.push({ path: target.pathname, body: init?.body });
      if (target.pathname === "/v2/voices") return Response.json({ voices: [{ voice_id: "test-narrator", name: "Test narrator" }], has_more: false });
      const { text } = JSON.parse(init.body), characters = [...text];
      return Response.json({ audio_base64: Buffer.alloc(22_050 * 2).toString("base64"), alignment: {
        characters, character_start_times_seconds: characters.map((_, i) => i * 0.8 / characters.length),
        character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.8 / characters.length),
      } });
    };
    function assertProviderHost(host) { if (host !== "api.elevenlabs.io") throw new Error("Unexpected test request"); }
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const openSettings = async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Voice & narration" }).click();
  };
  await openSettings();
  await page.getByLabel("Voice engine").click();
  await page.getByRole("option", { name: /ElevenLabs/ }).click();
  await expect(page.getByRole("button", { name: "Load my voices" })).toBeDisabled();
  await page.getByLabel("ElevenLabs API key", { exact: true }).fill(testKey);
  await expect(page.getByLabel("ElevenLabs API key", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Load my voices" }).click();
  await page.getByLabel("Choose an account voice").click();
  await page.getByRole("option", { name: "Test narrator", exact: true }).click();
  await expect(page.getByLabel("ElevenLabs voice ID")).toHaveValue("test-narrator");
  await expect(page.getByRole("button", { name: "Hear it", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await window.moco.settings.get()).voice.elevenlabs)).toEqual({ voiceId: "test-narrator", hasApiKey: true });
  await expect(page.getByLabel("ElevenLabs API key", { exact: true })).toHaveValue("");
  assert.ok(!JSON.stringify(await page.evaluate(() => window.moco.settings.get())).includes(testKey));
  assert.ok(!String(await readFile(path.join(profile, "settings.json"))).includes(testKey));
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      this.addEventListener("playing", () => { window.__elevenPlayback = { url: this.src, duration: this.duration }; }, { once: true });
      return play.call(this);
    };
  });
  await page.getByRole("button", { name: "Hear it", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__elevenPlayback?.duration)).toBeGreaterThan(1);
  assert.deepEqual(await app.evaluate(() => globalThis.__elevenRequests.map(request => request.path)), ["/v2/voices", "/v1/text-to-speech/test-narrator/with-timestamps"]);
  await page.reload();
  await openSettings();
  await expect(page.getByLabel("Voice engine")).toHaveText(/ElevenLabs/);
  await expect(page.getByLabel("ElevenLabs API key", { exact: true })).toHaveValue("");
  // A saved key can load voices without being returned to the renderer.
  await page.getByRole("button", { name: "Load my voices" }).click();
  await expect(page.getByLabel("Choose an account voice")).toBeVisible();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: "Story options", exact: true }).click();
  await page.getByLabel("Story language").click();
  await expect(page.getByRole("option", { name: /Tamil/ })).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("option", { name: /Telugu/ })).toHaveText(/not supported by ElevenLabs/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await openSettings();
  await page.getByRole("button", { name: "Remove key and use system speech" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await window.moco.settings.get()).voice.elevenlabs.hasApiKey)).toBe(false);
  const persisted = JSON.parse(await readFile(path.join(profile, "settings.json"), "utf8"));
  assert.equal(persisted.voice.backend, "system");
  assert.equal(persisted.secrets, undefined);
  assert.deepEqual(errors, []);
  console.log("PASS: ElevenLabs key encryption, account voice selection, preview playback, persistence, language checks and removal. Provider responses were stubbed; no credits used.");
} finally { await app.close(); }
