// What the engine needs from the renderer and audio packages.
// The engine never imports Remotion or TTS code; real implementations are injected.
import type { EpisodeSpec, SceneSpec, TimedWord, VisemeTrack } from "@moco/spec";

export interface RenderError {
  shotId: string;
  frame?: number;
  message: string;
  path?: string; // JSON path in the spec, if the renderer knows it
}

export type RenderCheck = { ok: true; stills: string[] } | { ok: false; errors: RenderError[] };

export interface RenderPort {
  // Render a few stills to catch runtime errors (L3) and give the UI thumbnails.
  check(spec: SceneSpec, opts: { frames: number[]; outDir: string }): Promise<RenderCheck>;
  renderEpisode(
    episode: EpisodeSpec,
    out: string,
    quality: "preview" | "final",
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<{ path: string; durationSeconds: number }>;
  versions(): { kitVersion: string; rendererVersion: string };
}

export interface AudioPort {
  // Speak all lines into one file. `words` is filled when the TTS backend gives timings.
  tts(
    lines: { id: string; text: string }[],
    voice: { voiceId: string; backend: string },
    language: string,
    outDir: string,
    signal?: AbortSignal,
  ): Promise<{ file: string; durationSeconds: number; words?: TimedWord[] }>;
  // Word timings from audio (whisper). The audio package maps words back to line ids.
  align(file: string, lines: { id: string; text: string }[], language: string): Promise<TimedWord[]>;
  // Mouth shapes for lip sync, in whole-episode frames, from the audio and its word timings.
  visemes(file: string, words: TimedWord[]): Promise<VisemeTrack>;
}
