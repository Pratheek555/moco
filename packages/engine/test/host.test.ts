// The engine host protocol end to end over a real MessageChannel.
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { afterEach, expect, it } from "vitest";
import { createEngineClient } from "../src/client.ts";
import { serveEngine } from "../src/host.ts";
import { setup } from "./helpers.ts";

// Node ports emit the payload directly; Electron ports emit { data }. Adapt Node to Electron's shape.
const asElectron = (port: MessagePort) => ({
  on: (_event: "message", listener: (message: { data: unknown }) => void) => port.on("message", (data) => listener({ data })),
  postMessage: (message: unknown) => port.postMessage(message),
});

const opened: MessagePort[] = [];
afterEach(() => opened.forEach((port) => port.close()));

it("calls the engine, forwards events and errors through the port", async () => {
  const { engine } = await setup();
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  serveEngine(engine, asElectron(port1));
  const client = createEngineClient(asElectron(port2));

  const events: string[] = [];
  client.on("*", (event) => events.push(event.type));

  const seriesId = await client.createSeries({ idea: "Gita over the wire", language: "en", episodes: 1 });
  const job = await client.waitForJob(await client.runStage({ seriesId }));
  expect(job.status).toBe("succeeded");
  expect((await client.status(seriesId)).next).toMatchObject({ kind: "waiting", key: "series_plan" });
  expect(events).toContain("stage.awaiting_approval");

  await expect(client.approve({ seriesId, key: "series_plan" }, "wrong")).rejects.toMatchObject({ code: "gate_mismatch" });

  // Only whitelisted methods can be called from the UI side.
  const rejected = new Promise((resolve) => port2.on("message", (data) => (data.id === 99 ? resolve(data) : undefined)));
  port2.postMessage({ id: 99, method: "constructor", args: [] });
  expect(await rejected).toMatchObject({ id: 99, ok: false, error: { code: "bad_request" } });
});
