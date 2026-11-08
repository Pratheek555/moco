# Authored scenes: first working prototype

## Precise label editing

Artist manifests can now declare optional `labels`, copied into `SceneSpec.canvas.labels`:

```json
{
  "id": "reward-label", "text": "Reward signal",
  "x": 100, "y": 80, "width": 400, "height": 70,
  "fontFamily": "Arial", "fontSize": 40, "fontWeight": "700",
  "color": "#222222", "align": "center", "startFrame": 0, "endFrame": 180
}
```

Coordinates are output pixels. Times are shot-local frames, with exclusive end. Labels are single-line,
fixed screen-space overlays above the drawing. The artist must leave their space blank in the source/artwork.
The renderer loads Arial or an embedded font, measures every label, rejects overflow instead of shrinking or
reflowing it, and clips drawing to its box. Label text is omitted entirely from the source iframe's config.
Thus changing a label cannot feed a different value into the drawing program. The transparent label layer
uses separate drawing state; artwork and label rendering start clean at each requested frame.

The episode inspector provides label selection, replacement text, three sampled before/after frames, explicit
Apply, and Undo of the last label edit for that shot. Previewing does not replace the accepted scene or stills.
Apply constructs a text-only change in the engine; clients cannot supply changed layout, source, assets,
narration or timing. Drafts are stored under `episodes/<id>/edits/<uuid>/`, bound to every current shot revision,
the cut, narration and renderer version. Intervening episode changes reject Apply/Undo rather than overwriting
newer work. Undo creates a new human revision, retains provenance inputs, and survives reopening the project.
Undo is one step per shot; no timeline editor, multi-step history browser or redo is included.

The accepted SceneSpec is authoritative. Before the next artist invocation, its labels are copied back into
the editable manifest. Label edits do not rewrite drawing source, images or shared designs. A later explicit
shot regeneration is still a broader artist operation. Historical generic artifact restores are not a replacement
for this label Undo path.

Current comparison stills are selected by scene hash. Old episode MP4s remain on disk but are hidden from the
player/publishing controls when their input hashes, stage status or renderer versions are stale. Rebuild episode
preview performs no model call and does not require AI availability. Encoding uses temporary outputs and atomic
replacement, preserving the old video and cache on failure. The artist final gate still requires current quality
evidence. “Review without changing artwork” explicitly runs review with zero repair rounds; a failed review does
not silently rewrite other shots. Export retries after a precise edit also refuse automatic whole-cut repair.
Reviewing unchanged artwork keeps its current preview and approval intact.

Existing code-drawn text and raster-baked signs remain unchanged and unavailable in this editor. Moving,
perspective or occluded signs, animated letter effects, spoken-sentence changes, object/background replacement,
and timing changes are outside this first operation. No automatic conversion is attempted. Existing arbitrary
Canvas code must still follow the deterministic drawing contract below; label separation does not make an
otherwise nondeterministic program deterministic. Reviews and comparisons use sampled frames.

Verification commands (no live models):

```powershell
pnpm exec vitest run packages/engine/test/label-edit.test.ts
$env:MOCO_RENDER_TESTS='1'; pnpm exec vitest run packages/renderer/test/labels.test.ts
pnpm --filter @moco/desktop build
pnpm --filter @moco/desktop test:label-editor
```

Validation for precise editing: workspace/desktop typechecks and desktop build passed; the deterministic desktop
test passed comparison, rejected Apply, successful Apply, Undo, stale renders, overflow and unsupported artwork.
All three real-browser label tests passed, including pixel differences confined to the selected box, timing,
out-of-order reproducibility, embedded fonts, recovery and an encoded MP4. The filtered workspace suite passed
318 tests with 15 opt-in/platform tests skipped, using the existing exclusions
`packages/ai/test/claude-cli.test.ts` and `packages/kit/test/art.test.ts`. This is not an unfiltered-suite claim.
No live model generation was used. The full artist integration fixture now also exercises label preservation
through regeneration and uses a 60-second deadline for its many durable filesystem writes.

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
