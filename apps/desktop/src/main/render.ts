import { app, utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RenderEngineStatus } from "../shared/api.ts";

interface WorkerMsg {
  type: string;
  id?: string;
  [k: string]: unknown;
}

export interface RenderRequest {
  inputProps: Record<string, unknown>;
  output: string;
  quality: "draft" | "standard" | "high";
  concurrency: number;
  licenseKey: string;
  signal?: AbortSignal;
  onProgress?: (p: {
    progress: number;
    stage: string;
    rendered?: number;
    encoded?: number;
    total?: number;
  }) => void;
}

const QUALITY = {
  draft: { crf: 28, scale: 0.5, x264Preset: "veryfast" },
  standard: { crf: 20, scale: 1, x264Preset: "medium" },
  high: { crf: 16, scale: 1, x264Preset: "slow" },
} as const;

/** Where the prebuilt Remotion bundle lives (dev: the workspace; packaged: resources). */
export function bundleDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "remotion-bundle")
    : path.resolve(
        app.getAppPath(),
        "..",
        "..",
        "packages",
        "renderer",
        "build",
      );
}

function findBrowser(dir: string, depth = 0): string | undefined {
  if (!existsSync(dir) || depth > 4) return undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (
      entry.isFile() &&
      (entry.name === "chrome-headless-shell.exe" ||
        entry.name === "chrome-headless-shell")
    )
      return file;
    if (entry.isDirectory()) {
      const found = findBrowser(file, depth + 1);
      if (found) return found;
    }
  }
}

function packagedBinaries(): string | undefined {
  if (!app.isPackaged) return undefined;
  const root = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@remotion",
  );
  if (!existsSync(root)) return undefined;
  const name = readdirSync(root).find((n) =>
    n.startsWith(`compositor-${process.platform}-${process.arch}`),
  );
  return name ? path.join(root, name) : undefined;
}

export function createRenderService(
  workerPath: string,
  onEngine: (s: RenderEngineStatus) => void,
) {
  let worker: UtilityProcess | null = null;
  let workerReady = false;
  const pending: Record<string, unknown>[] = [];
  const listeners = new Map<string, (m: WorkerMsg) => void>();
  const status: RenderEngineStatus = {
    bundle: existsSync(path.join(bundleDir(), "index.html")),
    browser: "unknown",
    bundlePath: bundleDir(),
  };

  const emit = () => onEngine({ ...status });

  function ensureWorker(): UtilityProcess {
    if (worker) return worker;
    // The headless browser downloads next to the nearest package.json from cwd,
    // so give the worker a writable, package-free working directory.
    const cwd = app.isPackaged
      ? path.join(app.getPath("userData"), "render-engine")
      : path.dirname(bundleDir());
    mkdirSync(cwd, { recursive: true });
    const browser = app.isPackaged
      ? findBrowser(path.join(process.resourcesPath, "render-browser"))
      : undefined;
    worker = utilityProcess.fork(workerPath, [], {
      cwd,
      env: {
        ...process.env,
        ...(browser ? { MOCO_BROWSER_EXECUTABLE: browser } : {}),
        ...(packagedBinaries()
          ? { MOCO_BINARIES_DIRECTORY: packagedBinaries() }
          : {}),
      },
      serviceName: "Moco renderer",
      stdio: "pipe",
    });
    workerReady = false;
    worker.stdout?.on("data", (d) => process.stdout.write(`[render] ${d}`));
    worker.stderr?.on("data", (d) => process.stderr.write(`[render] ${d}`));
    worker.on("message", (m: WorkerMsg) => {
      if (m.type === "ready") {
        workerReady = true;
        for (const msg of pending.splice(0)) worker?.postMessage(msg);
        return;
      }
      if (m.type === "browser-downloading") {
        status.browser = "downloading";
        emit();
      } else if (m.type === "browser-progress") {
        status.browser = "downloading";
        status.downloadPercent = Number(m.percent ?? 0);
        emit();
      } else if (m.type === "browser-ready") {
        if (status.browser !== "ready") {
          status.browser = "ready";
          emit();
        }
      }
      if (m.id) listeners.get(m.id)?.(m);
    });
    worker.on("exit", (code) => {
      worker = null;
      workerReady = false;
      pending.length = 0;
      for (const [id, fn] of listeners)
        fn({
          type: "error",
          id,
          message: `Render process exited (code ${code})`,
        });
      listeners.clear();
    });
    return worker;
  }

  function postWorker(message: Record<string, unknown>) {
    const target = ensureWorker();
    if (workerReady) target.postMessage(message);
    else pending.push(message);
  }

  return {
    status(): RenderEngineStatus {
      status.bundle = existsSync(path.join(bundleDir(), "index.html"));
      return { ...status };
    },
    prepare(): Promise<RenderEngineStatus> {
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        listeners.set(id, (m) => {
          if (m.type === "browser-ready") {
            listeners.delete(id);
            resolve({ ...status });
          } else if (m.type === "error") {
            listeners.delete(id);
            reject(new Error(String(m.message)));
          }
        });
        postWorker({ type: "ensure-browser", id });
      });
    },
    render(req: RenderRequest): Promise<string> {
      if (!existsSync(path.join(bundleDir(), "index.html"))) {
        return Promise.reject(
          new Error(
            `Render bundle missing at ${bundleDir()}. Run "npm run bundle -w @moco/renderer".`,
          ),
        );
      }
      const id = randomUUID();
      const q = QUALITY[req.quality];
      let total = 0;
      return new Promise((resolve, reject) => {
        if (req.signal?.aborted) {
          reject(new Error("Cancelled"));
          return;
        }
        const onAbort = () => postWorker({ type: "cancel", id });
        req.signal?.addEventListener("abort", onAbort, { once: true });
        const finish = () => {
          listeners.delete(id);
          req.signal?.removeEventListener("abort", onAbort);
        };
        listeners.set(id, (m) => {
          switch (m.type) {
            case "browser-downloading":
            case "browser-progress":
              req.onProgress?.({
                progress: 0,
                stage: `Downloading render engine ${Math.round(Number(m.percent ?? 0))}%`,
              });
              break;
            case "stage":
              if (m.total) total = Number(m.total);
              req.onProgress?.({
                progress: 0.02,
                stage: String(m.stage),
                total,
              });
              break;
            case "progress": {
              const encoding =
                m.stage === "muxing" || Number(m.rendered) >= total;
              req.onProgress?.({
                progress: Number(m.progress),
                stage: encoding
                  ? "Encoding video"
                  : `Rendering frames ${m.rendered}/${total || "…"}`,
                rendered: Number(m.rendered),
                encoded: Number(m.encoded),
                total,
              });
              break;
            }
            case "done":
              finish();
              resolve(String(m.output));
              break;
            case "error":
              finish();
              reject(
                new Error(
                  req.signal?.aborted ? "Cancelled" : String(m.message),
                ),
              );
              break;
          }
        });
        postWorker({
          type: "render",
          id,
          serveUrl: bundleDir(),
          output: req.output,
          inputProps: req.inputProps,
          crf: q.crf,
          scale: q.scale,
          x264Preset: q.x264Preset,
          concurrency: req.concurrency > 0 ? req.concurrency : null,
          licenseKey: req.licenseKey || null,
        });
      });
    },
    dispose() {
      worker?.kill();
    },
  };
}

export type RenderService = ReturnType<typeof createRenderService>;
