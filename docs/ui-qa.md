# Desktop UI verification

Verified on Windows on 14 November 2026. The UI implementation follows [design.md](design.md); repeatable commands are in the [desktop README](../apps/desktop/README.md).

## Implemented

- Home with recent-project covers and attention states; first-run connection, skill and project setup.
- Skill import, starter skills, project creation, rename/delete, command palette and settings.
- Markdown conversation, folded work details, questions, elapsed status, attachment drop/paste, persistent drafts and streaming scroll controls.
- Progress, output cards, file tree, image/video/audio/text viewer, save/reveal/copy actions, and a files drawer for constrained widths and zoom.
- Light/dark/system themes, native window layout and persistence, shortcuts, notifications and active-work quit confirmation.
- Codex as the default for every new project, without automatic fallback to Claude. Saved projects retain their own provider/session; Claude is an explicit alternative.

## Results

- Root and desktop TypeScript checks passed.
- Vitest: 164 tests passed across 18 files.
- Electron production build passed.
- Real Electron smoke checks passed in development-build and packaged Windows modes; no renderer console errors.
- Windows unpacked application built at `apps/desktop/release/win-unpacked/Moco.exe`; bundled ink-history starter imported with its supporting kit.
- Light/dark capture run covers 52 screenshots, including first run, disconnected setup, Skills, creation, settings, palette, conversation, work details, viewer, running/error/empty states, minimum width and 125% zoom. Current evidence is under `artifacts/ui-qa-codex/` with machine-readable results in `qa-results.json` (local ignored artifacts).

Regression coverage includes unsent drafts on cancelled startup, late upload/send completion after navigation, failed folder-trash retry, delayed provider-connection checks, draft/theme persistence, viewer interaction, and file access at narrow widths. Smoke tests use temporary profiles and mocked send completions; they never request AI inference. Demo media is synthetic QA fixture content.

## Release work still required

- Configure release signing and installer/update distribution. The tested unpacked Windows build is unsigned.
- Integrate paid licence activation if required for the commercial release.
- Verify native notifications and drag-out with actual OS targets; exercise installers and codecs on each supported OS. macOS/Linux builds were not tested here.
- Run an explicitly authorized end-to-end Codex video-generation trial separately from these no-inference UI checks.

Changes are left uncommitted alongside existing workspace edits.
