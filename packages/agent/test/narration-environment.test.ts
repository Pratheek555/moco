import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), access: vi.fn(), query: vi.fn(), environments: [] as NodeJS.ProcessEnv[] }));
vi.mock("node:child_process", async original => ({
  ...await original<typeof import("node:child_process")>(),
  execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: mocks.exec }),
}));
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>(), access: mocks.access }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: mocks.query, createSdkMcpServer: () => ({}), tool: () => ({}) }));
vi.mock("../src/codex-rpc.ts", () => ({ CodexConnection: class {
  done = Promise.resolve();
  constructor(_: string, env: NodeJS.ProcessEnv) { mocks.environments.push(env); }
  async initialize() { return "test"; }
  async request(method: string) { return method === "account/read" ? { account: { type: "chatgpt" } } : { thread: { id: "saved" } }; }
  async close() {}
} }));
import { claudeProvider } from "../src/claude.ts";
import { codexProvider } from "../src/codex.ts";

beforeEach(() => {
  vi.clearAllMocks(); mocks.environments.length = 0;
  mocks.access.mockResolvedValue(undefined);
  mocks.exec.mockImplementation(async (_: string, args: string[]) => ({ stdout: args.includes("--version") ? "test" : JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }) }));
  mocks.query.mockImplementation(({ options }: { options: { env: NodeJS.ProcessEnv } }) => {
    mocks.environments.push(options.env);
    return { async *[Symbol.asyncIterator]() {}, close() {} };
  });
  vi.stubEnv("GEMINI_API_KEY", "test-inherited-key"); vi.stubEnv("GOOGLE_API_KEY", "test-google-key");
  vi.stubEnv("MOCO_GEMINI_TTS_VOICE", "Puck");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-provider-key"); vi.stubEnv("OPENAI_API_KEY", "test-provider-key");
});
afterEach(() => vi.unstubAllEnvs());
it.each(["claude-code", "codex"] as const)("hands %s the narration env after auth filtering; absent/cleared settings preserve inherited values", async id => {
  const provider = id === "codex" ? codexProvider({ executable: "test-codex" }) : claudeProvider();
  const base = { cwd: ".", skill: "sample", onEvent: () => {} };
  for (const narration of [undefined, { key: "test-key-123", voice: "Charon" }, undefined]) {
    const session = await provider.start({ ...base, narration }); await session.stop();
    const env = mocks.environments.at(-1)!;
    expect(env.GEMINI_API_KEY).toBe(narration?.key ?? "test-inherited-key");
    expect(env.MOCO_GEMINI_TTS_VOICE).toBe(narration?.voice ?? "Puck");
    expect(env.GOOGLE_API_KEY).toBe("test-google-key");
    expect(env[id === "codex" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"]).toBeUndefined();
  }
  expect(process.env.GEMINI_API_KEY).toBe("test-inherited-key");
  delete process.env.GEMINI_API_KEY; delete process.env.MOCO_GEMINI_TTS_VOICE;
  await (await provider.start(base)).stop();
  expect(mocks.environments.at(-1)).not.toHaveProperty("GEMINI_API_KEY");
  expect(mocks.environments.at(-1)).not.toHaveProperty("MOCO_GEMINI_TTS_VOICE");
});
