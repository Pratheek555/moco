// Real optional-model integration test. Uses an already installed model; downloads nothing.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-real-voice-"));
const installed = process.env.MOCO_TEST_VOICE_DIR ?? path.join(process.env.APPDATA, "Moco", "voice");
await symlink(installed, path.join(profile, "voice"), process.platform === "win32" ? "junction" : "dir");
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ onboarded: true, projectsDir: path.join(profile, "projects"), voice: { voice: "", backend: "chatterbox", rate: 1, expressiveness: 0.65 }, defaults: { language: "hi", episodes: 1 } }));
const env = { ...process.env, MOCO_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env });
try {
  app.process().stdout.on("data", (data) => process.stdout.write(String(data)));
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Voice & narration" }).click();
  await expect(page.getByLabel("Voice engine")).toHaveText(/Chatterbox/);
  // Capture the actual Hear it payload and validate the audio playback event.
  await page.evaluate(() => {
    const originalPlay = HTMLMediaElement.prototype.play;
    window.__voicePlayback = null;
    HTMLMediaElement.prototype.play = function () {
      this.addEventListener("playing", () => { window.__voicePlayback = { url: this.src, duration: this.duration }; }, { once: true });
      return originalPlay.call(this);
    };
  });
  console.log("Starting real Hindi Hear it synthesis…");
  await page.getByRole("button", { name: "Hear it", exact: true }).click();
  let playback;
  await expect.poll(async () => {
    playback = await page.evaluate(() => window.__voicePlayback);
    const errorToast = page.locator('[data-sonner-toast][data-type="error"]').first();
    if (!playback && await errorToast.count()) playback = { error: await errorToast.innerText() };
    return playback;
  }, { timeout: 15 * 60_000, intervals: [2000] }).toBeTruthy();
  assert.ok(!playback.error, playback.error);
  assert.ok(playback.duration > 1 && Number.isFinite(playback.duration));
  const bytes = await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Preview audio fetch failed: ${response.status}`);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }, playback.url);
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "RIFF");
  const artifacts = path.resolve(desktop, "../../artifacts/voice-settings");
  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(artifacts, "hindi-preview.wav"), Buffer.from(bytes));
  console.log(`PASS: real Hear it button generated and played ${playback.duration.toFixed(2)} seconds of Hindi neural narration.`);
} finally { await app.close(); }
