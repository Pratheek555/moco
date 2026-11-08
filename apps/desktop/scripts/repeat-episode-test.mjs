// Deterministic Electron/preload/React flow. All generation and rendering IPC is replaced.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "moco-repeat-ui-"));
await writeFile(path.join(profile, "settings.json"), JSON.stringify({ theme: "dark", onboarded: true, projectsDir: path.join(profile, "projects") }));
const env = { ...process.env, MOCO_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.getByLabel("What story will you tell?")).toBeVisible();
  await expect(page.locator(".recent-chats").getByText("Your chats will appear here.")).toBeVisible();
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const at = new Date().toISOString();
    const reuse = { cast: ["Pip"], voices: ["Narrator: warm"], look: "Warm flat illustrations", rules: ["One diagram per idea"], format: { width: 1920, height: 1080, fps: 60 }, designFiles: 2 };
    const stage = (key, status, gated = false) => ({ key, status, gated, artifactHash: `${key}-hash`, updatedAt: at });
    const plan = { title: "Everyday science", premise: "Simple answers", language: "en", episodes: [{ id: "ep-01", title: "Sneezes", synopsis: "Why we sneeze" }] };
    const bible = { cast: [{ id: "pip", kitCharacterId: "pip", description: "Recurring presenter" }], style: { palette: ["#eeddcc"], captionStyle: "plain", mood: "warm", grade: "none" }, narrator: { voiceId: "warm", backend: "system", language: "en" } };
    const state = {
      series: { id: "repeat-ui", idea: "Explain everyday science", language: "en", episodes: 1, createdAt: at, engineVersion: "0.1.0", specVersion: "0.1.0", production: { mode: "artist", format: reuse.format } },
      stages: [stage("series_plan", "approved", true), stage("bible", "approved", true), ...["script", "voiceover", "shot_list", "sample", "scenes", "preview", "final", "memory_update", "publish"].map(s => stage(`ep-01/${s}`, ["script", "sample", "preview"].includes(s) ? "approved" : "done"))],
      next: { kind: "finished" }, jobs: [], decisions: [], usage: { aiCalls: {}, costUsdEstimate: 0 }, repeatEpisodes: {},
    };
    const fixture = { state, plan, reuse, calls: [], phase: "complete", inspected: false };
    globalThis.__repeatFixture = fixture;
    const send = () => BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
    const handle = (name, fn) => { ipcMain.removeHandler(`moco:${name}`); ipcMain.handle(`moco:${name}`, (_event, ...args) => fn(...args)); };
    handle("ai.status", () => ({ ok: true }));
    handle("series.status", () => state);
    handle("series.list", () => [{ ...state.series, title: plan.title, premise: plan.premise, cast: [], finals: 1, next: state.next, running: false, usage: state.usage }]);
    handle("series.repeatOffer", () => ({ available: true, sourceEpisodeId: "ep-01", reuse, ...(fixture.planned && { nextEpisode: plan.episodes.at(-1) }) }));
    handle("series.artifact", (_id, file) => {
      let data;
      if (file === "artifacts/series_plan.json") data = plan;
      if (file === "artifacts/bible.json") data = bible;
      if (file === "episodes/ep-02/artifacts/script.json") data = { targetSeconds: 30, lines: [{ id: "l01", beat: "Explain", speaker: "narrator", text: "Hiccups happen when the diaphragm suddenly contracts." }] };
      if (file === "episodes/ep-02/artifacts/shot_list.json" && ["blocked", "preview", "complete"].includes(fixture.phase)) data = { shots: [{ id: "s01", start: 0, end: 30, intent: "Explain the diaphragm", characters: ["pip"], location: "studio" }] };
      if (file === "episodes/ep-02/artifacts/critique.json" && ["blocked", "preview"].includes(fixture.phase)) data = { quality: { status: fixture.phase === "blocked" ? "needs_attention" : "passed", unresolved: fixture.phase === "blocked" ? ["s01: diagram label is unreadable"] : [] } };
      return data ? { meta: { contentHash: "fixture-hash", revision: 1 }, data } : null;
    });
    handle("episode.media", (_id, episodeId) => ({ stills: {}, savedShots: episodeId === "ep-02" && fixture.phase === "blocked" ? ["s01"] : [], ...(fixture.inspected && episodeId === "ep-02" && { preview: "data:video/mp4;base64,AAAA" }) }));
    handle("series.repeat", (_id, input) => {
      fixture.calls.push(["repeat", input]);
      const id = fixture.planned ? "ep-03" : "ep-02";
      if (!fixture.planned) { plan.episodes.push({ id, title: "Hiccups", synopsis: "Explain why the diaphragm causes hiccups." }); state.series.episodes = 2; }
      state.repeatEpisodes[id] = { episodeId: id, sourceEpisodeId: "ep-01", outlinePending: !fixture.planned, topic: input.topic, reuse, basis: {}, sharedFiles: {} };
      state.stages.push(stage(`${id}/script`, "awaiting_approval", true));
      state.next = { kind: "waiting", key: `${id}/script`, status: "awaiting_approval" };
      fixture.phase = "script";
      send();
      return "repeat-job";
    });
    handle("stages.approve", (_id, key, hash) => {
      fixture.calls.push(["approve", key, hash]);
      state.stages.find(stage => stage.key === key).status = "approved";
      if (key.endsWith("/script")) state.repeatEpisodes["ep-02"].outlinePending = false;
    });
    handle("stages.reject", (_id, key, note) => { fixture.calls.push(["reject", key, note]); });
    handle("stages.run", () => {
      fixture.calls.push(["run"]);
      if (fixture.phase === "script") {
        fixture.phase = "blocked";
        state.stages.push({ ...stage("ep-02/scenes", "failed"), error: { code: "validation_failed", message: "Visual review needs attention" } });
        state.next = { kind: "run", key: "ep-02/scenes" };
      } else if (fixture.phase === "blocked") {
        fixture.phase = "preview";
        state.stages.find(stage => stage.key === "ep-02/scenes").status = "done";
        state.stages.push(stage("ep-02/preview", "awaiting_approval", true));
        state.next = { kind: "waiting", key: "ep-02/preview", status: "awaiting_approval" };
      } else {
        fixture.phase = "complete";
        state.stages.push(stage("ep-02/final", "done"), stage("ep-02/memory_update", "done"), stage("ep-02/publish", "done"));
        state.next = { kind: "finished" };
      }
      send();
      return "run-job";
    });
    handle("episode.inspect", () => { fixture.calls.push(["inspect"]); fixture.inspected = true; send(); return "inspect-job"; });
    handle("publish.save", () => {});
    send();
  });
  await page.getByRole("button", { name: "My series", exact: true }).click();
  await page.getByRole("button", { name: "Everyday science", exact: true }).click();
  const card = page.locator('[aria-label="Next episode"]').last();
  await expect(card.getByRole("button", { name: "Create next episode", exact: true })).toBeDisabled();
  await card.getByText(/Reusing your approved series setup/).click();
  await expect(card.getByText("Warm flat illustrations", { exact: true })).toBeVisible();
  await card.getByLabel("What should the next episode explain?").fill("Why do we get hiccups?");
  await card.getByRole("button", { name: "Create next episode", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review outline and script", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Episode outline" })).toContainText("Explain why the diaphragm causes hiccups.");
  assert.deepEqual(await app.evaluate(() => globalThis.__repeatFixture.calls), [["repeat", { topic: "Why do we get hiccups?" }]]);
  await page.reload();
  await page.getByRole("button", { name: "My series", exact: true }).click();
  await page.getByRole("button", { name: "Everyday science", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review outline and script", exact: true })).toBeVisible();
  assert.equal(await app.evaluate(() => globalThis.__repeatFixture.calls.length), 1, "reload does not launch generation or approve work");
  await page.getByRole("button", { name: "Approve outline and script", exact: true }).click();
  await expect(page.getByText("s01: diagram label is unreadable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Watch inspection preview", exact: true }).click();
  await expect(page.getByLabel("Episode 2 preview", { exact: true })).toBeVisible();
  assert.equal(await app.evaluate(() => globalThis.__repeatFixture.state.stages.some(stage => stage.key === "ep-02/final")), false, "inspection cannot export final");
  await page.getByRole("button", { name: "Retry saved work", exact: true }).click();
  await expect(page.getByRole("region", { name: /Review Episode 2 preview/ })).toBeVisible();
  assert.equal(await app.evaluate(() => globalThis.__repeatFixture.state.stages.some(stage => stage.key === "ep-02/final")), false, "passing checks still wait for video approval");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator('[aria-label="Next episode"]').last().getByRole("button", { name: "Create next episode", exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.__repeatFixture;
    fixture.planned = true;
    fixture.plan.episodes.push({ id: "ep-03", title: "Goosebumps", synopsis: "Why skin gets goosebumps" });
    fixture.state.series.episodes = 3;
    fixture.state.next = { kind: "run", key: "ep-03/script" };
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await page.getByRole("button", { name: "Start episode 3", exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.__repeatFixture.calls.at(-1)), ["repeat", {}]);
  assert.deepEqual(errors, []);
  console.log("PASS repeat episode UI: new topic and planned launch, reuse summary, combined review, reload, quality issues, inspection, final approval; no model calls");
} finally { await app.close(); }
