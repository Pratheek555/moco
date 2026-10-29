import spawn from 'cross-spawn';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TtsRequest, TtsResult, VoiceInfo } from './types.ts';

// Offline voices that ship with the OS: SAPI on Windows, `say` on macOS,
// espeak-ng on Linux. Lower quality than neural voices, but always available.

function run(cmd: string, args: string[], env: Record<string, string> = {}, signal?: AbortSignal, input?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    signal?.addEventListener('abort', () => child.kill(), { once: true });
    if (input !== undefined) child.stdin?.end(input);
  });
}

const SAPI_HELPER = `
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @"
using System; using System.Text; using System.Speech.Synthesis; using System.Globalization;
public static class MocoTts {
  public static string Run(string text, string voice, int rate, string outPath) {
    var s = new SpeechSynthesizer();
    if (!String.IsNullOrEmpty(voice)) { try { s.SelectVoice(voice); } catch {} }
    s.Rate = rate;
    var sb = new StringBuilder("[");
    bool first = true;
    s.SpeakProgress += (o, e) => { lock (sb) { if (!first) sb.Append(","); first = false; sb.Append("{\\"t\\":" + e.AudioPosition.TotalSeconds.ToString(CultureInfo.InvariantCulture) + ",\\"p\\":" + e.CharacterPosition + ",\\"n\\":" + e.CharacterCount + "}"); } };
    s.SetOutputToWaveFile(outPath);
    s.Speak(text);
    s.SetOutputToNull();
    s.Dispose();
    return sb.Append("]").ToString();
  }
}
"@
$text = [IO.File]::ReadAllText($env:MOCO_TEXT, [Text.Encoding]::UTF8)
[MocoTts]::Run($text, $env:MOCO_VOICE, [int]$env:MOCO_RATE, $env:MOCO_OUT)
`;

export async function systemVoices(): Promise<VoiceInfo[]> {
  if (process.platform === 'win32') {
    const script = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $v = $_.VoiceInfo; \"$($v.Name)|$($v.Culture)|$($v.Gender)\" }";
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name = '', locale = '', gender = ''] = line.split('|');
        return { id: name, name: name.replace(/^Microsoft /, '').replace(/ Desktop$/, ''), locale, gender: gender.toLowerCase(), provider: 'system' as const };
      });
  }
  if (process.platform === 'darwin') {
    const { stdout } = await run('say', ['-v', '?']);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const m = /^(.+?)\s+([a-z]{2}[_-][A-Z]{2})/.exec(line);
        return { id: m?.[1]?.trim() ?? line, name: m?.[1]?.trim() ?? line, locale: (m?.[2] ?? '').replace('_', '-'), gender: '', provider: 'system' as const };
      });
  }
  const { stdout } = await run('espeak-ng', ['--voices']).catch(() => ({ stdout: '' }));
  return stdout
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return { id: parts[4] ?? parts[1] ?? 'en', name: parts[3] ?? 'voice', locale: parts[1] ?? '', gender: '', provider: 'system' as const };
    });
}

export async function systemSynthesize(req: TtsRequest): Promise<TtsResult> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'moco-tts-'));
  const out = path.join(dir, 'out.wav');
  const textFile = path.join(dir, 'text.txt');
  try {
    await writeFile(textFile, req.text, 'utf8');
    if (process.platform === 'win32') {
      const rate = Math.max(-10, Math.min(10, Math.round(((req.rate ?? 1) - 1) * 10)));
      const scriptFile = path.join(dir, 'tts.ps1');
      await writeFile(scriptFile, `﻿${SAPI_HELPER}`, 'utf8');
      const { code, stdout, stderr } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], { MOCO_TEXT: textFile, MOCO_VOICE: req.voice ?? '', MOCO_RATE: String(rate), MOCO_OUT: out }, req.signal);
      if (code !== 0) throw new Error(`Windows speech failed: ${stderr.trim() || stdout.trim()}`);
      const marks = JSON.parse(stdout.trim().split(/\r?\n/).pop() || '[]') as { t: number; p: number; n: number }[];
      const audio = await readFile(out);
      const words = marks.map((m, i) => ({ text: req.text.substr(m.p, m.n), start: m.t, end: marks[i + 1]?.t ?? m.t + 0.4 }));
      return { audio, ext: '.wav', words };
    }
    if (process.platform === 'darwin') {
      const wpm = Math.round(180 * (req.rate ?? 1));
      const args = ['-r', String(wpm), '-o', out, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', textFile];
      if (req.voice) args.unshift('-v', req.voice);
      const { code, stderr } = await run('say', args, {}, req.signal);
      if (code !== 0) throw new Error(`macOS say failed: ${stderr}`);
      return { audio: await readFile(out), ext: '.wav', words: [] };
    }
    const args = ['-w', out, '-s', String(Math.round(165 * (req.rate ?? 1))), '-f', textFile];
    if (req.voice) args.unshift('-v', req.voice);
    const { code, stderr } = await run('espeak-ng', args, {}, req.signal);
    if (code !== 0) throw new Error(`espeak-ng failed: ${stderr}`);
    return { audio: await readFile(out), ext: '.wav', words: [] };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
