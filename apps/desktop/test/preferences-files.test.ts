import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings, loadTheme, saveNotifications, saveTheme } from "../src/main/settings.ts";
import { MAX_TEXT_BYTES, copyWorkspaceFile, readTextFile, trashableWorkspace } from "../src/main/workspace-actions.ts";
import { loadWindowState, saveWindowState, visibleBounds } from "../src/main/window-state.ts";

let temp: string;
beforeEach(async () => { temp = await mkdtemp(path.join(tmpdir(), "moco-native-")); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
it("defaults notifications on, migrates appearance, and serializes preference changes without losing either setting", async () => {
  expect(await loadSettings(temp)).toEqual({ theme: "system", notifications: true });
  await writeFile(path.join(temp, "settings.json"), '\uFEFF{"theme":"dark"}');
  expect(await loadTheme(temp)).toBe("dark");
  await Promise.all([saveNotifications(temp, false), saveTheme(temp, "light")]);
  expect(await loadSettings(temp)).toEqual({ theme: "light", notifications: false });
  await writeFile(path.join(temp, "appearance.json"), '{"theme":"dark","notifications":false,"other":"preserve"}');
  await saveTheme(temp, "system");
  expect(JSON.parse(await readFile(path.join(temp, "appearance.json"), "utf8"))).toEqual({ theme: "system", notifications: false, other: "preserve" });
  await saveNotifications(temp, true);
  expect(await loadSettings(temp)).toEqual({ theme: "system", notifications: true });
});
it("recovers from damaged or invalid preferences", async () => {
  for (const content of ["invalid", "null", '[]', '{"theme":12,"notifications":"false"}']) {
    await writeFile(path.join(temp, "appearance.json"), content);
    expect(await loadSettings(temp)).toEqual({ theme: "system", notifications: true });
  }
});
it("reads UTF-8 text previews up to 256 KB and reports truncation without splitting a code point", async () => {
  await writeFile(path.join(temp, "notes.md"), "Hello, 世界");
  expect(await readTextFile(temp, "notes.md")).toEqual({ text: "Hello, 世界", truncated: false });
  const exact = "a".repeat(MAX_TEXT_BYTES);
  await writeFile(path.join(temp, "exact.txt"), exact);
  expect(await readTextFile(temp, "exact.txt")).toEqual({ text: exact, truncated: false });
  await writeFile(path.join(temp, "large.TS"), "a".repeat(MAX_TEXT_BYTES - 1) + "界" + "tail");
  expect(await readTextFile(temp, "large.TS")).toEqual({ text: "a".repeat(MAX_TEXT_BYTES - 1), truncated: true });
  for (const extension of ["cjs", "tsx", "jsx", "ps1", "sh", "ini", "cfg"]) {
    await writeFile(path.join(temp, `file.${extension}`), "text");
    expect((await readTextFile(temp, `file.${extension}`)).text).toBe("text");
  }
});
it("confines text previews and file copies and rejects binary previews", async () => {
  const workspace = path.join(temp, "project"); await mkdir(workspace);
  await writeFile(path.join(temp, "outside.txt"), "private");
  await writeFile(path.join(workspace, "video.mp4"), "binary");
  await writeFile(path.join(workspace, "notes.txt"), "copy me");
  for (const relative of ["../outside.txt", "..\\outside.txt", path.join(temp, "outside.txt"), "notes.txt:stream", "video.mp4"])
    await expect(readTextFile(workspace, relative)).rejects.toThrow();
  await copyWorkspaceFile(workspace, "notes.txt", path.join(temp, "copy.txt"));
  expect(await readFile(path.join(temp, "copy.txt"), "utf8")).toBe("copy me");
  await expect(copyWorkspaceFile(workspace, "../outside.txt", path.join(temp, "bad-copy.txt"))).rejects.toThrow();
  await symlink(temp, path.join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
  await expect(readTextFile(workspace, "escape/outside.txt")).rejects.toThrow("outside");
});
it("permits trash only for real descendants of the projects directory", async () => {
  const root = path.join(temp, "projects"), workspace = path.join(root, "project"), outside = path.join(temp, "outside");
  await mkdir(workspace, { recursive: true }); await mkdir(outside);
  expect(await trashableWorkspace(root, workspace)).toBe(workspace);
  for (const bad of [root, outside, path.join(root, "missing")]) expect(await trashableWorkspace(root, bad)).toBeNull();
  await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  expect(await trashableWorkspace(root, path.join(root, "escape"))).toBeNull();
});
it("restores valid window bounds on connected displays, including negative coordinates, and rejects offscreen or invalid state", async () => {
  const displays = [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1080 }];
  const state = { bounds: { x: -1800, y: 80, width: 1380, height: 900 }, maximized: true };
  await saveWindowState(temp, state);
  expect(await loadWindowState(temp, displays)).toEqual(state);
  expect(await loadWindowState(temp, [displays[1]!])).toBeUndefined();
  for (const bounds of [{ ...state.bounds, x: 10000 }, { ...state.bounds, y: -100 }, { ...state.bounds, width: 400 }, { ...state.bounds, x: NaN }])
    expect(visibleBounds(bounds, displays)).toBe(false);
  await writeFile(path.join(temp, "window.json"), '{"bounds":{},"maximized":true}');
  expect(await loadWindowState(temp, displays)).toBeUndefined();
});
