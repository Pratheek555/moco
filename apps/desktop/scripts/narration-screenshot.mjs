// No inference or Google calls. Exercise Narration on a disposable profile with an obvious fake key.
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.argv[2] ?? "artifacts/narration-settings.png");
const temp = await mkdtemp(path.join(tmpdir(), "moco-narration-shot-"));
const data = path.join(temp, "profile"), projects = path.join(temp, "projects");
let app;
const errors = [];
try {
  await mkdir(data); await mkdir(projects); await mkdir(path.dirname(output), { recursive: true });
  await writeFile(path.join(data, "appearance.json"), JSON.stringify({ theme: "light" }));
  const env = { ...process.env, MOCO_USER_DATA: data, MOCO_PROJECTS_DIR: projects };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60_000 });
  // Fake the metadata check in main; no Google request can leave this process.
  await app.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (String(input).includes("googleapis.com")) {
        if (!String(input).includes("/v1beta/models?")) throw new Error("No Google generation in narration screenshot verification.");
        return Promise.resolve(Response.json({ models: [{ name: "models/gemini-3.8-flash-tts" }] }));
      }
      return original(input, init);
    };
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1380, 900);
    return win.webContents.getLastWebPreferences();
  });
  assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Narration", exact: true }).click();
  await page.getByText("No key saved.", { exact: false }).waitFor();
  await page.getByLabel("Gemini API key", { exact: true }).fill("test-key-123");
  await page.getByRole("button", { name: "Check key", exact: true }).click();
  await page.getByText("Key accepted. Gemini Flash TTS is listed.", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.moco.narrationStatus())).keySet, false);
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await page.getByText("Key saved. Saved keys are never displayed.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Gemini API key", { exact: true }).inputValue(), "");
  const status = await page.evaluate(() => window.moco.narrationStatus());
  assert.equal(status.keySet, true); assert.equal(JSON.stringify(status).includes("test-key"), false);
  assert.equal((await readFile(path.join(data, "narration.json"), "utf8")).includes("test-key"), false);
  await page.getByRole("button", { name: "Check key", exact: true }).click();
  await page.getByText("Key accepted. Gemini Flash TTS is listed.", { exact: true }).waitFor();
  await page.getByLabel("Gemini voice", { exact: true }).click();
  await page.getByRole("option", { name: "Kore", exact: true }).click();
  await page.waitForFunction(async () => (await window.moco.narrationStatus()).voice === "Kore");
  await page.waitForTimeout(300);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
  await writeFile(output, Buffer.from(png, "base64"));
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByText("No key saved.", { exact: false }).waitFor();
  assert.equal((await page.evaluate(() => window.moco.narrationStatus())).keySet, false);
  assert.deepEqual(errors, []);
  console.log(`Narration UI passed: typed/saved key checks (fake fetch), save, masked/empty field, encrypted file, voice, remove, renderer boundaries. Screenshot: ${output}`);
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
  console.log("Disposable narration profile removed.");
}
