// Real Electron/preload/React path, deterministic IPC fixtures; no model calls or renders.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
  await expect(page.getByLabel("What story will you tell?")).toBeVisible();
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const at = new Date().toISOString();
    const state = {
      series: {
        id: "development-ui",
        idea: "A lighthouse keeper and a sea serpent protect a village that fears them both.",
        episodes: 1,
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
    const plan = {
      title: "The light between us",
      premise: "Two outsiders find a friendship worth protecting.",
      language: "en",
      episodes: [
        {
          id: "ep-01",
          title: "A light in the fog",
          synopsis: "An unexpected visitor answers the keeper’s signal.",
        },
      ],
    };
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
  });
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
  await update(18);
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
  await page.screenshot({ path: path.join(artifacts, "02-plan-review.png") });
  await page.getByRole("button", { name: "Approve series plan" }).click();
  await expect(
    page.getByRole("region", { name: "Production studio", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Preparing the next step" }),
  ).toBeVisible();
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
  await page.getByRole("tab", { name: "Episodes & series" }).click();
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
  for (const step of ["script", "sample", "preview"]) {
    await app.evaluate(({ ipcMain, BrowserWindow }, step) => {
      const f = globalThis.__developmentFixture;
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
          shot01: [
            "data:image/svg+xml," +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="#22354a"/></svg>',
              ),
          ],
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
  const calls = await app.evaluate(() => globalThis.__developmentFixture.calls);
  assert.ok(
    calls.some((c) => c[0] === "approve" && c[2] === "plan-hash"),
    "approval must use the reviewed artifact hash",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS all review gates, unavailable-media guard, finished state, bottom dock, and dark creation → live activity → scroll/fade → queued note → stop/resume → revise → review/approve → production",
  );
} finally {
  await app.close();
}
