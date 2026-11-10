import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runTool } from "./process.ts";

export const BLENDER_VERSION = "4.5.15";
export const blenderToolsDir = () => process.platform === "win32"
  ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Moco", "tools", "blender")
  : join(homedir(), ".local", "share", "moco", "tools", "blender");

export function findBlender(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.MOCO_BLENDER_PATH) return process.env.MOCO_BLENDER_PATH;
  const root = blenderToolsDir();
  const suffix = process.platform === "win32" ? "windows-x64/blender.exe" : "linux-x64/blender";
  const portable = join(root, `blender-${BLENDER_VERSION}-${suffix}`);
  if (existsSync(portable)) return portable;
  if (process.platform === "darwin" && existsSync("/Applications/Blender.app/Contents/MacOS/Blender")) return "/Applications/Blender.app/Contents/MacOS/Blender";
  if (process.platform === "win32") {
    const installed = join(process.env.ProgramFiles ?? "C:/Program Files", "Blender Foundation");
    for (const folder of (existsSync(installed) ? readdirSync(installed, { withFileTypes: true }) : []).filter(item => item.isDirectory()).sort((a,b) => b.name.localeCompare(a.name))) {
      const bin = join(installed, folder.name, "blender.exe");
      if (existsSync(bin)) return bin;
    }
  }
  return "blender";
}

export function blenderBinaryStamp(bin: string): string {
  try { const stat = statSync(bin); return `${bin}:${stat.size}:${stat.mtimeMs}`; } catch { return bin; }
}

export async function blenderStatus(executable?: string, ffmpegExecutable?: string) {
  const path = findBlender(executable);
  try {
    const output = await runTool(path, ["--version"], { timeoutMs: 15_000 });
    const version = /Blender (\d+\.\d+\.\d+)/.exec(output)?.[1];
    if (!version || Number(version.split(".")[0]) !== 4 || Number(version.split(".")[1]) !== 5) throw new Error("This integration supports Blender 4.5 LTS. Run pnpm blender:setup.");
    await runTool(ffmpegExecutable ?? process.env.MOCO_FFMPEG_PATH ?? "ffmpeg", ["-version"], { timeoutMs: 15_000 });
    return { ok: true as const, path, version };
  } catch (error) {
    return { ok: false as const, path, reason: `${error instanceof Error ? error.message : error}. Install Blender with pnpm blender:setup and put FFmpeg on PATH (or set MOCO_FFMPEG_PATH).` };
  }
}
