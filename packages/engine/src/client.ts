// The UI side of the engine host protocol (see host.ts). No Node imports, so it can run in the
// Electron preload or renderer. `createEngineClient(port)` gives the same API as the Engine.
import type { Engine, EngineEvent, EngineEventType, Unsubscribe } from "./index.ts";
import type { EngineMethod, EngineRequest, EngineResponse } from "./host.ts";

// Anything with postMessage + a message listener: a MessagePort in the renderer, MessagePortMain in main.
export interface ClientPort {
  postMessage(message: unknown): void;
  addEventListener?(type: "message", listener: (message: { data: unknown }) => void): void;
  on?(event: "message", listener: (message: { data: unknown }) => void): void;
}

export class EngineClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "EngineClientError";
  }
}

export type EngineClient = Engine;

export function createEngineClient(port: ClientPort): EngineClient {
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const listeners = new Set<{ type: EngineEventType | "*"; listener: (event: EngineEvent) => void }>();

  const onMessage = ({ data }: { data: unknown }) => {
    const pushed = data as { event?: EngineEvent };
    if (pushed.event) {
      const event = pushed.event;
      listeners.forEach((entry) => (entry.type === "*" || entry.type === event.type ? entry.listener(event) : undefined));
      return;
    }
    const response = data as EngineResponse;
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.result);
    else waiting.reject(new EngineClientError(response.error.code, response.error.message));
  };
  if (port.addEventListener) port.addEventListener("message", onMessage);
  else port.on?.("message", onMessage);

  const call = (method: EngineMethod) => (...args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const request: EngineRequest = { id, method, args };
      port.postMessage(request);
    });

  return {
    createSeries: call("createSeries"),
    listSeries: call("listSeries"),
    runStage: call("runStage"),
    approve: call("approve"),
    reject: call("reject"),
    status: call("status"),
    regenerateShot: call("regenerateShot"),
    renderPreview: call("renderPreview"),
    renderFinal: call("renderFinal"),
    cancel: call("cancel"),
    waitForJob: call("waitForJob"),
    history: call("history"),
    restore: call("restore"),
    readArtifact: call("readArtifact"),
    on(type, listener): Unsubscribe {
      const entry = { type, listener };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
  } as EngineClient;
}
