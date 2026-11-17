// Google's 30 prebuilt studio voices: https://ai.google.dev/gemini-api/docs/speech-generation#voices
export const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;
export type GeminiVoice = typeof GEMINI_VOICES[number];
export const DEFAULT_GEMINI_VOICE: GeminiVoice = "Charon";
export interface NarrationStatus {
  keySet: boolean;
  voice: GeminiVoice;
  encryptionAvailable: boolean;
  encryptionReason?: string;
  unreadable: boolean;
}
export interface KeyCheck {
  outcome: "accepted" | "rejected" | "network" | "unexpected";
  message: string;
  /** Listing is only advisory; absence can mean pagination or access differences. */
  ttsModelListed?: boolean;
}
