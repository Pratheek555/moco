// Eleven Multilingual v2: https://elevenlabs.io/docs/overview/models
export const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const LANGUAGES = new Set(["en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "fil", "pl", "sv", "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "ru"]);

export function elevenLabsSupports(language: string): boolean {
  return LANGUAGES.has(language.toLowerCase().split(/[-_]/)[0]!);
}
