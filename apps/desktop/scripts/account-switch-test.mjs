// Exercise real IPC, CLI spawning and settings UI with an isolated fake CLI.
// Never reads or changes the user's actual Codex credentials or opens a browser.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-account-test-"));
const bin = path.join(profile, "bin");
const entry = path.join(bin, "node_modules/@openai/codex/bin/codex.js");
const complete = path.join(profile, "complete");
const log = path.join(profile, "commands.jsonl");
await mkdir(path.dirname(entry), { recursive: true });
await writeFile(entry, `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n');
if(args[0]==='--version') { console.log('codex-cli 0.166.0'); process.exit(0); }
if(args.join(' ')==='login status') { console.log('Logged in using ChatGPT'); process.exit(0); }
if(args[0]==='logout') process.exit(0);
if(args.join(' ')==='login') {
  console.log('https://auth.openai.com/oauth/authorize?state=test-fixture');
  setInterval(()=>{ if(fs.existsSync(${JSON.stringify(complete)}))process.exit(0); },100);
} else process.exit(2);
`);
// codexCommand recognizes the Windows npm layout; use a POSIX shim elsewhere.
if (process.platform !== "win32") {
  await writeFile(path.join(bin, "codex"), `#!/bin/sh\nexec node '${entry.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
}
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ onboarded: true, aiProvider: "codex-cli", projectsDir: path.join(profile, "projects") }));
const env = { ...process.env, MOCO_USER_DATA: profile, CODEX_HOME: path.join(profile, "codex-home") };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
env[pathKey] = bin + path.delimiter + (env[pathKey] ?? "");
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const switchButton = page.getByRole("button", { name: "Switch account / Sign in", exact: true });
  await expect(switchButton).toBeVisible();
  await switchButton.click();
  await expect(page.getByRole("button", { name: "Cancel sign-in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open sign-in page" })).toBeVisible();
  assert.equal((await page.evaluate(() => window.moco.ai.status())).ok, false);
  const blocked = await page.evaluate(async () => {
    try { await window.moco.series.create({ idea: "Never start a real job", language: "en", episodes: 1 }); return "not blocked"; }
    catch(error) { return String(error); }
  });
  assert.match(blocked, /Finish or cancel Codex sign-in/);
  const duplicate = await page.evaluate(async () => {
    try { await window.moco.ai.switchAccount(); return "not blocked"; }
    catch(error) { return String(error); }
  });
  assert.match(duplicate, /already in progress/);
  await page.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect(page.getByText(/Sign-in cancelled/)).toBeVisible();
  await expect(switchButton).toBeEnabled();
  await switchButton.click();
  await expect(page.getByRole("button", { name: "Open sign-in page" })).toBeVisible();
  await writeFile(complete, "done");
  await expect(page.getByText(/Codex sign-in completed/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Codex 0.166.0 is ready/)).toBeVisible();
  const commands = (await readFile(log, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(commands.filter(args => args.join(" ") === "logout").length, 2);
  assert.equal(commands.filter(args => args.join(" ") === "login").length, 2);
  assert.deepEqual(errors, []);
  console.log("PASS account-switch IPC/UI: browser link, duplicate exclusion, job guard, cancel, retry, verified success; real credentials untouched");
} finally { await app.close(); }
