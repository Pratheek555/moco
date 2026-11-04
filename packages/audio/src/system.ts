// Voiceover from the voices that ship with the OS: `say` on macOS, SAPI on Windows, espeak-ng on Linux.
// Free, offline and always there; less natural than a neural voice. Ported from main's @moco/audio (system.ts).
// Each line is spoken on its own, then the lines are joined with a short pause into one 16-bit WAV.
// The OS voices give no word timings, so each line's words are spread over that line's measured length.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TimedWord } from "@moco/spec";
import { amplitudeVisemes, parseWav, type Pcm } from "./lipsync.ts";
import type { Line } from "./index.ts";

export interface SystemAudioOptions {
  voice?: string; // an installed voice name ("Samantha", "Microsoft Zira Desktop", "en-us"); empty = the OS default
  rate?: number; // 1 = normal speed
}

const PAUSE_SECONDS = 0.25; // silence between lines
const TAIL_SECONDS = 0.4; // silence after the last line

export interface VoiceInfo {
  id: string;
  name: string;
  locale: string;
}

// Same shape as the engine's AudioPort.
export function systemAudio(options: SystemAudioOptions = {}) {
  return {
    async voices(language: string) {
      return (await systemVoices()).filter((voice) => voice.locale.split("-")[0] === language.split("-")[0]).map(({ id, name }) => ({ id, name }));
    },
    async tts(lines: Line[], _voice: { voiceId: string; backend: string }, language: string, outDir: string, signal?: AbortSignal) {
      const voice = pickVoice(await systemVoices(), language, options.voice);
      const work = await mkdtemp(join(tmpdir(), "moco-tts-"));
      try {
        const spoken: Pcm[] = [];
        for (const [index, line] of lines.entries()) {
          const chosen = line.voiceId && line.voiceId !== "default" ? line.voiceId : voice;
          spoken.push(parseWav(await speak(line.text, join(work, `line-${index}.wav`), { ...options, voice: chosen }, signal)));
        }
        const joined = joinLines(lines, spoken);
        await mkdir(outDir, { recursive: true });
        const file = join(outDir, "vo.wav");
        await writeFile(file, wavFrom(joined.pcm));
        return { file, durationSeconds: joined.pcm.samples.length / joined.pcm.sampleRate, words: joined.words };
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },
    // The OS voices give no timings to align against; tts() already timed every word.
    async align(): Promise<TimedWord[]> {
      throw new Error("system voices give their word timings from tts(); align() is never needed");
    },
    async visemes(file: string, words: TimedWord[]) {
      return amplitudeVisemes(parseWav(await readFile(file)), words);
    },
  };
}

// A voice that can speak `language`: the user's choice if it can, otherwise the first installed one.
// macOS voices read a script they don't know as near-silence, so a mismatch has to be caught here.
// English keeps the OS default: the first English voices macOS lists are novelty ones ("Albert", "Bad News").
export function pickVoice(voices: VoiceInfo[], language: string, chosen: string | undefined): string | undefined {
  const code = language.split("-")[0]!;
  const speakers = voices.filter((voice) => voice.locale.split("-")[0]!.toLowerCase() === code);
  if (speakers.some((voice) => voice.id === chosen)) return chosen;
  if (code === "en") return undefined;
  if (speakers[0]) return speakers[0].id;
  throw new Error(`No ${language} voice is installed on this computer. Add one in your system's speech settings, then try again.`);
}

// The lines one after another with a pause between them, and every word's time in the joined audio.
export function joinLines(lines: Line[], spoken: Pcm[]): { pcm: Pcm; words: TimedWord[] } {
  if (lines.length !== spoken.length) throw new Error("Every narration line needs exactly one audio clip");
  const sampleRate = spoken[0]?.sampleRate ?? 16_000;
  const pauseAt = (index: number) => Math.round((lines[index]?.delivery?.pauseAfterMs ?? PAUSE_SECONDS * 1000) * sampleRate / 1000);
  const tail = Math.round(TAIL_SECONDS * sampleRate);
  const total = spoken.reduce((sum, pcm, index) => sum + pcm.samples.length + (index < spoken.length - 1 ? pauseAt(index) : 0), 0) + tail;
  const samples = new Float32Array(Math.max(total, tail));
  const words: TimedWord[] = [];

  let offset = 0;
  for (const [index, pcm] of spoken.entries()) {
    if (pcm.sampleRate !== sampleRate) throw new Error(`line ${index} came back at ${pcm.sampleRate} Hz, the others at ${sampleRate} Hz`);
    samples.set(pcm.samples, offset);
    words.push(...timeWords(lines[index]!, offset / sampleRate, pcm.samples.length / sampleRate));
    offset += pcm.samples.length + pauseAt(index);
  }
  return { pcm: { sampleRate, samples }, words };
}

// A line's words across its spoken length, each word's share in proportion to its letters.
function timeWords(line: Line, start: number, duration: number): TimedWord[] {
  const texts = line.text.split(/\s+/).filter(Boolean);
  const letters = texts.reduce((sum, text) => sum + text.length, 0) || 1;
  let before = 0;
  return texts.map((text) => {
    const wordStart = start + (duration * before) / letters;
    before += text.length;
    return { text, start: wordStart, end: start + (duration * before) / letters, lineId: line.id };
  });
}

// 16-bit mono PCM WAV of the samples.
export function wavFrom(pcm: Pcm): Buffer {
  const dataBytes = pcm.samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(pcm.sampleRate, 24);
  wav.writeUInt32LE(pcm.sampleRate * 2, 28); // byte rate
  wav.writeUInt16LE(2, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  pcm.samples.forEach((sample, index) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  return wav;
}

// ---------- the OS voices ----------

// Speaks `text` into a 16-bit WAV at `out` and returns its bytes. The text goes in a file, never on a command line.
async function speak(text: string, out: string, options: SystemAudioOptions, signal?: AbortSignal): Promise<Buffer> {
  const textFile = `${out}.txt`;
  await writeFile(textFile, text, "utf8");
  const rate = options.rate ?? 1;

  if (process.platform === "darwin") {
    const args = ["-r", String(Math.round(180 * rate)), "-o", out, "--file-format=WAVE", "--data-format=LEI16@22050", "-f", textFile];
    if (options.voice) args.unshift("-v", options.voice);
    await run("say", args, {}, signal);
  } else if (process.platform === "win32") {
    const scriptFile = `${out}.ps1`;
    await writeFile(scriptFile, SAPI_SCRIPT, "utf8");
    const sapiRate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)));
    const env = { MOCO_TEXT: textFile, MOCO_VOICE: options.voice ?? "", MOCO_RATE: String(sapiRate), MOCO_OUT: out };
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile], env, signal);
  } else {
    const args = ["-w", out, "-s", String(Math.round(165 * rate)), "-f", textFile];
    if (options.voice) args.unshift("-v", options.voice);
    await run("espeak-ng", args, {}, signal); // the user's installed espeak-ng; we don't ship it (GPL-3)
  }
  return readFile(out);
}

// Writes 16-bit mono WAV with Windows' built-in speech (System.Speech).
const SAPI_SCRIPT = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:MOCO_VOICE) { try { $s.SelectVoice($env:MOCO_VOICE) } catch {} }
$s.Rate = [int]$env:MOCO_RATE
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($env:MOCO_OUT, $format)
$s.Speak([IO.File]::ReadAllText($env:MOCO_TEXT, [Text.Encoding]::UTF8))
$s.SetOutputToNull()
$s.Dispose()
`;

// The installed voices, for the voice picker in Settings.
export async function systemVoices(): Promise<VoiceInfo[]> {
  if (process.platform === "darwin") {
    const { stdout } = await run("say", ["-v", "?"]);
    const voices = stdout.split("\n").filter(Boolean).map(parseSayVoice);
    return [...new Map(voices.map((voice) => [voice.id, voice])).values()]; // macOS lists some voices twice
  }
  if (process.platform === "win32") {
    const script = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $v = $_.VoiceInfo; \"$($v.Name)|$($v.Culture)\" }";
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return stdout.split(/\r?\n/).filter(Boolean).map(parseSapiVoice);
  }
  const { stdout } = await run("espeak-ng", ["--voices"]).catch(() => ({ stdout: "" }));
  return stdout.split("\n").slice(1).filter(Boolean).map(parseEspeakVoice);
}

// "Samantha            en_US    # Hello! My name is Samantha."
function parseSayVoice(line: string): VoiceInfo {
  const match = /^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#/.exec(line);
  const name = match?.[1]?.trim() ?? line.trim();
  return { id: name, name, locale: (match?.[2] ?? "").replace("_", "-") };
}

// "Microsoft Zira Desktop|en-US"
function parseSapiVoice(line: string): VoiceInfo {
  const [name = "", locale = ""] = line.split("|");
  return { id: name, name: name.replace(/^Microsoft /, "").replace(/ Desktop$/, ""), locale };
}

// " 5  en-us          --/M      English_(America)  gmw/en-US"
function parseEspeakVoice(line: string): VoiceInfo {
  const parts = line.trim().split(/\s+/);
  return { id: parts[1] ?? "en", name: parts[3] ?? "voice", locale: parts[1] ?? "" };
}

function run(command: string, args: string[], env: Record<string, string> = {}, signal?: AbortSignal) {
  return new Promise<{ stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, windowsHide: true, signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ stdout }) : reject(new Error(`${command} failed (${code}): ${stderr.trim() || stdout.trim()}`))));
  });
}
