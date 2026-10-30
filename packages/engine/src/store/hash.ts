// Canonical JSON + sha256, so the same data always hashes the same way.
import { createHash } from "node:crypto";

// Sort object keys at every level; arrays keep their order.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    const isPlainObject = v !== null && typeof v === "object" && !Array.isArray(v);
    if (!isPlainObject) return v;
    const sortedEntries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(sortedEntries);
  });
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hashData(value: unknown): string {
  return sha256(canonicalJson(value));
}
