// Runs in an Electron utility process: Remotion rendering is CPU-heavy and must
// never block the main process. Messages are plain JSON over parentPort.
import {
  ensureBrowser,
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";

type Inbound =
  | { type: "ensure-browser"; id: string }
  | {
      type: "render";
      id: string;
      serveUrl: string;
      output: string;
      inputProps: Record<string, unknown>;
      crf: number;
      scale: number;
      concurrency: number | null;
      x264Preset: "veryfast" | "medium" | "slow";
      licenseKey: string | null;
    }
  | { type: "cancel"; id: string };

const port = process.parentPort;
const cancels = new Map<string, () => void>();
const post = (msg: Record<string, unknown>) => port.postMessage(msg);
const browserExecutable = process.env.MOCO_BROWSER_EXECUTABLE || null;
const binariesDirectory = process.env.MOCO_BINARIES_DIRECTORY || null;

async function browser(id: string) {
  await ensureBrowser({
    browserExecutable,
    onBrowserDownload: () => {
      post({ type: "browser-downloading", id });
      return {
        version: null,
        onProgress: ({ percent }: { percent: number }) =>
          post({ type: "browser-progress", id, percent: percent * 100 }),
      };
    },
  });
  post({ type: "browser-ready", id });
}

port.on("message", async (event) => {
  const msg = event.data as Inbound;
  if (msg.type === "cancel") {
    cancels.get(msg.id)?.();
    return;
  }
  if (msg.type === "ensure-browser") {
    try {
      await browser(msg.id);
    } catch (err) {
      post({
        type: "error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (msg.type !== "render") return;
  const { cancelSignal, cancel } = makeCancelSignal();
  cancels.set(msg.id, cancel);
  try {
    await browser(msg.id);
    post({ type: "stage", id: msg.id, stage: "Preparing composition" });
    const composition = await selectComposition({
      serveUrl: msg.serveUrl,
      id: "Episode",
      inputProps: msg.inputProps,
      browserExecutable,
      timeoutInMilliseconds: 60_000,
    });
    post({
      type: "stage",
      id: msg.id,
      stage: "Rendering frames",
      total: composition.durationInFrames,
    });
    await renderMedia({
      binariesDirectory,
      composition,
      browserExecutable,
      serveUrl: msg.serveUrl,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: msg.output,
      inputProps: msg.inputProps,
      crf: msg.crf,
      scale: msg.scale,
      x264Preset: msg.x264Preset,
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 92,
      concurrency: msg.concurrency,
      timeoutInMilliseconds: 60_000,
      cancelSignal,
      overwrite: true,
      ...(msg.licenseKey ? { licenseKey: msg.licenseKey } : {}),
      onProgress: (p) =>
        post({
          type: "progress",
          id: msg.id,
          progress: p.progress,
          rendered: p.renderedFrames,
          encoded: p.encodedFrames,
          stage: p.stitchStage,
        }),
    });
    post({ type: "done", id: msg.id, output: msg.output });
  } catch (err) {
    post({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  } finally {
    cancels.delete(msg.id);
  }
});

post({ type: "ready" });
