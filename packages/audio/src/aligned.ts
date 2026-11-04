// Optional measured-word alignment for any existing local TTS backend. Does not invent uniform timings.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TimedWord, VisemeTrack } from "@moco/spec";
import type { Line } from "./index.ts";

interface NarrationBackend {
  voices?(language: string): Promise<{ id: string; name: string }[]>;
  tts(lines: Line[], voice: { voiceId: string; backend: string }, language: string, outDir: string, signal?: AbortSignal): Promise<{ file: string; durationSeconds: number; words?: TimedWord[] }>;
  align(file: string, lines: Line[], language: string): Promise<TimedWord[]>;
  visemes(file: string, words: TimedWord[]): Promise<VisemeTrack>;
}

export function alignedAudio(base: NarrationBackend, options: { python: string; model?: string; worker?: string }) {
  return {
    ...base,
    async tts(lines: Line[], voice: { voiceId: string; backend: string }, language: string, outDir: string, signal?: AbortSignal) {
      const spoken = await base.tts(lines, voice, language, outDir, signal);
      const request = join(outDir, "alignment-request.json"), output = join(outDir, "alignment.json");
      await writeFile(request, JSON.stringify({ file: spoken.file, lines, language: language.split("-")[0], model: options.model ?? "small", output }));
      await new Promise<void>((resolve, reject) => {
        const child = spawn(options.python, [options.worker ?? fileURLToPath(new URL("../python/align.py", import.meta.url)), request], { windowsHide: true, signal, stdio: ["ignore", "pipe", "pipe"] });
        let diagnostics = "";
        const collect = (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-2000); };
        child.stdout.on("data", collect); child.stderr.on("data", collect);
        const timer = setTimeout(() => child.kill(), 180_000);
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`Word alignment failed (${code}): ${diagnostics}`)); });
      });
      const aligned = JSON.parse(await readFile(output, "utf8")) as { words: TimedWord[]; similarity: number };
      if (!aligned.words.length || aligned.similarity < 0.65) throw Error(`Narration transcription did not sufficiently match the script (${aligned.similarity}); inspect alignment.json`);
      return { ...spoken, words: aligned.words };
    },
  };
}
