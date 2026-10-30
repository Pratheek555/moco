# @moco/ai

One interface, `generate(request) -> { text, json, usage }`, over AI backends.

- `claude-cli`: drives the user's installed Claude Code (`claude -p`) on their own subscription. Every call runs in an empty temp folder with no tools, no MCP, `--safe-mode` (no CLAUDE.md/skills/hooks) and structured output via `--json-schema`. Prompt goes in on stdin.

Decision (Oct 2026): Claude Code session only, no API keys. See `docs/reference.md` §2 R1/R2 for the risks of this choice.
