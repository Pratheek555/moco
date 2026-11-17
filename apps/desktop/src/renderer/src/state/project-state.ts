import type { RunState } from "../../../shared/api.ts";
import type { AppState, Route } from "./app-context.ts";

/** Live events win over a startup snapshot, including an idle event that removed a key. */
export function hydrateRunStates(snapshot: Record<string, RunState>, live: Record<string, RunState>, touched: ReadonlySet<string>): Record<string, RunState> {
  return Object.fromEntries([
    ...Object.entries(snapshot).filter(([id, state]) => state !== "idle" && !touched.has(id)),
    ...Object.entries(live).filter(([id, state]) => touched.has(id) && state !== "idle"),
  ]);
}

export function transitionProject(states: Record<string, RunState>, id: string, state: RunState, route: Route): {
  states: Record<string, RunState>; attention?: AppState["attention"][string]; changed: boolean;
} {
  const previous = states[id] ?? "idle";
  if (previous === state) return { states, changed: false };
  const next = { ...states };
  if (state === "idle") delete next[id]; else next[id] = state;
  const visible = route.name === "project" && route.id === id;
  const attention = visible ? undefined : state === "error" ? "error"
    : previous === "running" && state === "waiting" ? "waiting"
    : previous === "running" && state === "idle" ? "done" : undefined;
  return { states: next, attention, changed: true };
}
