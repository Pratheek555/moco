# Autonomous artist benchmark — 4 November 2026

## Repair follow-up - 5 November 2026

The shared artist pipeline now has observable, word-indexed action checks, whole-cut overview sheets,
action-sequence sampling, prioritized repair of every weak shot, and a two-round limit. Equal results and
regressions are reverted. Final export requires a passing review tied to current scene, narration and shot-list
hashes. Reusable acting helpers expose hand shapes, gaze, expressions and head turns; authors may extend them
through immutable shared rig versions.

The fixed-narration test is saved at `artifacts/artist-repair-2026-11-04T18-20-50-232Z`.
Its bounded authoring run reached the plan limit during the last candidate review. A subsequent review-only
pass completed without generating more artwork. No manual scene edits were made, and narration bytes match
the original. The current deliverable is `episodes/ep-01/renders/preview.mp4`: H.264/AAC, 960x540,
60 fps, 906 video frames (15.1 seconds). Final export remains blocked.

The latest independent review passes the opening, but fails the teaching-board gaze/lean/expression,
curtain grip and return to elbow support, and the closing palm orientation. The closing hand reads as an
outward-facing greeting rather than a palm-up question. All signs are readable in the inspected samples.
Two encoded 16-frame sheets are in `encoded-review/`. Sparse sampling does not establish continuous contact
or smoothness between those frames.

Review evidence is in `episodes/ep-01/quality/d1251145-885a-45c4-acf2-da9b6fd914af/report.json`.
Earlier verdicts passed the teaching-board repair and rejected the opening, whereas this independent pass
does the reverse. This variation prevents a strong quality-improvement claim and shows why a single model
verdict is insufficient evidence of subtle acting. The gate now exposes unresolved defects instead of
automatically shipping them; the acting itself still needs improvement.

Two additional defects were fixed after the interrupted run: target-shot reviews now reject foreign action
IDs and unscoped episode requirements, and author/reviewer interruptions restore every still-unaccepted
scene spec and editable workspace. The old interrupted report remains preserved as evidence; its contaminated
closing verdict is superseded by the fresh review. No rejected checks were silently converted to passes.

Validation for this continuation: typecheck passed; the filtered suite passed 242 tests with 9 skipped,
using the same two exclusions documented below; all three renderer canvas tests passed with
`MOCO_RENDER_TESTS=1`. Eight engine review tests cover scope, acceptance, stale evidence and interruption
rollback. No dependencies were installed. The original baseline findings below describe the earlier pipeline.

## Original result

Completed a fresh **Codex-only** 15-second placebo explainer through Moco's normal planning, local narration,
word alignment, shot authoring, visual review, repair and export stages. No manual edits were made to its artwork.
The earlier Claude run and control were stopped when the user changed providers; no subsequent Claude calls ran.

- Video: `artifacts/autonomous-codex/make-one-15-second-english-explainer-about/episodes/ep-01/renders/final.mp4`
- Two 16-frame encoded review sheets: the project's `encoded-review/contact-1.png` and `contact-2.png`.
- Saved evidence: `autonomy-report.json`, `episodes/ep-01/artifacts/critique.json`, and
  `episodes/ep-01/artist/events.jsonl`, previews, source files and source history.
- Export: H.264/AAC, 1920×1080, 60 fps, 906 frames, approximately 15.1 seconds.
- Narration: 44 words, 15.1047 seconds, Whisper transcript similarity 1.0. This is ASR alignment, not forced alignment.
- The complete project used 19 Codex CLI calls. CLI token totals include repeated prompt context; the adapter does
  not report billing cost. Ledger cost estimates of zero do **not** mean the generation was free.

An additional Codex-only control lets one scene author choose all internal cuts, using the same narration,
approved character source, brief, tools and renderer. Its video is
`artifacts/codex-control/episodes/ep-01/renders/final.mp4`. It inherits the main run's character design and does not
include the same independent review/repair stage, so it is not a fair end-to-end quality or budget ranking.
Neither result recreates the unavailable successful raw-Claude video. Both used the Codex CLI default without
explicit model pinning; exact primary-model identity was not reported by the adapter.

## What the evidence shows

Moco now permits custom artwork and motion, text on physical surfaces, reusable character code and preview-driven
repairs. The encoded review sheets show coherent recurring artwork, readable signs, the pharmacy red X and a
teaching board whose outgoing pulses shrink. They also show restrained acting and simple environments. Opening
the drawing path has not by itself produced the level of acting requested in the original full-length brief.

The independent visual reviewer scored every initial shot 3/5. Its notes identified specific acting problems:
hands did not clearly support a sore elbow, the pointing action did not follow the explanation, the curtain pull
lacked convincing contact, and the final question used a fist-like hand and long pose holds. Moco requested two
repairs. Both were retained at 3/5; the scores do not demonstrate improvement.

Concrete pipeline limitations exposed by this run:

1. **Repair coverage and stopping rules.** The default budget repairs only two of four equally weak shots. A repair
   is kept when its score is equal to the original. The benchmark auto-approved human gates, so unresolved weak
   acting reached export. Interactive users can reject the preview, but there is no automatic final quality gate.
2. **Fragmented review.** Twelve sampled frames per shot fill each review call, so the critic sees only one shot at
   a time. Its saved verdicts explicitly cannot verify recurrence, whole-video pacing, runtime or audio. Supply a
   whole-episode overview and verified technical metadata alongside detailed action sequences.
3. **Shared design revisions.** Freezing the first approved character prevents later shared-file drift, but can
   make expression and pose repairs cumbersome. Versioned shared designs with dependent-shot revalidation would
   preserve consistency while allowing deliberate improvements.
4. **Attempt provenance.** Later review repairs overwrote the latest numbered attempt reports. Source history and
   events survive for this run. The implementation now also saves a unique immutable report per authoring call;
   a regression test verifies that later regeneration preserves the earlier report.
5. **Export reliability.** The control's first export failed because a Remotion temporary output directory was
   missing. A render-only retry succeeded without another model call. Root cause remains unconfirmed.

These observations do not establish how much quality is caused by the model, the prompt or the pipeline. In
particular, weak facial acting is something the author failed to create, not proof that Canvas cannot animate it.

## Provider independence

The engine consumes `AiRequest.artistTools` and `supportsArtist`. Both CLI adapters expose the same application-owned
file/preview callbacks through the shared authenticated MCP bridge. Scenes, manifests, timing, renderer and repair
logic use that common contract. Codex is now the default backend; desktop settings still explicitly choose a
provider. Older CLI scripts use the backend factory instead of hardcoding Claude. Unknown provider names fail
visibly; no provider fallback is used. The desktop custom illustration option works with either supported adapter.

The benchmark intentionally uses procedural art and the installed local voice. Image providers, reference-image
art, Montserrat, full walking rigs, motion blur, music/SFX and mastering from the original brief remain outside this
test. The control's encoded audio measured -17.11 LUFS, not the original brief's -14 LUFS target.

## Validation

- `pnpm typecheck`: passed, including desktop.
- Filtered suite: 234 passed, 8 skipped. Command:
  `pnpm exec vitest run --exclude packages/ai/test/claude-cli.test.ts --exclude packages/kit/test/art.test.ts --maxWorkers=2 --testTimeout=20000`.
  These exclusions retain the earlier Windows fake-executable and art-fixture limitations; this is not an
  unfiltered-suite pass.
- Real-browser canvas tests: 2 passed with `MOCO_RENDER_TESTS=1`, including deterministic out-of-order frames,
  isolation and source-error recovery.
- Live Codex MCP check: successfully invoked Moco's verification tool. The autonomous run subsequently exercised
  file writes, preview images and repairs through that adapter.
- After the provenance change, the four artist integration tests and typecheck passed again.
- Inspected both 16-frame contact sheets for each encoded output. Sampling is not proof against every brief
  single-frame defect. No new dependencies were installed during this continuation.
