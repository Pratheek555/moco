// End-to-end check of the real app: type an idea, approve every review, get a final MP4.
// Uses the Claude Code on this computer (about 20–40 calls for one episode) and renders with Remotion.
//   pnpm --filter @moco/desktop build && pnpm test:desktop
// Screenshots of every review land in artifacts/desktop/. MOCO_SMOKE_IDEA picks the idea, MOCO_SMOKE_LANGUAGE the
// language, and MOCO_SMOKE_NOTE is asked for once at the preview review (that rewrites every shot, so more calls).
// To watch it make a real series instead: MOCO_SMOKE_PROFILE=real uses your own app profile (voice, projects folder),
// MOCO_SMOKE_PAUSE=<seconds> holds each review on screen before approving it, and MOCO_SMOKE_KEEP_OPEN=1 leaves the
// app open at the end until you close its window. MOCO_SMOKE_RESUME=<series id> carries on with a series already in
// that projects folder instead of starting one. You can approve or redo a review yourself while it waits.
import { _electron as electron, expect } from "@playwright/test";
import { getVideoMetadata } from "@remotion/renderer";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const realProfile = process.env.MOCO_SMOKE_PROFILE === "real";
const pause = Number(process.env.MOCO_SMOKE_PAUSE ?? 0) * 1000;
const workspace = await mkdtemp(path.join(os.tmpdir(), "moco-desktop-"));
const userData = path.join(workspace, "profile");
let projects = path.join(workspace, "projects");
const artifacts = path.join(root, "artifacts", "desktop");
const idea = process.env.MOCO_SMOKE_IDEA ?? "Krishna tells a frightened Arjuna to stand up and do his duty on the battlefield of Kurukshetra";
const language = process.env.MOCO_SMOKE_LANGUAGE ?? "English"; // the name at the end of the option, e.g. "Hindi"
let note = process.env.MOCO_SMOKE_NOTE;
const MINUTES = 60_000;
await mkdir(userData, { recursive: true });
await mkdir(artifacts, { recursive: true });
if (!realProfile) await writeFile(path.join(userData, "settings.json"), JSON.stringify({ theme: "light", projectsDir: projects, onboarded: true }));

const env = realProfile ? { ...process.env } : { ...process.env, MOCO_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const debugPort = process.env.MOCO_SMOKE_DEBUG_PORT;
const app = await electron.launch({ args: [desktop, ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : [])], cwd: desktop, env, timeout: 60_000 });
const errors = [];
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
try {
  app.process().stdout.on("data", (d) => process.stdout.write(String(d)));
  app.process().stderr.on("data", (d) => process.stderr.write(String(d)));
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await expect(page.getByRole("heading", { name: "What would you like to explain?" })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(artifacts, "01-studio.png") });
  console.log(`PASS studio opens (${elapsed()})`);

  const info = await page.evaluate(() => window.moco.app.info());
  if (realProfile) projects = path.resolve(info.projectsDir);
  assert.equal(path.resolve(info.projectsDir), projects);
  const before = new Set(existsSync(projects) ? await readdir(projects) : []);
  const ai = await page.evaluate(() => window.moco.ai.status());
  assert.ok(ai.ok, `AI CLI is not ready: ${ai.reason}`);
  console.log(`PASS AI CLI ${ai.version} ready`);

  const voices = await page.evaluate(() => window.moco.voice.list());
  assert.equal(new Set(voices.map((voice) => voice.id)).size, voices.length, "a voice is listed twice");

  const resume = process.env.MOCO_SMOKE_RESUME;
  if (resume) {
    // Open the series from its card on the studio page, and start whatever comes next.
    const plan = JSON.parse(await readFile(path.join(projects, resume, "artifacts", "series_plan.json"), "utf8"));
    before.delete(resume);
    await page.getByRole("button", { name: plan.data.title, exact: true }).first().click();
    await expect(page.getByText("The episode board")).toBeVisible({ timeout: 30_000 });
    const carryOn = page.getByRole("button", { name: /^(Continue:|Try again)/ }).first();
    if (await carryOn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await carryOn.click();
      // The old failure stays on screen until the new run starts; don't mistake it for a new one.
      await expect(page.getByRole("alert").filter({ hasText: / failed/ })).toBeHidden({ timeout: 60_000 });
    }
    console.log(`PASS resumed ${resume} (${elapsed()})`);
  } else {
    // Keep this older kit/world smoke run explicit; the default is now an explainer.
    await page.getByRole("button", { name: "Story options", exact: true }).click();
    await page.getByLabel("Visual approach").click();
    await page.getByRole("option", { name: "Animation & 3D", exact: true }).click();
    if (language !== "English") {
      await page.getByLabel("Story language").click();
      await page.getByRole("option", { name: new RegExp(`${language}$`) }).click();
    }
    await page.getByRole("button", { name: "Done", exact: true }).click();
    // The prompt.
    await page.getByLabel("What story will you tell?").fill(idea);
    await page.getByRole("button", { name: /Create series/ }).click();
    await expect(page.getByText("The episode board")).toBeVisible({ timeout: 30_000 });
    console.log(`PASS series created from the idea (${elapsed()})`);
  }

  // Approve each review as it comes up, until every episode is rendered.
  const review = page.getByRole("region", { name: "Review" });
  const finished = page.getByText("Every episode is rendered");
  const failed = page.getByRole("alert").filter({ hasText: / failed/ });
  for (let gate = 1; gate <= 9; gate += 1) {
    await expect(review.or(finished).or(failed).first()).toBeVisible({ timeout: 25 * MINUTES });
    if (await failed.isVisible()) throw new Error(`a stage failed: ${await failed.textContent()}`);
    if (await finished.isVisible()) break;
    const title = (await review.locator("[data-slot=card-title]").first().textContent())?.replace(/^Review (the )?/, "").trim();
    await page.screenshot({ path: path.join(artifacts, `0${gate + 1}-review-${title?.replace(/\W+/g, "-").toLowerCase()}.png`), fullPage: true });
    console.log(`PASS review ${gate}: ${title} (${elapsed()})`);
    // A notification under the mouse stays hovered and can cover the approval controls.
    // Move away before the review pause so the normal toast expiry can run.
    await page.mouse.move(260, 72);
    if (pause) await page.waitForTimeout(pause);
    // Approved or sent back by hand while it waited: carry on from wherever that left it.
    if (!(await review.isVisible())) continue;
    if (note && title?.endsWith("preview")) {
      await review.getByRole("button", { name: "Ask for changes" }).click();
      await review.getByLabel("What should change").fill(note);
      await review.getByRole("button", { name: "Redo with my note" }).click();
      await expect(review).toBeHidden({ timeout: 60_000 });
      note = undefined;
      continue;
    }
    await review.getByRole("button", { name: "Approve", exact: true }).click({ timeout: 15_000 }).catch(async (error) => {
      // The user may approve while the driver is moving to the button.
      if (await review.isVisible()) throw error;
    });
    await expect(review).toBeHidden({ timeout: 60_000 });
  }
  await expect(finished).toBeVisible({ timeout: 25 * MINUTES });
  console.log(`PASS every stage approved and rendered (${elapsed()})`);

  // The episode page plays the final render.
  await page.getByRole("list", { name: "Episodes" }).getByRole("button").first().click();
  await expect(page.getByText("Final render", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(artifacts, "09-episode.png") });

  const [seriesId] = (await readdir(projects)).filter((name) => !name.startsWith(".") && !before.has(name));
  const final = path.join(projects, seriesId, "episodes", "ep-01", "renders", "final.mp4");
  assert.ok(existsSync(final), `no final render at ${final}`);
  const video = await getVideoMetadata(final);
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.ok(video.durationInSeconds >= 10, `final is only ${video.durationInSeconds}s`);
  console.log(`PASS final.mp4 ${video.width}×${video.height}, ${video.durationInSeconds.toFixed(1)} s (${elapsed()})`);
  console.log(`FINAL ${final}`);

  assert.deepEqual(errors, [], "the UI logged errors");
  console.log("PASS no UI errors");
  if (process.env.MOCO_SMOKE_KEEP_OPEN) {
    console.log("The app stays open; close its window to finish.");
    await app.waitForEvent("close", { timeout: 0 });
  }
} finally {
  await app.close();
}
