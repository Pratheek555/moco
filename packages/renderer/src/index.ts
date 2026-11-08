// @moco/renderer — RenderPort on Remotion. Spec in, frames out; no AI here.
// The engine never imports this package: the app wires it in (see apps/desktop/src/engine-host.ts).
import { createHash } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { catalog } from "@moco/kit";
import { KIT_ASSETS_DIR } from "@moco/kit/assets";
import type { EpisodeSpec, SceneSpec, ThumbnailDesign } from "@moco/spec";
import { blankReason, decodePng } from "./pixels.ts";
import { serveEpisodeInput } from "./episode-input.ts";

// Part of the engine's render cache key: bump it whenever the same spec renders differently, or old videos come back.
// (Not the kit version: that one is in every shot's input hash, so bumping it sends every shot back to the AI.)
export const RENDERER_VERSION = "0.10.0"; // isolated bounded label overlays

// Remotion keeps a persistent webpack cache that doesn't notice a reinstall. When pnpm re-resolves a package under a new
// peer-dependency folder, the cache still points at the old one and a bundle ends up with two copies of
// @react-three/fiber ("R3F: Hooks can only be used within the Canvas component!"): every 3D render fails. Keying the
// cache on the folders the 3D and React packages actually resolve to starts a fresh cache whenever they change.
const DEPENDENCY_ROOTS = [fileURLToPath(new URL("../", import.meta.url)), safeRealpath(fileURLToPath(new URL("../node_modules/@moco/kit", import.meta.url)))];
const STAMPED = ["@react-three/fiber", "@remotion/three", "three", "react", "react-dom", "remotion"];

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function dependencyStamp(): string {
  return DEPENDENCY_ROOTS.flatMap((root) => STAMPED.map((name) => safeRealpath(join(root, "node_modules", name)))).join("|");
}

export interface RemotionRenderOptions {
  stillFrameBudget?: number; // recycle the shared browser during long visual-review batches
  stillTimeoutMs?: number; // per still; a hung browser fails the check instead of blocking forever (default 60 s)
  // Prebuilt bundle folder (packaged app). Without it the bundle is built on first use (dev only).
  serveUrl?: string;
  browserExecutable?: string | null; // packaged Chrome Headless Shell
  binariesDirectory?: string | null; // compositor binaries outside app.asar (app.asar.unpacked)
  concurrency?: number | null; // parallel browser tabs for episode renders (default 2: each 1080×1920 tab is memory-heavy)
  stallTimeoutMs?: number; // cancel an episode render whose progress hasn't moved for this long (default 120 s)
}

// Same shape as the engine's RenderPort (structural typing: no import of the engine needed).
export interface RemotionRenderPort {
  check(spec: SceneSpec, opts: { frames: number[]; outDir: string }): Promise<
    { ok: true; stills: string[] } | { ok: false; errors: { shotId: string; frame?: number; message: string; path?: string }[] }
  >;
  thumbnail(spec: SceneSpec, opts: { frame: number; text: string; design?: ThumbnailDesign; out: string }): Promise<void>;
  renderEpisode(
    episode: EpisodeSpec,
    out: string,
    quality: "preview" | "final",
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<{ path: string; durationSeconds: number }>;
  versions(): { kitVersion: string; rendererVersion: string };
  release(): Promise<void>; // closes the shared browser if no still or thumbnail is using it; the next one reopens it
  close(): Promise<void>;
}

const QUALITY = {
  preview: { scale: 0.5, crf: 28 }, // 540×960, fast
  final: { scale: 1, crf: 18 },
};

export function createRemotionRenderPort(options: RemotionRenderOptions = {}): RemotionRenderPort {
  let serveUrl: Promise<string> | undefined;
  let browser: ReturnType<typeof openBrowser> | undefined;
  const shared = { binariesDirectory: options.binariesDirectory ?? null, chromiumOptions: { gl: "angle" as const } }; // 3D stages need ANGLE

  const getServeUrl = () => {
    serveUrl ??= options.serveUrl
      ? Promise.resolve(options.serveUrl)
      : bundle({
          entryPoint: fileURLToPath(new URL("./remotion/index.ts", import.meta.url)),
          publicDir: KIT_ASSETS_DIR,
          // Remotion names its cache after a hash of this config (and sets `cache` itself afterwards), so the stamp goes in
          // the config's name.
          webpackOverride: (config) => ({ ...config, name: `moco-${createHash("md5").update(dependencyStamp()).digest("hex").slice(0, 12)}` }),
        });
    return serveUrl;
  };
  // One browser for all stills and renders; opening Chrome per call is slow.
  const getBrowser = () => {
    browser ??= openBrowser("chrome", { browserExecutable: options.browserExecutable ?? null, chromeMode: "headless-shell", chromiumOptions: shared.chromiumOptions }); // the GL choice is made when the browser launches
    return browser;
  };
  // After a crash or hang the browser can't be trusted: close it (if it's still there) and open a new one next time.
  const resetBrowser = async () => {
    const old = browser;
    browser = undefined;
    await old?.then((instance) => instance.close({ silent: true })).catch(() => undefined);
  };
  const stillTimeoutMs = options.stillTimeoutMs ?? 60_000;
  // Stills and thumbnails using the shared browser right now; release() leaves it open while any are.
  let inUse = 0;
  let checkedFrames = 0;
  const using = async <T>(work: () => Promise<T>): Promise<T> => {
    inUse += 1;
    try {
      return await work();
    } finally {
      inUse -= 1;
    }
  };

  const port: Omit<RemotionRenderPort, "release"> = {
    async check(spec, { frames, outDir }) {
      const inputProps = { scene: spec, strict: true }; // see Scene: a blocked camera is reported, not worked around
      await mkdir(outDir, { recursive: true });
      const stills: string[] = [];
      const blank: ReturnType<typeof blankError>[] = [];
      let frame: number | undefined;
      try {
        const [url, puppeteerInstance] = await Promise.all([getServeUrl(), getBrowser()]);
        const composition = await withTimeout(
          selectComposition({ serveUrl: url, id: "Scene", inputProps, puppeteerInstance, ...shared }),
          stillTimeoutMs,
        );
        for (frame of frames) {
          const output = join(outDir, `${frame}.png`);
          await withTimeout(renderStill({ composition, serveUrl: url, output, frame, inputProps, puppeteerInstance, scale: 0.5, ...shared }), stillTimeoutMs);
          stills.push(output);
          // A frame that renders fine but shows nothing is as broken as one that throws.
          const reason = await blankStill(output);
          if (reason) blank.push(blankError(spec, frame, reason));
        }
        return blank.length > 0 ? { ok: false, errors: blank } : { ok: true, stills };
      } catch (err) {
        // Browser trouble isn't the spec's fault: throw so the stage fails visibly, rather than
        // telling the AI to "fix" a spec that was fine.
        if (isInfrastructureError(err)) {
          await resetBrowser();
          throw err;
        }
        return { ok: false, errors: [toRenderError(spec.shotId, frame, err)] };
      }
    },

    async thumbnail(spec, { frame, text, design, out }) {
      const inputProps = { scene: spec, text, design };
      await mkdir(dirname(out), { recursive: true });
      try {
        const [url, puppeteerInstance] = await Promise.all([getServeUrl(), getBrowser()]);
        const composition = await withTimeout(
          selectComposition({ serveUrl: url, id: "Thumbnail", inputProps, puppeteerInstance, ...shared }),
          stillTimeoutMs,
        );
        const still = { composition, serveUrl: url, output: out, frame, inputProps, puppeteerInstance, ...shared };
        // Full composition size, with a compact JPEG for upload.
        await withTimeout(renderStill({ ...still, imageFormat: "jpeg", jpegQuality: 90 }), stillTimeoutMs);
      } catch (err) {
        if (isInfrastructureError(err)) resetBrowser();
        throw err;
      }
    },

    async renderEpisode(episode, out, quality, onProgress, signal) {
      await mkdir(join(out, ".."), { recursive: true });
      const input = await serveEpisodeInput(episode);
      let audio: Awaited<ReturnType<typeof serveFile>>;
      const { cancelSignal, cancel } = makeCancelSignal();
      signal?.addEventListener("abort", cancel, { once: true });
      // Watchdog: when Chrome dies mid-render, Remotion can retry a closed page forever. Cancel instead.
      let lastProgress = { value: -1, at: Date.now() };
      let stalled = false;
      const stallMs = options.stallTimeoutMs ?? 120_000;
      const watchdog = setInterval(() => {
        if (Date.now() - lastProgress.at < stallMs) return;
        stalled = true;
        cancel();
      }, 5_000);
      try {
        audio = await serveFile(episode.audio.voiceover);
        const url = await getServeUrl();
        const inputProps = { episode: input.episode, audioUrl: audio?.url ?? null };
        // No shared browser here: Remotion launches its own, so when Chrome crashes mid-render
        // (it does, at random frames, on long full-size renders) Remotion can replace it and retry the frame.
        const browser = { browserExecutable: options.browserExecutable ?? null, chromeMode: "headless-shell" as const };
        const composition = await selectComposition({ serveUrl: url, id: "Episode", inputProps, ...browser, ...shared });
        await renderMedia({
          composition,
          serveUrl: url,
          codec: "h264",
          outputLocation: out,
          inputProps,
          ...browser,
          cancelSignal,
          concurrency: options.concurrency ?? 2,
          onProgress: ({ progress }) => {
            if (progress !== lastProgress.value) lastProgress = { value: progress, at: Date.now() };
            onProgress?.(progress);
          },
          ...QUALITY[quality],
          ...shared,
        });
        return { path: out, durationSeconds: composition.durationInFrames / composition.fps };
      } catch (err) {
        if (stalled) {
          resetBrowser();
          throw new RenderTimeout(`render stalled at ${Math.round(lastProgress.value * 100)}% for ${stallMs / 1000} s (browser crashed or ran out of memory)`);
        }
        if (isInfrastructureError(err)) resetBrowser();
        throw err;
      } finally {
        clearInterval(watchdog);
        signal?.removeEventListener("abort", cancel);
        audio?.server.close();
        await input.close();
      }
    },

    versions() {
      return { kitVersion: catalog.kitVersion, rendererVersion: RENDERER_VERSION };
    },

    async close() {
      if (browser) await (await browser).close({ silent: true });
      browser = undefined;
    },
  };
  return {
    ...port,
    check: async (spec, opts) => {
      const result=await using(() => port.check(spec, opts));
      checkedFrames+=opts.frames.length;
      if(inUse===0 && checkedFrames>=(options.stillFrameBudget ?? 120)) { await resetBrowser(); checkedFrames=0; }
      return result;
    },
    thumbnail: (spec, opts) => using(() => port.thumbnail(spec, opts)),
    async release() {
      if (inUse === 0) { await resetBrowser(); checkedFrames=0; }
    },
  };
}

class RenderTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeout(`Remotion did not answer within ${ms / 1000} s (browser hung or crashed)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Errors from the browser itself, as opposed to errors thrown while rendering the spec.
function isInfrastructureError(err: unknown): boolean {
  if (err instanceof RenderTimeout) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /Target closed|Session closed|Protocol error|browser has disconnected|Browser closed|ECONNREFUSED|socket hang up|ERR_NO_BUFFER_SPACE|ERR_INSUFFICIENT_RESOURCES|ERR_OUT_OF_MEMORY/i.test(message);
}

// A still the check can't read is the check's problem, not the spec's, so it's let through.
async function blankStill(file: string): Promise<string | undefined> {
  const image = await readFile(file).then(decodePng).catch(() => undefined);
  return image && blankReason(image);
}

// On a 3D stage what the lens can see comes down to the camera, the place and the subject, so that's what to change.
function blankError(spec: SceneSpec, frame: number, reason: string) {
  const message = `the picture is ${reason}`;
  if (!spec.stage) return { shotId: spec.shotId, frame, message };
  return { shotId: spec.shotId, frame, path: "stage.camera", message: `${message}: the camera can't see anything lit. Pick another camera or place, or a subject who stands somewhere lit.` };
}

// Kit errors are thrown as "[moco:path=actors[0].actions[1].name] UnknownAction(...)"; pull the path out.
function toRenderError(shotId: string, frame: number | undefined, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const tagged = /\[moco:path=(\S+?)\] ([^\n]*)/.exec(message); // paths contain "]" too, so match up to "] "
  if (tagged) return { shotId, frame, path: tagged[1], message: tagged[2]! };
  return { shotId, frame, message: message.split("\n")[0]!.slice(0, 300) };
}

// "bytes=100-199" → { start: 100, end: 199 }; "bytes=100-" → to the end; "bytes=-50" → the last 50 bytes.
// undefined = no range asked (send the whole file); "invalid" = can't be satisfied.
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "invalid";
  const suffix = match[1] === "";
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start > end || start >= size ? "invalid" : { start, end };
}

const MIME: Record<string, string> = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4" };

// The Remotion page can't read local files, so the voiceover is served from 127.0.0.1 for the length of a render.
async function serveFile(path: string): Promise<{ url: string; server: Server } | undefined> {
  if (!path) return undefined;
  const info = await stat(path).catch(() => undefined);
  if (!info || info.size === 0) return undefined; // no audio yet (e.g. placeholder voiceover): render silent
  const type = MIME[extname(path)] ?? "application/octet-stream";
  // Range support matters: Chrome's media player asks for byte ranges, and without them it re-downloads
  // the whole file over and over during long renders until the browser crashes.
  const server = createServer((req, res) => {
    const range = parseRange(req.headers.range, info.size);
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes" };
    if (range === "invalid") {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${info.size}` }).end();
      return;
    }
    const { start, end } = range ?? { start: 0, end: info.size - 1 };
    const status = range ? 206 : 200;
    const rangeHeader = range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {};
    res.writeHead(status, { ...headers, ...rangeHeader, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") res.end();
    else createReadStream(path, { start, end }).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/voiceover${extname(path)}`, server };
}
