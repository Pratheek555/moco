# Authored scenes: first working prototype

## Freeform default (2026-11-10, spec 0.15.0)

New stories without a template default to `production.mode: "artist"`, local artwork, 1080?1920 at 30 fps.
The desktop starts on Freeform illustration. Local-only production settings override historical image-provider requests, so ordinary illustration briefs cannot block on a remote image tool. Explicit `production: null` selects kit/world; an explicit legacy
template retains its existing route. Saved series are not migrated to a new route. The older prototype notes below
are historical; this section supersedes their code/asset limits and proposed next steps.

The author writes ordinary JavaScript function-body snippets, concatenated in manifest order. There are no kit
pose, expression, camera or easing enums on this path. Full Canvas 2D is available: SVG `Path2D`, gradients, text,
clipping, filters, embedded PNG/JPEG/WebP/SVG images, local canvas/OffscreenCanvas layers and blend modes. Helpers
are optional. Source/file/read byte ceilings, source-file/file/cast/cue counts, and schema dimensions/fps caps were
removed. Physical browser/codec limits, rendering watchdogs, AI-call and preview budgets still apply; these are
resource controls, not artwork vocabulary. Freeform shots can depart from the show's suggested duration range,
introduce new places or characters, and use an empty cast for graphics-only work. Cast declarations and cue bounds
still check the shot's requirements; they do not inspect or restrict drawing commands.

The artist manifest additionally accepts:

```json
{
  "sourceFiles": ["shared/characters.js", "shots/s01/draw.js"],
  "cast": ["original-character"],
  "dataFiles": {"palette": "shared/palette.json"},
  "assets": {"symbol": "assets/symbol.svg"},
  "fonts": {"My Typeface": "assets/typeface.woff2"},
  "transition": {"type": "dissolve", "durationFrames": 12}
}
```

`scene.words` supplies text, shot-local startFrame/endFrame and whole-track wordIndex. `scene.data` contains the
manifest's parsed JSON files; `scene.assets` contains decoded images. An optional manifest `captions` array uses
moco's normal overlay; source can instead draw arbitrary word-by-word captions with `helpers.wordText`. Caption
text, when supplied as an overlay, still matches narration. No overlay is forced onto a custom composition.

Shared code, data, assets and fonts are published into the revisioned series artifact
`artifacts/authored-library.json`. It is restored into any later episode, independently of whether the preceding
episode has an artist workspace. Published paths are immutable; add a new name under `shared/versions/` for a new
rig/asset. Every shot embeds its chosen source, data, fonts and images and records shared source hashes, so new
library revisions cannot change old renders. Old projects can bootstrap this artifact from their existing shared
workspace. The library lives alongside the series' narrative memory and playbook; it is not a global asset pool.

Optional helpers now include snap, pop/overshoot, easeOut, hold, stagger, gravityArc, camera drift/push, step on
twos/threes, seededRandom, words/wordText, palette, grade, vignette, paper, rimLight and offscreen layer. See
`packages/engine/src/generator/prompts/artist.md` for exact signatures and direction guidance. Pacing, pose/face
swaps, entrances, camera drift, event density, cel shading and original designs are guidance, not validation.

`Shot.transition` and `SceneSpec.transition` support cut, dissolve and fade-through-black. Transitions run inside
the incoming shot over the outgoing final frame, clamped to the incoming duration. Voiceover and cut times are
unchanged. A missing transition remains a hard cut, including for old specs. The first shot ignores an incoming
transition. Hand-authored code can draw additional effects within its own shot.

The opaque-origin `sandbox="allow-scripts"` iframe and its CSP are unchanged: no same-origin/parent DOM, file,
network, workers or process access. Local layer creation does not add host privileges. Remotion injects a browser
`process.env.NODE_ENV` shim; it has no Node methods. Intentional blank/flat-colour authored holds are left to visual review rather than rejected as drawing errors. Runtime exceptions retain canvas.source, shot and frame feedback,
and a failed preview's actual message is also retained in the outer retry. The existing critic/repair/quality gates
continue to operate on rendered temporal evidence. Browser resource exhaustion is still not an OS-level quota.

Design decisions (one per line):
- Keep the artist contract rather than inventing another production mode; default only newly created untemplated stories.
- Keep kit/world templates and `production: null` as explicit options; never rewrite saved production settings.
- Persist shared assets as append-only named series artifacts and pin exact bytes in each scene.
- Offer functions as conveniences; no new drawing DSL or motion vocabulary validation.
- Apply transitions inside incoming time over a held outgoing frame to preserve narration and word timing.
- Keep sandbox/CSP and execution watchdogs; remove arbitrary drawing complexity ceilings.
- Bump the additive schema to 0.15.0 and renderer cache version to 0.10.0.

Proof: `pnpm exec tsx scripts/freeform-proof.ts`, inspect the six `s01-1.png`?`s03-2.png` files, then
`pnpm exec tsx scripts/freeform-proof.ts --render`. This uses real artist manifest assembly, L2 validation,
Remotion L3 checks, ArtifactStore, engine runRender and episode composition. It is a hand-authored fixture with
manual visual review, not a live-AI/automated-critic benchmark. Narration uses moco's offline systemAudio backend
(measured line durations and estimated word times). The 12-second H.264 proof has 360 frames, 1080?1920 at 30 fps,
AAC narration, three shots, Pip reused in two shots, a five-frame pop, one-frame pose swap, dissolve and fade-through-black.
Six full-size encoded stills are saved alongside the MP4 and were visually inspected. Provenance, hash-bound
fixture review and normal saved artifacts are included.

Default proof directory:
`C:\Users\prath\AppData\Local\Temp\claude\3fd6186c8caca1fe\e78eb94b-2564-4524-87ab-c2cf7fdca0df\scratchpad\freeform-proof`.

Verification: workspace + desktop typecheck passed. Focused engine/helper/compatibility/review tests: 38 passed.
Full opt-in Chromium canvas suite: 9 passed, including native drawing, exact transitions, intentional flat-colour
holds, >100 MiB episodes, frame seeks, isolation, fonts, runtime failures and repairs. Reduced-concurrency workspace run: 331 passed, 15 skipped, one unchanged CRLF art-fixture failure;
excluding that fixture: 328 passed, 16 skipped (including the added opt-in flat-colour check). Plain `pnpm test` also reproduces baseline 5-second timeouts under
full concurrency. Baseline/current logs are copied into the proof directory. The expanded browser suite exposed a cleanup/recycle race after thrown source errors at the still-frame budget.
Tracking idempotent page closes before shared-browser disposal removed the unhandled Target.closeTarget rejection;
the complete browser suite now exits cleanly. Final plain run: 313 passed, 19 failed (18 timeouts and the art fixture),
15 skipped, before adding one further opt-in test. The pre-edit baseline log has 303 passed, 20 failed (19 timeouts
and the same art fixture), 13 skipped. No kit source/fixture changes were made to hide these failures.


Issue: https://github.com/Pratheek555/moco/issues/15

Moco can now render a shot from AI-authored Canvas 2D code, in addition to its existing kit/world paths. This gives
the scene author control of artwork, acting, physical signs and custom mechanisms without a renderer change per idea.
The source is **data in the ordinary SceneSpec artifact**, not a new core plugin or an unsaved HTML side project.

## Run the demonstration

On the development workstation, with its installed Chatterbox voice runtime/models and cached faster-whisper small:

```powershell
pnpm exec tsx scripts/authored-demo.ts --stills-only
pnpm exec tsx scripts/authored-demo.ts
```

Optional first positional argument: output project directory. Environment overrides: MOCO_VOICE_PYTHON,
MOCO_VOICE_MODEL_DIR, MOCO_ALIGN_PYTHON. FFmpeg must be on PATH. No new dependencies are installed by this script.
The defaults use the installed Windows desktop voice runtime; supply paths explicitly elsewhere.

Output: `artifacts/authored-pharmacy/episodes/ep-01/renders/final.mp4` plus saved scene/voiceover/shot-list artifacts,
their content hashes, revision history, sampled frames, an engine render report, render cache and provenance.json.
The supplied art was authored by Codex during this implementation, not generated by a separate Claude CLI call.
It goes through the real ArtifactStore, engine runRender, episode assembly and Remotion RenderPort. It does not
exercise the automatic series/script/world planner. The generator accepts this same scene format; a pipeline test
verifies it persists source without forcing subtitles or kit actors. The demo uses measured Whisper word times.

## Scene authoring

```json
{
  "shotId": "s01",
  "durationFrames": 180,
  "background": {"id": "my-illustrated-place"},
  "actors": [],
  "captions": [],
  "canvas": {
    "version": 1,
    "cast": ["viewer"],
    "cues": [{"id": "reveal", "atFrame": 20}],
    "assets": {},
    "source": "ctx.fillStyle='#e9dfcf';ctx.fillRect(0,0,scene.width,scene.height);helpers.circle(200+scene.t*40,300,80,'#4d797d');"
  }
}
```

`source` is a function body receiving `(ctx, scene, helpers)`. Scene contains frame, fps, t (seconds), width, height
and decoded images keyed by asset id. Embedded PNG/JPEG/WebP data URLs let image plates and cutouts travel with the
artifact and participate in cache invalidation. No raster provider is required; procedural vector drawing works too.

Helpers are documented in the scene prompt: easing, seeded noise, cue lookup, rounded rectangles, circles, tubes,
two-bone arm IK and per-letter text arrival. They are conveniences: ordinary Canvas 2D drawing remains available.

Canvas owns the whole shot. Put physical signs and their text under the same camera transform. Legacy actors,
props, captions, stage, camera, fx and atmosphere must be empty/absent. Grade/finish are not composited over canvas.
Cast declarations are metadata, not proof a character was drawn: visual review must still inspect the frames.

Source executes from a clean canvas at each requested frame. Never depend on playback history, timers, network,
unseeded random values or wall-clock time. Source errors are tagged `canvas.source` and enter the normal repair loop.
The scene prompt receives the full original creative brief; the desktop/engine input limit is now 32,000 characters.

Optional `scene.format: {width,height,fps}` controls canvas stills and assembled exports. Existing scenes retain
1080x1920 at 30fps. All scenes in one assembled episode must agree. The demo explicitly sets 1920x1080 at 60fps.
Legacy projects still use 30fps. Explicit artist projects now carry production.format through word timing,
visemes, shot briefs, preview frames, scene artifacts and assembled exports.

Artist episode length is user-controlled. The optional seconds field starts empty and accepts custom positive
values, including fractions. Leave it empty to use the duration in the prompt; if the prompt omits a duration,
the planner proposes one in the show plan for approval. An entered value explicitly overrides the prompt.
Artist planning no longer inherits the legacy 30-60 second reel window or the former 15-90 second schema cap.
These are target durations; measured narration retains the existing fitting tolerance and resource budgets
still apply. Existing projects retain their saved explicit target. A conflicting prompt reference is not an
unsupported artwork capability. Desktop submission checks use `pnpm --filter @moco/desktop test:duration-settings`.

## Execution boundary and current limits

Source is never executed in Node or bundled into the app. It runs in a sandboxed opaque-origin iframe with scripts
only, no same-origin access, and CSP restrictions on network, nested frames, workers, forms and remote assets.
Frames acknowledge completed drawing so Remotion does not capture stale content. Rendering has existing browser
timeouts/watchdogs; this is **not an OS-level sandbox or a hard per-shot memory/CPU quota**. Treat execution as an
experimental local authoring feature, not a proven boundary for hostile uploaded code. Browser navigation/resource
exhaustion require stronger isolation and network enforcement before accepting untrusted third-party scene code.

The demo deliberately scopes to the visual capability: no paid image generation, music bed, SFX, embedded custom
font, walking rig or motion-blur integration yet. Text uses the bundled helper's Arial fallback, not Montserrat.
Three illustrative shots do not establish parity with a full 60-second production or with the unavailable raw video.

## Verification

- Engine integration test: authored source survives normal generation and storage with no captions or kit actors.
- Browser test: out-of-order frame reproducibility, parent-DOM isolation, actionable source error, successful repair.
- Contract test: embedded-source escaping and rejecting external image URLs.
- Demo: sampled frames and actual H.264 output from moco's existing engine render stage.

### Results on 2026-11-04

- `pnpm typecheck`: passed (workspace and desktop).
- `MOCO_RENDER_TESTS=1 pnpm exec vitest run packages/renderer/test/canvas.test.ts`: 2 passed, including real browser
  rendering, out-of-order reproducibility, DOM isolation and recovery after an intentionally broken source.
- `pnpm exec vitest run --exclude packages/ai/test/claude-cli.test.ts --exclude packages/kit/test/art.test.ts
  --maxWorkers=2 --testTimeout=20000`: 228 passed, 8 opt-in/platform tests skipped.
- Unfiltered `pnpm test` was not green: Windows could not spawn extensionless fake-Claude executables; the unchanged
  Krishna art loader fixture differed in CRLF/LF strings; ten engine tests exceeded their 5-second timeout under
  the full concurrent run. The engine timeouts passed in the reduced-concurrency run above. No unrelated fixture
  or CLI changes were made to hide these failures.
- Reviewed eight sampled frames per shot. The first stage title overflowed its physical sign; reduced its type size
  from 94 to 82 and rerendered. Previous source remains in artifact history; the final report references the repaired hash.
- Encoded output: H.264 + AAC, 1920x1080, 60fps, 600 video frames, 10 seconds of video (10.005 seconds container).
- FFmpeg scene-change scan (>0.2) found exactly the planned cuts at 2.7 and 5.5 seconds; this threshold scan is not
  proof that all subtle temporal artifacts are absent.
- Final encoded audio measured -15.12 LUFS integrated, so exact -14 LUFS mastering remains an audio follow-up.

Next steps after reviewing the demo: choose whether this canvas authoring path should be an explicit project mode,
add persistent shared character/asset design context, expose asset generation through optional budgeted providers,
and migrate the full project timing pipeline to the requested output format.

## Autonomous artist workspace (2026-11-04)

Artist mode is now an explicit production option in the engine and desktop. The engine skips kit casting and
3D world construction, passes the full brief to each planner and shot author, and records capability requirements
in `artifacts/artist-capabilities.json`. Unsupported requirements fail visibly rather than selecting a kit fallback.

The workspace contract is provider independent: `AiRequest.artistTools` supplies `list_files`, `read_file`,
`write_file` and `render_preview` callbacks. Both Codex and Claude adapters expose these through the same local
authenticated MCP bridge. The engine, saved artwork, renderer and repair logic use the same tool contract.
Adding another backend requires implementing that contract and advertising `supportsArtist`; there is no automatic
fallback to a different provider. MCP configuration follows the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).

For this development session, Claude runs were stopped at the user's request. The benchmark scripts now invoke
**Codex only**, including planning, artwork, review and repairs:

```powershell
pnpm exec tsx scripts/autonomous-artist.ts
```

Output root: `artifacts/autonomous-codex`. `MOCO_SERIES` resumes a saved series. `scripts/artist-control.ts` can
create an optional whole-sequence control with the same saved narration and shared character source. This is an
internal planning comparison, not an independent recreation of the unavailable raw-Claude baseline.

Each artist call must preview its final saved source. Edits after preview invalidate that acceptance; renderer
errors enter the repair loop. Source revisions and tool events are retained under `episodes/ep-01/artist`.
Shared designs become read-only after sample approval. Sampled sequences improve motion review but do not prove
the absence of sliding feet, flicker or other defects between samples.

The automated benchmark uses procedural artwork, local Chatterbox speech and measured Whisper alignment. It does
not claim the original brief's image-generation, font, motion blur, music or SFX requirements are implemented.

## Evidence-based artist repairs

Artist shot plans now declare observable `actionChecks` against whole-track word indices. Each review receives
an episode overview (early, middle and late frames from every shot), target-shot action sequences, the cut list,
and measured narration/format metadata. Images cannot verify audio playback or continuous motion between samples.

The repair loop prioritizes unresolved critical and major checks, covers every weak shot, and permits two rounds.
The second round explicitly asks for a different approach. A candidate must resolve checks or improve its score
without increasing weighted defects; equal results are reverted. Missing check IDs become unknown, and important
unknowns block acceptance. Action sequences sample preparation, action and follow-through across the declared
word range. Existing critical severity is preserved. Every candidate verdict and decision is saved
under `episodes/<id>/quality/<run>/`; rejected scene specs remain in artifact history. Rejection also restores
editable shot files and removes newly created shot files, so later repair attempts start from the retained source.

Canvas authors can use `helpers.acting.pose`, `.hand` and `.face` for expressive poses, distinct hand shapes,
gaze, head turns, expressions and blinks, or write custom rigs. Approved shared designs remain immutable;
new versions go under `shared/versions/`, and the whole cut is rechecked after candidate changes/restores.

Artist final export requires a passing quality report bound to the current scene, shot-list and narration hashes.
An unresolved episode can still render a preview for inspection. This is a sampled visual acceptance gate,
not a guarantee of broadcast quality or compliance with the full original production brief.

To repair a saved Codex episode while preserving its narration and cuts:

```powershell
pnpm exec tsx scripts/artist-repair.ts <original-project-directory>
```

The script copies the project to a new artifact directory, adds action checks to legacy shots, runs the shared
review/repair loop, checks that narration bytes match the original, and writes `repair-report.json`.
Set `MOCO_REPAIR_DIR` to resume that copy. An unsuccessful quality gate produces `preview.mp4` rather than
`final.mp4`. Generate encoded inspection sheets with `scripts/artist-contact-sheet.py <directory> preview.mp4`.

Append `--review-only` to inspect the saved cut without generating further artwork. It creates a fresh review
and renders the preview; final export still requires all important checks to pass. This mode does not establish
improvement relative to a prior verdict. New defect IDs must begin with the target shot ID and a hyphen;
foreign action IDs and episode-wide checks are rejected. Whole-cut images supply continuity context, while
acceptance requirements belong to the target shot. An interrupted authoring or review transaction restores
unaccepted scene specs and editable shot files before saving an unresolved report.
