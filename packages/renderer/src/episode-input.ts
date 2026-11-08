import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { CanvasScene, EpisodeSpec } from "@moco/spec";
import type { RenderEpisode } from "./render-input.ts";

// Remotion injects input props through Chrome's debugging connection, whose message
// buffer is limited to 100 MiB. Keep embedded drawings out of it, and load only the
// active shot over loopback. Saved artifacts remain self-contained data URLs.
export async function serveEpisodeInput(episode: EpisodeSpec): Promise<{
  episode: RenderEpisode;
  close(): Promise<void>;
}> {
  if (!episode.scenes.some((scene) => scene.canvas)) return { episode, close: async () => {} };

  const prefix = `/${randomUUID()}/`;
  const drawings = new Map<string, CanvasScene>(episode.scenes.flatMap((scene, index) =>
    scene.canvas ? [[`${prefix}${index}.json`, scene.canvas] as const] : [],
  ));
  const server = createServer((req, res) => {
    // Include CORS on failures too, so the browser can report their HTTP status.
    res.setHeader("Access-Control-Allow-Origin", "*"); // the bundle uses another loopback port
    const drawing = drawings.get(req.url ?? "");
    if (!drawing || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(drawing));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the episode artwork server");
  const baseUrl = `http://127.0.0.1:${address.port}${prefix}`;
  return {
    episode: {
      ...episode,
      scenes: episode.scenes.map((scene, index) => {
        if (!scene.canvas) return scene;
        const { canvas, ...metadata } = scene;
        return { ...metadata, canvasUrl: `${baseUrl}${index}.json` };
      }),
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
