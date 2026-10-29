import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, which } from './exec.ts';
import type { AiProvider, CliStatus, CompleteRequest, CompleteResult } from './types.ts';

// Drives the user's installed Codex CLI (`codex exec`) on their ChatGPT plan,
// sandboxed read-only inside an empty temp dir.

export async function codexStatus(): Promise<CliStatus> {
  const bin = await which('codex');
  if (!bin) return { installed: false };
  try {
    const v = await run(bin, ['--version'], { timeoutMs: 20_000 });
    const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1];
    const login = await run(bin, ['login', 'status'], { timeoutMs: 20_000 }).catch(() => null);
    const text = `${login?.stdout ?? ''}${login?.stderr ?? ''}`;
    const loggedIn = login ? login.code === 0 && /logged in/i.test(text) : undefined;
    return { installed: true, path: bin, version, loggedIn, account: /using (.+)/i.exec(text)?.[1]?.trim() };
  } catch (err) {
    return { installed: true, path: bin, error: err instanceof Error ? err.message : String(err) };
  }
}

export function codexCli(model?: string): AiProvider {
  return {
    id: 'codex-cli',
    label: 'Codex',
    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const bin = await which('codex');
      if (!bin) throw new Error('Codex CLI is not installed. Install it, run `codex login`, then try again.');
      const started = Date.now();
      const cwd = await mkdtemp(path.join(os.tmpdir(), 'moco-codex-'));
      const outFile = path.join(cwd, 'last-message.txt');
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '--json', '-C', cwd, '-o', outFile];
      if (model) args.push('-m', model);
      args.push('-');
      const prompt = `${req.system}\n\n---\n\n${req.prompt}\n\nDo not run commands or read files; answer directly.`;
      req.onStatus?.('Thinking…');
      try {
        const out = await run(bin, args, {
          input: prompt,
          cwd,
          signal: req.signal,
          timeoutMs: req.timeoutMs ?? 15 * 60_000,
          onStdoutLine: (line) => {
            try {
              const ev = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
              if (ev.type === 'item.completed' && ev.item?.type === 'reasoning') req.onStatus?.('Reasoning…');
              if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) {
                req.onStatus?.('Writing…');
                req.onText?.(ev.item.text);
              }
            } catch {
              /* non-JSON progress line */
            }
          },
        });
        const text = await readFile(outFile, 'utf8').catch(() => '');
        if (!text.trim()) throw new Error(`Codex returned nothing (code ${out.code}). ${out.stderr.trim().slice(-400)}`);
        return { text, model, durationMs: Date.now() - started };
      } finally {
        await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
