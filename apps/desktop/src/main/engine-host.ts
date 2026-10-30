// Engine host: the entry point Electron main starts with utilityProcess.fork(). Backend only, no UI.
// It wires the engine to its real backends and serves it over the message port main sends in.
// Rendering and AI calls are slow and CPU-heavy, so they live here and never block the main process.
//
// It runs from source: Electron's Node strips the TypeScript types (the packages use erasable syntax only), so the
// engine's prompt files and the kit assets stay where the packages expect them.
// shortcut: works in dev (`pnpm dev`); a packaged build needs the packages shipped outside app.asar/node_modules
// (Node won't strip types there) and a prebuilt Remotion bundle passed as remotion.serveUrl.
import { claudeCli } from "@moco/ai";
import { systemAudio } from "@moco/audio";
import { createEngine } from "@moco/engine";
import { serveEngine, type HostPort } from "@moco/engine/host";
import { createRemotionRenderPort } from "@moco/renderer";

export interface EngineHostConfig {
  projectsDir: string;
  voice: { voice: string; rate: number };
  concurrency: number | null; // render tabs; null = the renderer's default
  remotion?: {
    serveUrl?: string; // prebuilt bundle (packaged app)
    browserExecutable?: string; // packaged Chrome Headless Shell
    binariesDirectory?: string; // compositor binaries in app.asar.unpacked
  };
}

// The part of Electron's utilityProcess API this file uses (avoids depending on electron types here).
interface ParentPort {
  on(event: "message", listener: (message: { data: EngineHostConfig; ports: (HostPort & { start(): void })[] }) => void): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("engine-host must be started with Electron's utilityProcess.fork()");

parentPort.on("message", ({ data, ports }) => {
  const port = ports[0];
  if (!port || typeof data?.projectsDir !== "string") return;

  const engine = createEngine({
    projectsDir: data.projectsDir,
    ai: claudeCli(), // the user's own Claude Code session
    render: createRemotionRenderPort({ ...data.remotion, concurrency: data.concurrency }),
    audio: systemAudio(data.voice),
    config: { voice: { voiceId: data.voice.voice || "default", backend: "system" } },
  });
  serveEngine(engine, port);
  port.start();
});
