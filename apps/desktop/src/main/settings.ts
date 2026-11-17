import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
export type Theme = "light" | "dark" | "system";
export interface Settings { theme: Theme; notifications: boolean }
const writes = new Map<string, Promise<void>>();
const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark" || value === "system";
async function json(file: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
export async function loadSettings(dataDir: string): Promise<Settings> {
  const appearance = await json(path.join(dataDir, "appearance.json"));
  const previous = isTheme(appearance.theme) ? {} : await json(path.join(dataDir, "settings.json"));
  return {
    theme: isTheme(appearance.theme) ? appearance.theme : isTheme(previous.theme) ? previous.theme : "system",
    notifications: typeof appearance.notifications === "boolean" ? appearance.notifications : true,
  };
}
export async function loadTheme(dataDir: string): Promise<Theme> { return (await loadSettings(dataDir)).theme; }
function save(dataDir: string, change: Partial<Settings>): Promise<void> {
  dataDir = path.resolve(dataDir);
  const work = (writes.get(dataDir) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const file = path.join(dataDir, "appearance.json");
    const settings = { ...await json(file), ...await loadSettings(dataDir), ...change };
    await mkdir(dataDir, { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(settings), "utf8");
    await rename(temp, file);
  });
  writes.set(dataDir, work);
  void work.finally(() => { if (writes.get(dataDir) === work) writes.delete(dataDir); }).catch(() => {});
  return work;
}
export async function saveTheme(dataDir: string, theme: Theme): Promise<void> { await save(dataDir, { theme }); }
export async function saveNotifications(dataDir: string, notifications: boolean): Promise<void> { await save(dataDir, { notifications }); }
