export interface Draft { text: string; attachments: string[] }
export const draftKey = (projectId: string) => `moco:project:${projectId}:draft`;

export function readSetting(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeSetting(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* A full or disabled store must not block conversation. */ }
}
export function parseDraft(raw: string | null): Draft {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object") {
      const draft = value as Record<string, unknown>;
      return { text: typeof draft.text === "string" ? draft.text : "", attachments: Array.isArray(draft.attachments) ? [...new Set(draft.attachments.filter((item): item is string => typeof item === "string" && item.startsWith("uploads/")))] : [] };
    }
  } catch { /* Ignore a draft written by an older version or invalid local data. */ }
  return { text: "", attachments: [] };
}
