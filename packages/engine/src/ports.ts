// What the engine needs from the renderer and audio packages.
// The engine never imports Remotion or TTS code; real implementations are injected.
import type { Delivery, EpisodeSpec, SceneSpec, TimedWord, VisemeTrack } from "@moco/spec";

export interface RenderError {
  shotId: string;
  frame?: number;
  message: string;
  path?: string; // JSON path in the spec, if the renderer knows it
}

export type RenderCheck = { ok: true; stills: string[] } | { ok: false; errors: RenderError[] };

export interface RenderPort {
  // Render a few stills to catch runtime errors (L3) and give the UI shot previews.
  check(spec: SceneSpec, opts: { frames: number[]; outDir: string }): Promise<RenderCheck>;
  // One full-size frame of a shot, without its caption and with `text` as a headline, saved as a JPEG at `out`.
  thumbnail(spec: SceneSpec, opts: { frame: number; text: string; out: string }): Promise<void>;
  renderEpisode(
    episode: EpisodeSpec,
    out: string,
    quality: "preview" | "final",
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<{ path: string; durationSeconds: number }>;
  versions(): { kitVersion: string; rendererVersion: string };
  // Frees what the renderer holds between renders (its browser), if nothing is using it. The next render reopens it.
  // Called before narration: a neural voice model loading next to an idle browser can run Windows out of memory.
  release?(): Promise<void>;
}

export interface AudioPort {
  voices?(language: string): Promise<{ id: string; name: string }[]>;
  // Speak all lines into one file. `words` is filled when the TTS backend gives timings.
  tts(
    lines: { id: string; text: string; delivery?: Delivery; voiceId?: string; speaker?: string }[],
    voice: { voiceId: string; backend: string },
    language: string,
    outDir: string,
    signal?: AbortSignal,
  ): Promise<{ file: string; durationSeconds: number; words?: TimedWord[]; backend?: string }>;
  // Optional local ASR route for authored canvas productions. Legacy narration
  // keeps its existing backend; the desktop host supplies this measured route.
  ttsMeasured?: AudioPort["tts"];
  // Word timings from audio (whisper). The audio package maps words back to line ids.
  align(file: string, lines: { id: string; text: string }[], language: string): Promise<TimedWord[]>;
  // Mouth shapes for lip sync, in whole-episode frames, from the audio and its word timings.
  visemes(file: string, words: TimedWord[]): Promise<VisemeTrack>;
}
