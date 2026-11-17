import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface Bounds { x: number; y: number; width: number; height: number }
export interface WindowState { bounds: Bounds; maximized: boolean }
export function visibleBounds(bounds: Bounds, displays: Bounds[]): boolean {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) || bounds.width < 960 || bounds.height < 640) return false;
  // Keep enough of the title bar on a connected screen to move/restore the window.
  return displays.some(display => bounds.y >= display.y && bounds.y + 48 <= display.y + display.height
    && Math.min(bounds.x + bounds.width, display.x + display.width) - Math.max(bounds.x, display.x) >= 100);
}
export async function loadWindowState(dataDir: string, displays: Bounds[]): Promise<WindowState | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(dataDir, "window.json"), "utf8")) as WindowState;
    if (value && value.bounds && typeof value.maximized === "boolean" && visibleBounds(value.bounds, displays)) return value;
  } catch { /* First run, damaged state, or a disconnected monitor: use defaults. */ }
  return undefined;
}
export async function saveWindowState(dataDir: string, state: WindowState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, "window.json");
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(state), "utf8");
  await rename(temp, file);
}
