# @moco/ai

One interface, `complete(prompt) -> text`, over several backends:

- `claude-cli`: drives the user's installed Claude Code (`claude -p`) on their subscription
- `codex-cli`: drives the user's installed Codex CLI (`codex exec`) on their ChatGPT subscription
- `api`: Anthropic/OpenAI API keys (fallback if subscription use becomes a problem)
