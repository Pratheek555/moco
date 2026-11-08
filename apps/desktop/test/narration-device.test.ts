import { expect, it, vi } from "vitest";
import type { Settings } from "../src/shared/api.ts";
import { chatterboxAudio } from "@moco/audio/chatterbox";
import { narrationAudio, productionNarrationAudio } from "../src/main/narration.ts";

vi.mock("@moco/audio/chatterbox", () => ({
  chatterboxAudio: vi.fn(() => ({ tts: vi.fn(async () => ({ file: "vo.wav", durationSeconds: 1, words: [] })) })),
}));
vi.mock("@moco/audio", async (original) => ({
  ...await original<typeof import("@moco/audio")>(),
  alignedAudio: vi.fn(base => base),
}));
vi.mock("../src/main/voice-models.ts", () => ({
  modelForLanguage: () => "english", modelReady: async () => true,
}));

for (const device of [undefined, "auto", "cpu", "gpu"] as const) {
  it(`uses ${device ?? "legacy automatic"} for both preview and measured production narration`, async () => {
    vi.stubEnv("MOCO_ALIGN_PYTHON", process.execPath);
    try {
      const voice: Settings["voice"] = { backend: "chatterbox", voice: "", rate: 1, device };
      const runtime = { python: "python", modelsDir: "models", workerDir: "workers" };
      const args = [[{ id: "a", text: "Hello." }], { voiceId: "default", backend: "chatterbox" }, "en", "output"] as const;
      const lines = [...args[0]];
      await narrationAudio(voice, runtime).tts(lines, args[1], args[2], args[3]);
      expect(vi.mocked(chatterboxAudio).mock.lastCall?.[0]).toMatchObject({ device: device ?? "auto" });
      await productionNarrationAudio(voice, runtime).ttsMeasured(lines, args[1], args[2], args[3]);
      expect(vi.mocked(chatterboxAudio).mock.lastCall?.[0]).toMatchObject({ device: device ?? "auto" });
    } finally { vi.unstubAllEnvs(); }
  });
}
