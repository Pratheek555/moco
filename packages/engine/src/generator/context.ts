// Builds what the scene generator sees for one shot: a small catalog slice, the timed words,
// the relevant memory and the golden example. Small prompts are cheaper and more reliable.
import { readFileSync } from "node:fs";
import type { Catalog } from "@moco/kit";
import { FPS, SceneSpec, type SeriesBible, type SeriesMemory, type Shot, type VisemeTrack, type VoiceoverTrack } from "@moco/spec";
import type { SceneBrief } from "../loop/validate.ts";

const goldenExample = SceneSpec.parse(JSON.parse(readFileSync(new URL("./examples/krishna-chariot.json", import.meta.url), "utf8")));

export function goldenScene(): SceneSpec {
  return structuredClone(goldenExample);
}

// Seconds → whole frames. Shots are converted at their absolute times so frames add up exactly across shots.
export function toFrame(seconds: number, fps = FPS): number {
  return Math.round(seconds * fps);
}

export function shotBrief(shot: Shot, voiceover: VoiceoverTrack): SceneBrief {
  const frame = (seconds: number) => toFrame(seconds, voiceover.fps ?? FPS);
  const shotStartFrame = frame(shot.start);
  const durationFrames = frame(shot.end) - shotStartFrame;
  const words = voiceover.words
    .filter((word) => word.start >= shot.start && word.start < shot.end)
    .map((word) => ({
      text: word.text,
      startFrame: frame(word.start) - shotStartFrame,
      endFrame: Math.min(durationFrames, frame(word.end) - shotStartFrame),
    }));
  return { shot, durationFrames, words };
}

// The part of the episode's viseme track inside one shot, in shot frames, starting with the shape already showing.
export function shotVisemes(shot: Shot, voiceover: VoiceoverTrack): VisemeTrack {
  const startFrame = toFrame(shot.start, voiceover.fps ?? FPS);
  const endFrame = toFrame(shot.end, voiceover.fps ?? FPS);
  const showing = voiceover.visemes.filter((key) => key.frame <= startFrame).at(-1);
  const inside = voiceover.visemes.filter((key) => key.frame > startFrame && key.frame < endFrame);
  const keys = showing ? [showing, ...inside] : inside;
  return keys.map((key) => ({ frame: Math.max(0, key.frame - startFrame), viseme: key.viseme }));
}

// Mask the audio's mouth shapes by the measured speaker intervals, including cuts mid-line.
// Undefined preserves the legacy behaviour for audio generated before speaker metadata existed.
export function shotSpeech(shot: Shot, voiceover: VoiceoverTrack) {
  if (!voiceover.speakers) return undefined;
  const frameAt = (seconds: number) => toFrame(seconds, voiceover.fps ?? FPS);
  const start = frameAt(shot.start);
  const duration = frameAt(shot.end) - start;
  return [...new Set(voiceover.speakers.map((span) => span.speaker))].map((speaker) => {
    const spans = voiceover.speakers!.filter((span) => span.speaker === speaker);
    const visemes: VisemeTrack = [];
    let index = 0;
    for (let frame = 0; frame < duration; frame++) {
      const absolute = frame + start;
      while (index + 1 < voiceover.visemes.length && voiceover.visemes[index + 1]!.frame <= absolute) index++;
      const key = voiceover.visemes[index];
      const active = spans.some((span) => absolute >= frameAt(span.start) && absolute < frameAt(span.end));
      const viseme = active && key && key.frame <= absolute ? key.viseme : "X";
      if (visemes.at(-1)?.viseme !== viseme) visemes.push({ frame, viseme });
    }
    return { speaker, visemes };
  });
}

// Only the kit entries this shot can use.
export function catalogSlice(catalog: Catalog, bible: SeriesBible, shot: Shot) {
  const castInShot = bible.cast.filter((member) => shot.characters.includes(member.id));
  const kitIds = castInShot.map((member) => member.kitCharacterId);
  return {
    cast: castInShot.map((member) => ({ castId: member.id, kitCharacterId: member.kitCharacterId, variant: member.variant })),
    // Art details (layers, visemes, idle motion) are the renderer's business, not choices for the AI.
    characters: catalog.characters
      .filter((character) => kitIds.includes(character.id))
      .map(({ layers: _layers, visemes: _visemes, idle: _idle, ...offered }) => offered),
    background: catalog.backgrounds.find((background) => background.id === shot.location),
    props: catalog.props,
    fx: catalog.fx,
    atmosphere: catalog.atmosphere.map((atmosphere) => atmosphere.id),
  };
}

// The stage's first option of each kind, so a fallback shot on a 3D stage still renders.
function stageDefault(shot: Shot, catalog: Catalog, bible: SeriesBible) {
  const stage = catalog.backgrounds.find((background) => background.id === shot.location)?.stage;
  if (!stage) return {};
  // In a generated world nobody is there until the shot puts them there, so stand the shot's cast side by side.
  const cast = stage.things ? bible.cast.filter((member) => shot.characters.includes(member.id)) : [];
  const players = cast.map((member, index) => ({ id: member.id, model: member.kitCharacterId, at: [(index - (cast.length - 1) / 2) * 1.6, 0, 0] }));
  const subject = players[0]?.id ?? stage.subjects[0]!;
  const camera = stage.cameras.find((option) => option.id === "wide") ?? stage.cameras[0]!; // a generated world opens on a far establishing shot
  return { stage: { camera: camera.id, place: stage.places[0]!.id, subject, leadStart: 0, leadEnd: 0, players } };
}

// Continuity facts about the characters and location in this shot.
export function relevantFacts(memory: SeriesMemory | undefined, shot: Shot) {
  const entities = [...shot.characters, shot.location];
  return (memory?.facts ?? []).filter((fact) => entities.includes(fact.entity));
}

// Deterministic safe shot used when the AI can't produce a valid scene: background,
// captions straight from the voiceover words, a slow push-in. Flagged `fallback: true` for the UI.
export function fallbackScene(brief: SceneBrief, catalog: Catalog, bible: SeriesBible): SceneSpec {
  const wordsPerCaption = 3;
  const captions: SceneSpec["captions"] = [];
  for (let start = 0; start < brief.words.length; start += wordsPerCaption) {
    const chunk = brief.words.slice(start, start + wordsPerCaption);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    const startFrame = Math.min(first.startFrame, brief.durationFrames - 1);
    const endFrame = Math.min(brief.durationFrames, Math.max(startFrame + 1, last.endFrame));
    captions.push({ text: chunk.map((word) => word.text).join(" "), startFrame, endFrame, emphasis: false });
  }
  return SceneSpec.parse({
    shotId: brief.shot.id,
    durationFrames: brief.durationFrames,
    background: { id: brief.shot.location, parallax: true },
    ...stageDefault(brief.shot, catalog, bible),
    actors: [],
    props: [],
    camera: [{ move: "push_in", startFrame: 0, endFrame: brief.durationFrames, amount: 0.1 }],
    captions,
    fx: [],
    fallback: true,
  });
}
