// Focused Electron UI check following this app's smoke-test workflow. No model/network download.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-voice-ui-"));
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ onboarded: true, projectsDir: path.join(profile, "projects"), voice: { voice: "", rate: 1 } }));
const env = { ...process.env, MOCO_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Voice & narration" }).click();
  await expect(page.getByLabel("Voice engine")).toHaveText(/System speech/);
  await expect(page.getByRole("button", { name: "Download", exact: true })).toHaveCount(2);
  assert.deepEqual((await page.evaluate(() => window.moco.voice.models())).map((model) => model.state), ["not-installed", "not-installed"]);
  await page.getByLabel("Voice engine").click();
  await expect(page.getByRole("option", { name: /Chatterbox/ })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  // Model/runtime fixtures stand in for a completed download; never call synthesis with these.
  const runtime = path.join(profile, "voice", "runtime");
  const modelDir = path.join(profile, "voice", "models", "english");
  const python = path.join(runtime, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  await mkdir(path.dirname(python), { recursive: true });
  await mkdir(modelDir, { recursive: true });
  await writeFile(python, "fixture");
  await writeFile(path.join(runtime, "ready.json"), JSON.stringify({ version: "0.1.7" }));
  const files = {};
  for (const file of ["ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"]) {
    await writeFile(path.join(modelDir, file), "model"); files[file] = 5;
  }
  await writeFile(path.join(modelDir, "ready.json"), JSON.stringify({ modelId: "english", files }));
  await expect(page.getByText("Installed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Voice engine")).toHaveText(/System speech/);
  await page.getByLabel("Voice engine").click();
  await page.getByRole("option", { name: /Chatterbox/ }).click();
  await expect(page.getByLabel("Performance reference (optional)")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => page.evaluate(async () => (await window.moco.settings.get()).voice.backend)).toBe("chatterbox");
  const artifacts = path.join(root, "artifacts", "voice-settings");
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "optional-models.png"), fullPage: true });
  // Exercise progress through the actual IPC/preload/UI path without downloading weights.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("moco:voice.models");
    ipcMain.handle("moco:voice.models", () => [
      { id: "english", name: "Chatterbox · English", size: "About 3 GB + shared voice runtime", state: "ready", progress: 1 },
      { id: "multilingual", name: "Chatterbox · Multilingual", size: "About 3 GB + shared voice runtime · includes Hindi", state: "downloading", progress: 0.1041666667, downloadedBytes: 312500000, totalBytes: 3000000000, message: "Downloading voice model (2 of 6)" },
    ]);
  });
  const transferText = "312.5 MB of 3,000.0 MB downloaded · 2,687.5 MB left";
  await expect(page.getByText(transferText, { exact: true })).toBeVisible();
  const progress = page.getByRole("progressbar", { name: "Chatterbox · Multilingual download progress" });
  await expect(progress).toHaveAttribute("aria-valuetext", transferText);
  await expect(progress).toHaveAttribute("aria-valuenow", /10\.416/);
  await page.screenshot({ path: path.join(artifacts, "download-bytes.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: system default, explicit downloads, readiness gate, selection, save, and accessible shadcn progress with MB downloaded/remaining. No weights downloaded.");
} finally { await app.close(); }
