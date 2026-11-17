import type { MocoAPI, ProjectEvent, ProjectView, RunState } from "../../../../shared/api.ts";

export function mergeProjectEvents(saved: readonly ProjectEvent[], incoming: readonly ProjectEvent[]): ProjectEvent[] {
  const ids = new Set<string>();
  return [...saved, ...incoming].filter(record => {
    if (!record || typeof record.id !== "string" || ids.has(record.id)) return false;
    ids.add(record.id); return true;
  });
}

/** Subscribe first, then load: neither records nor state transitions can fall in the gap. */
export function observeProject(
  source: Pick<MocoAPI, "project" | "onUpdate">,
  projectId: string,
  onView: (view: ProjectView | undefined) => void,
  onError: (error: unknown | undefined) => void,
) {
  let disposed = false, loading = true, generation = 0;
  let current: ProjectView | undefined, buffered: ProjectEvent[] = [], changedState: RunState | undefined;
  const unsubscribe = source.onUpdate(update => {
    if (disposed || "error" in update || update.projectId !== projectId) return;
    if (loading) {
      if (update.record) buffered.push(update.record);
      if (update.state) changedState = update.state;
      return;
    }
    if (!current) return;
    const events = update.record && !current.events.some(record => record.id === update.record?.id) ? [...current.events, update.record] : current.events;
    const state = update.state ?? current.state;
    if (events === current.events && state === current.state) return;
    current = { ...current, events, state };
    onView(current);
  });
  async function reload() {
    const request = ++generation;
    loading = true; buffered = []; changedState = undefined; current = undefined;
    onError(undefined); onView(undefined);
    try {
      const view = await source.project(projectId);
      if (disposed || request !== generation) return;
      current = { ...view, events: mergeProjectEvents(view.events, buffered), state: changedState ?? view.state };
      loading = false; buffered = [];
      onView(current);
    } catch (error) {
      if (!disposed && request === generation) onError(error);
    }
  }
  void reload();
  return { reload, dispose() { disposed = true; unsubscribe(); } };
}
