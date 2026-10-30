// claude-cli against a fake `claude` binary that records its args and replays canned output.
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCli, compareVersions, RateLimitError, SchemaRefusal } from "../src/index.ts";

// A script standing in for `claude`: answers --version and auth status; otherwise saves args, cwd and stdin and prints `output`.
async function fakeClaude(output: object, version = "2.1.312") {
  const dir = await mkdtemp(join(tmpdir(), "fake-claude-"));
  const bin = join(dir, "claude");
  const log = join(dir, "log.json");
  await writeFile(
    bin,
    `#!/usr/bin/env node
const fs = require("fs");
if (process.argv[2] === "--version") { console.log("${version} (Claude Code)"); process.exit(0); }
if (process.argv[2] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })); process.exit(0); }
const stdin = fs.readFileSync(0, "utf8");
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin }));
process.stdout.write(${JSON.stringify(JSON.stringify(output))});
`,
  );
  await chmod(bin, 0o755);
  return { bin, readLog: async () => JSON.parse(await readFile(log, "utf8")) as { args: string[]; cwd: string; stdin: string } };
}

const request = { system: "sys", prompt: "hello", jsonSchema: { type: "object" }, timeoutMs: 10_000 };

describe("claude-cli", () => {
  it("runs isolated with no tools and returns structured output", async () => {
    const { bin, readLog } = await fakeClaude({ result: "", structured_output: { ok: 1 }, session_id: "s", total_cost_usd: 0.01 });
    const result = await claudeCli({ bin }).generate(request);
    expect(result.json).toEqual({ ok: 1 });
    expect(result.usage?.costUsdEstimate).toBe(0.01);

    const { args, cwd, stdin } = await readLog();
    expect(stdin).toBe("hello"); // prompt via stdin, never argv
    expect(cwd).toContain("moco-ai-"); // empty temp folder
    expect(args).toEqual(expect.arrayContaining(["-p", "--safe-mode", "--strict-mcp-config", "--no-session-persistence"]));
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("mcp__*");
    expect(args[args.indexOf("--json-schema") + 1]).toBe('{"type":"object"}');
  });

  it("reports a missing structured output as a refusal", async () => {
    const { bin } = await fakeClaude({ result: "I can't do that" });
    await expect(claudeCli({ bin }).generate(request)).rejects.toBeInstanceOf(SchemaRefusal);
  });

  it("checks the installed version and login", async () => {
    const current = await fakeClaude({});
    expect(await claudeCli({ bin: current.bin }).available()).toMatchObject({ ok: true, version: "2.1.312", authMethod: "claude.ai" });
    const old = await fakeClaude({}, "2.0.9");
    expect(await claudeCli({ bin: old.bin }).available()).toMatchObject({ ok: false, version: "2.0.9" });
    expect(compareVersions("2.1.40", "2.1.312")).toBe(-1);
  });

  it("recognises plan rate limits", async () => {
    const { bin } = await fakeClaude({ is_error: true, result: "Claude usage limit reached. Your limit will reset at 5pm." });
    await expect(claudeCli({ bin }).generate(request)).rejects.toBeInstanceOf(RateLimitError);
  });
});
