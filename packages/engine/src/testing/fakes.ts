// Fakes for engine tests and for building the UI before the real renderer and TTS exist.
// Exported as "@moco/engine/testing".
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiBackend, AiRequest, AiResult } from "@moco/ai";
import { FPS, type SceneSpec, type TimedWord, type VisemeTrack } from "@moco/spec";
import type { AudioPort, RenderError, RenderPort } from "../ports.ts";

// The task a request is for, read from the prompt template's header ("<!-- prompt: scene v1 -->").
export function taskOf(request: AiRequest): string {
  return /<!-- prompt: (\w+)/.exec(request.system)?.[1] ?? "unknown";
}

// AI that answers with whatever the handler returns as structured output. Records every request.
export class FakeAi implements AiBackend {
  id = "fake-ai";
  readonly requests: AiRequest[] = [];

  private readonly handler: (request: AiRequest, task: string) => unknown | Promise<unknown>;

  constructor(handler: (request: AiRequest, task: string) => unknown | Promise<unknown>) {
    this.handler = handler;
  }

  async available() {
    return { ok: true, authMethod: "fake" };
  }

  async generate(request: AiRequest): Promise<AiResult> {
    this.requests.push(request);
    const json = await this.handler(request, taskOf(request));
    return { text: JSON.stringify(json), json, backend: this.id, usage: { costUsdEstimate: 0 } };
  }
}

// Renderer that writes empty files. `failFor` returns errors to inject for a given spec.
export class FakeRenderPort implements RenderPort {
  checks = 0;
  renders = 0;

  private readonly failFor: (spec: SceneSpec) => RenderError[];

  constructor(failFor: (spec: SceneSpec) => RenderError[] = () => []) {
    this.failFor = failFor;
  }

  async check(spec: SceneSpec, opts: { frames: number[]; outDir: string }) {
    this.checks += 1;
    const errors = this.failFor(spec);
    if (errors.length > 0) return { ok: false as const, errors };
    await mkdir(opts.outDir, { recursive: true });
    const stills = opts.frames.map((frame) => join(opts.outDir, `${frame}.png`));
    await Promise.all(stills.map((still) => writeFile(still, "")));
    return { ok: true as const, stills };
  }

  async renderEpisode(episode: { scenes: SceneSpec[] }, out: string) {
    this.renders += 1;
    await mkdir(join(out, ".."), { recursive: true });
    await writeFile(out, "");
    const frames = episode.scenes.reduce((total, scene) => total + scene.durationFrames, 0);
    return { path: out, durationSeconds: frames / 30 };
  }

  versions() {
    return { kitVersion: "fake", rendererVersion: "fake" };
  }
}

// TTS that "speaks" at a fixed rate, with exact word timings.
export class FakeAudio implements AudioPort {
  private readonly secondsPerWord: number;

  constructor(secondsPerWord = 0.4) {
    this.secondsPerWord = secondsPerWord;
  }

  async tts(lines: { id: string; text: string }[], _voice: unknown, _language: string, outDir: string) {
    await mkdir(outDir, { recursive: true });
    const file = join(outDir, "vo.wav");
    await writeFile(file, "");
    const words = this.time(lines);
    return { file, durationSeconds: (words.at(-1)?.end ?? 0) + 0.2, words };
  }

  async align(_file: string, lines: { id: string; text: string }[]) {
    return this.time(lines);
  }

  // Mouth open ("C") during every word, resting ("X") between them.
  async visemes(_file: string, words: TimedWord[]): Promise<VisemeTrack> {
    return words.flatMap((word) => [
      { frame: Math.round(word.start * FPS), viseme: "C" },
      { frame: Math.round(word.end * FPS), viseme: "X" },
    ]);
  }

  private time(lines: { id: string; text: string }[]): TimedWord[] {
    const tokens = lines.flatMap((line) => line.text.split(/\s+/).filter(Boolean).map((text) => ({ text, lineId: line.id })));
    return tokens.map((token, index) => ({ ...token, start: index * this.secondsPerWord, end: (index + 1) * this.secondsPerWord - 0.05 }));
  }
}
