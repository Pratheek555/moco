import { ANTHROPIC_MODELS, anthropicApi } from './anthropic.ts';
import { claudeCli, claudeStatus } from './claude-cli.ts';
import { codexCli, codexStatus } from './codex-cli.ts';
import { openaiApi } from './openai.ts';
import type { AiProvider, CompleteRequest, ProviderSettings } from './types.ts';

export { ANTHROPIC_MODELS, claudeStatus, codexStatus };
export { extractJson, JsonExtractError } from './json.ts';
export { which } from './exec.ts';
export type * from './types.ts';

export const PROVIDERS = [
  { id: 'claude-cli', name: 'Claude Code', kind: 'subscription', description: 'Uses your Claude Pro/Max plan through the Claude Code app on this computer.' },
  { id: 'codex-cli', name: 'Codex', kind: 'subscription', description: 'Uses your ChatGPT plan through the Codex CLI on this computer.' },
  { id: 'anthropic', name: 'Anthropic API key', kind: 'api', description: 'Pay-as-you-go with your own Anthropic key.' },
  { id: 'openai', name: 'OpenAI API key', kind: 'api', description: 'Pay-as-you-go with your own OpenAI key.' },
] as const;

export const CLAUDE_CLI_MODELS = [
  { id: '', label: 'Claude Code default' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
];

/** A scripted provider for tests and offline demos. */
export function mockProvider(reply: (req: CompleteRequest) => string | Promise<string>): AiProvider {
  return {
    id: 'mock',
    label: 'Mock',
    async complete(req) {
      const started = Date.now();
      const text = await reply(req);
      req.onText?.(text);
      return { text, model: 'mock', durationMs: Date.now() - started };
    },
  };
}

export function createProvider(s: ProviderSettings): AiProvider {
  switch (s.provider) {
    case 'claude-cli':
      return claudeCli(s.model || undefined);
    case 'codex-cli':
      return codexCli(s.model || undefined);
    case 'anthropic':
      if (!s.anthropicKey) throw new Error('Add your Anthropic API key in Settings → AI.');
      return anthropicApi(s.anthropicKey, s.model || 'claude-opus-5-5', s.effort ?? 'medium');
    case 'openai':
      if (!s.openaiKey) throw new Error('Add your OpenAI API key in Settings → AI.');
      return openaiApi(s.openaiKey, s.model || 'gpt-5');
    default:
      throw new Error(`Unknown AI provider: ${s.provider}`);
  }
}

export async function detectClis() {
  const [claude, codex] = await Promise.all([claudeStatus(), codexStatus()]);
  return { claude, codex };
}
