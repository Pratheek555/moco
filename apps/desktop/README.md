# Desktop

Electron shell for Moco's skill-driven agent workspace. Main owns dialogs and safe media serving; the source utility process runs the Claude SDK or Codex app-server adapter and project service; preload exposes the typed API; React displays projects, chat, questions, tasks and files. Choose the AI provider when creating a project. The project keeps its provider and resumable session across restarts.

New projects always start with Codex selected, including when Claude is connected or was used previously. Connection checks never switch the chosen provider. Claude remains an explicit per-project option; existing conversations keep their provider and saved session.

For ink-history projects, choose a narration voice when creating a project or under the conversation header's **Project options → Narration voice**. **Zonos** uses the kit's expressive local voice; the agent installs its model on first synthesis and sets the story's engine. CUDA is recommended; CPU generation can be slow. The choice is saved per project and reaches both AI providers on the next message. **Use story default** clears the app override and keeps the story's current voice settings. Uploaded narration takes precedence. Older imported skill copies need Zonos support from the updated ink-history skill.

Settings ? **Narration** can save your own Gemini key encrypted on this computer, check it without audio generation, and choose a prebuilt voice. Google bills narration usage to you. Ink-history projects can select **Gemini** when a key is saved; explicit local choices and uploaded narration still win. Key/voice changes reach both providers on the next idle run without restarting Moco. Existing project skill copies need a new import/new project to receive Gemini support.

From the repository root: `pnpm dev`, `pnpm typecheck`, `pnpm test`.
Build with `pnpm --filter @moco/desktop build`, then run `pnpm test:desktop` for the no-AI Electron smoke check. `pnpm --filter @moco/desktop dist` builds installers. See [reference](../../docs/reference.md) for storage, process boundaries and packaging.

The smoke check uses a temporary profile and project directory. It covers imports, project creation/provider selection, attachments, transcript/questions, the media viewer, file confinement, draft persistence, slow IPC completion across navigation, the files drawer at minimum width and 125% UI zoom, deletion, and theme persistence across restart. It never sends an AI inference request.

After building, capture the UI in both themes with `pnpm --filter @moco/desktop test:screenshots ../../artifacts/ui-qa both`. The script seeds disposable projects and media, captures Home, setup, Skills, all settings sections, dialogs, conversation/work logs, viewer, activity/error/empty states and narrow layouts. It writes `qa-results.json` and exits unsuccessfully if a screen or renderer check fails. FFmpeg is optional and adds playable audio/video fixtures when installed.

To verify the packaged Windows app, run `pnpm --filter @moco/desktop exec electron-builder --dir --win --config electron-builder.yml`, then set `MOCO_SMOKE_EXEC` to the absolute path of `release/win-unpacked/Moco.exe` when running the smoke script. Packaging includes the allowlisted ink-history starter skill. No other example skill is bundled.

Before public distribution, configure release signing and the release/update channel. Paid licence activation is a separate backend integration. Native notifications and drag-out still need an OS-level check; macOS/Linux packaging and codec availability need checks on their target systems.
