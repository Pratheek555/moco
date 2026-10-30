// Serves the Engine API over a message port, for the engine host process (Electron utilityProcess).
// Protocol: request { id, method, args } → response { id, ok, result | error }; engine events are pushed as { event }.
// The UI process is a trust boundary: only whitelisted methods can be called, and the engine validates every id.
import { EngineError, type Engine } from "./index.ts";

// Electron's MessagePortMain shape. Node's worker_threads ports can be adapted to it in tests.
export interface HostPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

export const ENGINE_METHODS = [
  "createSeries",
  "listSeries",
  "runStage",
  "approve",
  "reject",
  "status",
  "regenerateShot",
  "renderPreview",
  "renderFinal",
  "cancel",
  "waitForJob",
  "history",
  "restore",
  "readArtifact",
] as const;
export type EngineMethod = (typeof ENGINE_METHODS)[number];

export interface EngineRequest {
  id: number;
  method: EngineMethod;
  args: unknown[];
}

export type EngineResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { code: string; message: string } };

export function serveEngine(engine: Engine, port: HostPort): void {
  // Every engine event goes to the UI.
  engine.on("*", (event) => port.postMessage({ event }));

  port.on("message", ({ data }) => {
    void handle(engine, data).then((response) => port.postMessage(response));
  });
}

async function handle(engine: Engine, data: unknown): Promise<EngineResponse> {
  const request = data as Partial<EngineRequest>;
  const id = typeof request?.id === "number" ? request.id : -1;
  if (!ENGINE_METHODS.includes(request?.method as EngineMethod) || !Array.isArray(request?.args)) {
    return { id, ok: false, error: { code: "bad_request", message: `unknown method ${String(request?.method)}` } };
  }
  try {
    const method = engine[request.method!] as (...args: unknown[]) => Promise<unknown>;
    const result = await method.apply(engine, request.args);
    return { id, ok: true, result };
  } catch (err) {
    const error = err instanceof EngineError ? { code: err.code, message: err.message } : { code: "internal", message: String(err) };
    return { id, ok: false, error };
  }
}
