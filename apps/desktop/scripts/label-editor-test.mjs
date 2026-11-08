// Deterministic desktop/IPC fixture: no AI, voice generation or live project writes.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-label-ui-"));
const projects = path.join(profile, "projects");
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ theme: "dark", onboarded: true, projectsDir: projects }));
const stillDir = path.join(projects, "label-ui", "episodes", "ep-01", "shots", "s01", "stills");
await mkdir(stillDir, { recursive: true });
await writeFile(path.join(stillDir, "0.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64"));
const env = { ...process.env, MOCO_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60000 });
try {
  const page = await app.firstWindow(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.getByLabel("What story will you tell?")).toBeVisible();
  await app.evaluate(({ ipcMain }) => {
    const format = { width: 1920, height: 1080, fps: 60 };
    const state = { series: { id: "label-ui", idea: "Explain rewards", episodes: 1, language: "en", createdAt: new Date().toISOString(), production: { mode: "artist", format } }, stages: [{ key: "series_plan", status: "approved" }, { key: "ep-01/scenes", status: "done" }, { key: "ep-01/preview", status: "approved" }, { key: "ep-01/final", status: "done" }], jobs: [], decisions: [], usage: { aiCalls: {}, costUsdEstimate: 0 }, next: { kind: "finished" } };
    const f = { state, format, revision: 0, text: "Dopamine", undoId: undefined, calls: [], fail: false };
    globalThis.__labelFixture = f;
    const image = "moco-asset://projects/label-ui/episodes/ep-01/shots/s01/stills/0.png";
    const handle = (name, fn) => { ipcMain.removeHandler(`moco:${name}`); ipcMain.handle(`moco:${name}`, (_event, ...args) => fn(...args)); };
    handle("ai.status", () => ({ ok: true }));
    handle("series.create", () => state.series.id);
    handle("series.list", () => [{ ...state.series, title: "Rewards explained", premise: "Explain rewards", cast: [], finals: 1, next: state.next, running: false, usage: state.usage }]);
    handle("series.status", () => state);
    handle("characters.list", () => []);
    const shots = [{ id: "s01", intent: "A reward diagram", location: "board", characters: [], start: 0, end: 2 }, { id: "s02", intent: "A baked sign", location: "board", characters: [], start: 2, end: 4 }];
    handle("series.artifact", (_id, file) => file === "artifacts/series_plan.json" ? { data: { title: "Rewards explained", premise: "Explain rewards", episodes: [{ id: "ep-01", title: "Reward diagram", synopsis: "Explain rewards" }] } }
      : file.endsWith("shot_list.json") ? { data: { shots } }
      : file.endsWith("spec.json") ? { data: { durationFrames: 120, format } } : null);
    handle("episode.media", () => ({ stills: { s01: [image], s02: [image] }, outdatedFinal: f.revision > 0, outdatedPreview: f.revision > 0 }));
    handle("episode.labelEditor", (_series, _episode, shot) => ({ sceneHash: `scene-${f.revision}`, format, labels: shot === "s02" ? [] : [{ id: "reward", text: f.text }], undoId: f.undoId }));
    handle("episode.previewLabelEdit", (_series, _episode, _shot, input) => {
      f.calls.push({ preview: input });
      if (input.text.length > 25) throw Error("Label reward overflows its fixed box. Shorten the text; layout is locked.");
      f.draft = input;
      return { id: "draft-1", labelId: "reward", beforeText: f.text, text: input.text, frames: [0], before: [image], after: [image] };
    });
    handle("episode.applyLabelEdit", () => { if (f.fail) throw Error("This episode changed since the label preview. Reload and preview the edit again."); f.text = f.draft.text; f.undoId = "draft-1"; f.revision++; });
    handle("episode.undoLabelEdit", () => { f.calls.push({ undo: f.undoId }); f.text = "Dopamine"; f.undoId = undefined; f.revision++; });
    handle("episode.renderPreview", () => { f.calls.push("render-preview"); return "preview-job"; });
    handle("episode.review", () => { f.calls.push("review-only"); return "review-job"; });
  });
  await page.getByLabel("What story will you tell?").fill("Explain rewards");
  await page.getByRole("button", { name: "Create series", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Project workspace" }).click();
  await page.getByRole("button", { name: /Reward diagram/ }).click();
  await expect(page.getByLabel("Replacement text")).toHaveValue("Dopamine");
  await expect(page.getByRole("button", { name: "Compare label edit", exact: true })).toBeDisabled();
  await page.getByLabel("Replacement text").fill("Reward signal");
  await page.getByRole("button", { name: "Compare label edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "After label edit, frame 0" })).toBeVisible();
  assert.equal(await app.evaluate(() => globalThis.__labelFixture.text), "Dopamine");
  await dialog.getByRole("button", { name: "Keep current shot" }).click();
  await expect(page.getByLabel("Replacement text")).toHaveValue("Reward signal");
  await page.getByRole("button", { name: "Open comparison", exact: true }).click();
  await app.evaluate(() => { globalThis.__labelFixture.fail = true; });
  await dialog.getByRole("button", { name: "Apply label edit" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed since");
  assert.equal(await app.evaluate(() => globalThis.__labelFixture.text), "Dopamine");
  await app.evaluate(() => { globalThis.__labelFixture.fail = false; });
  await dialog.getByRole("button", { name: "Apply label edit" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Replacement text")).toHaveValue("Reward signal");
  await expect(page.getByText("Episode renders are out of date", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo last label edit" }).click();
  await expect(page.getByLabel("Replacement text")).toHaveValue("Dopamine");
  await expect(page.getByRole("button", { name: "Undo last label edit" })).toHaveCount(0);
  await page.getByLabel("Replacement text").fill("A very long label that cannot fit into this fixed box");
  await page.getByRole("button", { name: "Compare label edit", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("overflows");
  await page.getByRole("button", { name: "Rebuild episode preview" }).click();
  await page.getByRole("button", { name: "Review without changing artwork" }).click();
  const calls = await app.evaluate(() => globalThis.__labelFixture.calls);
  assert.ok(calls.includes("render-preview")); assert.ok(calls.includes("review-only"));
  await page.getByRole("button", { name: /S02.*A baked sign/i }).click();
  await expect(page.getByText(/No editable labels in this shot/)).toBeVisible();
  assert.deepEqual(errors, []);
  console.log("Label editor passed: comparison, rejection, apply, undo, stale renders, overflow and unsupported artwork.");
} finally { await app.close(); }
