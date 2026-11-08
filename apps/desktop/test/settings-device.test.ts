import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() } }));

it("persists CPU/GPU preferences, retains automatic for old settings, and rejects invalid devices", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moco-device-settings-"));
  vi.mocked(app.getPath).mockReturnValue(dir);
  const { loadSettings, saveSettings } = await import("../src/main/settings.ts");
  expect((await loadSettings()).voice.device).toBe("auto");
  await saveSettings({ voice: { device: "cpu" } });
  expect((await loadSettings()).voice.device).toBe("cpu");
  await saveSettings({ voice: { device: "gpu" } });
  expect(JSON.parse(await readFile(join(dir, "settings.json"), "utf8")).voice.device).toBe("gpu");
  await expect(saveSettings({ voice: { device: "invalid" as "gpu" } })).rejects.toThrow("Choose Automatic, CPU or GPU");
  expect((await loadSettings()).voice.device).toBe("gpu");
});
