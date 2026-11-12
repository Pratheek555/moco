import path from "node:path";
import { realpath, stat } from "node:fs/promises";

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Check the spelling AND the real target: junctions/symlinks must never escape a workspace.
export async function confinedFile(root: string, relative: string): Promise<string> {
  if (!relative || relative.includes("\0") || relative.includes(":")) throw new Error("Invalid workspace file path.");
  if (path.isAbsolute(relative) || /^[\\/]/.test(relative)) throw new Error("Use a workspace-relative path.");
  const candidate = path.resolve(root, relative);
  if (!inside(path.resolve(root), candidate)) throw new Error("File is outside the project workspace.");
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!inside(realRoot, realFile) || !(await stat(realFile)).isFile()) throw new Error("File is outside the project workspace or is not a file.");
  return realFile;
}

const mediaTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".flac": "audio/flac", ".aac": "audio/aac",
};
export const mediaType = (file: string): string | undefined => mediaTypes[path.extname(file).toLowerCase()];
