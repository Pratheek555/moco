import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, which } from './exec.ts';
import type { AiProvider, CliStatus, CompleteRequest, CompleteResult } from './types.ts';

// Drives the user's installed Claude Code (`claude -p`) on their own
// subscription. Runs in an empty temp dir with every tool disabled, so it acts
// as a plain completion endpoint and never touches the user's files.

export async function claudeStatus(): Promise<CliStatus> {
  const bin = await which('claude');
  if (!bin) return { installed: false };
  try {
    const v = await run(bin, ['--version'], { timeoutMs: 20_000 });
    const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1];
    let loggedIn: boolean | undefined;
    let account: string | undefined;
    const auth = await run(bin, ['auth', 'status'], { timeoutMs: 20_000 }).catch(() => null);
    if (auth?.stdout.trim().startsWith('{')) {
      try {
        const j = JSON.parse(auth.stdout) as { loggedIn?: boolean; authMethod?: string; email?: string };
        loggedIn = j.loggedIn;
        account = j.email ?? j.authMethod;
      } catch {
        /* older CLI */
      }
    }
    return { installed: true, path: bin, version, loggedIn, account };
  } catch (err) {
    return { installed: true, path: bin, error: err instanceof Error ? err.message : String(err) };
  }
}

interface StreamEvent {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  event?: { type: string; delta?: { type: string; text?: string } };
  message?: { model?: string };
  model?: string;
}

export function claudeCli(model?: string): AiProvider {
  return {
    id: 'claude-cli',
    label: 'Claude Code',
    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const bin = await which('claude');
      if (!bin) throw new Error('Claude Code is not installed. Install it from claude.com/code, sign in once, then try again.');
      const started = Date.now();
      const cwd = await mkdtemp(path.join(os.tmpdir(), 'moco-claude-'));
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence', '--strict-mcp-config', '--tools', '', '--system-prompt', req.system];
      if (model) args.push('--model', model);
      let result: StreamEvent | null = null;
      let streamed = '';
      let usedModel: string | undefined;
      req.onStatus?.('Thinking…');
      try {
        const out = await run(bin, args, {
          input: req.prompt,
          cwd,
          signal: req.signal,
          timeoutMs: req.timeoutMs ?? 15 * 60_000,
          onStdoutLine: (line) => {
            let ev: StreamEvent;
            try {
              ev = JSON.parse(line) as StreamEvent;
            } catch {
              return;
            }
            if (ev.type === 'system' && ev.model) usedModel = ev.model;
            if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta' && ev.event.delta.text) {
              if (!streamed) req.onStatus?.('Writing…');
              streamed += ev.event.delta.text;
              req.onText?.(ev.event.delta.text);
            }
            if (ev.type === 'result') result = ev;
          },
        });
        const final = result as StreamEvent | null;
        if (!final) throw new Error(`Claude Code exited without a result (code ${out.code}). ${out.stderr.trim().slice(0, 400)}`);
        if (final.is_error) throw new Error(`Claude Code: ${(final.result ?? final.subtype ?? 'error').slice(0, 500)}`);
        return { text: final.result ?? streamed, model: usedModel, durationMs: Date.now() - started };
      } finally {
        await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
