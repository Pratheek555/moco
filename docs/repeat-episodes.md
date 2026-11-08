# Repeat illustrated episodes

After an artist series has a completed episode with current passing visual checks, **Next episode** can
start its next planned episode or add one new topic. Planned episodes finish before a new topic is added.
The existing Add episodes workflow remains available for batches and separate plan approval.

The shortcut is opt-in. Normal projects and their approvals keep their existing behavior.

## Review flow

1. Start the next planned episode, or enter a topic. Review the summary of reused characters, voice IDs,
   visual rules, artwork source and output format.
2. Review the script. For a new topic, its outline appears alongside the script and the button explicitly
   approves both. Asking for changes regenerates both drafts. No speech or artwork is generated before approval.
3. Moco creates narration and scenes and runs the existing visual review/repair loop. Important unresolved
   issues remain blocking and appear in the repeat panel. An inspection preview is available when every
   scene has been saved; watching it does not approve a production preview or permit final export.
4. Review and approve the production video preview. Final export still needs a current passing quality
   report tied to the scene, narration and shot-list hashes. The engine stops at episode delivery.

The normal path needs one launch and two review stops. A newly appended episode previously needed a
separate plan review as well: **three reviews become two**. Already-planned later episodes already had
two reviews; their improvement is the explicit reuse summary and visible issues/recovery, not fewer gates.
Duration send-backs and genuine production failures may require further reviews or retries. No wall-clock
or artwork-quality improvement is claimed from fake tests.

## Reuse and recovery

The ledger's optional `repeatEpisodes[episodeId]` record pins the show bible, cast/voice assignments,
production settings, starting continuity and shared source-file hashes. Shared JavaScript must match the
source hashes embedded in the previous episode's accepted scenes. Embedded images are checked against
their saved files. Unreferenced files under `shared/versions/` are not inherited as approved designs.

Files are copied into the new episode's existing artist workspace, verified on retry and locked. The copy
is idempotent and completes before the lock is written. Repeat authoring can write shot files but cannot
replace shared designs or introduce new shared versions. A changed series setup blocks the shortcut
rather than silently adopting different rules or voices. A new/changed recurring design needs a separately
reviewed series/design update; the shortcut does not implement asset management or canon expansion.

The script gate binds the script, episode outline and reuse snapshot. Its hash is also recognised by the
artist permissions check. Restarts preserve the pending combined approval; interrupted stages resume
without appending an extra episode. Rapid duplicate launches are rejected. A memory checkpoint avoids
adding the same episode's facts twice after a crash between the memory save and stage completion.
Learning remains best effort; an interruption after memory is saved can skip that episode's retro.

## Interfaces and boundaries

- Engine: `repeatOffer(seriesId)`, `nextEpisode(seriesId, {topic?})`, and `inspectPreview(EpisodeRef)`.
- Desktop: `series.repeatOffer`, `series.repeat`, `episode.inspect`; existing gate APIs remain in use.
- Existing artist source/manifest and embedded SceneSpec formats are unchanged. This branch does not add
  a new asset library, editing model, learned-style system, licensing flow or provider fallback.
- Voice IDs/backends are reused, not voice recordings copied into projects. Configured voice files and
  installed voices must remain available and unchanged. A different recording behind the same voice ID
  is not fingerprinted by this feature.
- Older artist projects without reusable saved shared designs can continue their standard planned workflow.
  Quality acceptance still uses sampled frames, not proof of every frame's motion or identity consistency.

## Verification

`packages/engine/test/repeat-episode.test.ts` exercises real engine stages with fake model/audio/render
ports: new/planned launch, combined review and revisions, preview approval, locked designs, restart,
duplicate launch, partial-copy recovery, memory recovery and inspection without export permission.

`pnpm --filter @moco/desktop test:repeat-episode` exercises Electron/preload/React with fake IPC: launch,
reuse summary, combined review, reload, issue display, inspection, retry and final preview approval.
It starts no live generation. The existing desktop studio-development test remains a regression check.

### Verification on 8 November 2026

- Workspace/desktop typechecks and desktop build passed.
- All six repeat engine tests and both fake Electron workflow checks passed.
- Pipeline, artist-review, artist-permissions, reuse, review-retry and host regression checks passed.
- The existing full-cut Canvas integration passed in isolation (21.3 seconds). Its test allowance is now
  60 seconds; its former 20-second allowance was exceeded on this workstation, with assertions unchanged.
- A broader engine run was stopped after timeouts, so this is not a claim of a green full suite. The
  repeat fixture was shortened to two shots while retaining all gate/recovery assertions and passed again.
- No live model, speech or paid image-generation runs were used to verify this change.
