import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export type Theme = "light" | "dark" | "system";
export async function loadTheme(dataDir: string): Promise<Theme> {
  for (const file of ["appearance.json", "settings.json"]) {
    try {
      const settings = JSON.parse((await readFile(path.join(dataDir, file), "utf8")).replace(/^\uFEFF/, "")) as { theme?: string };
      if (["light", "dark", "system"].includes(settings.theme ?? "")) return settings.theme as Theme;
    } catch { /* first run, or try the previous app's appearance preference */ }
  }
  return "system";
}
export async function saveTheme(dataDir: string, theme: Theme): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "appearance.json"), JSON.stringify({ theme }), "utf8");
}
