// Real Electron/preload/React UI with isolated, deterministic IPC fixtures.
// These are product-control screenshots, not evidence of live model artwork.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.resolve(desktop, "../../artifacts/character-reuse-ui");
const profile = await mkdtemp(path.join(tmpdir(), "moco-character-ui-"));
await mkdir(artifacts, { recursive: true });
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ theme: "dark", onboarded: true, projectsDir: path.join(profile, "projects") }));
const env = { ...process.env, MOCO_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await expect(page.getByLabel("What story will you tell?")).toBeVisible();
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const v1 = "62c14d8a".repeat(8), v2 = "98b72fa1".repeat(8);
    const scene = { meta: { contentHash: "reviewed-shot-v1" }, data: { shotId: "s01", durationFrames: 180,
      format: { width: 1080, height: 1920, fps: 30 }, canvas: { version: 1, cast: ["guide"], characterRigs: {}, source: "// deterministic UI fixture" } } };
    const quality = { status: "passed", sceneHashes: { s01: scene.meta.contentHash }, unresolved: [] };
    const state = { series: { id: "character-ui", idea: "A recurring illustrated guide", language: "en", episodes: 1,
      production: { mode: "artist", format: scene.data.format }, createdAt: "2026-11-08T10:00:00Z" },
      stages: [{ key: "series_plan", status: "approved" }, { key: "bible", status: "approved" }, { key: "ep-01/scenes", status: "done" }],
      jobs: [], decisions: [], usage: { aiCalls: {}, costUsdEstimate: 0 }, next: { kind: "finished" } };
    const f = { state, scene, quality, library: [], calls: [], v1, v2, fail: false };
    globalThis.__characterFixture = f;
    const event = () => BrowserWindow.getAllWindows()[0].webContents.send("engine", { type: "artifact.saved", seriesId: "character-ui", at: new Date().toISOString(), data: {} });
    const provenance = (episodeId, shotId) => ({ episodeId, shotId, sceneHash: "reviewed-scene", approvedAt: "2026-11-08T10:00:00Z", review: { report: "quality/report.json", requirements: [], limitation: "Sampled evidence only" } });
    const handle = (name, fn) => { ipcMain.removeHandler(`moco:${name}`); ipcMain.handle(`moco:${name}`, (_event, ...args) => fn(...args)); };
    handle("ai.status", () => ({ ok: true }));
    handle("series.create", () => state.series.id);
    handle("series.list", () => [{ ...state.series, title: "Illustrated guide", cast: [], finals: 0, next: state.next, running: false, usage: state.usage }]);
    handle("series.status", () => state);
    handle("series.artifact", (_series, file) => file === "artifacts/series_plan.json" ? { data: { title: "Illustrated guide", episodes: [{ id: "ep-01", title: "Meet your guide", synopsis: "Introduce the recurring guide." }] } }
      : file === "artifacts/bible.json" ? { data: { cast: [{ id: "guide", kitCharacterId: "illustrated-guide", description: "A consistent illustrated narrator." }], style: { palette: [], captionStyle: "none", mood: "friendly" } } }
      : file.endsWith("shot_list.json") ? { data: { shots: [{ id: "s01", start: 0, end: 6, characters: ["guide"], location: "studio", intent: "The guide introduces the next idea." }] } }
      : file.endsWith("spec.json") ? scene
      : file.endsWith("critique.json") ? { data: { quality } } : null);
    handle("episode.media", () => ({ stills: {} }));
    handle("characters.list", () => f.library);
    handle("characters.save", (seriesId, episodeId, shotId, choice) => {
      f.calls.push({ action: "save", seriesId, episodeId, shotId, choice });
      assertFixture(choice.sceneHash === scene.meta.contentHash, "stale approval hash");
      f.library = [{ castId: "guide", activeVersion: v1, versions: [{ version: v1, provenance: provenance("ep-01", "s01"), dependants: [] }] }];
      event();
      return { castId: "guide", version: v1 };
    });
    handle("characters.apply", (seriesId, episodeId, shotId, choice) => {
      f.calls.push({ action: "apply", seriesId, episodeId, shotId, choice });
      if (f.fail) throw new Error("The changed cut did not pass review. The previous shot has been retained.");
      scene.data.canvas.characterRigs = { guide: choice.version };
      scene.meta.contentHash = "reviewed-shot-v2";
      quality.sceneHashes.s01 = scene.meta.contentHash;
      event();
      return "fixture-upgrade-job";
    });
    f.addVersion = () => {
      scene.data.canvas.characterRigs = { guide: v1 };
      f.library[0].activeVersion = v2;
      f.library[0].versions.push({ version: v2, provenance: provenance("ep-02", "s01"), dependants: [] });
      event();
    };
    function assertFixture(condition, message) { if (!condition) throw Error(message); }
  });
  await page.getByLabel("What story will you tell?").fill("A recurring illustrated guide");
  await page.getByRole("button", { name: "Create series", exact: true }).click();
  await page.getByText("Project workspace", { exact: true }).click();
  await page.getByRole("button", { name: /Meet your guide/ }).click();
  const controls = page.getByRole("region", { name: "Reusable characters" });
  await expect(controls.getByRole("button", { name: "Save character for reuse" })).toBeEnabled();
  await controls.screenshot({ path: path.join(artifacts, "01-save-approved-character.png") });
  await controls.getByRole("button", { name: "Save character for reuse" }).click();
  await expect(controls.getByLabel("Approved versions")).toBeVisible();
  await expect(controls.getByLabel("Approved versions")).toHaveValue("62c14d8a".repeat(8));
  await controls.screenshot({ path: path.join(artifacts, "02-saved-for-new-shots.png") });
  assert.deepEqual(await app.evaluate(() => globalThis.__characterFixture.calls[0]), { action: "save", seriesId: "character-ui", episodeId: "ep-01", shotId: "s01", choice: { castId: "guide", sceneHash: "reviewed-shot-v1" } });
  await app.evaluate(() => globalThis.__characterFixture.addVersion());
  await expect(controls.getByText("Saved version 62c14d8a", { exact: true })).toBeVisible();
  await controls.getByLabel("Approved versions").selectOption("98b72fa1".repeat(8));
  await expect(controls.getByRole("button", { name: "Use version in this shot" })).toBeEnabled();
  await controls.screenshot({ path: path.join(artifacts, "03-deliberate-version-upgrade.png") });
  await app.evaluate(() => { globalThis.__characterFixture.fail = true; });
  await controls.getByRole("button", { name: "Use version in this shot" }).click();
  await expect(page.getByText(/The changed cut did not pass review/)).toBeVisible();
  await expect(controls.getByText("Saved version 62c14d8a", { exact: true })).toBeVisible();
  await app.evaluate(() => { globalThis.__characterFixture.fail = false; });
  await controls.getByRole("button", { name: "Use version in this shot" }).click();
  await expect(controls.getByText("Saved version 98b72fa1", { exact: true })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Use version in this shot" })).toBeDisabled();
  await controls.screenshot({ path: path.join(artifacts, "04-selected-shot-updated.png") });
  assert.deepEqual(await app.evaluate(() => globalThis.__characterFixture.calls.at(-1)), { action: "apply", seriesId: "character-ui", episodeId: "ep-01", shotId: "s01", choice: { castId: "guide", version: "98b72fa1".repeat(8), sceneHash: "reviewed-shot-v1" } });
  assert.deepEqual(errors, []);
  console.log(`PASS save payload, approved versions, preserved old pin, deliberate upgrade, error recovery, and screenshots: ${artifacts}`);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: path.join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally { await app.close(); }
