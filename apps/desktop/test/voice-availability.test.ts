import { expect, it } from "vitest";
import { voiceLanguageProblem } from "../src/shared/voice-availability.ts";
import type { Settings, VoiceModelStatus } from "../src/shared/api.ts";

const neural: Settings["voice"] = { backend: "chatterbox", voice: "", rate: 1 };
const system = { ...neural, backend: "system" as const };
const voices = [{ id: "zira", name: "Zira", locale: "en-US" }];
const models: VoiceModelStatus[] = [{ id: "multilingual", name: "Multilingual", size: "3 GB", state: "ready", progress: 1 }];

it("allows installed Hindi narration even when Windows only has an English voice", () => {
  expect(voiceLanguageProblem("hi", neural, voices, models)).toBeUndefined();
  expect(voiceLanguageProblem("hi-IN", neural, voices, models)).toBeUndefined();
  expect(voiceLanguageProblem("hi", system, voices, models)).toBe("no system voice installed");
});
it("distinguishes missing model downloads from unsupported languages", () => {
  expect(voiceLanguageProblem("en", neural, voices, models)).toBe("download English voice model");
  expect(voiceLanguageProblem("hi", neural, voices, [])).toBe("download Multilingual voice model");
  expect(voiceLanguageProblem("ta", neural, voices, models)).toBe("not supported by Chatterbox");
  expect(voiceLanguageProblem("hi", neural, voices, null)).toBe("checking voice models");
});
it("checks the selected backend rather than the presence of any voice model", () => {
  expect(voiceLanguageProblem("en_US", system, voices, [])).toBeUndefined();
  expect(voiceLanguageProblem("hi", { voice: "", rate: 1 }, voices, models)).toBe("no system voice installed");
  expect(voiceLanguageProblem("hi", system, [], null)).toBeUndefined();
});

it("checks ElevenLabs setup and model language support independently of OS voices and local models", () => {
  const elevenlabs: Settings["voice"] = { backend: "elevenlabs", voice: "", rate: 1, elevenlabs: { hasApiKey: true, voiceId: "cloud-voice" } };
  expect(voiceLanguageProblem("hi-IN", elevenlabs, voices, [])).toBeUndefined();
  expect(voiceLanguageProblem("ta", elevenlabs, voices, null)).toBeUndefined();
  expect(voiceLanguageProblem("te", elevenlabs, voices, models)).toBe("not supported by ElevenLabs Multilingual v2");
  expect(voiceLanguageProblem("en", { ...elevenlabs, elevenlabs: { hasApiKey: false, voiceId: "cloud-voice" } }, voices, models)).toBe("add your ElevenLabs API key");
  expect(voiceLanguageProblem("en", { ...elevenlabs, elevenlabs: { hasApiKey: true } }, voices, models)).toBe("choose an ElevenLabs voice");
});
