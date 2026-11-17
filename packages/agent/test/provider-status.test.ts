import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), access: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: mocks.exec }),
}));
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>(), access: mocks.access }));
import { claudeProvider } from "../src/claude.ts";
import { codexProvider } from "../src/codex.ts";

beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue(undefined); });
it("identifies missing installations for both providers", async () => {
  mocks.access.mockRejectedValue(new Error("not found"));
  expect(await claudeProvider().status()).toMatchObject({ ok: false, issue: "not-installed" });
  expect(await codexProvider().status()).toMatchObject({ ok: false, issue: "not-installed" });
});
it("identifies Claude subscription login and signed-out or API-key accounts", async () => {
  for (const auth of [{ loggedIn: false }, { loggedIn: true, authMethod: "api_key" }, { loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }]) {
    mocks.exec.mockResolvedValueOnce({ stdout: "Claude 1.0" }).mockResolvedValueOnce({ stdout: JSON.stringify(auth) });
    const result = await claudeProvider().status();
    expect(result).toMatchObject(auth.authMethod === "claude.ai" ? { ok: true, version: "Claude 1.0" } : { ok: false, issue: "signed-out", version: "Claude 1.0" });
  }
});
it("recognizes a signed-out Claude auth command even when it exits nonzero", async () => {
  mocks.exec.mockResolvedValueOnce({ stdout: "Claude 1.0" }).mockRejectedValueOnce({ stdout: '{"loggedIn":false}', code: 1 });
  expect(await claudeProvider().status()).toMatchObject({ ok: false, issue: "signed-out" });
});
it("identifies Claude launch failures and invalid auth responses as unavailable", async () => {
  mocks.exec.mockRejectedValueOnce(new Error("could not start"));
  expect(await claudeProvider().status()).toMatchObject({ ok: false, issue: "unavailable" });
  mocks.exec.mockResolvedValueOnce({ stdout: "Claude 1.0" }).mockResolvedValueOnce({ stdout: "not JSON" });
  expect(await claudeProvider().status()).toMatchObject({ ok: false, issue: "unavailable", version: "Claude 1.0" });
});
