// Real Electron/preload/React path, deterministic IPC fixtures; no model calls or renders.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const artifacts = path.resolve(
  desktop,
  "../../artifacts/studio-implementation",
);
const profile = await mkdtemp(path.join(tmpdir(), "moco-development-ui-"));
await mkdir(artifacts, { recursive: true });
await writeFile(
  path.join(profile, "settings.json"),
  JSON.stringify({
    theme: "dark",
    onboarded: true,
    projectsDir: path.join(profile, "projects"),
  }),
);
const seasonPlan = JSON.parse(await readFile(path.resolve(desktop, "../../examples/series/mom-has-admin.plan.json"), "utf8"));
const seasonBrief = await readFile(path.resolve(desktop, "../../examples/series/mom-has-admin.txt"), "utf8");
const styleDir = path.join(profile, "styles", "roblox-ui-fixture");
await mkdir(styleDir, { recursive: true });
await writeFile(path.join(styleDir, "moco-template.md"), "# Creative prompt\nBlocky cartoon art");
await writeFile(path.join(styleDir, "moco-template.json"), JSON.stringify({
  id: "roblox-ui-fixture", name: "2D Roblox What If", palette: { sky: ["#536c9b", "#d7d8e7"], accents: [] },
  production: { mode: "artist", localOnly: true, format: { width: 1080, height: 1920, fps: 60 }, targetSeconds: 42 },
  defaults: { episodes: 1 },
}));
const env = { ...process.env, MOCO_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [desktop],
  cwd: desktop,
  env,
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByLabel("What would you like to explain?")).toBeVisible();
  // This regression covers the existing freeform story workflow explicitly.
  await page.getByRole("button", { name: "Story options", exact: true }).click();
  await page.getByLabel("Visual approach").click();
  await page.getByRole("option", { name: "Animation & 3D", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create series", exact: true })).toBeDisabled();
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible();
  await page.getByRole("button", { name: "My series", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My series", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  const ocean = () => page.locator(".ascii-ocean").evaluate((canvas) => canvas.toDataURL());
  await page.getByRole("button", { name: "Pause ocean animation", exact: true }).click();
  const pausedOcean = await ocean();
  await page.waitForTimeout(250);
  assert.equal(await ocean(), pausedOcean, "paused ocean stays still");
  await page.getByRole("button", { name: "Resume ocean animation", exact: true }).click();
  await expect.poll(ocean).not.toBe(pausedOcean);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Let the media-query change render its final, static frame.
  await page.waitForTimeout(100);
  const reducedOcean = await ocean();
  await page.waitForTimeout(250);
  assert.equal(await ocean(), reducedOcean, "reduced motion stops all ocean updates");
  const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.setViewportSize({ width: 1120, height: 720 });
  await expect(page.getByLabel("What story will you tell?")).toBeVisible();
  assert.equal(await page.locator(".studio-landing").evaluate(e => e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
  await page.screenshot({ path: path.join(artifacts, "00-studio-landing-compact.png") });
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your stories" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Story options", exact: true }).click();
  await expect(page.getByLabel("Number of episodes")).toBeVisible();
  await expect(page.getByLabel("Visual approach")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Visual approach", exact: true })).toBeFocused();
  await page.screenshot({ path: path.join(artifacts, "00-story-options-dark.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1120, height: 720 });
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
  assert.equal(await page.getByRole("dialog", { name: "Shape your story" }).evaluate(e => e.scrollWidth > e.clientWidth), false);
  await page.screenshot({ path: path.join(artifacts, "00-story-options-compact.png"), animations: "disabled" });
  await page.setViewportSize(viewport);
  await page.getByRole("button", { name: "The keeper and the serpent", exact: true }).click();
  await expect(page.getByRole("button", { name: "The keeper and the serpent", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("An idea is ready in your prompt. Make it your own.")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("What story will you tell?")).toBeFocused();
  await expect(page.getByLabel("What story will you tell?")).not.toHaveValue("");
  await page.getByLabel("What story will you tell?").fill("");
  await page.screenshot({ path: path.join(artifacts, "00-studio-landing.png") });
  await page.screenshot({ path: path.join(artifacts, "00-studio-landing-dark.png") });
  await expect(page.getByText(/Loading chats/)).toHaveCount(0, { timeout: 30000 });
  await page.getByLabel("What story will you tell?").fill("A draft kept through appearance changes.");
  await page.getByRole("button", { name: "Switch to light appearance", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.getByLabel("What story will you tell?")).toHaveValue("A draft kept through appearance changes.");
  await page.screenshot({ path: path.join(artifacts, "00-studio-landing-light.png") });
  await page.getByRole("button", { name: "Story options", exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, "00-story-options-light.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to dark appearance", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  assert.equal(await page.evaluate(() => window.moco.settings.get().then(s => s.theme)), "dark");
  await page.getByLabel("What story will you tell?").fill("");
  const emptyHeight = await page.getByLabel("What story will you tell?").evaluate(e => e.clientHeight);
  await page.getByLabel("What story will you tell?").fill(seasonBrief);
  const longHeight = await page.getByLabel("What story will you tell?").evaluate(e => e.clientHeight);
  assert.ok(longHeight > emptyHeight && longHeight <= 200, "long briefs expand within a bounded editing area");
  await page.getByRole("button", { name: "Story options", exact: true }).click();
  await page.getByLabel("Number of episodes").click();
  await page.getByRole("option", { name: "10 episodes", exact: true }).click();
  await page.getByRole("combobox", { name: "Template", exact: true }).click();
  await page.getByRole("option", { name: "2D Roblox What If", exact: true }).click();
  await expect(page.getByLabel("Number of episodes")).toContainText("10 episodes");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Animation style", exact: true })).toHaveText("2D Roblox What If");
  await expect(page.getByRole("button", { name: "Choose episode count" })).toHaveText("10 EPISODES");
  await page.setViewportSize({ width: 1120, height: 720 });
  await expect(page.getByRole("button", { name: "Create series", exact: true })).toBeInViewport();
  assert.equal(await page.locator(".studio-landing").evaluate(e => e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight), false);
  await page.screenshot({ path: path.join(artifacts, "00-roblox-series-brief.png") });
  await page.setViewportSize(viewport);
  await page.getByRole("button", { name: "Story options", exact: true }).click();
  await page.getByRole("button", { name: "Remove template", exact: true }).click();
  await expect(page.getByLabel("Number of episodes")).toContainText("10 episodes");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByLabel("What story will you tell?").fill("");
  await expect.poll(() => page.getByLabel("What story will you tell?").evaluate(e => e.clientHeight)).toBe(emptyHeight);
  assert.equal(await page.locator(".studio-landing").evaluate((e) => e.scrollHeight > e.clientHeight), false);
  await app.evaluate(({ ipcMain, BrowserWindow }, { seasonPlan, seasonBrief }) => {
    const at = new Date().toISOString();
    const state = {
      series: {
        id: "development-ui",
        idea: "A lighthouse keeper and a sea serpent protect a village that fears them both.\n\n" + seasonBrief,
        episodes: 10,
        language: "en",
        createdAt: at,
      },
      stages: [
        { key: "series_plan", status: "running", gated: true, updatedAt: at },
      ],
      activeJob: {
        id: "job-ui",
        status: "running",
        startedAt: at,
        kind: "stage",
        target: "next",
        stagesRun: [],
      },
      jobs: [],
      decisions: [],
      usage: { aiCalls: {}, costUsdEstimate: 0 },
      next: { kind: "waiting", key: "series_plan", status: "running" },
    };
    const plan = seasonPlan;
    const fixture = { state, plan, calls: [], ready: false };
    globalThis.__developmentFixture = fixture;
    const send = () =>
      BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
    const handle = (name, fn) => {
      ipcMain.removeHandler(`moco:${name}`);
      ipcMain.handle(`moco:${name}`, (_event, ...args) => fn(...args));
    };
    handle("ai.status", () => ({ ok: true }));
    handle("series.create", (input) => {
      fixture.calls.push(["create", input.idea]);
      return state.series.id;
    });
    handle("series.status", () => state);
    handle("series.artifact", (_id, file) =>
      fixture.ready && file === "artifacts/series_plan.json"
        ? { meta: { contentHash: "plan-hash", revision: 1 }, data: plan }
        : null,
    );
    handle("series.list", () => [
      {
        ...state.series,
        title: plan.title,
        premise: plan.premise,
        cast: [],
        finals: 0,
        next: state.next,
        running: Boolean(state.activeJob),
        usage: state.usage,
      },
    ]);
    handle("stages.cancel", (id) => {
      fixture.calls.push(["cancel", id]);
      state.jobs = [{ ...state.activeJob, status: "cancelled" }];
      delete state.activeJob;
      state.stages[0].status = "pending";
      send();
    });
    handle("stages.reject", (_id, key, feedback) => {
      fixture.calls.push(["reject", key, feedback]);
      state.stages[0].status = "pending";
      state.decisions.push({
        category: "feedback",
        subject: key,
        detail: feedback,
        at: new Date().toISOString(),
      });
    });
    handle("stages.approve", (_id, key, hash) => {
      fixture.calls.push(["approve", key, hash]);
      state.stages[0].status = "approved";
      send();
    });
    handle("stages.run", () => {
      fixture.calls.push(["run"]);
      state.activeJob = {
        id: "job-next",
        startedAt: new Date().toISOString(),
        status: "running",
        kind: "stage",
        target: "next",
        stagesRun: [],
      };
      if (state.stages[0].status !== "approved")
        state.stages[0].status = "running";
      state.next = { kind: "run", key: "bible" };
      send();
      return "job-next";
    });
  }, { seasonPlan, seasonBrief });
  await page
    .getByLabel("What story will you tell?")
    .fill(
      "A lighthouse keeper and a sea serpent protect a village that fears them both.",
    );
  await page.getByRole("button", { name: /Create series/ }).click();
  await expect(
    page.getByRole("heading", { name: "A world is taking shape." }),
  ).toBeVisible();
  assert.equal(
    await page
      .locator(".studio-development")
      .evaluate((e) => getComputedStyle(e).colorScheme),
    "dark",
  );
  await expect(page.getByLabel("Stop generation")).toBeVisible();
  await page.getByRole("button", { name: "Production progress", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Production stages" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Production stages" }).getByRole("listitem")).toHaveCount(6);
  await expect(page.getByRole("navigation", { name: "Production stages" })).toContainText("Plan");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Story context", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The story so far" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("A lighthouse keeper and a sea serpent");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.locator(".development-scroll").evaluate(e => { e.scrollTop = 0; });
  await expect(page.getByRole("button", { name: "Read full brief", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Read full brief", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show less", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Show less", exact: true }).click();
  await expect(page.locator(".generation-brief-collapsed")).toContainText("QUALITY BAR");
  await page.locator(".development-scroll").evaluate(e => { e.scrollTop = e.scrollHeight; });

  const update = async (count) =>
    app.evaluate(({ BrowserWindow }, count) => {
      const s = globalThis.__developmentFixture.state;
      for (let i = 0; i < count; i++)
        BrowserWindow.getAllWindows()[0].webContents.send("moco:engine", {
          type: "ai.activity",
          seriesId: s.series.id,
          at: new Date().toISOString(),
          data: {
            key: "series_plan",
            phase: "working",
            message: `Draft update ${i + 1}: Shaping the world and giving the village a reason to fear the sea.`,
          },
        });
    }, count);
  await update(3);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, "01-generation-overview.png"), animations: "disabled" });
  const generationViewport = page.viewportSize();
  await page.setViewportSize({ width: 1120, height: 720 });
  await expect(page.getByLabel("Add direction to your series")).toBeInViewport();
  await expect(page.locator(".development-active p")).toBeInViewport();
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(artifacts, "01-generation-compact.png"), animations: "disabled" });
  await page.setViewportSize(generationViewport);
  await page.locator(".generation-process > summary").click();
  await page.locator(".development-scroll").evaluate(e => { e.scrollTop = e.scrollHeight; });
  await update(15);
  await expect(page.locator(".development-history article")).toHaveCount(17);
  await expect
    .poll(() =>
      page
        .locator(".development-scroll")
        .evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
    )
    .toBeLessThan(49);
  const before = await page.locator(".development-composer").boundingBox();
  await page.locator(".development-scroll").evaluate((e) => {
    e.scrollTop = 0;
  });
  await expect(
    page.getByRole("button", { name: "Latest update" }),
  ).toBeVisible();
  await update(1);
  assert.ok(
    await page.locator(".development-scroll").evaluate((e) => e.scrollTop < 10),
    "new updates must not interrupt history reading",
  );
  const after = await page.locator(".development-composer").boundingBox();
  assert.ok(
    Math.abs(before.y - after.y) < 1,
    "composer stays still while the chat scrolls",
  );
  const fade = await page
    .locator(".development-composer-dock")
    .evaluate((e) => {
      const s = getComputedStyle(e, "::before");
      return { blur: s.backdropFilter, pointer: s.pointerEvents };
    });
  assert.equal(fade.blur, "blur(5px)");
  assert.equal(fade.pointer, "none");
  await page.getByRole("button", { name: "Latest update" }).click();
  await page
    .getByLabel("Add direction to your series")
    .fill("Give the serpent a warmer personality.");
  await page
    .getByRole("button", { name: "Add direction", exact: true })
    .click();
  await expect(
    page.getByText("Your direction · queued for the next draft"),
  ).toBeVisible();
  // Check actual canvas pixels, not just an empty placeholder element.
  await expect
    .poll(() =>
      page.locator(".studio-ascii").evaluate((e) =>
        e
          .getContext("2d")
          .getImageData(0, 0, e.width, e.height)
          .data.some((n, i) => i % 4 === 3 && n > 0),
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: path.join(artifacts, "01-dark-conversation.png"),
  });
  await page.getByLabel("Stop generation").click();
  await expect(
    page.getByRole("heading", { name: "Your draft is safe." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume development" }).click();
  const finish = async () =>
    app.evaluate(({ BrowserWindow }) => {
      const f = globalThis.__developmentFixture;
      f.ready = true;
      delete f.state.activeJob;
      f.state.stages[0] = {
        ...f.state.stages[0],
        status: "awaiting_approval",
        artifactHash: "plan-hash",
      };
      f.state.next = {
        kind: "waiting",
        key: "series_plan",
        status: "awaiting_approval",
      };
      BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
    });
  await finish();
  await expect(
    page.getByRole("button", { name: "Apply notes & revise" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply notes & revise" }).click();
  await expect
    .poll(() =>
      app.evaluate(() =>
        globalThis.__developmentFixture.calls.some(
          (c) =>
            c[0] === "reject" &&
            c[2] === "Give the serpent a warmer personality.",
        ),
      ),
    )
    .toBe(true);
  await finish();
  await page
    .getByRole("button", { name: "Review series plan", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Review", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Review", exact: true })).toBeFocused();
  await expect(page.getByRole("list", { name: "The episode board", exact: true }).getByRole("listitem")).toHaveCount(10);
  await page.getByRole("navigation", { name: "Jump to episode", exact: true }).getByRole("button", { name: /^Episode 10:/ }).click();
  await expect(page.getByRole("heading", { name: "The Best Server Isn't Perfect", exact: true })).toBeInViewport();
  await expect(page.getByRole("list", { name: "The episode board", exact: true }).getByRole("listitem").last()).toBeFocused();
  await page.screenshot({ path: path.join(artifacts, "02-plan-review.png") });
  await page.getByRole("button", { name: "Approve series plan" }).click();
  await expect(
    page.getByRole("region", { name: "Production studio", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Preparing the next step" }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    const send = (type, data, seriesId = f.state.series.id) => BrowserWindow.getAllWindows()[0].webContents.send("moco:engine", { type, seriesId, at: new Date().toISOString(), data });
    send("ai.activity", { key: "ep-01/scenes", message: "Drawing the keeper beside the lighthouse." });
    send("shot.attempt", { shotId: "s01", attempt: 2, errors: 0 });
    send("ai.activity", { message: "OTHER SERIES SENTINEL" }, "unrelated");
    send("stage.awaiting_approval", { key: "bible" });
  });
  await page.locator(".studio-feed .generation-process > summary").click();
  await expect(page.getByRole("log", { name: "Production updates" })).toContainText("Drawing the keeper beside the lighthouse.");
  await expect(page.getByRole("log")).toContainText("s01: checked attempt 2. Shot checks passed.");
  await expect(page.getByRole("log")).not.toContainText("OTHER SERIES SENTINEL");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await expect(page.locator(".generation-live-message")).toContainText("Drawing the keeper");
  await expect(page.locator(".studio-feed-working > svg")).toBeVisible();
  const productionUpdates = async (count) => app.evaluate(({ BrowserWindow }, count) => {
    const f = globalThis.__developmentFixture;
    for (let i = 0; i < count; i++) BrowserWindow.getAllWindows()[0].webContents.send("moco:engine", {
      type: "ai.activity", seriesId: f.state.series.id, at: new Date().toISOString(),
      data: { key: "ep-01/scenes", message: `Production update ${i}: Refining the lighthouse artwork.` },
    });
  }, count);
  await productionUpdates(20);
  await page.getByLabel("Review direction").fill("Keep the lighthouse visible in every scene.");
  await page.getByRole("button", { name: "Save production note", exact: true }).click();
  await expect(page.getByText("Your direction · queued for the next review", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("moco.production-direction.development-ui") ?? "[]").length)).toBe(1);
  await page.getByLabel("Review direction").fill("An unfinished thought that survives the next review.");
  await page.locator(".development-scroll").evaluate((e) => { e.scrollTop = 0; });
  await expect(page.getByRole("button", { name: "Latest update" })).toBeVisible();
  await productionUpdates(1);
  assert.ok(await page.locator(".development-scroll").evaluate((e) => e.scrollTop < 10), "production updates must not interrupt reading");
  await page.getByRole("button", { name: "Latest update" }).click();
  await page.screenshot({ path: path.join(artifacts, "04-production-feed.png"), animations: "disabled" });
  const docked = async () => {
    const box = await page.locator(".development-composer").boundingBox();
    const shell = await page.locator(".studio-development").boundingBox();
    assert.ok(
      shell.y + shell.height - box.y - box.height < 35,
      "composer must stay at the bottom of the workspace",
    );
    assert.equal(
      await page
        .locator(".development-scroll")
        .evaluate((e) => getComputedStyle(e).scrollbarWidth),
      "none",
    );
  };
  await docked();
  await expect(page.getByRole("tab", { name: "Episodes & series" })).toHaveCount(0);
  await expect(page.getByText("The episode board", { exact: true })).toBeHidden();
  await page.locator(".generation-project-work > summary").click();
  await expect(
    page.getByText("The episode board", { exact: true }),
  ).toBeVisible();
  await docked();
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    delete f.state.activeJob;
    f.state.stages.push({
      key: "bible",
      status: "awaiting_approval",
      artifactHash: "bible-hash",
      gated: true,
    });
    f.state.next = {
      kind: "waiting",
      key: "bible",
      status: "awaiting_approval",
    };
    const show = {
      logline: "A light in the fog brings two unlikely friends together.",
      tone: "Warm, mysterious, quietly funny.",
      look: {
        palette: [{ token: "ocean", hex: "#416b98", use: "The sea at dusk" }],
      },
      rules: ["Keep the lighthouse visible."],
      rubric: ["Read silhouettes clearly."],
      cast: [
        {
          id: "keeper",
          name: "The keeper",
          role: "Our guide",
          appearance: "A weathered yellow coat.",
          voice: "Warm and thoughtful.",
        },
      ],
      requirements: [
        {
          id: "music",
          text: "Original orchestral score",
          support: "partial",
          reason: "Use the configured soundtrack.",
        },
      ],
    };
    ipcMain.removeHandler("moco:series.artifact");
    ipcMain.handle("moco:series.artifact", (_e, _id, file) =>
      file === "artifacts/series_plan.json"
        ? { data: f.plan }
        : file === "artifacts/show.json"
          ? { data: show }
          : null,
    );
    ipcMain.removeHandler("moco:stages.reject");
    ipcMain.handle("moco:stages.reject", (_e, _id, key, note) => {
      f.calls.push(["reject", key, note]);
      f.state.stages.find((s) => s.key === key).status = "pending";
    });
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await expect(
    page.getByText("A light in the fog brings two unlikely friends together."),
  ).toBeVisible();
  await expect(page.getByLabel("Review direction")).toHaveValue("An unfinished thought that survives the next review.");
  await expect(page.getByRole("complementary", { name: "Review & approve", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Apply notes & revise", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apply notes & revise", exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__developmentFixture.calls.some(c => c[0] === "reject" && c[1] === "bible" && c[2] === "Keep the lighthouse visible in every scene."))).toBe(true);
  await expect(page.getByLabel("Review direction")).toHaveValue("An unfinished thought that survives the next review.");
  await expect(page.getByRole("button", { name: "Clear queued notes", exact: true })).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    delete f.state.activeJob;
    f.state.stages.find(s => s.key === "bible").status = "awaiting_approval";
    f.state.next = { kind: "waiting", key: "bible", status: "awaiting_approval" };
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await page.getByRole("tab", { name: "Production notes (1)" }).click();
  await expect(
    page.getByText("Original orchestral score", { exact: true }),
  ).toBeVisible();
  await docked();
  await page.screenshot({ path: path.join(artifacts, "03-bible-review.png") });
  await page
    .getByRole("button", { name: "Ask for changes", exact: true })
    .click();
  await expect(page.getByLabel("Review direction")).toBeFocused();
  await page.getByLabel("Review direction").fill("Make the sea a deeper blue.");
  await page.getByRole("button", { name: "Send review changes" }).click();
  await expect
    .poll(() =>
      app.evaluate(() =>
        globalThis.__developmentFixture.calls.some(
          (c) =>
            c[0] === "reject" &&
            c[1] === "bible" &&
            c[2] === "Make the sea a deeper blue.",
        ),
      ),
    )
    .toBe(true);
  await docked();
  await expect(page.getByRole("button", { name: "Clear queued notes", exact: true })).toHaveCount(0);
  for (const step of ["script", "sample", "preview"]) {
    await app.evaluate(({ ipcMain, BrowserWindow }, step) => {
      const f = globalThis.__developmentFixture;
      if (step === "script") f.state.decisions.push({ category: "send_back", subject: "ep-01", detail: "The narration runs 24.2 s but the target is 30 s. Add about 18 words, keeping the story beats.", at: new Date().toISOString() });
      delete f.state.activeJob;
      f.state.stages = f.state.stages.map((s) => ({
        ...s,
        status: "approved",
      }));
      f.state.stages.push({
        key: `ep-01/${step}`,
        status: "awaiting_approval",
        artifactHash: `${step}-hash`,
        gated: true,
      });
      f.state.next = {
        kind: "waiting",
        key: `ep-01/${step}`,
        status: "awaiting_approval",
      };
      ipcMain.removeHandler("moco:series.artifact");
      ipcMain.handle("moco:series.artifact", (_e, _id, file) =>
        file === "artifacts/series_plan.json"
          ? { data: f.plan }
          : file.endsWith("script.json")
            ? {
                data: {
                  lines: [
                    {
                      id: "line-01",
                      beat: "opening",
                      speaker: "narrator",
                      text: "The light cuts through the fog.",
                    },
                  ],
                },
              }
            : null,
      );
      ipcMain.removeHandler("moco:episode.media");
      ipcMain.handle("moco:episode.media", () => ({
        stills: {
          shot01: ["#22354a", "#345f73", "#527f98"].map(color =>
            "data:image/svg+xml," +
              encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="${color}"/></svg>`,
              ),
          ),
        },
        preview: undefined,
      }));
      ipcMain.removeHandler("moco:stages.approve");
      ipcMain.handle("moco:stages.approve", (_e, _id, key, hash) => {
        f.calls.push(["approve", key, hash]);
        f.state.stages.find((s) => s.key === key).status = "approved";
      });
      BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
    }, step);
    await expect(page.locator(".studio-review")).toBeVisible();
    await expect(
      page.locator(".studio-review [data-slot=card-title]"),
    ).toContainText(step === "sample" ? "sample" : step);
    if (step === "script") {
      await expect(page.getByText("Narration timing adjustment", { exact: true })).toBeVisible();
      await expect(page.getByText("Review the revised script before the next recording. Artwork waits for your approval.", { exact: true })).toBeVisible();
      await expect(page.locator(".studio-review").getByText(/The narration runs 24.2 s/)).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const f = globalThis.__developmentFixture;
        f.state.decisions.push({ category: "feedback", subject: "ep-01/script", detail: "Keep the opening question.", at: new Date().toISOString() });
        BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
      });
      await expect(page.getByText("Narration timing adjustment", { exact: true })).toHaveCount(0);
    } else await expect(page.getByText("Narration timing adjustment", { exact: true })).toHaveCount(0);
    if (step === "sample") {
      const frames = page.getByRole("region", { name: "Sample frames", exact: true });
      await expect(frames.getByRole("button", { name: "Previous sample frame" })).toBeDisabled();
      await frames.getByRole("button", { name: "Next sample frame" }).click();
      await expect(frames.getByText("Sample 2 of 3", { exact: true })).toBeVisible();
      await frames.getByRole("slider", { name: "Choose sample frame" }).press("End");
      await expect(frames.getByRole("button", { name: "Next sample frame" })).toBeDisabled();
      await frames.getByRole("slider", { name: "Choose sample frame" }).press("Home");
      await frames.getByRole("button", { name: "Enlarge sample frame" }).click();
      const enlarged = page.getByRole("dialog", { name: "Sample shot", exact: true });
      await expect(enlarged.getByRole("img", { name: "Enlarged sample frame 1 of 3" })).toBeVisible();
      await enlarged.getByRole("button", { name: "Next sample frame" }).click();
      await expect(enlarged.getByText("Sample 2 of 3", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(enlarged).toBeHidden();
      await expect(frames.getByText("Sample 2 of 3", { exact: true })).toBeVisible();
    }
    await docked();
    if (step === "preview")
      await expect(
        page.getByRole("button", { name: "Approve", exact: true }),
      ).toBeDisabled();
    else {
      await expect(
        page.getByRole("button", { name: "Approve", exact: true }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect
        .poll(() =>
          app.evaluate(
            (_electron, step) =>
              globalThis.__developmentFixture.calls.some(
                (c) =>
                  c[0] === "approve" &&
                  c[1] === `ep-01/${step}` &&
                  c[2] === `${step}-hash`,
              ),
            step,
          ),
        )
        .toBe(true);
    }
  }
  // A saved preview must expose unresolved visual checks before export approval.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    f.state.stages.find(s => s.key === "ep-01/preview").artifactHash = "flagged-preview-hash";
    ipcMain.removeHandler("moco:series.artifact");
    ipcMain.handle("moco:series.artifact", (_e, _id, file) => file === "artifacts/series_plan.json" ? { data: f.plan }
      : file.endsWith("critique.json") ? new Promise(resolve => {
        globalThis.__resolvePreviewCritique = () => resolve({ data: { quality: { status: "needs_attention", unresolved: ["s01: Make the pointing direction clear."] } } });
      }) : null);
    ipcMain.removeHandler("moco:episode.media");
    ipcMain.handle("moco:episode.media", () => ({ preview: "data:video/mp4;base64,", stills: {} }));
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await expect.poll(() => app.evaluate(() => typeof globalThis.__resolvePreviewCritique)).toBe("function");
  await expect(page.locator(".studio-review video")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await app.evaluate(() => globalThis.__resolvePreviewCritique());
  await expect(page.getByText("Visual review needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText("s01: Make the pointing direction clear.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review saved shots", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await page.screenshot({
    path: path.join(artifacts, "03-production-review.png"),
  });
  await app.evaluate(({ BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    delete f.state.activeJob;
    f.state.stages = f.state.stages.map((s) => ({ ...s, status: "approved" }));
    f.state.next = { kind: "finished" };
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await expect(
    page.getByRole("heading", { name: "Your story is ready." }),
  ).toBeVisible();
  await docked();
  await page.getByRole("button", { name: "Explore episodes" }).click();
  await expect(
    page.getByText("The episode board", { exact: true }),
  ).toBeVisible();
  // Live shots arrive independently; finished work moves out of the live status line.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    f.state.activeJob = { id: "shots-job", status: "running", startedAt: new Date().toISOString(), kind: "stage", target: "ep-01/scenes", stagesRun: [] };
    f.state.stages.push({ key: "ep-01/shot_list", status: "done", artifactHash: "shots-hash" }, { key: "ep-01/scenes", status: "running" });
    f.state.next = { kind: "waiting", key: "ep-01/scenes", status: "running" };
    ipcMain.removeHandler("moco:series.artifact");
    ipcMain.handle("moco:series.artifact", (_e, _id, file) => file === "artifacts/series_plan.json" ? { data: f.plan }
      : file.endsWith("shot_list.json") ? { data: { shots: [{ id: "s01", intent: "The lighthouse at dusk." }, { id: "s02", intent: "The serpent arrives." }] } } : null);
    ipcMain.removeHandler("moco:episode.media");
    ipcMain.handle("moco:episode.media", () => ({ stills: { s01: ["data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#273e50"/></svg>')] } }));
    const send = (type, data) => BrowserWindow.getAllWindows()[0].webContents.send("moco:engine", { type, seriesId: f.state.series.id, at: new Date().toISOString(), data: { key: "ep-01/scenes", episodeId: "ep-01", ...data } });
    send("shot.started", { shotId: "s01" });
    send("shot.started", { shotId: "s02" });
    send("ai.activity", { shotId: "s02", message: "Animating the serpent's arrival." });
    send("shot.done", { shotId: "s01", fallback: false });
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await expect(page.getByRole("region", { name: "Shot progress" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Shot progress" })).toContainText("1 / 2 saved");
  await expect(page.getByLabel("Shot saved", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Creating shot", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("img", { name: "Shot 1: The lighthouse at dusk.", exact: true })).toBeVisible();
  await expect(page.locator(".generation-live-message")).toContainText("Animating the serpent's arrival.");
  await page.locator(".studio-feed .generation-process").evaluate(e => { e.open = false; });
  await page.locator(".studio-feed").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, "04-live-shots.png"), animations: "disabled" });
  // A targeted repair keeps Visuals active even when the next ordinary stage is Preview.
  await app.evaluate(({ BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    f.state.activeJob = { ...f.state.activeJob, kind: "shot", target: "ep-01/shots/s02" };
    f.state.stages = f.state.stages.map(s => ({ ...s, status: s.key === "ep-01/scenes" ? "done" : s.status }));
    f.state.next = { kind: "run", key: "ep-01/preview" };
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await expect(page.getByRole("button", { name: "Production progress", exact: true })).toContainText("Visuals");
  await expect(page.getByRole("heading", { name: "Episode 1 scenes", exact: true })).toBeVisible();
  await expect(page.locator(".studio-feed-working")).toContainText("Episode 1 scenes");
  await expect(page.getByRole("region", { name: "Shot progress" })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    delete f.state.activeJob;
    f.state.stages = f.state.stages.map(s => ({ ...s, status: s.key === "ep-01/scenes" ? "done" : s.status }));
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  // A delivered episode opens publishing help; merely viewing it never starts episode two.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    f.state.stages.push({ key: "ep-01/final", status: "done", artifactHash: "final-hash", gated: false });
    f.state.next = { kind: "run", key: "ep-02/script" };
    ipcMain.removeHandler("moco:series.artifact");
    ipcMain.handle("moco:series.artifact", (_e, _id, file) => file === "artifacts/series_plan.json" ? { data: f.plan }
      : file.endsWith("publish.json") ? { meta: { contentHash: "publish-hash" }, data: { youtube: { title: "A light in the fog", description: "A new story. #shorts", tags: ["animation"], language: "en", madeForKids: false, category: "Entertainment" } } }
      : file.endsWith("shot_list.json") ? { data: { shots: [{ id: "s01", intent: "The lighthouse at dusk." }] } } : null);
    ipcMain.removeHandler("moco:episode.media");
    ipcMain.handle("moco:episode.media", () => ({ final: "data:video/mp4;base64,", finalPath: "C:/fixture/final.mp4", stills: {} }));
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  const runsBeforeDelivery = await app.evaluate(() => globalThis.__developmentFixture.calls.filter(c => c[0] === "run").length);
  await expect(page.getByRole("complementary", { name: "Publish your video", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start episode 2", exact: true })).toBeInViewport();
  await expect(page.getByLabel("Finished episode", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Upload the video/ })).toBeVisible();
  assert.equal(await app.evaluate(() => globalThis.__developmentFixture.calls.filter(c => c[0] === "run").length), runsBeforeDelivery);
  await page.setViewportSize({ width: 1120, height: 720 });
  await expect(page.getByRole("button", { name: "Start episode 2", exact: true })).toBeInViewport();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
  await page.screenshot({ path: path.join(artifacts, "05-publishing-sidebar.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Start episode 2", exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__developmentFixture.calls.filter(c => c[0] === "run").length)).toBe(runsBeforeDelivery + 1);
  const calls = await app.evaluate(() => globalThis.__developmentFixture.calls);
  assert.ok(
    calls.some((c) => c[0] === "approve" && c[2] === "plan-hash"),
    "approval must use the reviewed artifact hash",
  );
  // Failed visual review must not hide the existing single-shot repair controls.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const f = globalThis.__developmentFixture;
    delete f.state.activeJob;
    f.state.series.production = { mode: "artist", format: { width: 1080, height: 1920, fps: 60 } };
    f.state.stages = [
      { key: "series_plan", status: "approved" }, { key: "bible", status: "approved" },
      { key: "ep-01/script", status: "approved" }, { key: "ep-01/voiceover", status: "done" },
      { key: "ep-01/shot_list", status: "done" },
      { key: "ep-01/scenes", status: "failed", error: { code: "validation_failed", message: "Visual review needs attention: s01 gaze." } },
    ];
    f.state.next = { kind: "waiting", key: "ep-01/scenes", status: "failed" };
    f.state.jobs = [];
    f.recoverySaved = false;
    ipcMain.removeHandler("moco:series.artifact");
    ipcMain.handle("moco:series.artifact", (_e, _id, file) => file === "artifacts/series_plan.json" ? { data: f.plan }
      : file.endsWith("shot_list.json") ? { data: { shots: [{ id: "s01", start: 0, end: 5, lineIds: ["l01"], intent: "Point to the booth.", characters: [], location: "booth" }] } } : null);
    ipcMain.removeHandler("moco:episode.media");
    ipcMain.handle("moco:episode.media", () => ({ stills: {}, savedShots: f.recoverySaved ? ["s01"] : [] }));
    ipcMain.removeHandler("moco:episode.regenerateShot");
    ipcMain.handle("moco:episode.regenerateShot", (_e, ...args) => { f.calls.push(["regenerate", ...args]); return "repair-job"; });
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await page.getByRole("button", { name: "Review saved shots", exact: true }).click();
  await expect(page.getByLabel("Redo this shot", { exact: true })).toBeDisabled();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__developmentFixture.recoverySaved = true;
    BrowserWindow.getAllWindows()[0].webContents.send("moco:library", {});
  });
  await expect(page.getByLabel("Redo this shot", { exact: true })).toBeEnabled();
  await expect(page.getByText("All shots are saved. Repair this shot and Moco will recheck the cut. Final export still requires a passing review.", { exact: true })).toBeVisible();
  await page.getByLabel("Redo this shot", { exact: true }).fill("Point toward the booth.");
  await page.getByRole("button", { name: "Redo shot", exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__developmentFixture.calls.filter(c => c[0] === "regenerate").length)).toBe(1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS studio themes, compact layout, all review sidebars, queued direction, live task and shot progress, publishing sidebar, and explicit episode continuation",
  );
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: path.join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
