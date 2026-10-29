import type { AiProvider, CompleteRequest, CompleteResult } from './types.ts';

/** OpenAI Chat Completions with the user's own key, streamed over SSE. */
export function openaiApi(apiKey: string, model = 'gpt-5'): AiProvider {
  return {
    id: 'openai',
    label: 'OpenAI API',
    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const started = Date.now();
      req.onStatus?.('Thinking…');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 15 * 60_000);
      req.signal?.addEventListener('abort', () => controller.abort(), { once: true });
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: true,
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.prompt },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`OpenAI API error ${res.status}: ${(await res.text()).slice(0, 400)}`);
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let usedModel: string | undefined;
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const data = line.replace(/^data:\s*/, '').trim();
            if (!data || data === '[DONE]' || !line.startsWith('data:')) continue;
            try {
              const j = JSON.parse(data) as { model?: string; choices?: { delta?: { content?: string } }[] };
              usedModel ??= j.model;
              const delta = j.choices?.[0]?.delta?.content;
              if (delta) {
                if (!text) req.onStatus?.('Writing…');
                text += delta;
                req.onText?.(delta);
              }
            } catch {
              /* keep-alive or partial line */
            }
          }
        }
        return { text, model: usedModel, durationMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
