import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

// Windows .cmd shims cannot be spawned directly without a shell.
export function codexCommand(): { bin: string; args: string[] } {
  if (process.platform === "win32") {
    for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const native = join(directory, "codex.exe");
      if (existsSync(native)) return { bin: native, args: [] };
      const entry = join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (existsSync(entry)) return { bin: "node", args: [entry] };
    }
  }
  return { bin: "codex", args: [] };
}
