import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, CompleteRequest, CompleteResult } from './types.ts';

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — best quality (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — faster, cheaper' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest' },
];

/** Models that accept `output_config.effort` and server-side refusal fallbacks. */
const MODERN = /^claude-(opus-5|sonnet-5|fable-5)/;

/** Anthropic Messages API with the user's own key (fallback when subscription CLIs aren't an option). */
export function anthropicApi(apiKey: string, model = 'claude-opus-5-5', effort: 'low' | 'medium' | 'high' = 'medium'): AiProvider {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    id: 'anthropic',
    label: 'Anthropic API',
    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const started = Date.now();
      const modern = MODERN.test(model);
      req.onStatus?.('Thinking…');
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          system: req.system,
          messages: [{ role: 'user', content: req.prompt }],
          ...(modern ? { output_config: { effort }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: req.signal, timeout: req.timeoutMs ?? 15 * 60_000 },
      );
      let first = true;
      stream.on('text', (delta) => {
        if (first) req.onStatus?.('Writing…');
        first = false;
        req.onText?.(delta);
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing the idea.');
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      if (message.stop_reason === 'max_tokens') throw new Error('The response was cut off (max tokens). Try fewer episodes or shots.');
      return { text, model: message.model, durationMs: Date.now() - started };
    },
  };
}
