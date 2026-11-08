# Video thumbnails

The publishing panel includes a thumbnail editor in both the episode view and the Studio delivery sidebar.
Choose Bold hook, Minimal, Cinematic, or Editorial; then choose a shot, a reviewed still, a headline,
text placement, and an accent. An empty headline exports only the scene image. The composition guide
is an editing aid and is never exported; it is not a promise of a platform's crop or safe area.

The draft preview uses the closest available shot still. That still can contain video captions or differ
from the requested frame. Rendering uses the actual scene frame without its caption overlay and replaces
the preview with the saved JPEG. Authored canvas scenes may include text in their artwork itself.
Export dimensions follow the scene format, including landscape artist projects. Existing kits without a
design remain editable and use the Bold hook defaults.

The AI publish prompt can choose the same designs. Frame and design options are validated at the engine
boundary, passed through the render port, and persisted in `PublishKit.thumbnail`. The engine clamps
valid frame numbers to the scene's duration. Editing YouTube metadata preserves the saved thumbnail.
The editor and Remotion share presentation rules in `packages/spec/src/thumbnail.ts`.

## Research

Reviewed November 8, 2026. These are design starting points, not performance guarantees:

- [YouTube: thumbnail and title tips](https://support.google.com/youtube/answer/12340300?hl=en)
  supports readable type, restrained composition, and choosing imagery for the intended audience.
- [vidIQ: thumbnail formats and 2026 styles](https://vidiq.com/blog/post/types-youtube-thumbnails/)
  informed the quieter Minimal and Cinematic options alongside bold and editorial treatments.
- [YouTube: custom thumbnails](https://support.google.com/youtube/answer/72431?hl=en)
  currently documents custom Shorts thumbnail uploads in desktop Studio for verified accounts and
  recommends 9:16 for Shorts. The editor links to that guide so users can check current eligibility.
- [YouTube: A/B tests](https://support.google.com/youtube/answer/16391400?hl=en)
  currently excludes Shorts. This editor provides local design choices and does not claim to run an A/B test.

## Verification

```powershell
pnpm typecheck
pnpm vitest run packages/engine/test/publish.test.ts packages/spec/test/thumbnail.test.ts
pnpm --filter @moco/desktop build
pnpm --filter @moco/desktop test:thumbnail-editor
$env:MOCO_RENDER_TESTS='1'
pnpm vitest run packages/renderer/test/thumbnail.test.ts
```

The Electron test uses an isolated temporary profile and mocked IPC. The render test writes real JPEG
fixtures into `artifacts/thumbnail-exports/` and verifies their dimensions and distinct style output.
