// Re-runs stages of an existing series in the real app, on a copy, the way it happens after a renderer or engine
// update: the stages are marked stale and the app runs them again up to the preview review.
//   pnpm --filter @moco/desktop build && node scripts/rerender-test.mjs <series dir> <out dir> [stages=preview]
// `stages` is a comma list of episode stages, e.g. "scenes,preview" (scenes reuses up-to-date shots, then the AI
// reviews the cut). Leaves <out dir>/preview.mp4, a screenshot of the review and the decisions the engine logged.
import { _electron as electron, expect } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [source, outDir, stages = "preview"] = process.argv.slice(2);
if (!source || !outDir) throw new Error("usage: node scripts/rerender-test.mjs <series dir> <out dir>");
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await mkdtemp(path.join(os.tmpdir(), "moco-rerender-"));
const userData = path.join(workspace, "profile");
const projects = path.join(workspace, "projects");
const id = path.basename(source);
const copy = path.join(projects, id);
await mkdir(userData, { recursive: true });
await mkdir(outDir, { recursive: true });
await cp(source, copy, { recursive: true });

// The stages go stale, as if the renderer or engine changed under them.
const ledgerFile = path.join(copy, "ledger.json");
const ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
const decisionsBefore = ledger.decisions.length;
for (const [key, stage] of Object.entries(ledger.stages)) if (stages.split(",").some((name) => key.endsWith(`/${name}`))) stage.status = "stale";
await writeFile(ledgerFile, JSON.stringify(ledger, null, 2));
// Learned templates the series may use come from the real profile too.
await cp(path.join(process.env.APPDATA, "Moco", "styles"), path.join(userData, "styles"), { recursive: true }).catch(() => undefined);
// The voice settings of the real profile, so narration matches; the projects folder is the copy.
const settings = JSON.parse(await readFile(path.join(process.env.APPDATA, "Moco", "settings.json"), "utf8").catch(() => "{}"));
await writeFile(path.join(userData, "settings.json"), JSON.stringify({ ...settings, theme: "light", projectsDir: projects, onboarded: true }));

const env = { ...process.env, MOCO_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [desktop], cwd: desktop, env, timeout: 60_000 });
const started = Date.now();
try {
  app.process().stderr.on("data", (d) => process.stderr.write(String(d)));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const series = (await page.evaluate(() => window.moco.series.list())).find((item) => item.id === id);
  if (!series) throw new Error(`the app doesn't list ${id}`);
  // Open the series the way a user would, then run what's next (the stale preview).
  await page.getByText(series.title, { exact: true }).first().click();
  await page.evaluate((seriesId) => window.moco.stages.run(seriesId), id);
  const review = page.getByRole("region", { name: "Review" });
  const failed = page.getByRole("alert").filter({ hasText: / failed/ });
  await expect(review.or(failed).first()).toBeVisible({ timeout: 90 * 60_000 });
  if (await failed.isVisible()) throw new Error(`render failed: ${await failed.textContent()}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "app-review.png"), fullPage: true });
  await copyFile(path.join(copy, "episodes", "ep-01", "renders", "preview.mp4"), path.join(outDir, "preview.mp4"));
  const after = JSON.parse(await readFile(ledgerFile, "utf8"));
  await writeFile(path.join(outDir, "decisions.json"), JSON.stringify(after.decisions.slice(decisionsBefore), null, 2));
  console.log(`series copy: ${copy}`);
  console.log(`PASS preview re-rendered in the app in ${Math.round((Date.now() - started) / 1000)} s → ${path.join(outDir, "preview.mp4")}`);
} finally {
  await app.close();
}
