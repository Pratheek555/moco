# @moco/engine

The backbone. Orchestrates the pipeline, is the single writer of `projects/`, and calls the AI as a function with tools disabled. Design: `docs/reference.md` §4.

## Pipeline

```
series:  series_plan (gate) → bible (gate)
episode: script (gate) → voiceover → shot_list → [sample (gate), first episode only] → scenes → preview (gate) → final
                                                                                                             → memory_update
```

- `planner/`: idea → series plan → bible (kit characters only) → script fitted to 30–60 s → voiceover (send-back if off target) → shot list cut on word boundaries
- `generator/`: shot → SceneSpec via `ai`, with a catalog slice, memory and the golden Krishna example; reuses a shot's spec when nothing it depends on changed
- `loop/`: L0 JSON → L1 schema → L2 semantic (kit, bible, timing, captions, slideshow risk) → L3 render stills; issues fed back; fallback shot after the cap
- `memory/`: continuity facts and story-so-far, merged after each approved preview
- `pipeline/`: stage graph, gates bound to content hashes, staleness, stage runner, render cache
- `store/`: `{meta, data}` envelopes, atomic writes, history, tamper check, JSON ledger
- `host.ts` / `client.ts`: the Engine API over a message port (Electron utilityProcess ↔ UI)

## Using it

In the app, `apps/desktop/src/engine-host.ts` builds the engine; the UI talks to it with the client:

```ts
import { createEngineClient } from "@moco/engine/client";

const engine = createEngineClient(port); // port from Electron main
engine.on("*", (event) => ui.update(event));
const seriesId = await engine.createSeries({ idea: "Mahabharat series", language: "en", episodes: 3 });
await engine.runStage({ seriesId });                                   // runs until a gate
const { stages, next } = await engine.status(seriesId);                // next: { kind: "waiting", key }
await engine.approve({ seriesId, key: next.key }, stage.artifactHash); // the hash the user looked at
await engine.reject({ seriesId, key }, "make it darker");             // feedback goes into the next prompt
await engine.regenerateShot({ seriesId, episodeId: "ep-01", shotId: "s03" }, "closer on Arjuna");
```

`@moco/engine/testing` exports `FakeAi`, `FakeRenderPort` and `FakeAudio` for tests and for building the UI without spending AI calls. `pnpm live "<idea>"` runs one real episode end to end.
