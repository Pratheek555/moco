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

Unsaved creation choices survive navigation within the current app session,
including a visit to voice settings or the library. Topic, episode count,
language, visual approach, shape, length, viewer and visual direction return
together. A successful creation clears that draft for the next project. These
drafts are held in memory; restarting or reloading the app is not disk autosave.

## Production and approvals

This built-in template uses the ordinary artist pipeline and saved contracts:

1. Review the series plan.
2. Review the show bible, original presenter, palette and production limitations.
3. Approve narration with its estimated picture plan, before voice or artwork.
4. Generate measured narration and word-aligned cuts; review the first sample shot.
5. Author the rest using the approved shared design; review the full preview.
6. Export through the existing artist quality gate bound to current artifacts.

Sample review shows one larger frame with previous/next buttons, a position
indicator and a keyboard-accessible scrubber. Select the image to enlarge it;
frame navigation remains available in the enlarged view. These are sampled poses,
not a video player or proof of continuous motion. The full preview remains the
place to watch the animated cut.

A saved preview with unresolved visual checks lists them above the player and
links to **Review saved shots**. Approval stays disabled while that review needs
attention, instead of sending the user straight into a blocked final-export job.
Approval also waits for the report to load, and a changed preview starts a fresh
review panel. The engine's artifact-bound export gate remains authoritative.

If visual review fails after the scenes are saved, **Review saved shots** opens
the existing episode inspector. Single-shot redo is available when the script is
approved, narration and cuts are complete, and every planned shot is saved against
those current input hashes. Stale or incomplete cuts stay blocked. This removes a
circular prerequisite where a shot could not be repaired until its failed review
already passed. The whole cut is independently rechecked after a change; final
export still requires the unchanged quality gate. This is recovery through the
existing redo API, not a new selective-editing feature. The sibling editing
workstream should preserve these eligibility and input-freshness checks.

The directing brief asks for a concrete question, a diagram that demonstrates the
answer, narration-linked poses, sparse labels and motivated cuts. At the starting
length it aims for four to six editorial pictures. Presenter identity, diagram
correctness, label readability and purposeful cuts enter the show rubric; shot
actions enter the existing word-indexed action checks. These are directing and
review instructions, not a deterministic guarantee that every model output passes.
Picture-plan prose is kept short and written for the reviewer; technical action
check metadata belongs in the later measured-word shot list. Artist production
calls its second progress phase **Direction**, and planning commentary uses the
active stage's key so it appears in the live status line.
When measured narration requires a longer or shorter script, its next script
review explains the timing adjustment and that approval is needed before a new
recording. A later user-requested revision replaces that reason, avoiding a stale
automatic-timing explanation.

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

No live model generation is part of these automated tests. The separate live
workflow exercise below produced a fresh queue preview, with unresolved quality
checks. Existing sampled visual review can miss motion defects and does not verify
audio playback; see `artist-benchmark.md`.

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

### Live workflow exercise, 8–9 November 2026

Created **Small Systems**, a two-episode portrait series in the ordinary desktop
app, using the user's configured Codex CLI and local Chatterbox narration. The
planned episodes explain queues and moving one task through a checklist board.
The original presenter is Mina, wearing teal against a warm paper palette. The
project is saved under `Documents/Moco/small-systems-a-two-episode-illustrated-explaine`.

The live exercise covered plan and visual-direction approval, script feedback,
measured narration and a timing send-back, sample review, reopening the app,
full-shot generation, failed visual review, individual-shot repair and preview
encoding. It found and fixed:

- Lost episode count, audience, direction and other creation choices after
  navigating to Settings. The complete in-memory draft now returns together.
- Planning and sample-review commentary using the wrong stage key. Real progress
  now reaches the current live status line, including during individual-shot work.
- Unclear local voice startup and unexplained script reapproval after a narration
  timing correction. Both now explain what is happening.
- Small sample frames with no position/navigation controls. The larger viewer
  supports keyboard scrubbing and enlargement; Escape leaves the review open.
- Failed-review recovery that hid saved work and disabled shot repair until the
  same review had already passed. Saved, current cuts now permit targeted repair;
  missing or stale inputs remain blocked by the engine.
- Preview approval offered while the visual review still needed attention.
  The preview now names unresolved issues, links to saved shots and withholds
  approval. The final-export quality gate is unchanged.

The latest encoded draft is H.264/AAC, 540 x 960, 60 fps, 1,731 frames and 28.864
seconds. Its underlying production is 1080 x 1920; the ordinary preview encoder
halves the dimensions. Measured narration is 28.84675 seconds, inside the existing
5% fitting tolerance for a 30-second target. The file is
`episodes/ep-01/renders/preview.mp4` inside the saved project. A 15-frame encoded
contact sheet is at `artifacts/illustrated-explainer/workflow-test/12-episode-one-preview-sheet.png`.
That sheet samples the film; it does not establish continuous motion or audio
quality. The preview is a review draft, not a quality-approved final export.
The final encoding was resumed after an app interruption using only saved shots
and narration, with generation disabled. Its preview gate is awaiting review;
there are no remaining running jobs. The contact sheet was refreshed from that
encoded file.

The test also exposed a production bottleneck: repeated pointing/gaze repairs,
weak closing-pose motion, and reviewer variation make a short film slow to finish.
One reviewer demanded that a pointing hand reach a distant slot, which encouraged
an overextended arm. No acceptance checks were removed or marked passed by hand.
This is separate from the UI improvements; a fluent, finished two-episode live
series has not been demonstrated. Episode two remains planned, not produced.
The last independent review passed shots 1, 2, 3 and 5, while still rejecting shot
4's pointing/gaze check. It accepted the closing pose without a source change,
which reinforces the limitation of sampled model review. Further automatic
repairs were not launched; the draft remains inspectable and final export blocked.

Verification of the workflow fixes: workspace and desktop typechecks, desktop
production build, explainer/duration/Studio Electron checks, 19 focused engine
tests and 18 quality/retry tests passed. The recovery test also rejects a cut whose
saved shot omits its current narration input. These model-double checks cover
both provider selections without live calls; the live exercise used only Codex.
The Electron preview check also holds the report request pending and verifies
that approval stays disabled until the new report arrives.
