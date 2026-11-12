# Desktop

Electron shell for Moco's skill-driven agent workspace. Main owns dialogs and safe media serving; the source utility process runs the Claude SDK or Codex app-server adapter and project service; preload exposes the typed API; React displays projects, chat, questions, tasks and files. Choose the AI provider when creating a project. The project keeps its provider and resumable session across restarts.

From the repository root: `pnpm dev`, `pnpm typecheck`, `pnpm test`.
Build with `pnpm --filter @moco/desktop build`, then run `pnpm test:desktop` for the no-AI Electron smoke check. `pnpm --filter @moco/desktop dist` builds installers. See [reference](../../docs/reference.md) for storage, process boundaries and packaging.
