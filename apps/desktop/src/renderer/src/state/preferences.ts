import type { Route } from "./app-context.ts";

export function readPreference(key: string): string | null {
  try { return localStorage.getItem(`moco.${key}`); } catch { return null; }
}

export function savePreference(key: string, value: string): void {
  try { localStorage.setItem(`moco.${key}`, value); } catch { /* Preferences are optional. */ }
}

export function savedRoute(): Route {
  try {
    const value: unknown = JSON.parse(readPreference("route") ?? "null");
    if (value && typeof value === "object" && "name" in value) {
      if (value.name === "home" || value.name === "skills") return { name: value.name };
      if (value.name === "project" && "id" in value && typeof value.id === "string") return { name: "project", id: value.id };
    }
  } catch { /* A stale preference should never prevent startup. */ }
  return { name: "home" };
}
