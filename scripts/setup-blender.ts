// Portable, checksum-verified Blender installation. No admin rights, registry or PATH changes.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BLENDER_VERSION, blenderToolsDir, blenderStatus } from "@moco/renderer/blender";
import { runTool } from "../packages/renderer/src/blender/process.ts";

if (process.arch !== "x64" || !["win32", "linux"].includes(process.platform)) throw new Error("Install Blender 4.5 LTS from https://www.blender.org/download/lts/ and set its executable path in Moco Settings → Rendering. Automatic setup supports Windows/Linux x64.");
const root = blenderToolsDir();
const name = `blender-${BLENDER_VERSION}-${process.platform === "win32" ? "windows-x64.zip" : "linux-x64.tar.xz"}`;
const archive = join(root, name);
const url = `https://download.blender.org/release/Blender4.5/`;
await mkdir(root, { recursive: true });
const checksumFile = join(root, `blender-${BLENDER_VERSION}.sha256`);

async function download(url: string, path: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(path));
}

if (!await stat(checksumFile).catch(() => undefined)) await download(`${url}blender-${BLENDER_VERSION}.sha256`, checksumFile);
if (!await stat(archive).catch(() => undefined)) {
  console.log(`Downloading ${name} from Blender's official release server…`);
  try { await download(url + name, archive); } catch (error) { await rm(archive, { force: true }); throw error; }
}
const checksums = await readFile(checksumFile, "utf8");
const expected = checksums.split(/\r?\n/).find(line => line.trim().endsWith(name))?.trim().split(/\s+/)[0];
if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error(`No official SHA-256 for ${name}`);
const hasher = createHash("sha256");
for await (const bytes of createReadStream(archive)) hasher.update(bytes);
if (hasher.digest("hex") !== expected.toLowerCase()) {
  await rm(archive, { force: true });
  throw new Error("Blender checksum mismatch. The archive was removed; run setup again to download it afresh.");
}
console.log("SHA-256 verified. Extracting portable Blender…");
await runTool("tar", ["-xf", archive, "-C", root], { timeoutMs: 5 * 60_000 });
const binary = join(root, `blender-${BLENDER_VERSION}-${process.platform === "win32" ? "windows-x64/blender.exe" : "linux-x64/blender"}`);
const status = await blenderStatus(binary);
if (!status.ok) throw new Error(status.reason);
console.log(`Blender ${status.version} ready: ${status.path}\nFFmpeg ready. Select Blender in Moco Settings → Rendering.`);
