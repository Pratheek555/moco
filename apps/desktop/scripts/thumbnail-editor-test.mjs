// Deterministic Electron/IPC integration: no AI calls, renders, or changes to the user's profile.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-thumbnail-ui-"));
const artifacts = path.resolve(desktop, "../../artifacts/thumbnail-editor");
await mkdir(artifacts, { recursive: true });
const projects = path.join(profile, "projects");
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ theme: "dark", onboarded: true, projectsDir: projects }));
const stillDir = path.join(projects, "thumbnail-ui", "episodes", "ep-01", "shots", "s01", "stills");
await mkdir(stillDir, { recursive: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
await Promise.all([0, 29, 59].map(frame => writeFile(path.join(stillDir, `${frame}.png`), png)));
const env = { ...process.env, MOCO_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.getByLabel("What story will you tell?")).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    const at = new Date().toISOString();
    const state = { series: { id: "thumbnail-ui", idea: "A real turning point", episodes: 1, language: "en", createdAt: at },
      stages: [{ key: "series_plan", status: "approved" }, { key: "ep-01/final", status: "done" }],
      jobs: [], decisions: [], usage: { aiCalls: {}, costUsdEstimate: 0 }, next: { kind: "finished" } };
    const f = { state, calls: [], fail: false, revision: 0, thumbnail: undefined, landscape: false };
    globalThis.__thumbnailFixture = f;
    const handle = (name, fn) => { ipcMain.removeHandler(`moco:${name}`); ipcMain.handle(`moco:${name}`, (_event, ...args) => fn(...args)); };
    handle("ai.status", () => ({ ok: true }));
    handle("series.create", () => state.series.id);
    handle("series.list", () => [{ ...state.series, title: "One choice", premise: "A real turning point", cast: [], finals: 1, next: state.next, running: false, usage: state.usage }]);
    handle("series.status", () => state);
    handle("series.artifact", (_id, file) => file === "artifacts/series_plan.json" ? { data: { title: "One choice", premise: "A real turning point", episodes: [{ id: "ep-01", title: "One choice" }] } }
      : file.endsWith("publish.json") ? { meta: { contentHash: `kit-${f.revision}` }, data: { youtube: { title: "One choice", description: "A real turning point. #shorts", tags: [], category: "Entertainment", madeForKids: false, language: "en" }, ...(f.thumbnail && { thumbnail: f.thumbnail }) } }
      : file.endsWith("shot_list.json") ? { data: { shots: [{ id: "s01", intent: "The choice changes everything." }, { id: "s02", intent: "An emotional reaction." }] } }
      : file.endsWith("spec.json") ? { data: { durationFrames: 60, format: { width: f.landscape ? 1920 : 1080, height: f.landscape ? 1080 : 1920, fps: 30 } } } : null);
    handle("episode.media", () => ({ finalPath: "C:/fixture/final.mp4", ...(f.thumbnail && { thumbnail: `moco-asset://projects/thumbnail-ui/episodes/ep-01/shots/s01/stills/29.png?v=${f.revision}`, thumbnailPath: "C:/fixture/thumbnail.jpg" }),
      stills: { s01: [0, 29, 59].map(frame => `moco-asset://projects/thumbnail-ui/episodes/ep-01/shots/s01/stills/${frame}.png`) } }));
    handle("publish.setThumbnail", (_seriesId, _episodeId, choice) => {
      f.calls.push(choice);
      if (f.fail) throw new Error("Thumbnail render failed. Try again.");
      f.thumbnail = { ...choice, frame: choice.frame ?? 29, file: "episodes/ep-01/renders/thumbnail.jpg" }; f.revision++;
    });
  });
  await page.getByLabel("What story will you tell?").fill("A real turning point");
  await page.getByRole("button", { name: "Create series", exact: true }).click();
  const editor = page.locator(".thumbnail-editor");
  await expect(editor).toBeVisible();
  await expect(page.getByRole("button", { name: "Bold hook", exact: false })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Cinematic", exact: false }).click();
  await page.getByLabel("Headline", { exact: true }).fill("One choice");
  await page.getByLabel("Text position", { exact: true }).selectOption("upper");
  await page.getByRole("button", { name: "Mint", exact: true }).click();
  await page.getByRole("button", { name: "Use frame 59", exact: true }).click();
  await page.getByLabel("Composition guide").check();
  await expect(editor.getByText("Frame 59 · 2.0s into the shot")).toBeVisible();
  await expect(page.getByRole("img", { name: "Draft thumbnail at feed size", exact: true })).toBeVisible();
  await editor.locator(".thumbnail-style-grid").scrollIntoViewIfNeeded();
  await editor.locator(".thumbnail-style-grid").screenshot({ path: path.join(artifacts, "styles.png") });
  await editor.locator(".thumbnail-preview-panel").scrollIntoViewIfNeeded();
  await editor.locator(".thumbnail-preview-panel").screenshot({ path: path.join(artifacts, "preview.png") });
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, "draft.png") });
  await page.getByRole("button", { name: "Make thumbnail", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved thumbnail", exact: true })).toBeVisible();
  assert.deepEqual(await app.evaluate(() => globalThis.__thumbnailFixture.calls[0]), { shotId: "s01", text: "One choice", frame: 59, design: { style: "cinematic", position: "upper", accent: "mint" } });
  await expect(page.getByRole("button", { name: "Update thumbnail", exact: true })).toBeDisabled();
  await page.getByLabel("Headline", { exact: true }).fill("x".repeat(41));
  await expect(page.getByText("Keep it to 40 characters.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update thumbnail", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("One choice");
  await app.evaluate(() => { globalThis.__thumbnailFixture.fail = true; });
  await page.getByLabel("Headline", { exact: true }).fill("Another choice");
  await page.getByRole("button", { name: "Update thumbnail", exact: true }).click();
  await expect(page.getByText(/Thumbnail render failed/)).toBeVisible();
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("Another choice");
  await expect(page.getByRole("button", { name: "Update thumbnail", exact: true })).toBeEnabled();
  await app.evaluate(() => { const f = globalThis.__thumbnailFixture; f.fail = false; f.landscape = true; });
  await page.getByLabel("Shot", { exact: true }).selectOption("s02");
  await expect(page.getByText("Frame 29 · 1.0s into the shot", { exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole("img", { name: "Draft thumbnail layout", exact: true }).evaluate(e => e.clientWidth / e.clientHeight)).toBeGreaterThan(1.7);
  await page.getByLabel("Headline", { exact: true }).fill("");
  await page.getByRole("button", { name: "Update thumbnail", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved thumbnail", exact: true })).toBeVisible();
  assert.equal(await app.evaluate(() => globalThis.__thumbnailFixture.thumbnail.text), "");
  // Reopen the series to check saved state, then inspect the editor in a compact sidebar.
  await page.getByRole("button", { name: "All series", exact: true }).click();
  await page.getByRole("button", { name: "One choice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cinematic", exact: false })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Text position", { exact: true })).toHaveValue("upper");
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("");
  await page.setViewportSize({ width: 1120, height: 720 });
  assert.equal(await editor.evaluate(e => e.scrollWidth > e.clientWidth), false);
  await page.getByRole("button", { name: "Minimal", exact: false }).click();
  await page.getByLabel("Headline", { exact: true }).fill("Look closer");
  await editor.locator(".thumbnail-style-grid").scrollIntoViewIfNeeded();
  await editor.locator(".thumbnail-style-grid").screenshot({ path: path.join(artifacts, "compact-styles.png") });
  await page.screenshot({ path: path.join(artifacts, "compact-landscape.png") });
  assert.deepEqual(errors, []);
  console.log("PASS thumbnail styles, frame selection, exact IPC payload, persistence, reset, validation, render failure recovery, landscape layout, and compact width");
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: path.join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally { await app.close(); }
