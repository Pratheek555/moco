# ADR: Rive vs the layered SVG rig

Status: **decided for now: keep the SVG rig; Rive stays a spike.** Revisit when a real illustrator delivers art (see "When to revisit").
Date: 2026-10-30 · Phase 5 of the premium-kit work · Remotion 4.0.539, @rive-app/canvas-advanced 2.31.5

## Question

Should the character kit move from layered SVG driven by our own rig (`packages/kit/src/rig.ts`, `layered.tsx`) to Rive files (bones, meshes, state machines authored in the Rive editor)? Before anyone converts art, we need to know three things:

1. Can Rive be driven **frame-exactly** from Remotion? Our rule is that the same spec and the same kit version give identical frames.
2. Can the spec pick the artboard, animation and state machine?
3. What does it cost per frame compared with the SVG rig?

## What was built

Everything lives in `packages/renderer/spikes/rive/` with its own Remotion root, so nothing in `src/` imports it and the production bundle never contains Rive.

| file | what |
|---|---|
| `RiveFrame.tsx` | Our frame-exact player on `@rive-app/canvas-advanced` (MIT). Props: `{ src, artboard?, animation? \| stateMachine?, inputs?: [{ frame, name, value }] }`. Unknown names fail with the list of names that do exist. |
| `index.tsx` | Compositions: `RiveFrame`; `RiveStock` (`@remotion/rive`'s `<RemotionRiveCanvas>`); their `…Reversed` twins, whose frame n shows frame last − n, so every frame is a backward seek (Remotion sorts explicit frame lists, so a plain render can't go backwards); and `SvgRig` (the kit's Krishna alone on the same stage, for a like-for-like cost). |
| `check-frames.ts` | The determinism check below. |
| `public/centaur.riv` | Rive's MIT demo character (46 KB): artboard `Character` with animations Idle, Walk, WalkBack, Aim, Fire, Blink and Idle_fire, plus state machine `Motion` with inputs `Fire` (trigger) and `Move`. |
| `bench/scenes/rive-*.json`, `svg-rig-only.json` | Props for the benchmark. |

Run it: `pnpm --filter @moco/renderer spike:rive` copies `rive.wasm` into `public/` (git-ignored). Then from `packages/renderer` run `npx tsx spikes/rive/check-frames.ts` and `pnpm bench:render --entry spikes/rive/index.tsx --public-dir spikes/rive/public --composition RiveFrame --spec bench/scenes/rive-motion.json --name rive-frame-motion --concurrency 8`.

## Findings

### 1. `@remotion/rive` as shipped is not frame-exact and can't do what we need

I read its source (`dist/cjs/RemotionRiveCanvas.js`) and confirmed it by rendering:

- **It moves the animation forward by "this frame minus the last frame drawn"** (`animation.advance((frame - lastFrame) / fps)`). Frame N's picture therefore depends on which frames that browser tab drew before. Remotion gives frames to whichever tab is free, so one render with 8 tabs differs from one render on 1 tab: **299 of 300 frames had different bytes**. 5 of 6 stills rendered on their own differed, and all 300 frames differed when every frame was a backward seek. Two identical single-tab renders do match. At frame 150 the drift is 2,232 pixels, max channel delta 42, with 30 pixels off by more than 16. That is subtle anti-aliasing drift on a looping idle, but it breaks our "identical frames" rule.
- **It can't play a state machine.** There is no `stateMachine` prop, only `artboard` and `animation`.
- **It downloads `rive.wasm` from unpkg.com while rendering** (`locateFile` is hard-coded to `https://unpkg.com/@rive-app/canvas-advanced@2.31.5/rive.wasm`). A desktop app that renders offline can't rely on that.
- It costs **22% more** than our player (see the table), because it draws to a hidden canvas and then copies it through Remotion's effect chain.

### 2. A thin player of our own *is* frame-exact, including state machines

`RiveFrame` follows one rule: **frame N is always reached from frame 0 in steps of exactly 1/fps.** If it has to go backwards, or its props change (for example, edited in the Studio), it throws the artboard away and starts again. State machine inputs are set at the step for their frame. So the picture depends only on (file, props, frame). `check-frames.ts` result:

| case | 8 tabs vs 1 tab | single stills vs in order | every frame a backward seek vs in order |
|---|---|---|---|
| `RiveFrame` Idle animation | 0 / 300 differ | 0 / 6 | 0 / 300 |
| `RiveFrame` Motion state machine (walk, stop, fire twice) | 0 / 300 differ | 0 / 6 | 0 / 300 |
| `RiveStock` Idle animation | **299 / 300 differ** | **5 / 6** | **300 / 300** |

The cost of exactness is replay. The first frame each tab draws, and any backward jump, replays every step from frame 0. That is cheap here (steps are wasm calls with no drawing; it doesn't show in the timings below). For a 45 s shot that is up to 1,350 steps per jump, and scrubbing backwards in the Studio would feel it. `ponytail:` if Rive is adopted, cache a snapshot every N frames, or jump timeline animations straight to `frame / fps`.

### 3. Cost: about the same as the SVG rig at final quality, worse at preview

One character on a plain stage, 1080×1920, 300 frames, H.264, concurrency 8, median of 3 runs on an M2 Max (rows in `docs/benchmarks/render-2026-10-30.json`):

| variant | preview (scale 0.5) | final | final vs SVG rig |
|---|---|---|---|
| `svg-rig-only` (layered SVG Krishna, idle + blink + raise_hand + smile) | 2.49 s | 2.88 s | – |
| `rive-frame-idle` (our player, timeline animation) | 2.97 s | 2.99 s | +4% |
| `rive-frame-motion` (our player, state machine) | 2.93 s | 2.95 s | +2% |
| `rive-stock-idle` (`@remotion/rive`) | 3.85 s | 3.52 s | +22% |

- At final quality Rive and the SVG rig cost the same within noise: about 0.3 ms per frame per character above the shared overhead. Neither is a bottleneck. The full premium scene's atmosphere and finish layers cost far more (Phase 7).
- At preview quality Rive gains nothing from `scale 0.5`, because the canvas always draws at the composition's full 1080×1920. Drawing the canvas at `width × scale` would fix that, but it isn't worth doing in a spike.
- The centaur is a simpler character than Krishna (fewer shapes, no ornaments). A Rive Krishna with as much detail would probably cost a little more.

### 4. What Rive would and wouldn't give us

**Would give:** mesh deformation and bones authored by an animator, real secondary motion, state machine blends between poses (walk to aim to fire) that look better than our curve library, and one editor where the illustrator also animates.

**Wouldn't give, or would cost:**

- **The AI contract changes shape.** Today actions, visemes and layers come from `catalog.json`, which we generate from the art and validate at build time (`requireLayers`, `MissingLayerError`). With Rive the catalog would have to be read out of each `.riv` (names of artboards, animations, state machine inputs), and our action semantics (`raise_hand` with `side`, gesture timing between `startFrame` and `endFrame`) would become state machine inputs fired at frames. That works, as the `inputs` prop shows, but timing then lives inside the Rive file and the spec can no longer stretch a gesture to fit a shot.
- **Variants and lip sync.** Our variants (`garment_upper--charioteer`) and viseme layers are plain SVG groups an illustrator can deliver from any tool, following `docs/kit-asset-spec.md`. In Rive they would be nested artboards or solo groups, and they need a Rive-literate animator, which is a narrower hiring pool than "an illustrator who can name layers".
- **Lock-in.** The `.riv` format and editor belong to Rive (the runtimes are MIT; the editor is a paid SaaS for teams). The SVG rig depends on nothing.
- **Rendering path.** A canvas inside a DOM render works, but it's another runtime (1.4 MB wasm) to ship and keep frame-exact. Our own player is about 150 lines; the stock one isn't usable as-is.

## Decision

1. **Keep the layered SVG rig as the kit's format.** Don't convert the kit. It already meets the determinism rule, costs the same at final quality and less at preview, and its catalog is checked at build time.
2. **Don't ship `@remotion/rive`.** If Rive is ever used, use a frame-exact player like `RiveFrame` on `@rive-app/canvas-advanced`, with the wasm bundled locally. `@remotion/rive` stays a devDependency of the spike only. It deepens Remotion lock-in without giving us anything our 150 lines don't.
3. **A possible middle path, not now:** Rive for a few hero props or effects (a chariot wheel, a conch shell, Sudarshan Chakra), placed by the spec like any prop, so the kit's characters stay SVG.

## When to revisit

- An illustrator or animator is hired and prefers Rive. Then re-run this spike with a Krishna-level character, a viseme state machine and a bless gesture, and compare the look side by side.
- The SVG rig's curve library visibly limits quality (stiff limbs, no mesh bend) in the Phase 7 golden scene review.
- Rive adds a supported way to set a state machine to an absolute time. That would remove the replay cost.
