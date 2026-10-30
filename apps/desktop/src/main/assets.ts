import { protocol } from "electron";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

// Rendered videos, shot stills and voice previews are local files. The UI reads
// them through the `moco-asset://` scheme. (The render browser gets its audio from
// the renderer's own loopback server, so nothing here serves it.)

export type AssetRoots = () => Record<string, string>;

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

export function registerAssetScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "moco-asset",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Map `<root>/<relative path>` to a file, refusing anything that escapes the root. */
export function resolveAsset(
  roots: AssetRoots,
  root: string,
  pathname: string,
): string | null {
  const base = roots()[root];
  if (!base) return null;
  const rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
  const file = path.resolve(base, rel);
  if (!file.startsWith(path.resolve(base) + path.sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

function rangeOf(header: string | null | undefined, size: number) {
  const m = header ? /bytes=(\d*)-(\d*)/.exec(header) : null;
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : NaN;
  let end = m[2] ? Number(m[2]) : NaN;
  if (Number.isNaN(start)) {
    start = size - (Number.isNaN(end) ? 0 : end);
    end = size - 1;
  } else if (Number.isNaN(end) || end >= size) end = size - 1;
  if (start < 0 || start > end || start >= size) return null;
  return { start, end };
}

export function handleAssetProtocol(roots: AssetRoots) {
  protocol.handle("moco-asset", (req) => {
    const url = new URL(req.url);
    const file = resolveAsset(roots, url.hostname, url.pathname);
    if (!file) return new Response("Not found", { status: 404 });
    const size = statSync(file).size;
    const type =
      MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = rangeOf(req.headers.get("range"), size);
    const headers: Record<string, string> = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    };
    if (range) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
      return new Response(
        Readable.toWeb(createReadStream(file, range)) as ReadableStream,
        { status: 206, headers },
      );
    }
    headers["Content-Length"] = String(size);
    return new Response(
      Readable.toWeb(createReadStream(file)) as ReadableStream,
      { status: 200, headers },
    );
  });
}
