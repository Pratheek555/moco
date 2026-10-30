// End-to-end check of the real app: type an idea, approve every review, get a final MP4.
// Uses the Claude Code on this computer (about 20–40 calls for one episode) and renders with Remotion.
//   pnpm --filter @moco/desktop build && pnpm test:desktop
// Screenshots of every review land in artifacts/desktop/. MOCO_SMOKE_IDEA picks the idea.
import { _electron as electron, expect } from "@playwright/test";
import { getVideoMetadata } from "@remotion/renderer";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const workspace = await mkdtemp(path.join(os.tmpdir(), "moco-desktop-"));
const userData = path.join(workspace, "profile");
const projects = path.join(workspace, "projects");
const artifacts = path.join(root, "artifacts", "desktop");
const idea = process.env.MOCO_SMOKE_IDEA ?? "Krishna tells a frightened Arjuna to stand up and do his duty on the battlefield of Kurukshetra";
const MINUTES = 60_000;
await mkdir(userData, { recursive: true });
await mkdir(artifacts, { recursive: true });
await writeFile(path.join(userData, "settings.json"), JSON.stringify({ theme: "light", projectsDir: projects, onboarded: true }));

const env = { ...process.env, MOCO_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60_000 });
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

  await expect(page.getByRole("heading", { name: /Small idea/ })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(artifacts, "01-studio.png") });
  console.log(`PASS studio opens (${elapsed()})`);

  const info = await page.evaluate(() => window.moco.app.info());
  assert.equal(path.resolve(info.projectsDir), projects);
  const ai = await page.evaluate(() => window.moco.ai.status());
  assert.ok(ai.ok, `Claude Code is not ready: ${ai.reason}`);
  console.log(`PASS Claude Code ${ai.version} ready`);

  // The prompt.
  await page.getByLabel("Your story idea").fill(idea);
  await page.getByRole("button", { name: /Create series/ }).click();
  await expect(page.getByText("The episode board")).toBeVisible({ timeout: 30_000 });
  console.log(`PASS series created from the idea (${elapsed()})`);

  // Approve each review as it comes up, until every episode is rendered.
  const review = page.getByRole("region", { name: "Review" });
  const finished = page.getByText("Every episode is rendered");
  const failed = page.getByText(/ failed: /);
  for (let gate = 1; gate <= 8; gate += 1) {
    await expect(review.or(finished).or(failed).first()).toBeVisible({ timeout: 25 * MINUTES });
    if (await failed.isVisible()) throw new Error(`a stage failed: ${await failed.textContent()}`);
    if (await finished.isVisible()) break;
    const title = (await review.locator(".composer-title span").first().textContent())?.replace("Your review: ", "").trim();
    await page.screenshot({ path: path.join(artifacts, `0${gate + 1}-review-${title?.replace(/\W+/g, "-").toLowerCase()}.png`), fullPage: true });
    console.log(`PASS review ${gate}: ${title} (${elapsed()})`);
    await review.getByRole("button", { name: "Approve" }).click();
    await expect(review).toBeHidden({ timeout: 60_000 });
  }
  await expect(finished).toBeVisible({ timeout: 25 * MINUTES });
  console.log(`PASS every stage approved and rendered (${elapsed()})`);

  // The episode page plays the final render.
  await page.locator(".episode-row").first().click();
  await expect(page.getByText("FINAL RENDER")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(artifacts, "09-episode.png") });

  const [seriesId] = (await readdir(projects)).filter((name) => !name.startsWith("."));
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
} finally {
  await app.close();
}
