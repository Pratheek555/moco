# Moco

A thin desktop workspace for your skills and AI subscription. Import a skill, create a project, and talk to Claude Code or Codex. The skill decides how to make the video; Moco shows the conversation and hands back the files.

## Run

Use Node 22.18+ (or a current Node LTS), pnpm, and either:

- [Claude Code](https://code.claude.com/docs/en/setup), signed in to a Claude subscription. On Windows, Claude Code also needs Git for Windows.
- [Codex CLI](https://developers.openai.com/codex/cli), signed in with ChatGPT using `codex login`. Use a current CLI with app-server support. Native Windows, macOS and Linux installs and npm installs are supported.

Moco uses the selected provider's existing local login, never an API key. You only need to install the provider you choose.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Import **SKILL.md** for instructions alone, or import a **folder containing SKILL.md** to include supporting code and assets. **Codex is the default AI provider** for new projects; you can choose Claude Code instead. Choose the skill and a project name, then send a message. Answer agent questions in the chat and attach files whenever they are ready. Use Stop to end the current session; a later message resumes it. The connection banner has sign-in instructions and **Check again** if the selected provider isn't ready.

Workspaces default to **Documents/moco/**. Skills and conversations are kept in Moco's app-data folder. Each project keeps its chosen provider; reopening restores its chat and resumes that provider's session on the next message. Existing projects continue using Claude Code. Light, dark and system appearance are available in the sidebar.

The agent has its provider's normal tools and runs without individual tool approvals. Only import skills you intend to run with your account and filesystem access. Its current directory is the project's workspace.

Images, audio and videos appear inline. Every file has **Open** and **Show in folder**. The agent can call `mcp__moco__SendUserFile` (Claude) or `moco_SendUserFile` (Codex) for explicit delivery; the file panel also discovers media throughout the workspace. Files created outside it must be copied into the workspace before delivery.

## Development

- `packages/agent`: provider-neutral session/events, Claude SDK and Codex app-server providers, filesystem storage.
- `apps/desktop`: Electron main, source utility process, typed preload, React UI and existing UI components.
- `examples/skills/cartoon-audio-short/SKILL.md`: unmodified reference fixture. **The supplied example did not include its `kit/`**; intake works, but full production requires the complete skill folder and its listed tools. Moco does not install skill-specific dependencies.
- `pnpm agent:check`: checks Claude Code and its subscription login. `pnpm agent:check --codex` checks Codex and its ChatGPT login without inference. Add `--live` to either command to make one short real intake turn with the reference skill, then stop (uses your subscription).
- `pnpm --filter @moco/desktop build` and `pnpm test:desktop`: build and smoke-test the actual Electron UI, without AI calls.
- `pnpm --filter @moco/desktop dist`: package the app. The utility host sources ship outside node_modules with ASAR disabled for Node type stripping.

See [architecture reference](docs/reference.md). The existing `website/` is independent of the desktop workspace and was left intact. Legacy generated projects, downloaded models and local artifacts are not imported into the new project library.
