import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => "C:/MocoTest" } }));
import { defaultSettings } from "../src/main/settings.ts";
import { narrationAudio, productionNarrationAudio } from "../src/main/narration.ts";
import { voiceRuntimePaths } from "../src/main/voice-models.ts";

it("uses system narration for new and legacy settings", async () => {
  expect(defaultSettings().voice.backend).toBe("system");
  expect(defaultSettings().voice.device).toBe("auto");
  const port = narrationAudio({ voice: "", rate: 1 }, voiceRuntimePaths("missing", "missing"));
  await expect(port.align()).rejects.toThrow(/system voices/);
});

it("refuses neural synthesis before explicit model installation", async () => {
  const port = narrationAudio({ backend: "chatterbox", voice: "", rate: 1 }, voiceRuntimePaths("missing", "missing"));
  await expect(port.tts([{ id: "a", text: "Hello." }], { voiceId: "narrator", backend: "chatterbox" }, "en", "missing")).rejects.toThrow(/Download.*Settings/);
});

it("requires an installed local aligner for canvas narration instead of silently estimating words",async()=>{
  vi.stubEnv("MOCO_ALIGN_PYTHON","missing-alignment-runtime/python.exe");
  try {
    const port=productionNarrationAudio({voice:"",rate:1},voiceRuntimePaths("missing","missing"));
    await expect(port.ttsMeasured([{id:"l01",text:"Hello"}],{voiceId:"default",backend:"system"},"en","missing")).rejects.toThrow("Canvas narration needs local word timing");
  } finally {vi.unstubAllEnvs();}
});
