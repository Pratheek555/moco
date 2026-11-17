import type { KeyCheck } from "../shared/gemini.ts";
import { validateGeminiKey } from "./gemini-settings.ts";

/** Metadata only: no generation, audio, or token usage. Never return Google's raw errors. */
export async function checkGeminiKey(value: unknown, fetcher: typeof fetch = fetch): Promise<KeyCheck> {
  const key = validateGeminiKey(value);
  const signal = AbortSignal.timeout(8_000);
  let response: Response;
  try {
    response = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": key }, signal, redirect: "error",
    });
  } catch { return { outcome: "network", message: "Could not reach Google. Check your connection and try again." }; }
  if ([400, 401, 403].includes(response.status)) return { outcome: "rejected", message: "Google rejected this key. Check the key and its API restrictions." };
  if (!response.ok) return { outcome: "unexpected", message: "Google could not check the key right now. Try again later." };
  try {
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("models" in data) || !Array.isArray(data.models)
      || data.models.some(model => !model || typeof model.name !== "string")) throw new Error();
    const listed = data.models.some(model => model.name === "models/gemini-3.8-flash-tts");
    return { outcome: "accepted", message: listed ? "Key accepted. Gemini Flash TTS is listed." : "Key accepted. Flash TTS was not listed; availability is not confirmed.", ttsModelListed: listed };
  } catch (error) {
    if (signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError", "TypeError"].includes(error.name)))
      return { outcome: "network", message: "Could not read Google's response. Check your connection and try again." };
    return { outcome: "unexpected", message: "Google returned an unexpected response. Try again later." };
  }
}
