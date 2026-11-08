# Illustrated explainer launch format

The Studio starts with **Illustrated explainer**: one 30-second portrait episode,
1080 x 1920 at 60 fps. It is intended for creators explaining one idea to a general
audience. Topics remain open; no science, history, psychology or mythology niche
is selected for the product.

Enter a topic, or try **How a queue works**. Story options includes an optional
intended viewer and visual direction. These are saved with the original topic in
the series brief, so they reach planning and every shot author. A blank intended
viewer uses a general audience. The presenter is invented for the project and can
be human, animal or another original design; this is not a fixed mascot pack.

Length starts at 30 seconds. An entered length explicitly overrides a duration in
the topic; clearing the field follows the prompt, or lets the show planner propose
a duration for approval. Fractions and longer runtimes remain available. Portrait
is the default; landscape is optional. Choosing a different template preserves its
own production settings. Freeform **Custom illustration** and **Animation & 3D**
remain available in Visual approach. Changing the look does not replace an episode
count the user has already chosen.

## Production and approvals

This built-in template uses the ordinary artist pipeline and saved contracts:

1. Review the series plan.
2. Review the show bible, original presenter, palette and production limitations.
3. Approve narration with its estimated picture plan, before voice or artwork.
4. Generate measured narration and word-aligned cuts; review the first sample shot.
5. Author the rest using the approved shared design; review the full preview.
6. Export through the existing artist quality gate bound to current artifacts.

The directing brief asks for a concrete question, a diagram that demonstrates the
answer, narration-linked poses, sparse labels and motivated cuts. At the starting
length it aims for four to six editorial pictures. Presenter identity, diagram
correctness, label readability and purposeful cuts enter the show rubric; shot
actions enter the existing word-indexed action checks. These are directing and
review instructions, not a deterministic guarantee that every model output passes.

Both configured CLI providers retain their existing artist-tool path; this format
does not change providers. Artwork is procedural Canvas, using bundled Montserrat
and the configured narration backend. Local-only production disables generated
image services, including on Codex. No image provider, music/SFX service or paid
API is connected by selecting the format. The ordinary local word-alignment setup
is still required (`pnpm learn:setup` and a cached faster-whisper model, or the
existing alignment environment settings). Missing capabilities stop visibly.

Shared design notes and character source live in the existing episode artist
workspace; shot drawing source and embedded SceneSpec artifacts remain editable.
This work does not add a visual source editor, asset library, reference-matching
workflow, repeat-episode controls or licensing behavior. Those are sibling work.
They can continue to consume the existing template id, original brief, ShowBible,
EpisodeScript.shotPlan, shared design source and shot-scoped action checks; there
is no new spec or IPC contract to merge.

## Acceptance example and evidence

`examples/explainers/queue.json` is an original 30-second narration and five-picture
plan. It describes first in, first out at an invented ticket booth, with a recurring
presenter and numbered visitors/tokens. It is a planning fixture, not a generated
film or preapproved user project.

For a generated version to meet the visual acceptance bar:

- The same original presenter returns across cuts, with questioning, pointing and
  reacting poses and gaze directed at the intended target.
- Numbered visitors and diagram tokens preserve arrival/departure order; reveals
  follow the measured narration rather than guessed timestamps.
- Short labels fit their surfaces, remain legible at phone size and keep a 10%
  inset alongside essential faces and diagram parts.
- Every cut changes the explanatory view or advances the answer; the final view
  resolves the opening question.
- Source is saved and deterministic; unresolved important checks block final export.

Automated verification uses deterministic doubles for models, voice and rendering
to exercise this example through every approval and final export for each provider
selection. It checks saved portrait settings, source reuse, script/sample gates,
custom overrides, unsupported-authoring errors and disabled image tools. It does
not exercise live provider adapters or establish generated artistic quality.
The Electron first-run test captures requests without starting production and
checks defaults, viewer/direction, custom illustration, other templates and provider
preservation. A local renderer check using installed Chrome also passed real
portrait Canvas drawing with embedded Montserrat, different gesture frames,
out-of-order seek reproducibility and recovery after a deliberate source error.
That check uses hand-authored drawing source, not model-generated art; its report
is at `artifacts/illustrated-explainer/canvas-check/verification.json`.

No live model generation is part of these tests. Visual acceptance of a fresh
autonomous queue video remains unverified. Existing sampled visual review can miss
motion defects and does not verify audio playback; see `artist-benchmark.md`.

### Verification results, 8 November 2026

- Workspace and desktop typechecks passed; the Electron production build passed.
- The new first-run Electron test passed, including combined-brief length validation.
- Existing duration and Studio development Electron regressions passed.
- The engine suite passed 157 of 158 tests in the combined run. The existing
  40-shot image test exceeded its explicit 60-second limit during concurrent work;
  an isolated rerun passed in 51.7 seconds with the original limit. The combined
  suite is therefore not reported as an uninterrupted green run.
- The installed-Chrome Canvas check described above passed. The optional renderer
  Vitest run was stopped during a stalled Headless Shell download; it is not
  counted as a renderer-suite pass.

```powershell
pnpm typecheck
pnpm exec vitest run packages/engine/test/illustrated-explainer.test.ts packages/engine/test/templates.test.ts packages/engine/test/prompt-templates.test.ts --maxWorkers=2 --testTimeout=30000
pnpm --filter @moco/desktop build
pnpm --filter @moco/desktop test:illustrated-explainer
pnpm --filter @moco/desktop test:duration-settings
pnpm --filter @moco/desktop test:studio-development
```
