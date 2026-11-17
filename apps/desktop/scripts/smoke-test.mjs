// Actual Electron main/preload/renderer + source utility process. No AI messages sent.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const project = await store.createProject("Smoke project", skill.id, "codex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM0kAAAAASUVORK5CYII=", "base64");
await writeFile(path.join(project.workspace, "outbox/contact sheet.png"), png);
await writeFile(path.join(project.workspace, "outbox/notes.txt"), "Scene one opens on the harbour.");
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
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  await expect(sidebarProject(page, /^Smoke project,/)).toBeVisible({ timeout: 30_000 });
  return page;
}
const sidebarProject = (page, name) => page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name }).and(page.locator('[data-sidebar="menu-button"]'));
const header = page => page.getByTestId("project-header");
try {
  const page = await launch();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What will you create?" })).toBeVisible();
  const info = await page.evaluate(() => window.moco.info());
  assert.equal(info.projectsDir, projects);
  assert.equal(info.notifications, true);
  assert.equal(info.platform, process.platform);

  // Skill library: the native dialog → import → host storage boundary, without an interactive dialog.
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();
  await expect(page.getByText("1 imported", { exact: true })).toBeVisible({ timeout: 30_000 });
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, path.join(root, "examples/skills/cartoon-audio-short"));
  await page.getByRole("button", { name: "Import folder" }).click();
  await expect(page.getByText("2 imported", { exact: true })).toBeVisible();
  assert.ok((await page.evaluate(() => window.moco.starterSkills())).some(skill => skill.name === "ink-history"));

  // A delayed connection check must not replace an explicitly clicked provider,
  // including a click on the already-selected radio (which emits no value change).
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("moco:status");
    ipcMain.handle("moco:status", async (_event, provider) => {
      await new Promise(resolve => setTimeout(resolve, provider === "codex" ? 1600 : 800));
      return provider === "codex" ? { ok: false, issue: "signed-out", reason: "Test sign-in required" } : { ok: true, version: "test" };
    });
  });
  await page.evaluate(() => localStorage.setItem("moco.last-provider", "claude-code"));
  await page.reload();
  // New project dialog.
  await page.getByRole("button", { name: "New project" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name", { exact: true }).fill("Created in the UI");
  await expect(dialog.getByRole("radio", { name: "Codex", exact: true })).toBeChecked();
  await dialog.getByRole("radiogroup", { name: "AI provider" }).getByRole("radio", { name: /^Codex/ }).click();
  await page.waitForTimeout(1800);
  await expect(dialog.getByRole("radio", { name: "Codex", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(header(page)).toContainText("Created in the UI");
  await expect(header(page)).toContainText("Codex");
  const created = await page.evaluate(async () => (await window.moco.projects()).find(project => project.name === "Created in the UI"));
  assert.equal(created.provider, "codex");
  assert.match(await readFile(path.join(created.workspace, ".agents/skills/cartoon-audio-short/SKILL.md"), "utf8"), /name: cartoon-audio-short/);

  // Attachments.
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, upload);
  await page.getByRole("button", { name: "Attach files" }).click();
  await expect(page.getByRole("button", { name: /Remove .*voice.wav/ })).toBeVisible();
  const pasted = await page.evaluate(id => window.moco.attachPasted(id, "pasted-image-1.png", new Uint8Array([137, 80, 78, 71])), created.id);
  assert.match(pasted[0], /^uploads\/.+pasted-image-1\.png$/);

  // Existing conversation: transcript, tasks, question, delivered media.
  await sidebarProject(page, /Smoke project/).click();
  await expect(header(page)).toContainText("Codex");
  await expect(page.getByText("Let's make your video.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Agent tasks" })).toContainText("Choose a starting point");
  const card = page.getByRole("form", { name: "Agent question" });
  await card.getByLabel("Voiceover ready").check(); await card.getByLabel("Need ideas").check();
  await card.getByLabel("Other: Where are you starting?").fill("Custom answer");
  await expect(card.getByRole("button", { name: "Continue" })).toBeEnabled();
  const image = page.getByAltText("contact sheet.png").first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBe(1);

  // Open the viewer through its overlay control and return to the conversation.
  await page.getByRole("button", { name: "View contact sheet.png", exact: true }).first().click();
  const viewer = page.getByRole("dialog", { name: "contact sheet.png", exact: true });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(viewer).toBeHidden();

  // Drafts survive route changes without sending an inference turn.
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Keep this unsent draft");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await sidebarProject(page, /Smoke project/).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Keep this unsent draft");

  // At the actual minimum outer window size, files remain reachable in a drawer.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
  const filesToggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
  if (await filesToggle.getAttribute("aria-pressed") !== "true") await filesToggle.click();
  const drawer = page.getByRole("dialog", { name: "Project files", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("tab", { name: "Outputs", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1380, 900));

  // Media protocol and file confinement.
  assert.equal(await page.evaluate(async id => (await fetch(`moco-media://project/${id}/outbox/contact%20sheet.png`)).status, project.id), 200);
  const checks = await app.evaluate(async ({ net }, { id }) => {
    const safe = await net.fetch(`moco-media://project/${id}/outbox/contact%20sheet.png`);
    const escape = await net.fetch(`moco-media://project/${id}/..%5C..%5Cprivate.png`);
    const html = await net.fetch(`moco-media://project/${id}/outbox/page.html`);
    return { safe: safe.status, escape: escape.status, html: html.status };
  }, { id: project.id });
  assert.deepEqual(checks, { safe: 200, escape: 404, html: 415 });
  const rejects = (work, ...args) => page.evaluate(([source, args]) => new Function(`return (${source})`)()(...args).then(() => false, () => true), [work.toString(), args]);
  assert.equal(await rejects((id) => window.moco.openFile(id, "../private.png", false), project.id), true);
  assert.equal(await rejects((id) => window.moco.readTextFile(id, "../private.txt"), project.id), true);
  assert.equal(await rejects((id) => window.moco.readTextFile(id, "outbox/contact sheet.png"), project.id), true);
  assert.equal(await rejects(() => window.moco.openExternal("http://example.com")), true);
  assert.equal(await rejects(() => window.moco.openExternal("file:///C:/Windows/notepad.exe")), true);
  assert.deepEqual(await page.evaluate(id => window.moco.readTextFile(id, "outbox/notes.txt"), project.id), { text: "Scene one opens on the harbour.", truncated: false });
  assert.deepEqual(await page.evaluate(() => window.moco.projectStates()), {});

  // Mock only slow IPC completions: never call either AI provider for these checks.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("moco:status");
    ipcMain.handle("moco:status", () => ({ ok: true, version: "test" }));
    ipcMain.removeHandler("moco:send");
    ipcMain.handle("moco:send", async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.waitForTimeout(900);
  await sidebarProject(page, /Smoke project/).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
  const attachedPath = (await page.evaluate(id => window.moco.files(id), created.id)).find(file => /voice.wav$/.test(file.path)).path;
  await app.evaluate(({ ipcMain }, uploaded) => {
    ipcMain.removeHandler("moco:attach");
    ipcMain.handle("moco:attach", async () => { await new Promise(resolve => setTimeout(resolve, 600)); return [uploaded]; });
  }, attachedPath);
  await sidebarProject(page, /Created in the UI/).click();
  await page.getByRole("button", { name: /Remove .*voice.wav/ }).click();
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.waitForTimeout(900);
  await sidebarProject(page, /Created in the UI/).click();
  await expect(page.getByRole("button", { name: /Remove .*voice.wav/ })).toBeVisible();
  await sidebarProject(page, /Smoke project/).click();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Keep this unsent draft");

  // Rename and delete keep the project folder.
  await page.evaluate(id => window.moco.renameProject(id, "Renamed in the UI"), created.id);
  assert.ok((await page.evaluate(() => window.moco.projects())).some(item => item.name === "Renamed in the UI"));
  await page.evaluate(id => window.moco.deleteProject(id, false), created.id);
  assert.ok(!(await page.evaluate(() => window.moco.projects())).some(item => item.id === created.id));
  await access(created.workspace);

  const starter = await page.evaluate(() => window.moco.addStarterSkill("ink-history"));
  assert.equal(starter.name, "ink-history");
  await access(path.join(data, "skills", starter.id, "content", "kit", "render.mjs"));

  // Narration preferences cross the real UI/preload/storage boundary without starting AI.
  await app.evaluate(({ ipcMain }) => {
    globalThis.narrationSmokeSends = 0;
    ipcMain.removeHandler("moco:send");
    ipcMain.handle("moco:send", () => { globalThis.narrationSmokeSends++; throw new Error("Narration settings must not start an AI turn."); });
  });
  await page.reload();
  await page.getByRole("button", { name: "New project" }).first().click();
  await dialog.getByLabel("Project name", { exact: true }).fill("Zonos narration");
  await dialog.getByRole("radio", { name: "ink-history", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Use story default", exact: true })).toBeChecked();
  await dialog.getByRole("radio", { name: "Zonos", exact: true }).click();
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(header(page)).toContainText("Zonos narration");
  const narrationProject = await page.evaluate(async () => (await window.moco.projects()).find(item => item.name === "Zonos narration"));
  assert.equal(narrationProject.narrationEngine, "zonos");
  const savedNarration = async () => JSON.parse(await readFile(path.join(data, "projects", narrationProject.id, "project.json"), "utf8"));
  assert.equal((await savedNarration()).narrationEngine, "zonos");
  await page.reload();
  await expect(header(page).getByText("Zonos", { exact: true })).toBeVisible();
  const narrationDialog = page.getByRole("dialog", { name: "Narration voice", exact: true });
  async function openNarration() {
    await page.getByRole("button", { name: "Project options", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Narration voice/ }).click();
    await expect(narrationDialog).toBeVisible();
  }
  await openNarration();
  await expect(narrationDialog.getByRole("radio", { name: "Zonos", exact: true })).toBeChecked();
  await narrationDialog.getByRole("radio", { name: "Kokoro", exact: true }).click();
  await narrationDialog.getByRole("button", { name: "Save voice", exact: true }).click();
  await expect(narrationDialog).toBeHidden();
  await expect(header(page).getByText("Kokoro", { exact: true })).toBeVisible();
  assert.equal((await savedNarration()).narrationEngine, "kokoro");
  await page.reload();
  await openNarration();
  await expect(narrationDialog.getByRole("radio", { name: "Kokoro", exact: true })).toBeChecked();
  await narrationDialog.getByRole("radio", { name: "Use story default", exact: true }).click();
  await narrationDialog.getByRole("button", { name: "Save voice", exact: true }).click();
  await expect(narrationDialog).toBeHidden();
  await expect(header(page).getByText("Kokoro", { exact: true })).toBeHidden();
  assert.equal((await savedNarration()).narrationEngine, undefined);
  await page.reload();
  await openNarration();
  await expect(narrationDialog.getByRole("radio", { name: "Use story default", exact: true })).toBeChecked();
  await narrationDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual((await page.evaluate(id => window.moco.project(id), narrationProject.id)).events, []);
  assert.equal(await app.evaluate(() => globalThis.narrationSmokeSends), 0);
  await sidebarProject(page, /Smoke project/).click();

  // Appearance persists.
  await page.getByRole("button", { name: "Settings" }).first().click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  assert.equal(JSON.parse(await readFile(path.join(data, "appearance.json"), "utf8")).theme, "dark");
  await page.keyboard.press("Escape");
  await app.close(); app = undefined;

  const reopened = await launch();
  await sidebarProject(reopened, /Smoke project/).click();
  await expect(header(reopened)).toContainText("Codex");
  await expect(reopened.getByText("Let's make your video.", { exact: true })).toBeVisible();
  await expect(reopened.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  await expect(reopened.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Keep this unsent draft");
  assert.deepEqual(errors, []);
  console.log("PASS Electron main/preload/utility host: home, skill import, new project dialog with provider and narration selection, saved Zonos/Kokoro/default preferences without AI turns, attachments, transcript, tasks/questions, inline media, confinement, rename/delete, appearance and restart; no renderer console errors.");
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }
