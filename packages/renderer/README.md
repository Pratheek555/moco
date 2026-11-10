# @moco/renderer

`createMocoRenderPort` from `@moco/renderer/backend` routes saved Blender scenes to native Blender
and existing scenes to Remotion. `createBlenderRenderPort` from `@moco/renderer/blender` also works
independently. See [Blender setup and production](../../docs/blender.md).

Remotion project. Takes a validated spec and renders 1080×1920 @30fps: parallax background layers, actors from `kit`, camera moves, captions, fx, voiceover. No AI here, pure deterministic rendering.

- `createRemotionRenderPort(options)` implements the engine's `RenderPort`: `check()` renders stills (L3) and maps kit errors back to spec paths; `renderEpisode()` renders preview (540×960) or final MP4.
- `src/remotion/`: compositions `Episode` and `Scene`. `pnpm --filter @moco/renderer studio` opens Remotion Studio on a demo scene.
- Real-render tests are opt-in: `MOCO_RENDER_TESTS=1 pnpm vitest run packages/renderer`.

Packaged app: pass a prebuilt `serveUrl`, `browserExecutable` and `binariesDirectory` (see `docs/reference.md` §7.2). Licensing: see R4.
