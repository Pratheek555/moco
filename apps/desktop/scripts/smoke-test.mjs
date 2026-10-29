import { _electron as electron, expect } from "@playwright/test";
import { getVideoMetadata } from "@remotion/renderer";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(desktop, "../..");
const workspace = await mkdtemp(path.join(os.tmpdir(), "moco-desktop-"));
const userData = path.join(workspace, "profile");
const projects = path.join(workspace, "projects");
const artifacts = path.join(root, "artifacts", "desktop");
await mkdir(userData, { recursive: true });
await mkdir(artifacts, { recursive: true });
await writeFile(
  path.join(userData, "settings.json"),
  JSON.stringify({
    theme: "light",
    projectsDir: projects,
    render: { quality: "draft", concurrency: 2 },
    ai: { maxRepairs: 0 },
  }),
);
const env = { ...process.env, MOCO_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    ...(process.env.MOCO_TEST_EXECUTABLE
      ? { executablePath: process.env.MOCO_TEST_EXECUTABLE, args: [] }
      : { args: [desktop] }),
    cwd: desktop,
    env,
    timeout: 60000,
  });
let app;
const errors = [];
try {
  app = await launch();
  app.process().stderr.on("data", (d) => {
    const s = String(d);
    if (/Error|\[render\]/.test(s)) process.stderr.write(s);
  });
  app.process().stdout.on("data", (d) => process.stdout.write(String(d)));
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await expect(page.getByRole("heading", { name: /Small idea/ })).toBeVisible({
    timeout: 30000,
  });
  await page.screenshot({
    animations: "disabled",
    path: path.join(artifacts, "studio.png"),
  });
  console.log("PASS studio and preload bridge");
  const info = await page.evaluate(() => window.moco.app.info());
  assert.equal(path.resolve(info.projectsDir), projects);
  const library = await page.evaluate(() => window.moco.series.list());
  assert.equal(library.length, 1, "first launch seeds the demo");
  const id = library[0].id;
  await page.getByRole("button", { name: "My series", exact: true }).click();
  await page.locator(".series-card").first().click();
  await expect(page.getByText("The episode board")).toBeVisible();
  await page.locator(".episode-row").first().click();
  await expect(page.getByLabel("Scene narration")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: path.join(artifacts, "episode.png"),
  });
  await page.getByLabel("Scene narration").fill("Courage begins here.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  const saved = await page.evaluate(
    async (id) => (await window.moco.episode.get(id, 1)).episode,
    id,
  );
  assert.equal(saved.shots[0].narration, "Courage begins here.");
  console.log("PASS episode editing and disk persistence");
  await page.getByRole("button", { name: "Creative kit", exact: true }).click();
  await expect(page.locator(".character-card")).toHaveCount(15);
  const playIcon = await page
    .locator(".preview-art-button svg")
    .first()
    .boundingBox();
  assert(
    playIcon && playIcon.width <= 20 && playIcon.height <= 20,
    "preview icon must not cover the character art",
  );
  await page.screenshot({
    animations: "disabled",
    path: path.join(artifacts, "kit.png"),
  });
  await page.locator(".character-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Quick search", exact: true }).click();
  await page.getByLabel("Search workspace").fill("Settings");
  await page.locator(".palette-results button").click();
  await expect(
    page.getByRole("heading", { name: "Studio settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("dark");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.screenshot({
    animations: "disabled",
    path: path.join(artifacts, "settings-dark.png"),
  });
  await page
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("light");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  console.log("PASS creative kit, command search, and theme settings");
  // Use a short real composition to exercise voice, music, utility-process
  // rendering, local asset serving, and export persistence without an AI call.
  await page.evaluate(
    async ({ id, saved }) => {
      const ep = {
        ...saved,
        shots: [{ ...saved.shots[0], duration: 2, voice: undefined, sfx: [] }],
      };
      await window.moco.episode.save(id, ep);
    },
    { id, saved },
  );
  const voice = await page.evaluate(
    (id) => window.moco.jobs.start({ kind: "voice", seriesId: id, number: 1 }),
    id,
  );
  const waitJob = async (job) => {
    let last = "";
    await expect
      .poll(
        async () => {
          const current = await page.evaluate(
            async (id) =>
              (await window.moco.jobs.list()).find((j) => j.id === id),
            job.id,
          );
          if (current?.stage !== last) {
            last = current?.stage;
            console.log("JOB", current?.kind, last);
          }
          return current?.status;
        },
        { timeout: 240000, intervals: [500, 1000] },
      )
      .toMatch(/^(done|error|canceled)$/);
    const result = await page.evaluate(
      async (id) => (await window.moco.jobs.list()).find((j) => j.id === id),
      job.id,
    );
    assert.equal(result.status, "done", JSON.stringify(result, null, 2));
    return result;
  };
  await waitJob(voice);
  const voiced = await page.evaluate(
    async (id) => await window.moco.episode.get(id, 1),
    id,
  );
  assert(voiced.episode.shots[0].voice?.src);
  const media = await page.evaluate(async (b) => {
    const r = await fetch(b.assetBase + b.episode.shots[0].voice.src);
    return { status: r.status, size: (await r.arrayBuffer()).byteLength };
  }, voiced);
  assert.equal(media.status, 200);
  assert(media.size > 1000);
  console.log("PASS system narration, music, and local audio protocol");
  const render = await page.evaluate(
    (id) => window.moco.jobs.start({ kind: "render", seriesId: id, number: 1 }),
    id,
  );
  const rendered = await waitJob(render);
  assert((await stat(rendered.output)).size > 1000);
  const metadata = await getVideoMetadata(rendered.output);
  assert.equal(metadata.width, 540);
  assert.equal(metadata.height, 960);
  assert.equal(metadata.codec, "h264");
  assert.equal(metadata.audioCodec, "aac");
  console.log("PASS real MP4 export:", rendered.output);
  await page.getByRole("button", { name: "Render queue", exact: true }).click();
  await expect(
    page.getByText("Completed", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: path.join(artifacts, "queue.png"),
  });
  assert.deepEqual(
    errors,
    [],
    "renderer has no uncaught exceptions or console errors",
  );
  await app.close();
  app = null;
  app = await launch();
  const reopened = await app.firstWindow();
  await expect(
    reopened.getByRole("heading", { name: /Small idea/ }),
  ).toBeVisible({ timeout: 30000 });
  const persisted = await reopened.evaluate(
    async (id) => ({
      settings: await window.moco.settings.get(),
      bundle: await window.moco.episode.get(id, 1),
    }),
    id,
  );
  assert.equal(persisted.settings.theme, "light");
  assert.equal(
    persisted.bundle.episode.shots[0].narration,
    "Courage begins here.",
  );
  assert.equal(persisted.bundle.renders.length, 1);
  console.log("PASS restart retains settings, edits, and exports");
  await writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        passed: true,
        packaged: !!process.env.MOCO_TEST_EXECUTABLE,
        workspace,
        output: rendered.output,
        metadata,
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
}
