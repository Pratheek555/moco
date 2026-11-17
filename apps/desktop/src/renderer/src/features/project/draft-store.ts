import { useCallback, useSyncExternalStore } from "react";
import { draftKey, parseDraft, readSetting, writeSetting, type Draft } from "./storage.ts";

// Async uploads and sends outlive a mounted conversation. Keep their draft owned
// by the project, so navigating away cannot discard completion or restore a sent message.
const entries = new Map<string, { value: Draft; listeners: Set<() => void> }>();
function entry(projectId: string) {
  let current = entries.get(projectId);
  if (!current) {
    current = { value: parseDraft(readSetting(draftKey(projectId))), listeners: new Set() };
    entries.set(projectId, current);
  }
  return current;
}
export function getProjectDraft(projectId: string): Draft { return entry(projectId).value; }
export function updateProjectDraft(projectId: string, update: Draft | ((draft: Draft) => Draft)) {
  const current = entry(projectId);
  current.value = typeof update === "function" ? update(current.value) : update;
  writeSetting(draftKey(projectId), current.value.text || current.value.attachments.length ? JSON.stringify(current.value) : null);
  current.listeners.forEach(listener => listener());
}
export function useProjectDraft(projectId: string) {
  const subscribe = useCallback((listener: () => void) => {
    const listeners = entry(projectId).listeners;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [projectId]);
  const snapshot = useCallback(() => getProjectDraft(projectId), [projectId]);
  const draft = useSyncExternalStore(subscribe, snapshot);
  const setDraft = useCallback((update: Draft | ((draft: Draft) => Draft)) => updateProjectDraft(projectId, update), [projectId]);
  return [draft, setDraft] as const;
}
