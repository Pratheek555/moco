// Shared test setup: a scripted fake AI that writes valid artifacts for every task, and engine factory.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiRequest } from "@moco/ai";
import { createEngine, type Engine } from "../src/index.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";

export const WORDS_PER_LINE = 14;
export const LINES = 8; // 112 words ≈ 45 s at 0.4 s/word, the default target

// Pull a "## Title" JSON section back out of a prompt.
export function section<T>(prompt: string, title: string): T {
  const start = prompt.indexOf(`## ${title}`);
  const match = /```json\n([\s\S]*?)\n```/.exec(prompt.slice(start));
  if (start < 0 || !match) throw new Error(`section "${title}" not in prompt`);
  return JSON.parse(match[1]!) as T;
}

export function scriptData(lines = LINES) {
  return {
    targetSeconds: 45,
    lines: Array.from({ length: lines }, (_, i) => ({
      id: `l${String(i + 1).padStart(2, "0")}`,
      text: Array.from({ length: WORDS_PER_LINE }, (_, j) => `word${i}x${j}`).join(" "),
      beat: `beat ${i + 1}`,
      speaker: "narrator",
    })),
  };
}

interface Brief {
  shotId: string;
  durationFrames: number;
  location: string;
  voiceoverWords: { text: string; startFrame: number; endFrame: number }[];
  avoid?: { cameraPreset: string[]; shotSize: string[] };
}

// Camera moves and actor scales (wide, medium, close) that the default answers take turns with, so
// neighbouring shots never look the same.
const MOVES = ["push_in", "pan_left", "pan_right"];
const SCALES: Record<string, number> = { wide: 0.45, medium: 0.7, close: 1 };

// A valid SceneSpec for whatever shot brief is in the prompt. `look` forces a camera move and shot size;
// otherwise they follow the shot number, steering clear of anything the brief says to avoid.
export function sceneFor(prompt: string, look?: { move: string; size: string }) {
  const brief = section<Brief>(prompt, "Shot brief");
  const turn = Number(brief.shotId.slice(1));
  const move = look?.move ?? rotate(MOVES, turn, brief.avoid?.cameraPreset ?? []);
  const size = look?.size ?? rotate(Object.keys(SCALES), turn, brief.avoid?.shotSize ?? []);
  return {
    shotId: brief.shotId,
    durationFrames: brief.durationFrames,
    background: { id: brief.location },
    actors: [{
      castId: "krishna",
      kitCharacterId: "krishna",
      position: { x: 0.5, y: 0.6, scale: SCALES[size]! },
      facing: "right",
      actions: [{ name: "blink", startFrame: 0, endFrame: 6 }],
    }],
    camera: [{ move, startFrame: 0, endFrame: brief.durationFrames, amount: 0.2 }],
    captions: brief.voiceoverWords.map((word) => ({ text: word.text, startFrame: word.startFrame, endFrame: Math.max(word.startFrame + 1, word.endFrame) })),
  };
}

// The option at this turn, or the next one that isn't avoided.
function rotate(options: string[], turn: number, avoid: string[]): string {
  const allowed = options.filter((option) => !avoid.includes(option));
  return allowed[turn % allowed.length]!;
}

// One valid answer per task. Tests override individual tasks.
export function validAnswer(request: AiRequest, task: string): unknown {
  switch (task) {
    case "series": {
      const { episodes, language } = section<{ episodes: number; language: string }>(request.prompt, "Request");
      return {
        title: "Gita Shorts",
        language,
        premise: "Krishna guides Arjuna.",
        episodes: Array.from({ length: episodes }, (_, i) => ({ id: `ep-${String(i + 1).padStart(2, "0")}`, title: `Episode ${i + 1}`, synopsis: "A beat." })),
      };
    }
    case "bible":
      return {
        cast: [
          { id: "krishna", kitCharacterId: "krishna", variant: "charioteer", description: "The guide." },
          { id: "arjuna", kitCharacterId: "arjuna", description: "The archer." },
        ],
        style: { palette: ["#f4c430", "#1b1b3a"], captionStyle: "bold", mood: "epic" },
      };
    case "script":
      return scriptData();
    case "shots": {
      const words = section<unknown[]>(request.prompt, "Words");
      const cuts = Array.from({ length: Math.ceil(words.length / 8) }, (_, i) => i * 8); // 8 words per shot
      return { shots: cuts.map((fromWord, i) => ({ id: `s${String(i + 1).padStart(2, "0")}`, fromWord, intent: "Show it.", characters: ["krishna"], location: "kurukshetra" })) };
    }
    case "scene":
      return sceneFor(request.prompt);
    case "memory":
      return { storySoFar: "Krishna began guiding Arjuna.", newFacts: [{ entity: "arjuna", fact: "Arjuna has lowered his bow.", sinceEpisode: section<{ episodeId: string }>(request.prompt, "Approved episode").episodeId }] };
    default:
      throw new Error(`no answer for task ${task}`);
  }
}

export async function setup(overrides: Partial<Record<string, (request: AiRequest) => unknown>> = {}, projectsDir?: string, secondsPerWord = 0.4) {
  const dir = projectsDir ?? (await mkdtemp(join(tmpdir(), "moco-test-")));
  const ai = new FakeAi((request, task) => (overrides[task] ? overrides[task]!(request) : validAnswer(request, task)));
  const render = new FakeRenderPort();
  const audio = new FakeAudio(secondsPerWord);
  const engine: Engine = createEngine({ projectsDir: dir, ai, render, audio });
  return { dir, ai, render, audio, engine };
}

// Run the next stages and wait for the job to finish.
export async function advance(engine: Engine, seriesId: string, key?: string) {
  const job = await engine.waitForJob(await engine.runStage({ seriesId, key }));
  if (job.status !== "succeeded") throw new Error(`job failed: ${JSON.stringify(job.error)}`);
  return job;
}

// Approve whatever stage is waiting, with its current hash.
export async function approveNext(engine: Engine, seriesId: string) {
  const status = await engine.status(seriesId);
  if (status.next.kind !== "waiting") throw new Error(`nothing waiting: ${JSON.stringify(status.next)}`);
  const stage = status.stages.find((candidate) => candidate.key === (status.next as { key: string }).key)!;
  await engine.approve({ seriesId, key: stage.key }, stage.artifactHash!);
  return stage.key;
}
