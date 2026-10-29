import spawn from 'cross-spawn';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isWin = process.platform === 'win32';

let shellPath: Promise<string> | null = null;

/**
 * GUI apps on macOS/Linux don't inherit the login shell's PATH, so `claude`
 * installed via npm/brew isn't found. Ask the user's shell once.
 */
function loginShellPath(): Promise<string> {
  if (isWin) return Promise.resolve(process.env.PATH ?? '');
  shellPath ??= new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    execFile(shell, ['-ilc', 'printf "__MOCO__%s__MOCO__" "$PATH"'], { timeout: 5000 }, (err, stdout) => {
      const m = /__MOCO__(.*)__MOCO__/.exec(stdout ?? '');
      resolve(!err && m ? m[1]! : process.env.PATH ?? '');
    });
  });
  return shellPath;
}

function extraDirs() {
  const home = os.homedir();
  const dirs = [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin')];
  if (isWin) {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    dirs.push(path.join(appData, 'npm'), path.join(local, 'Programs', 'claude'), path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin'), path.join(local, 'Microsoft', 'WinGet', 'Links'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  }
  return dirs;
}

export async function augmentedEnv(): Promise<NodeJS.ProcessEnv> {
  const base = await loginShellPath();
  const parts = new Set([...base.split(path.delimiter), ...extraDirs()].filter(Boolean));
  const key = isWin ? Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'Path' : 'PATH';
  const env: NodeJS.ProcessEnv = { ...process.env, [key]: [...parts].join(path.delimiter) };
  // If Moco itself was launched from inside a Claude Code session, don't let the
  // child CLI think it's a nested sub-session.
  for (const k of Object.keys(env)) if (/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_AGENT_SDK)/.test(k)) delete env[k];
  return env;
}

/** Find an executable on the (augmented) PATH. Returns an absolute path or null. */
export async function which(name: string): Promise<string | null> {
  const env = await augmentedEnv();
  const pathVar = Object.entries(env).find(([k]) => k.toLowerCase() === 'path')?.[1] ?? '';
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of isWin ? [...exts, ''] : exts) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate) && (!isWin || ext)) return candidate;
    }
  }
  return null;
}

export interface RunOptions {
  input?: string;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawn a CLI, stream stdout lines, enforce a timeout and honour aborts. */
export async function run(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const env = await augmentedEnv();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      child.kill();
      done(() => reject(new Error('Cancelled')));
    };
    const timer = setTimeout(() => {
      child.kill();
      done(() => reject(new Error(`${path.basename(command)} timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s`)));
    }, opts.timeoutMs ?? 15 * 60_000);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (!opts.onStdoutLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) opts.onStdoutLine(line);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      opts.onStderr?.(chunk);
    });
    child.on('error', (err) => done(() => reject(err)));
    child.on('close', (code) => {
      if (pending.trim() && opts.onStdoutLine) opts.onStdoutLine(pending);
      done(() => resolve({ code: code ?? 1, stdout, stderr }));
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input, 'utf8');
    else child.stdin?.end();
  });
}
