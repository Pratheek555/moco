// Learn a style from reference videos: measures every frame and word, has the AI study tile sheets, and writes
// a skill (<styles>/<slug>/skill/SKILL.md) plus a moco template (<styles>/<slug>/moco-template.md). By default <styles> is
// the desktop app's styles folder, so the template shows up in the app's Templates page. Uses the selected provider's quota
// (roughly 6–10 calls per reference plus 2–4 to merge). Run `pnpm learn:setup` once first.
//   pnpm learn --name "Cartoon fact shorts" <youtube-url|video-file> [more…] [--out <folder>] [--whisper small]
//              [--language en] [--model <id>] [--concurrency 3] [--measure-only]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { aiBackend } from "@moco/ai";
import { learnStyle } from "@moco/learn";

const args = process.argv.slice(2);
const flags = new Map<string, string>();
const sources: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]!;
  if (arg === "--measure-only") flags.set("measure-only", "1");
  else if (arg.startsWith("--")) flags.set(arg.slice(2), args[++i] ?? "");
  else sources.push(arg);
}
const name = flags.get("name");
if (!name || sources.length === 0) {
  console.error('usage: pnpm learn --name "Style name" <youtube-url|video-file> [more…] [--out styles] [--whisper small] [--measure-only]');
  process.exit(1);
}

const ai = aiBackend();
if (!flags.has("measure-only")) {
  const status = await ai.available();
  if (!status.ok) throw new Error(status.reason);
}

const started = Date.now();
const result = await learnStyle({
  name,
  sources,
  stylesDir: flags.get("out") ?? appStylesDir(),
  ai,
  whisperModel: flags.get("whisper"),
  language: flags.get("language"),
  model: flags.get("model"),
  concurrency: flags.has("concurrency") ? Number(flags.get("concurrency")) : undefined,
  exampleTemplate: readFileSync(new URL("../packages/engine/src/templates/cartoon-3d-short.md", import.meta.url), "utf8"),
  stopAfter: flags.has("measure-only") ? "measure" : undefined,
  onEvent: (event) => console.log(`[${event.step}${event.ref ? ` ${event.ref}` : ""}] ${event.message}`),
});

console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)} s → ${result.dir}`);
for (const ref of result.references) console.log(`  ${ref.id}: ${ref.title}${ref.category ? ` (${ref.category}, ${ref.agents} agents)` : ""}`);
if (result.skillFile) console.log(`  skill:    ${result.skillFile}`);
if (result.templateFile) console.log(`  template: ${result.templateFile}`);
if (result.leaks.length) console.log(`  check:    ${result.leaks.length} phrase(s) from the references may remain; see leaks.json`);

// Where the desktop app (Electron userData for "Moco") looks for learned styles.
function appStylesDir(): string {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Moco", "styles");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Moco", "styles");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Moco", "styles");
}
