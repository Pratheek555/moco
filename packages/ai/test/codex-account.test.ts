import { expect, it, vi } from "vitest";
import { createCodexAccountManager, codexLoginUrl } from "../src/codex-account.ts";

const done = async (manager: ReturnType<typeof createCodexAccountManager>) => {
  await vi.waitFor(() => expect(manager.busy).toBe(false));
  return manager.status();
};

it("signs out, opens login, verifies status, and exposes no raw output", async () => {
  const run = vi.fn(async (args, _signal, _timeout, output) => {
    if (args.join(" ") === "login") output("secret-token\nhttps://auth.openai.com/oauth/authorize?state=example\n");
  });
  const manager = createCodexAccountManager({ run });
  expect(manager.start().state).toBe("signing-out");
  expect(() => manager.start()).toThrow(/already/);
  expect((await done(manager)).state).toBe("succeeded");
  expect(run.mock.calls.map(call => call[0])).toEqual([["logout"], ["login"], ["login", "status"]]);
  expect(JSON.stringify(manager.status())).not.toContain("secret-token");
  expect(manager.status().loginUrl).toBeUndefined();
});

it("never starts login after a failed logout and suppresses process diagnostics", async () => {
  const run = vi.fn(async () => { throw Error("secret credentials from process"); });
  const manager = createCodexAccountManager({ run });
  manager.start();
  expect((await done(manager)).state).toBe("error");
  expect(run).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(manager.status())).not.toContain("secret credentials");
});

it("surfaces timeout and status verification failures without claiming success", async () => {
  for (const failure of ["login", "login status"]) {
    const manager = createCodexAccountManager({ run: async args => {
      if (args.join(" ") === failure) throw Error(failure === "login" ? "timeout" : "Not logged in");
    } });
    manager.start();
    expect((await done(manager)).state).toBe("error");
    expect(manager.status().message).toContain("previous account was signed out");
  }
});

it("cancels an in-flight login, clears its URL, and permits a new attempt", async () => {
  let attempt = 0;
  const manager = createCodexAccountManager({ run: async (args, signal, _timeout, output) => {
    if (args.join(" ") !== "login" || attempt++) return;
    output("https://auth.openai.com/oauth/authorize?state=example");
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true }));
  } });
  manager.start();
  await vi.waitFor(() => expect(manager.status().loginUrl).toBeDefined());
  expect((await manager.cancel()).state).toBe("cancelled");
  expect(manager.status().loginUrl).toBeUndefined();
  expect(manager.busy).toBe(false);
  manager.start();
  expect((await done(manager)).state).toBe("succeeded");
});

it("does not start browser login when cancelled during logout", async () => {
  const run = vi.fn(async (_args, signal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true }));
  });
  const manager = createCodexAccountManager({ run });
  manager.start();
  await manager.cancel();
  expect(run).toHaveBeenCalledTimes(1);
  expect(manager.status().state).toBe("cancelled");
});

it("only accepts the official browser authorization endpoint", () => {
  expect(codexLoginUrl("Visit https://auth.openai.com/oauth/authorize?state=x next")).toContain("state=x");
  for (const url of ["http://auth.openai.com/oauth/authorize", "https://auth.openai.com.evil.example/oauth/authorize", "https://evil.example/oauth/authorize", "https://auth.openai.com/token", "https://user@auth.openai.com/oauth/authorize"])
    expect(codexLoginUrl(url)).toBeUndefined();
});
