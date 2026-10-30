// Feature switches for the benchmark: each turns one premium feature off in a copy of the spec.
// Only spec edits, so the renderer code path is the same one production uses.
import type { SceneSpec } from "@moco/spec";

export function applyOff(spec: SceneSpec, off: string[]): SceneSpec {
  return off.reduce(turnOff, structuredClone(spec));
}

function turnOff(spec: SceneSpec, feature: string): SceneSpec {
  switch (feature) {
    case "atmosphere":
      return { ...spec, atmosphere: [], fx: [] };
    case "grain":
      return { ...spec, finish: { ...spec.finish, grain: false } };
    case "vignette":
      return { ...spec, finish: { ...spec.finish, vignette: false } };
    case "grade":
      return { ...spec, grade: "none" };
    case "parallax":
      return { ...spec, background: { ...spec.background, parallax: false } };
    case "idle":
      return { ...spec, actors: spec.actors.map((actor) => ({ ...actor, idle: false })) };
    case "lipsync":
      return { ...spec, visemes: [], actors: spec.actors.map((actor) => ({ ...actor, actions: actor.actions.filter((action) => action.name !== "speak") })) };
    default:
      throw new Error(`unknown feature to switch off: ${feature}`);
  }
}
