// Real Electron/preload/React, captured submissions; no live model, voice or render calls.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-explainer-ui-"));
const artifacts = path.resolve(desktop, "../../artifacts/illustrated-explainer");
await mkdir(artifacts, { recursive: true });
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ onboarded: true, theme: "light", aiProvider: "claude-cli", voice: { backend: "system", voice: "", rate: 1 }, projectsDir: path.join(profile, "projects") }));
const env = { ...process.env, MOCO_USER_DATA: profile, CODEX_HOME: path.join(profile, "codex-home") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await app.evaluate(({ ipcMain }) => {
    globalThis.explainerRequests = [];
    const handle = (name, fn) => {
      ipcMain.removeHandler(`moco:${name}`);
      ipcMain.handle(`moco:${name}`, (_event, ...args) => fn(...args));
    };
    handle("series.create", input => { globalThis.explainerRequests.push(input); throw Error("Test captured submission; production did not start"); });
    handle("ai.status", () => ({ ok: true, authMethod: "Test" }));
    handle("voice.list", () => [{ id: "test", name: "Test voice", locale: "en-US" }]);
  });
  await page.reload();
  const idea = page.getByLabel("What would you like to explain?", { exact: true });
  const options = () => page.getByRole("button", { name: "Story options", exact: true }).click();
  const done = () => page.getByRole("button", { name: "Done", exact: true }).click();
  const submit = () => page.locator("#idea").press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  const requests = () => app.evaluate(() => globalThis.explainerRequests);
  await expect(idea).toBeVisible();
  await expect(page.getByRole("button", { name: "Animation style", exact: true })).toHaveText("Illustrated explainer");
  await expect(page.getByRole("button", { name: "Choose episode count" })).toHaveText("1 EPISODE");
  await expect(page.getByRole("button", { name: "Create series", exact: true })).toBeDisabled();
  for (const [width, height] of [[1120, 720], [840, 640]]) {
    await page.setViewportSize({ width, height });
    await expect(idea).toBeInViewport();
    await expect(page.getByRole("button", { name: "Try “How a queue works”", exact: true })).toBeInViewport();
    assert.equal(await page.locator(".studio-landing").evaluate(el => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight), false);
  }
  await page.screenshot({ path: path.join(artifacts, "studio-portrait-default.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Try “How a queue works”", exact: true }).click();
  await expect(idea).toHaveValue(/first in, first out/);
  await submit();
  await expect.poll(async () => (await requests()).length).toBe(1);
  const first = (await requests())[0];
  assert.equal(first.template, "illustrated-explainer");
  assert.equal(first.episodes, 1);
  assert.deepEqual(first.production, { mode: "artist", format: { width: 1080, height: 1920, fps: 60 }, targetSeconds: 30, localOnly: true });
  assert.equal((await page.evaluate(() => window.moco.settings.get())).aiProvider, "claude-cli");

  await options();
  await expect(page.getByLabel("Visual approach")).toContainText("Illustrated explainer");
  const duration = page.getByLabel("Length in seconds (optional)");
  await expect(duration).toHaveValue("30");
  await expect(page.getByLabel("Video shape")).toContainText("Portrait");
  await page.getByLabel("Intended viewer (optional)").fill("People new to programming");
  await page.getByLabel("Visual direction (optional)").fill("An original owl presenter, ink and paper");
  await duration.fill("37.5");
  await page.getByLabel("Number of episodes").click();
  await page.getByRole("option", { name: "2 episodes", exact: true }).click();
  await done();
  const draftTopic = await idea.inputValue();
  await page.getByRole("button", { name: "Voice settings", exact: true }).click();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(idea).toHaveValue(draftTopic);
  await options();
  await expect(page.getByLabel("Intended viewer (optional)")).toHaveValue("People new to programming");
  await expect(page.getByLabel("Visual direction (optional)")).toHaveValue("An original owl presenter, ink and paper");
  await expect(page.getByLabel("Number of episodes")).toContainText("2 episodes");
  await expect(duration).toHaveValue("37.5");
  await done();
  await submit();
  await expect.poll(async () => (await requests()).length).toBe(2);
  const second = (await requests())[1];
  assert.match(second.idea, /Intended viewer: People new to programming/);
  assert.match(second.idea, /Visual direction: An original owl presenter, ink and paper/);
  assert.equal(second.production.targetSeconds, 37.5);
  assert.equal(second.episodes, 2);

  await options();
  await duration.fill("");
  await page.getByLabel("Video shape").click();
  await page.getByRole("option", { name: "Landscape · 16:9", exact: true }).click();
  await done();
  await page.getByRole("button", { name: "My series", exact: true }).click();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await options();
  await expect(duration).toHaveValue("");
  await expect(page.getByLabel("Video shape")).toContainText("Landscape");
  await done();
  await submit();
  await expect.poll(async () => (await requests()).length).toBe(3);
  const third = (await requests())[2];
  assert.equal(third.production.targetSeconds, undefined);
  assert.deepEqual(third.production.format, { width: 1920, height: 1080, fps: 60 });

  const topic = await idea.inputValue();
  await idea.fill("x".repeat(32000));
  await submit();
  await expect(page.getByText("Keep your topic, intended viewer and visual direction within 32,000 characters in total.", { exact: true }).first()).toBeVisible();
  assert.equal((await requests()).length, 3);
  await idea.fill(topic);

  await options();
  await duration.fill("0");
  await done();
  await submit();
  await expect(page.getByText("Enter a positive duration in seconds, or leave it blank to use your prompt.", { exact: true }).first()).toBeVisible();
  assert.equal((await requests()).length, 3);

  await options();
  await page.getByLabel("Visual approach").click();
  await page.getByRole("option", { name: "Custom illustration · experimental", exact: true }).click();
  await expect(duration).toHaveValue("");
  await expect(page.getByLabel("Intended viewer (optional)")).toHaveCount(0);
  await done();
  await page.getByRole("button", { name: "Voice settings", exact: true }).click();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Animation style", exact: true })).toHaveText("ILLUSTRATE");
  await submit();
  await expect.poll(async () => (await requests()).length).toBe(4);
  const custom = (await requests())[3];
  assert.equal(custom.template, undefined);
  assert.equal(custom.production.mode, "artist");
  assert.equal(custom.production.localOnly, undefined);
  assert.doesNotMatch(custom.idea, /Intended viewer:|Visual direction:/);

  // Selecting the launch format again restores its defaults without replacing the topic.
  const keptIdea = custom.idea;
  await options();
  await page.getByLabel("Visual approach").click();
  await page.getByRole("option", { name: "Illustrated explainer", exact: true }).click();
  await expect(duration).toHaveValue("30");
  await expect(page.getByLabel("Video shape")).toContainText("Portrait");
  await page.getByLabel("Number of episodes").click();
  await page.getByRole("option", { name: "3 episodes", exact: true }).click();
  await page.getByRole("combobox", { name: "Template", exact: true }).click();
  await page.getByRole("option", { name: "kurzgesat style", exact: true }).click();
  await expect(page.getByLabel("Number of episodes")).toContainText("3 episodes");
  await done();
  await expect(page.locator("#idea")).toHaveValue(keptIdea);
  await submit();
  await expect.poll(async () => (await requests()).length).toBe(5);
  const other = (await requests())[4];
  assert.equal(other.template, "kurzgesat-style");
  assert.equal(other.production, undefined, "another template keeps its own production settings");
  assert.equal(other.episodes, 3);

  // A successful creation clears the previous draft, while ongoing work remains
  // discoverable through the normal series page. No model or renderer is invoked.
  await app.evaluate(({ ipcMain }) => {
    const handle = (name, fn) => { ipcMain.removeHandler(`moco:${name}`); ipcMain.handle(`moco:${name}`, (_event, ...args) => fn(...args)); };
    handle("series.create", () => "created-draft-test");
    handle("series.artifact", () => null);
    handle("series.status", () => ({
      series: { id: "created-draft-test", idea: "A saved explainer", language: "en", episodes: 1, production: { mode: "artist", localOnly: true, format: { width: 1080, height: 1920, fps: 60 } } },
      stages: [{ key: "series_plan", status: "approved" }, { key: "bible", status: "running" }],
      activeJob: { id: "fake-job", target: "bible", startedAt: new Date().toISOString(), status: "running" },
      next: { kind: "waiting", key: "bible", status: "running" }, jobs: [], decisions: [], usage: { aiCalls: {}, costUsdEstimate: 0 },
    }));
  });
  await submit();
  await expect(page.getByRole("button", { name: "Production progress" })).toContainText("Direction");
  await page.getByRole("button", { name: "Production progress" }).click();
  await expect(page.getByRole("navigation", { name: "Production stages" })).toContainText("Direction");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New series", exact: true }).click();
  await expect(idea).toHaveValue("");
  await options();
  await expect(page.getByLabel("Number of episodes")).toContainText("1 episode");
  await expect(page.getByLabel("Intended viewer (optional)")).toHaveValue("");
  await expect(page.getByLabel("Visual direction (optional)")).toHaveValue("");
  await expect(duration).toHaveValue("30");
  await expect(page.getByLabel("Video shape")).toContainText("Portrait");
  assert.deepEqual(errors, []);
  console.log("PASS explainer workflow: portrait defaults, viewer/direction, navigation preserves drafts and custom modes, successful creation resets drafts, artist direction progress, overrides, templates and provider preserved; no generation");
} finally { await app.close(); }
