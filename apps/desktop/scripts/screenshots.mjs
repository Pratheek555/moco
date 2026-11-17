// Visual QA: launches the built app on a throwaway demo profile and captures every screen.
// Usage: node scripts/screenshots.mjs <output-dir> [light|dark|both]. No AI messages are sent.
import { _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoProfile } from "./demo-profile.mjs";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? "screenshots");
const themes = process.argv[3] === "light" || process.argv[3] === "dark" ? [process.argv[3]] : ["light", "dark"];
await mkdir(out, { recursive: true });
const problems = [];

async function launch(data, projects, size = { width: 1380, height: 900 }) {
  const env = { ...process.env, MOCO_USER_DATA: data, MOCO_PROJECTS_DIR: projects };
  delete env.ELECTRON_RUN_AS_NODE;
  await writeFile(path.join(data, "window.json"), JSON.stringify({ bounds: { x: 60, y: 40, ...size }, maximized: false })).catch(() => {});
  const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60_000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8_000);
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  page.on("console", event => { if (event.type() === "error") problems.push(`console: ${event.text()}`); });
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(size.width, size.height); }, size);
  await page.getByRole("heading", { name: "What will you create?" }).waitFor({ timeout: 30_000 }).catch(() => {});
  return { app, page };
}

async function run(theme) {
  const temp = await mkdtemp(path.join(tmpdir(), "moco-shots-"));
  const data = path.join(temp, "profile"), projects = path.join(temp, "projects");
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, "appearance.json"), JSON.stringify({ theme }));
  const demo = await buildDemoProfile(data, projects);
  let step = 0;
  const { app, page } = await launch(data, projects);
  const shot = async name => {
    await page.waitForTimeout(600);
    // Native capture avoids Playwright cropping to CSS pixels when UI zoom is on.
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    await writeFile(path.join(out, `${theme}-${String(++step).padStart(2, "0")}-${name}.png`), Buffer.from(png, "base64"));
  };
  const attempt = async (name, work) => { try { await work(); } catch (error) { problems.push(`${theme} ${name}: ${String(error).split("\n")[0]}`); await shot(`${name}-FAILED`).catch(() => {}); await page.keyboard.press("Escape").catch(() => {}); } };
  const sidebar = page.getByRole("navigation", { name: "Projects" });
  const update = payload => app.evaluate(({ BrowserWindow }, payload) => BrowserWindow.getAllWindows()[0].webContents.send("moco:update", payload), payload);
  try {
    await attempt("home", async () => { await page.waitForTimeout(1500); await shot("home"); });
    await attempt("skills", async () => { await page.getByRole("button", { name: "Skills", exact: true }).click(); await page.getByRole("heading", { name: "Skills", exact: true }).waitFor(); await shot("skills"); });
    await attempt("new-project", async () => {
      await page.getByRole("button", { name: "New project" }).first().click();
      await page.getByRole("dialog", { name: "New project" }).waitFor();
      await page.getByLabel("Project name", { exact: true }).fill("The siege of Vienna");
      await shot("new-project"); await page.keyboard.press("Escape");
    });
    await attempt("settings", async () => {
      await page.getByRole("button", { name: "Settings" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Settings" }); await dialog.waitFor(); await shot("settings-general");
      for (const section of ["AI", "Storage", "About"]) {
        const tab = dialog.getByRole("tab", { name: section, exact: true }).or(dialog.getByRole("button", { name: section, exact: true })).first();
        await tab.click(); await shot(`settings-${section.toLowerCase()}`);
      }
      await page.keyboard.press("Escape");
    });
    await attempt("palette", async () => { await page.keyboard.press("Control+K"); await page.waitForTimeout(300); await page.keyboard.type("ch"); await shot("palette"); await page.keyboard.press("Escape"); });
    await attempt("project", async () => {
      await sidebar.getByRole("button", { name: /The Chain and the Ships/ }).first().click();
      await page.getByTestId("project-header").waitFor(); await page.waitForTimeout(2500); await shot("project-bottom");
      const scroller = page.getByRole("region", { name: "Conversation" });
      await scroller.locator('[data-slot="scroll-area-viewport"]').evaluate(node => node.scrollTo({ top: 0 }));
      await shot("project-top");
      await scroller.locator('[data-slot="scroll-area-viewport"]').evaluate(node => node.scrollTo({ top: node.scrollHeight * 0.45 }));
      await shot("project-middle");
    });
    await attempt("work-log", async () => {
      const toggle = page.getByRole("region", { name: "Conversation" }).getByRole("button", { expanded: false }).first();
      await toggle.scrollIntoViewIfNeeded(); await toggle.click(); await shot("project-work-open");
    });
    await attempt("all-files", async () => {
      await page.getByText("All files", { exact: true }).first().click(); await shot("project-all-files");
      await page.getByText("Outputs", { exact: true }).first().click();
    });
    await attempt("viewer", async () => {
      await page.getByRole("button", { name: "View storyboard.png", exact: true }).first().click(); await page.waitForTimeout(600); await shot("viewer-image");
      await page.keyboard.press("ArrowRight"); await page.waitForTimeout(900); await shot("viewer-next");
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    });
    await attempt("running", async () => {
      await update({ projectId: demo.main.id, state: "running" });
      await update({ projectId: demo.main.id, record: { id: "live-1", at: new Date().toISOString(), event: { type: "tool_call", id: "live-tool", name: "Bash", input: { command: "node kit/render.mjs story.mjs --out outbox/final.mp4" } } } });
      await page.waitForTimeout(2200); await shot("project-running");
      await update({ projectId: demo.created[1].id, state: "waiting" });
      await update({ projectId: demo.created[2].id, state: "running" });
      await page.getByRole("button", { name: "Home", exact: true }).click(); await page.waitForTimeout(1200); await shot("home-with-activity");
    });
    await attempt("error-project", async () => { await sidebar.getByRole("button", { name: /Koh-i-Noor/ }).first().click(); await page.waitForTimeout(1200); await shot("project-error"); });
    await attempt("empty-project", async () => { await sidebar.getByRole("button", { name: /Byron/ }).first().click(); await page.waitForTimeout(1200); await shot("project-empty"); });
    await attempt("narrow", async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
      await sidebar.getByRole("button", { name: /The Chain and the Ships/ }).first().click(); await page.waitForTimeout(1500); await shot("project-narrow");
      const filesToggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
      if (await filesToggle.getAttribute("aria-pressed") !== "true") await filesToggle.click();
      await shot("files-narrow");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
      await page.getByRole("dialog", { name: "Project files", exact: true }).waitFor();
      await shot("files-narrow-zoomed");
      const drawer = page.getByRole("dialog", { name: "Project files", exact: true });
      if (await drawer.isVisible()) await drawer.getByRole("button", { name: "Close", exact: true }).click();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
      await page.getByRole("button", { name: "Home", exact: true }).click(); await shot("home-narrow");
    });
  } finally { await app.close().catch(() => {}); await rm(temp, { recursive: true, force: true }).catch(() => {}); }

  // First run: nothing imported, no projects; then the same with both AIs reported as missing.
  const fresh = await mkdtemp(path.join(tmpdir(), "moco-shots-fresh-"));
  const freshData = path.join(fresh, "profile");
  await mkdir(freshData, { recursive: true });
  await writeFile(path.join(freshData, "appearance.json"), JSON.stringify({ theme }));
  const first = await launch(freshData, path.join(fresh, "projects"));
  try {
    await first.page.waitForTimeout(4000);
    await first.page.screenshot({ path: path.join(out, `${theme}-first-run.png`) });
    await first.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("moco:status");
      ipcMain.handle("moco:status", (_event, provider) => provider === "claude-code"
        ? { ok: false, issue: "signed-out", version: "2.1.0", reason: "Sign in to your Claude subscription: open a terminal, run claude, and choose your Claude account. Moco does not accept API keys." }
        : { ok: false, issue: "not-installed", reason: "Codex is not installed. Install the Codex CLI from developers.openai.com/codex/cli, then run codex login and sign in with ChatGPT." });
    });
    await first.page.reload(); await first.page.waitForTimeout(3000);
    await first.page.screenshot({ path: path.join(out, `${theme}-first-run-not-connected.png`), fullPage: false });
    await first.page.getByRole("button", { name: "Skills", exact: true }).click(); await first.page.waitForTimeout(600);
    await first.page.screenshot({ path: path.join(out, `${theme}-skills-empty.png`) });
  } catch (error) { problems.push(`${theme} first-run: ${String(error).split("\n")[0]}`); }
  finally { await first.app.close().catch(() => {}); await rm(fresh, { recursive: true, force: true }).catch(() => {}); }
}

for (const theme of themes) await run(theme);
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : "No problems recorded.");
console.log(`Screenshots in ${out}`);
await writeFile(path.join(out, "qa-results.json"), JSON.stringify({ problems }, null, 2));
if (problems.length) process.exitCode = 1;
