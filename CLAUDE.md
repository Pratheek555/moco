# Moco

## Product idea
A one-time-purchase desktop app for making animated videos with the customer's own AI subscription. The user brings a skill: its instructions, code, assets and taste determine what the agent makes. Moco supplies a workspace, conversation, uploads and access to the resulting files. Projects can use Claude Code or Codex with a ChatGPT subscription.

## Business model and audience
- Lifetime licence, paid once. The user brings their AI subscription; Moco has no paid video API or per-video backend costs.
- The niche is history explanation videos made with the ink-history skill, for faceless history channel operators and creators.
- Compete on creative freedom and a good desktop experience. Competitors include Higgsfield, Mootion, LTX Studio, Revid, AutoShorts, Krikey, InVideo, Predis, HeyGen and VEED.
- Quality depends on the supplied skill and the agent. Subscription integration remains subject to provider terms. A lifetime business needs a continuing stream of buyers.

## Engineering
- `pnpm` workspaces, strict TypeScript, Vitest. Run `pnpm install`, `pnpm typecheck`, `pnpm test`, and `pnpm dev`.
- `packages/agent` is the provider interface, Claude Agent SDK and Codex app-server adapters, skill library and project storage. Consumer Claude Code or ChatGPT login only; no agent-provider API keys or API fallback. Exception: optional user-supplied Gemini narration credentials are encrypted by Electron main via safeStorage and passed only to skill processes as `GEMINI_API_KEY` / `MOCO_GEMINI_TTS_VOICE`; skills own synthesis and Google bills the user.
- `apps/desktop/src/main/index.ts` owns Electron, native dialogs, IPC and confined media serving. `agent-host.ts` runs the provider and `ProjectService` in a utility process. It runs from source: use erasable TypeScript (no enums, parameter properties or namespaces).
- The preload exports one typed `MocoAPI`. The React renderer shows projects, skills, the conversation, questions, tasks and workspace files. Preserve context isolation, sandboxing and disabled Node integration.
- Each project pins its provider and one imported skill in `.claude/skills/<name>/` (Claude) or `.agents/skills/<name>/` (Codex). Preserve the provider's ordinary toolset. No application-authored creative workflow, output schema, validation, render pipeline or repair loop.
- JSON metadata and an append-only conversation live in app-data; workspaces default to Documents/moco. Persist the provider's session ID and resume it after restart.
- Claude's `AskUserQuestion` is a pending SDK callback; Codex uses `moco_AskUserQuestion` and native user-input requests. The renderer's answers resolve them. Claude's `mcp__moco__SendUserFile` and Codex's `moco_SendUserFile` hand workspace files to the user. The file panel also discovers media independently.
- Appearance settings remain; old voice, renderer, account-switching and production settings do not apply. Settings ? Narration holds the optional Gemini key and prebuilt voice; ink-history project narration preferences still apply, and uploads take precedence. There was no licence implementation to preserve.
- See [docs/reference.md](docs/reference.md) for the contracts and checks. Do not commit or run live subscription tests unless the task authorizes them.
