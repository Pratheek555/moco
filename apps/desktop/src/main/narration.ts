import type { Project } from "../shared/api.ts";

/** Preference only; the imported skill owns synthesis, setup, and timing. */
export function narrationContext(project: Project, geminiAvailable = false): string {
  const engine = project.narrationEngine;
  if (project.skill.name !== "ink-history" && !geminiAvailable) return "";
  const available = geminiAvailable && !engine ? " A Gemini narration key is available in GEMINI_API_KEY; follow the skill's own instructions and the user's voice choice." : "";
  if (!engine) return "\n\nMoco narration preference: Use story default. Follow the active story's own voice settings and the user's request. Uploaded narration takes precedence." + available;
  const label = { zonos: "Zonos", kokoro: "Kokoro", gemini: "Gemini" }[engine];
  const missing = engine === "gemini" && !geminiAvailable ? " No Moco Gemini key is available; explain that a key must be saved in Settings before using this preference." : "";
  return `\n\nMoco narration preference: ${label} (${engine}) for synthesized narration, unless the user explicitly requests another voice. Uploaded narration takes precedence. Follow the installed skill's own engine instructions; if it lacks support, explain that an updated skill is needed. Changing this preference alone does not request generation.${missing}`;
}
