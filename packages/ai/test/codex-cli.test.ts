import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aiBackend, codexCli, RateLimitError, SchemaRefusal, TimeoutError } from "../src/index.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fake(events: object[], options: { code?: number; loggedIn?: boolean; delay?: number; generated?: string[] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "fake-codex-"));
  dirs.push(dir);
  const script = join(dir, "cli.cjs"), log = join(dir, "log.json");
  await writeFile(script, `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli 0.134.0'); process.exit(0); }
if (args[0] === 'login') { console.error(${JSON.stringify(options.loggedIn === false ? "Not logged in" : "Logged in using ChatGPT")}); process.exit(${options.loggedIn === false ? 1 : 0}); }
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({args, stdin, cwd:process.cwd()}));
for (const [index,data] of ${JSON.stringify(options.generated ?? [])}.entries()) {
  const folder=require('node:path').join(process.cwd(),'generated_images','thread-1');
  fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(require('node:path').join(folder,index+'.png'),Buffer.from(data,'base64'));
}
setTimeout(() => { console.log(${JSON.stringify(events.map((event) => JSON.stringify(event)).join("\n"))}); process.exit(${options.code ?? 0}); }, ${options.delay ?? 0});
`);
  return { ai: codexCli({ bin: process.execPath, binArgs: [script] }), log: async () => JSON.parse(await readFile(log, "utf8")) };
}
const request = { system: "Write stories", prompt: "hello", timeoutMs: 5000, jsonSchema: { type: "object" } };
const answer = (text = '{"ok":true}') => [
  { type: "thread.started", thread_id: "thread-1" },
  { type: "item.completed", item: { type: "agent_message", text } },
  { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } },
];
describe("codex-cli", () => {
  it("delivers public updates while keeping the final structured answer intact", async () => {
    const updates: string[] = [];
    const cli = await fake([
      { type: "item.completed", item: { type: "reasoning", text: "private" } },
      { type: "item.completed", item: { type: "agent_message", text: "I’m outlining the episodes." } },
      ...answer(),
    ]);
    const result = await cli.ai.generate({ ...request, onActivity: (text) => updates.push(text) });
    expect(updates).toEqual(["I’m outlining the episodes."]);
    expect(result.json).toEqual({ ok: true });
  });
  it("selects both providers and checks login without making a model request", async () => {
    expect(aiBackend().id).toBe("codex-cli");
    expect(aiBackend("claude-cli").id).toBe("claude-cli");
    expect(() => aiBackend("unknown" as never)).toThrow("Unknown AI provider");
    expect(aiBackend("codex-cli").id).toBe("codex-cli");
    expect(await (await fake([])).ai.available()).toMatchObject({ ok: true, authMethod: "ChatGPT" });
    expect(await (await fake([], { loggedIn: false })).ai.available()).toMatchObject({ ok: false });
    expect(await codexCli({ bin: join(tmpdir(), "missing-moco-codex") }).available()).toMatchObject({ ok: false });
  });
  it("passes prompts through stdin, attaches images, parses usage, and removes its working directory", async () => {
    const cli = await fake(answer());
    const result = await cli.ai.generate({ ...request, images: ["C:/images/frame.png"], model: "test-model" });
    expect(result).toMatchObject({ backend: "codex-cli", json: { ok: true }, sessionId: "thread-1", usage: { inputTokens: 100, outputTokens: 10 } });
    const log = await cli.log();
    expect(log.stdin).toContain(JSON.stringify(request.jsonSchema));
    expect(log.args).toEqual(expect.arrayContaining(["--ignore-user-config", "--ephemeral", "read-only", "features.shell_tool=false", "features.image_generation=false", "--image", "C:/images/frame.png", "test-model"]));
    expect(log.args).not.toContain("hello");
    await expect(readFile(join(log.cwd, "system.md"))).rejects.toThrow();
  });
  it("handles plain text and fenced JSON responses", async () => {
    expect((await (await fake(answer("hello"))).ai.generate({ ...request, jsonSchema: undefined })).text).toBe("hello");
    expect((await (await fake(answer('```json\n{"ok":true}\n```'))).ai.generate(request)).json).toEqual({ ok: true });
  });
  it("collects actual native image artifacts only for an explicit image request", async () => {
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCWQAAAAASUVORK5CYII=","base64");
    const cli=await fake(answer("Generated"),{generated:[png.toString("base64")]});
    expect(cli.ai.supportsImageGeneration).toBe(true);
    const result=await cli.ai.generate({...request,jsonSchema:undefined,imageGeneration:true});
    expect(result.generatedImages).toEqual([{data:png,mimeType:"image/png"}]);
    expect((await cli.log()).args).toContain("features.image_generation=true");
    await expect(readFile(join((await cli.log()).cwd,"system.md"))).rejects.toThrow();
    await expect((await fake(answer('C:/private/secret.png'))).ai.generate({...request,jsonSchema:undefined,imageGeneration:true})).rejects.toThrow("found 0");
  });
  it("exposes only the application's artist tools with explicit approval and no shell", async () => {
    const cli = await fake(answer("done"));
    expect(cli.ai.supportsArtist).toBe(true);
    await cli.ai.generate({ ...request, jsonSchema: undefined, artistTools: [{
      name: "render_preview", description: "Preview", inputSchema: { type: "object" },
      call: async () => ({ content: [{ type: "text", text: "ok" }] }),
    }] });
    const { args } = await cli.log();
    expect(args).toEqual(expect.arrayContaining([
      'mcp_servers.moco_artist.enabled_tools=["render_preview"]',
      'mcp_servers.moco_artist.required=true',
      'mcp_servers.moco_artist.default_tools_approval_mode="approve"',
      'features.shell_tool=false', 'features.apply_patch_freeform=false', 'read-only',
    ]));
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });
  it("reports invalid JSON, failed turns and premature exits", async () => {
    await expect((await fake(answer("refused"))).ai.generate(request)).rejects.toBeInstanceOf(SchemaRefusal);
    await expect((await fake([{ type: "turn.failed", error: { message: "429 usage limit reached" } }], { code: 1 })).ai.generate(request)).rejects.toBeInstanceOf(RateLimitError);
    await expect((await fake([])).ai.generate(request)).rejects.toThrow("without completing");
  });
  it("times out and respects cancellation", async () => {
    await expect((await fake([], { delay: 2000 })).ai.generate({ ...request, timeoutMs: 100 })).rejects.toBeInstanceOf(TimeoutError);
    const controller = new AbortController();
    const cli = await fake([], { delay: 2000 });
    const result = cli.ai.generate({ ...request, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(result).rejects.toThrow("cancelled");
  });
});
