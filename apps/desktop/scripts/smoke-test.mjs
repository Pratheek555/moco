// Actual Electron main/preload/renderer + source utility process. No AI messages sent.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceStore } from "../../../packages/agent/src/storage.ts";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const temp = await mkdtemp(path.join(tmpdir(), "moco-electron-"));
const data = path.join(temp, "profile"), projects = path.join(temp, "projects");
const store = new WorkspaceStore(data, projects);
const skill = await store.importSkill(path.join(root, "examples/skills/cartoon-audio-short"));
const project = await store.createProject("Smoke project", skill.id, "claude-code");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM0kAAAAASUVORK5CYII=", "base64");
await writeFile(path.join(project.workspace, "outbox/contact sheet.png"), png);
const upload = path.join(temp, "voice.wav"); await writeFile(upload, "upload fixture");
const question = { question: "Where are you starting?", header: "Start", multiSelect: true, options: [{ label: "Voiceover ready", description: "Upload your audio" }, { label: "Need ideas", description: "Start fresh" }] };
for (const event of [
  { type: "user", text: "Make something original", files: [] },
  { type: "text", messageId: "reply", text: "Let's make your video." },
  { type: "tool_call", id: "tool", name: "Read", input: { file_path: "SKILL.md" } },
  { type: "tool_result", id: "tool", content: "Skill loaded", isError: false },
  { type: "tasks", tasks: [{ id: "1", subject: "Choose a starting point", status: "in_progress" }] },
  { type: "file", path: "outbox/contact sheet.png", label: "Review the contact sheet" },
  { type: "question", id: "q", questions: [question] },
]) await store.record(project.id, event);
const errors = [];
const env = { ...process.env, MOCO_USER_DATA: data, MOCO_PROJECTS_DIR: projects };
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch() {
  app = await electron.launch({ ...(process.env.MOCO_SMOKE_EXEC ? { executablePath: process.env.MOCO_SMOKE_EXEC } : {}), args: process.env.MOCO_SMOKE_EXEC ? [] : [desktop], cwd: desktop, env, timeout: 60_000 });
  app.process().stderr.on("data", chunk => process.stderr.write(chunk));
  const page = await app.firstWindow();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  await expect(page.getByRole("heading", { name: "What will you create?" })).toBeVisible();
  await expect(page.getByLabel("AI provider", { exact: true })).toHaveValue("codex");
  return page;
}
try {
  const page = await launch();
  assert.equal((await page.evaluate(() => window.moco.info())).projectsDir, projects);
  await expect(page.getByText("1 imported", { exact: true })).toBeVisible({ timeout: 30_000 });
  // Exercise the native dialog → import → host storage boundary without an interactive dialog.
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, path.join(root, "examples/skills/cartoon-audio-short"));
  await page.getByRole("button", { name: "Import folder" }).click();
  await expect(page.getByText("2 imported", { exact: true })).toBeVisible();
  await page.getByLabel("Project name", { exact: true }).fill("Created in the UI");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Created in the UI", exact: true })).toBeVisible();
  await expect(page.locator(".project-header")).toContainText("Codex");
  const created = await page.evaluate(async () => (await window.moco.projects()).find(project => project.name === "Created in the UI"));
  assert.equal(created.provider, "codex");
  assert.match(await readFile(path.join(created.workspace, ".agents/skills/cartoon-audio-short/SKILL.md"), "utf8"), /name: cartoon-audio-short/);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, upload);
  await page.getByRole("button", { name: "Attach files" }).click();
  await expect(page.getByRole("button", { name: /Remove .*voice.wav/ })).toBeVisible();
  await page.getByRole("button", { name: /Smoke project/ }).click();
  await expect(page.locator(".project-header")).toContainText("Claude Code");
  await expect(page.getByText("Let's make your video.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Agent tasks" })).toContainText("Choose a starting point");
  const card = page.getByRole("form", { name: "Agent question" });
  await card.getByLabel("Voiceover ready").check(); await card.getByLabel("Need ideas").check();
  await card.getByLabel("Other: Where are you starting?").fill("Custom answer");
  await expect(card.getByRole("button", { name: "Continue" })).toBeEnabled();
  const image = page.getByAltText("contact sheet.png").first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBe(1);
  assert.equal(await page.evaluate(async id => (await fetch(`moco-media://project/${id}/outbox/contact%20sheet.png`)).status, project.id), 200);
  const checks = await app.evaluate(async ({ net }, { id }) => {
    const safe = await net.fetch(`moco-media://project/${id}/outbox/contact%20sheet.png`);
    const escape = await net.fetch(`moco-media://project/${id}/..%5C..%5Cprivate.png`);
    const html = await net.fetch(`moco-media://project/${id}/outbox/page.html`);
    return { safe: safe.status, escape: escape.status, html: html.status };
  }, { id: project.id });
  assert.deepEqual(checks, { safe: 200, escape: 404, html: 415 });
  assert.equal(await page.evaluate(id => window.moco.openFile(id, "../private.png", false).then(() => false, () => true), project.id), true);
  await page.getByLabel("Appearance").selectOption("dark");
  await expect(page.locator("html")).toHaveClass("dark");
  assert.equal(JSON.parse(await readFile(path.join(data, "appearance.json"), "utf8")).theme, "dark");
  await app.close(); app = undefined;
  const reopened = await launch();
  await reopened.getByRole("button", { name: /Created in the UI/ }).click();
  await expect(reopened.locator(".project-header")).toContainText("Codex");
  await reopened.getByRole("button", { name: /Smoke project/ }).click();
  await expect(reopened.getByText("Let's make your video.", { exact: true })).toBeVisible();
  await expect(reopened.locator("html")).toHaveClass("dark");
  assert.deepEqual(errors, []);
  console.log("PASS Electron main/preload/utility host: home, skill import, Codex/Claude provider selection and restart, project creation, upload, transcript, tasks/questions, inline media and confinement; no renderer console errors.");
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }
