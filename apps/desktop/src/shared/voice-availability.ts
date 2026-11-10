import type { Settings, VoiceInfo, VoiceModelId, VoiceModelStatus } from "./api.ts";
import { elevenLabsSupports } from "@moco/audio/elevenlabs-config";

// Languages supported by the installed chatterbox-tts 0.1.7 multilingual worker.
const CHATTERBOX_LANGUAGES = new Set(["ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"]);
const codeOf = (language: string) => language.toLowerCase().split(/[-_]/)[0]!;
export function modelForLanguage(language: string): VoiceModelId {
  return codeOf(language) === "en" ? "english" : "multilingual";
}

/** A short actionable reason, or undefined when the selected engine can speak the language. */
export function voiceLanguageProblem(language: string, voice: Settings["voice"], voices: VoiceInfo[] | null, models: VoiceModelStatus[] | null): string | undefined {
  const code = codeOf(language);
  if (voice.backend === "elevenlabs") {
    if (!voice.elevenlabs?.hasApiKey) return "add your ElevenLabs API key";
    if (!voice.elevenlabs.voiceId?.trim()) return "choose an ElevenLabs voice";
    return elevenLabsSupports(language) ? undefined : "not supported by ElevenLabs Multilingual v2";
  }
  if (voice.backend !== "chatterbox") {
    // Unknown OS voice availability should not block the OS default.
    return voices?.length && !voices.some((speaker) => codeOf(speaker.locale) === code) ? "no system voice installed" : undefined;
  }
  if (!CHATTERBOX_LANGUAGES.has(code)) return "not supported by Chatterbox";
  if (models === null) return "checking voice models";
  const model = modelForLanguage(language);
  return models.some((entry) => entry.id === model && entry.state === "ready") ? undefined : `download ${model === "english" ? "English" : "Multilingual"} voice model`;
}
