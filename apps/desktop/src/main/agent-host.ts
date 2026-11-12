// Source entry point: Electron's utility process strips erasable TypeScript.
// Relative imports avoid Node's restriction on stripping TypeScript in node_modules.
import { claudeProvider, codexProvider } from "../../../../packages/agent/src/index.ts";
import { WorkspaceStore } from "../../../../packages/agent/src/storage.ts";
import { ProjectService } from "./service.ts";
import type { HostRequest, Method, ServiceMethods } from "../shared/api.ts";

interface Port {
  on(event: "message", listener: (event: { data: HostRequest }) => void): void;
  postMessage(message: unknown): void;
  start(): void;
}
interface ParentPort { on(event: "message", listener: (event: { data: { dataDir: string; projectsDir: string }; ports: Port[] }) => void): void }
const parent = (process as unknown as { parentPort: ParentPort }).parentPort;
if (!parent) throw new Error("agent-host must run in an Electron utility process.");
parent.on("message", ({ data, ports }) => {
  const port = ports[0];
  if (!port) return;
  const service = new ProjectService(new WorkspaceStore(data.dataDir, data.projectsDir), [claudeProvider(), codexProvider()], update => port.postMessage({ update }));
  port.on("message", ({ data: request }) => {
    void service.call(request.method, request.args as ServiceMethods[Method]["args"]).then(
      result => port.postMessage({ id: request.id, result }),
      error => port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }),
    );
  });
  port.start();
});
