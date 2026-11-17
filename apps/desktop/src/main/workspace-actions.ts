import { copyFile, open, realpath } from "node:fs/promises";
import path from "node:path";
import { confinedFile } from "@moco/agent/storage";
import { inside } from "../../../../packages/agent/src/paths.ts";
import type { TextPreview } from "../shared/api.ts";

const textExtensions = new Set(".txt .md .json .srt .vtt .csv .log .mjs .cjs .js .ts .tsx .jsx .py .yaml .yml .toml .html .css .xml .sh .ps1 .ini .cfg".split(" "));
export const MAX_TEXT_BYTES = 256 * 1024;

export async function readTextFile(workspace: string, relative: string): Promise<TextPreview> {
  if (!textExtensions.has(path.extname(relative).toLowerCase())) throw new Error("This file does not support a text preview. Open it in its default app instead.");
  const file = await confinedFile(workspace, relative);
  if (!textExtensions.has(path.extname(file).toLowerCase())) throw new Error("This file does not support a text preview.");
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(MAX_TEXT_BYTES);
    let bytes = 0;
    while (bytes < buffer.length) {
      const { bytesRead } = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
    }
    const truncated = (await handle.stat()).size > bytes;
    // Omit an incomplete UTF-8 sequence at the preview boundary.
    const text = new TextDecoder("utf-8").decode(buffer.subarray(0, bytes), { stream: truncated });
    return { text, truncated };
  } finally { await handle.close(); }
}

export async function copyWorkspaceFile(workspace: string, relative: string, destination: string): Promise<void> {
  await copyFile(await confinedFile(workspace, relative), destination);
}

/** A metadata path alone is never enough authority to trash a folder. */
export async function trashableWorkspace(projectsDir: string, workspace: string): Promise<string | null> {
  if (!inside(path.resolve(projectsDir), path.resolve(workspace))) return null;
  try {
    const [root, target] = await Promise.all([realpath(projectsDir), realpath(workspace)]);
    return inside(root, target) ? target : null;
  } catch { return null; /* Missing, inaccessible, or external folders are left alone. */ }
}
