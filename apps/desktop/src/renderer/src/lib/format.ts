export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

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

export const IDEAS = [
  "The Mahabharat in seven reels — from the dice game to Kurukshetra",
  "Hanuman’s leap across the ocean to find Sita",
  "Why Lord Ganesha has an elephant head",
  "Shiva drinks the poison at the churning of the ocean",
  "Karna — the tragic hero who never got his due",
  "Chanakya’s five rules for success",
  "Bal Krishna steals butter in Vrindavan",
  "Draupadi’s vow in the Kuru court",
  "Bhishma’s terrible oath and its price",
  "The Bhagavad Gita, one lesson per reel",
  "Rama breaks Shiva’s bow at Sita’s swayamvar",
  "Shiva and Parvati — the story of Kailash",
];
