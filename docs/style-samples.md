# Reference style samples

Templates → **Learn from videos** now connects the existing measured reference
analysis to the Canvas artist pipeline. Use YouTube links or local video files,
with up to five optional PNG/JPEG/WebP appearance references under 3 MB each.
Uploaded stills reserve attachment slots; representative video frames fill the
remaining slots, up to five combined images. Stills do not supply motion evidence.

When learning finishes, choose **Make a sample** and enter your own topic. The
default target is 12 seconds across 2–3 shots. Choose portrait or landscape,
palette overrides, illustration detail, acting intensity and pacing, with optional
written direction. These are artist instructions, not numeric guarantees about
the resulting artwork. Local narration supplies the actual measured timing.

Review and approve the sample plan, character/design plan, script/storyboard and
first shot through the existing engine gates. No approval is inferred from
template selection or pressing Generate. The complete sample is a playable
narrated preview. Its comparison panel separates:

- Measured sample duration, speaking rate and cut rhythm, including observed
  reference ranges when available.
- Your deliberately selected visual choices.
- Known capability gaps and the current project's partial requirements.
- Visual judgments that still require watching the full clip.

Approval needs a current passing artist quality review, a preview built from the
current scenes/narration, 2–3 shots, no retained reference-content warnings, and no
detected verbatim reference narration. The caller supplies the full review hash;
changing reference context, artwork, narration, choices or video invalidates it.
Approved revisions are read-only through the engine. Generate a new revision to
change the choices; earlier samples and approvals remain available after restart.
Samples stop after approval and do not enter final export or publishing.

## Saved evidence and executable context

Learning still saves its full measurements, frame sheets, reference rule cards
and prose skill. New structured files are `style-rules.json`,
`content-exclusions.json`, `reference-images.json` and `reference-frames.json`.
Content exclusions are retained as checking evidence and are not included as
creative examples in the reusable skill.

Each sample is an ordinary one-episode artist project with
`SeriesInfo.styleSample = {templateId,revisionId,topic,choices}`. It pins the
compiled template, selected source frames, their provenance, rules and exclusions
in `<stylesDir>/.samples/<revisionId>/`. These internal revisions are resolved by
the template registry but do not appear as separate gallery templates. Relearning
the base style cannot change an existing sample's context.

**Open sample files** opens this revision's folder. On approval its `approved/`
folder retains episode SceneSpecs with embedded executable Canvas source, editable
shared drawing functions and shot motion files, assets, narration, preview video,
quality evidence, review and a file-hash manifest. Prose and executable artwork
remain together. This is a local approval archive; selecting the base template
for a new series does not automatically import an approved sample's character rig
or override its visual choices. Broader asset-library and repeat-production
interfaces belong to the sibling workstreams.

Both Codex and Claude use the selected backend. A backend without artist tools or
image review fails explicitly. The desktop learning entry selects local Canvas
production; CLI learning retains its existing legacy behavior unless the caller
supplies artist production settings. Existing legacy learned templates need to
be learned again for this Canvas sample flow.

## Verification and limits

No paid services or live AI production runs were used to verify this feature.
Learner tests cover both compiler modes and actual local FFmpeg frame extraction.
Engine tests exercise the human gates, pinned context, retained source, revision
history, stale video rejection, warning rejection and restart behavior with fake
AI/audio/render ports. `pnpm --filter @moco/desktop test:style-sample` exercises the
desktop through deterministic Electron IPC fixtures after a desktop build.

Visual quality still depends on the selected model and user review. The artist
quality gate inspects sampled frames, not every intermediate pose or audio
playback. Narration matching is a conservative four-word overlap check; it is not
proof of semantic or visual originality. Palette/detail/acting/pacing choices are
prompt guidance, not renderer-enforced numeric constraints. The existing video
analyzer requires an accessible audio stream and local learning tools; packaged
distribution of the Python runtimes remains an existing deployment requirement.

### Verification on 8 November 2026

- Workspace/desktop typecheck and desktop production build passed.
- Deterministic Electron sample workflow passed, including input capture,
  explicit gates, revision history and exact-hash approval.
- Final focused engine run: 41 tests passed across sample approval, pipeline,
  publishing and review retry. The sample tests include concurrent generation vs
  approval, capability-note changes, read-only revisions and crash recovery.
- The broad filtered run passed 321 tests, skipped 13 and timed out the existing
  40-shot artist-permissions stress test under concurrent load. All seven
  artist-permissions tests passed when rerun alone. The filtered command excludes
  `packages/ai/test/claude-cli.test.ts` and `packages/kit/test/art.test.ts`, the
  previously documented Windows executable/line-ending fixture exclusions; this
  is not an unfiltered-suite pass.
- The opt-in Canvas suite was stopped after its Headless Shell download stalled.
  An independent local renderer check using installed Chrome passed six actual
  Canvas stills and encoded a two-shot H.264/AAC preview: 320×180 at 30 fps,
  2.005 seconds. The fixture uses synthetic silence, not generated narration.
  Its script and report are local artifacts under
  `artifacts/style-sample-validation/`; they are not a live model quality benchmark.
