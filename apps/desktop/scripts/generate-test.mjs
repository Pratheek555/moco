// Makes one episode from an idea in the real app, approving each review, and stops at the preview review.
// Uses the Claude Code on this computer (a world plus one episode: about 40–70 calls) and the real profile's voice
// settings and learned templates, in a throwaway workspace.
//   pnpm --filter @moco/desktop build && node scripts/generate-test.mjs <out dir> "<idea>" [template]
//   MOCO_RESUME=<workspace from an earlier run> node scripts/generate-test.mjs <out dir> — carries on that series.
// MOCO_STYLES=<folder> takes the learned templates from there instead of the real profile.
// Leaves <out dir>/preview.mp4, a screenshot of every review, and the decisions the engine logged.
import { _electron as electron, expect } from "@playwright/test";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [outDir, idea, template] = process.argv.slice(2);
if (!outDir || (!idea && !process.env.MOCO_RESUME)) throw new Error('usage: node scripts/generate-test.mjs <out dir> "<idea>" [template]');
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resume = process.env.MOCO_RESUME;
const workspace = resume ?? (await mkdtemp(path.join(os.tmpdir(), "moco-generate-")));
const userData = path.join(workspace, "profile");
const projects = path.join(workspace, "projects");
await mkdir(userData, { recursive: true });
await mkdir(outDir, { recursive: true });
await cp(process.env.MOCO_STYLES ?? path.join(process.env.APPDATA, "Moco", "styles"), path.join(userData, "styles"), { recursive: true, force: true }).catch(() => undefined);
// Downloaded voice models are large: linked, not copied.
await symlink(path.join(process.env.APPDATA, "Moco", "voice"), path.join(userData, "voice"), "junction").catch(() => undefined);
const settings = JSON.parse(await readFile(path.join(process.env.APPDATA, "Moco", "settings.json"), "utf8").catch(() => "{}"));
await writeFile(path.join(userData, "settings.json"), JSON.stringify({ ...settings, theme: "light", projectsDir: projects, onboarded: true }));

const env = { ...process.env, MOCO_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60_000 });
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
try {
  app.process().stderr.on("data", (d) => process.stderr.write(String(d)));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  // What the Create button sends, or the series already there, run on from where it stopped.
  const id = resume ? (await readdir(projects))[0] : await page.evaluate((input) => window.moco.series.create(input), { idea, language: "en", episodes: 1, template });
  console.log(`series ${id} (${elapsed()})`);
  await expect.poll(async () => (await page.evaluate(() => window.moco.series.list())).find((item) => item.id === id)?.title, { timeout: 30 * 60_000 }).toBeTruthy();
  const title = (await page.evaluate(() => window.moco.series.list())).find((item) => item.id === id).title;
  await page.getByText(title, { exact: true }).first().click();
  if (resume) await page.evaluate((seriesId) => window.moco.stages.run(seriesId), id);

  const review = page.getByRole("region", { name: "Review" });
  const failed = page.getByRole("alert").filter({ hasText: / failed/ });
  for (let gate = 1; gate <= 8; gate += 1) {
    await expect(review.or(failed).first()).toBeVisible({ timeout: 60 * 60_000 });
    if (await failed.isVisible()) throw new Error(`a stage failed: ${await failed.textContent()}`);
    const name = (await review.locator("[data-slot=card-title]").first().textContent())?.replace(/^Review (the )?/, "").trim() ?? `gate ${gate}`;
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `review-${gate}-${name.replace(/\W+/g, "-").toLowerCase()}.png`), fullPage: true });
    console.log(`review ${gate}: ${name} (${elapsed()})`);
    if (name.endsWith("preview")) break;
    await review.getByRole("button", { name: "Approve" }).click();
    await expect(review).toBeHidden({ timeout: 60_000 });
  }
  const dir = path.join(projects, id);
  await copyFile(path.join(dir, "episodes", "ep-01", "renders", "preview.mp4"), path.join(outDir, "preview.mp4"));
  await writeFile(path.join(outDir, "decisions.json"), JSON.stringify(JSON.parse(await readFile(path.join(dir, "ledger.json"), "utf8")).decisions, null, 2));
  console.log(`series folder: ${dir}`);
  console.log(`PASS preview made in the app in ${elapsed()} → ${path.join(outDir, "preview.mp4")}`);
} finally {
  await app.close();
}
