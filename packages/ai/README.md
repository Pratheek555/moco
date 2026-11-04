# @moco/ai

One interface, `generate(request) -> { text, json, usage }`, over AI backends.

- `claude-cli`: drives the user's installed Claude Code (`claude -p`) on their own subscription. Every call runs in an empty temp folder with no tools, no MCP, `--safe-mode` (no CLAUDE.md/skills/hooks) and structured output via `--json-schema`. Prompt goes in on stdin.

The desktop app lets you choose Claude Code or Codex under Settings > AI connection. The choice applies to generation, visual review, and template learning. Existing workspaces default to Claude Code.

- `codex-cli`: uses the installed `codex exec` and its existing login (`codex login`). Runs read-only in a temporary directory with shell and web search disabled, ignores user config, and attaches images explicitly. Prompts travel on stdin. JSON schemas travel in the prompt because Moco uses optional fields and dynamic-key records; callers validate and repair responses. Token usage comes from JSONL turn events; Codex does not report a dollar estimate.

Codex requires a recent CLI supporting `--ignore-user-config` and `--ephemeral`. Install/update with `npm install -g @openai/codex`. No API key needs to be entered into Moco.

CLI details: https://learn.chatgpt.com/docs/non-interactive-mode and https://learn.chatgpt.com/docs/config-file/config-reference.
