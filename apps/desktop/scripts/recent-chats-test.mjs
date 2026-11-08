// Saved-chat navigation through the real Electron/preload/React path, without AI calls.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.resolve(desktop, "../../artifacts/recent-chats");
const profile = await mkdtemp(path.join(tmpdir(), "moco-recent-chats-"));
await mkdir(artifacts, { recursive: true });
await writeFile(path.join(profile, "settings.json"), JSON.stringify({
  theme: "dark", onboarded: true, projectsDir: path.join(profile, "projects"),
}));
const env = { ...process.env, MOCO_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60000 });

try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const chats = () => page.locator('.recent-chats');
  const rows = () => chats().locator(".recent-chat-row");
  await expect(chats().getByText("Your chats will appear here.")).toBeVisible();

  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const usage = { aiCalls: {}, costUsdEstimate: 0 };
    const at = new Date().toISOString();
    globalThis.__recentChats = Array.from({ length: 10 }, (_, i) => ({
      id: `chat-${i}`, title: `Story ${i}`, premise: `The saved idea for story ${i}.`,
      language: "en", episodes: 1, cast: [], finals: 0, usage,
      createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      next: { kind: "waiting", key: "series_plan", status: "running" }, running: i === 1,
    })).reverse(); // The UI must sort, not rely on the IPC array order.
    const handle = (name, fn) => {
      ipcMain.removeHandler(`moco:${name}`);
      ipcMain.handle(`moco:${name}`, (_event, ...args) => fn(...args));
    };
    handle("series.list", () => globalThis.__recentChats);
    handle("series.artifact", () => null);
    handle("series.status", id => {
      const chat = globalThis.__recentChats.find(s => s.id === id);
      return {
        series: { ...chat, idea: chat.premise },
        stages: [{ key: "series_plan", status: "running", gated: true, updatedAt: at }],
        jobs: [], decisions: [], usage, next: chat.next,
      };
    });
    handle("ai.status", () => ({ ok: true }));
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await expect(rows()).toHaveCount(8);
  await expect(rows().first()).toContainText("Story 0");
  await expect(chats().getByRole("button", { name: "Story 1 Generating" })).toHaveAttribute("title", "Story 1 · Generating");
  await expect(chats().getByRole("button", { name: "View all chats" })).toBeVisible();
  const originalOrder = await rows().allTextContents();
  const seventhRow = await rows().filter({ hasText: "Story 7" }).boundingBox();
  await rows().filter({ hasText: "Story 7" }).click();
  await expect(page.locator(".generation-user-message")).toContainText("The saved idea for story 7.");
  assert.deepEqual(await rows().allTextContents(), originalOrder, "opening a chat must not shuffle click targets");
  await expect(rows().filter({ hasText: "Story 7" })).toHaveAttribute("aria-current", "page");
  // A second click at the same location must keep the same conversation open.
  await page.mouse.click(seventhRow.x + seventhRow.width / 2, seventhRow.y + seventhRow.height / 2);
  await expect(page.locator(".generation-user-message")).toContainText("The saved idea for story 7.");
  for (const id of [3, 1, 6, 2]) {
    await rows().nth(id).click();
    await expect(page.locator(".generation-user-message")).toContainText(`The saved idea for story ${id}.`);
    await expect(chats().locator('[aria-current="page"]')).toHaveCount(1);
    await expect(rows().nth(id)).toHaveAttribute("aria-current", "page");
    assert.deepEqual(await rows().allTextContents(), originalOrder);
  }
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".generation-user-message")).toContainText("The saved idea for story 6.");
  assert.deepEqual(await rows().allTextContents(), originalOrder, "Back must keep the sidebar order stable too");
  await page.screenshot({ path: path.join(artifacts, "recent-chats-dark.png") });

  // Reloading preserves the same order, while library changes stay live.
  await page.reload();
  await expect(rows().first()).toContainText("Story 0");
  await app.evaluate(({ BrowserWindow }) => {
    const chats = globalThis.__recentChats;
    chats.find(s => s.id === "chat-7").title = "The keeper and the very long story title that should stay inside the sidebar";
    chats.splice(chats.findIndex(s => s.id === "chat-0"), 1);
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await expect(rows().filter({ hasText: "The keeper and the very long story title" })).toHaveCount(1);
  await expect(rows().filter({ hasText: "Story 0" })).toHaveCount(0);
  assert.equal(await chats().evaluate(e => e.scrollWidth > e.clientWidth), false);
  await chats().getByRole("button", { name: "View all chats" }).click();
  await expect(page.getByRole("heading", { name: "My series", exact: true })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  await expect(chats()).toBeHidden();
  await page.getByRole("main").getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  await expect(chats()).toBeVisible();
  await page.getByRole("button", { name: "Switch to light appearance", exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, "recent-chats-light.png") });
  await expect(rows()).toHaveCount(8);

  // On narrow windows the drawer still exposes chats and closes after selection.
  await page.setViewportSize({ width: 700, height: 800 });
  await page.getByRole("main").getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  await expect(chats()).toBeVisible();
  await rows().filter({ hasText: "Story 1" }).click();
  await expect(page.locator(".generation-user-message")).toContainText("The saved idea for story 1.");
  await expect(chats()).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("PASS recent chats: stable order across repeated clicks, switching, Back and reload; one active row; empty state, newest-first, eight-item limit, live statuses/titles/deletion, collapsed sidebar, light/dark, mobile drawer");
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: path.join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
