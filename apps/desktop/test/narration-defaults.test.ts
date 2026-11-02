import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "C:/MocoTest" } }));
import { defaultSettings } from "../src/main/settings.ts";
import { narrationAudio } from "../src/main/narration.ts";
import { voiceRuntimePaths } from "../src/main/voice-models.ts";

it("uses system narration for new and legacy settings", async () => {
  expect(defaultSettings().voice.backend).toBe("system");
  const port = narrationAudio({ voice: "", rate: 1 }, voiceRuntimePaths("missing", "missing"));
  await expect(port.align()).rejects.toThrow(/system voices/);
});

it("refuses neural synthesis before explicit model installation", async () => {
  const port = narrationAudio({ backend: "chatterbox", voice: "", rate: 1 }, voiceRuntimePaths("missing", "missing"));
  await expect(port.tts([{ id: "a", text: "Hello." }], { voiceId: "narrator", backend: "chatterbox" }, "en", "missing")).rejects.toThrow(/Download.*Settings/);
});
