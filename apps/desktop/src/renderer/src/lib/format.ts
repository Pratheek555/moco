import { api } from "./api.ts";

/** The shortcut modifier as this platform labels it: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD_KEY = api.platform === "darwin" ? "⌘" : "Ctrl";

/** "raise_hand" → "Raise hand", "kurukshetra" → "Kurukshetra". */
export function humanize(id: string) {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function timeAgo(iso?: string | number) {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

export const seconds = (s?: number) =>
  s === undefined
    ? "—"
    : s < 60
      ? `${Math.round(s)}s`
      : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी Hindi" },
  { value: "ta", label: "தமிழ் Tamil" },
  { value: "te", label: "తెలుగు Telugu" },
  { value: "mr", label: "मराठी Marathi" },
  { value: "bn", label: "বাংলা Bengali" },
  { value: "gu", label: "ગુજરાતી Gujarati" },
  { value: "kn", label: "ಕನ್ನಡ Kannada" },
  { value: "ml", label: "മലയാളം Malayalam" },
];

/** "hi" → "Hindi". */
export const languageName = (code: string) =>
  LANGUAGE_OPTIONS.find((option) => option.value === code)?.label.split(" ").at(-1) ?? code.toUpperCase();

// Ideas the kit can animate today: Krishna and Arjuna at Kurukshetra, and motor racing. Widen this as the kit grows.
export const IDEAS = [
  "The Bhagavad Gita, one lesson per reel",
  "Krishna tells a frightened Arjuna to stand up and fight",
  "Arjuna lowers his bow on the battlefield of Kurukshetra",
  "Krishna drives Arjuna’s chariot between the two armies",
  "Krishna explains duty without attachment to the result",
  "Krishna shows Arjuna why the soul can never die",
  "A rookie hunts the champion through one last F1 lap",
];
