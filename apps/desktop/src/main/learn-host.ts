// Learn host: the entry point Electron main starts with utilityProcess.fork() to learn a style from reference videos.
// One process per run, so a 10-minute job never blocks main or the engine and can be stopped by killing it.
// Like engine-host.ts it runs from source, so @moco/learn finds its prompts and measure.py where the package keeps them.
// shortcut: the Python tools come from the repo's .venv-learn (`pnpm learn:setup`); a packaged build must ship them.
import { existsSync } from "node:fs";
import { aiBackend } from "@moco/ai";
import { allTemplates } from "@moco/engine";
import { templateText } from "@moco/engine/templates/registry";
import { defaultTools, learnStyle } from "@moco/learn";

export interface LearnHostInput {
  aiProvider: "claude-cli" | "codex-cli";
  name: string;
  sources: string[];
  stylesDir: string;
}

// Messages sent to main.
export type LearnHostMessage =
  | { type: "event"; step: string; ref?: string; message: string }
  | { type: "done"; templateId: string; leaks: number; calls: number; costUsd: number }
  | { type: "error"; message: string };

interface ParentPort {
  on(event: "message", listener: (message: { data: LearnHostInput }) => void): void;
  postMessage(message: LearnHostMessage): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("learn-host must be started with Electron's utilityProcess.fork()");

parentPort.on("message", ({ data }) => {
  void run(data).then(
    () => process.exit(0),
    (error: unknown) => {
      parentPort.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    },
  );
});

async function run(input: LearnHostInput) {
  const tools = defaultTools();
  if (!existsSync(tools.python)) throw new Error("The video tools aren't installed yet. Run `pnpm learn:setup` in the moco folder, then try again.");
  const ai = aiBackend(input.aiProvider);
  const status = await ai.available();
  if (!status.ok) throw new Error(status.reason ?? "The selected AI connection is not available.");

  // The built-in template shows the template writer moco's format.
  const example = allTemplates().find((template) => !template.learned);
  const result = await learnStyle({
    name: input.name,
    sources: input.sources,
    stylesDir: input.stylesDir,
    ai,
    tools,
    exampleTemplate: example ? templateText(example) : undefined,
    onEvent: (event) => parentPort!.postMessage({ type: "event", step: event.step, ref: event.ref, message: event.message }),
  });
  parentPort!.postMessage({ type: "done", templateId: result.slug, leaks: result.leaks.length, calls: result.usage.calls, costUsd: result.usage.costUsd });
}
