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
