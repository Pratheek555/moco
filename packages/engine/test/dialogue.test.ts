import { expect, it, vi } from "vitest";
import { EpisodeScript, Shot, VoiceoverTrack, type SceneSpec } from "@moco/spec";
import { defaultConfig } from "../src/config.ts";
import { shotSpeech } from "../src/generator/context.ts";
import { checkScript } from "../src/planner/script.ts";
import { advance, approveNext, scriptData, setup, showData } from "./helpers.ts";

it("rejects invented dialogue speakers while accepting narrator and cast ids", () => {
  const script = EpisodeScript.parse(scriptData());
  script.lines[0]!.speaker = "krishna";
  expect(checkScript(script, defaultConfig("/tmp"), 112, ["krishna"])).toEqual([]);
  script.lines[1]!.speaker = "stranger";
  expect(checkScript(script, defaultConfig("/tmp"), 112, ["krishna"])[0]!.path).toBe("lines[1].speaker");
});

it("keeps each speaker's mouth closed during other lines and handles a cut mid-word", () => {
  const vo = VoiceoverTrack.parse({ file: "vo.wav", durationSeconds: 3, words: [{ text: "Hi", start: 0, end: 1, lineId: "l01" }],
    visemes: [{ frame: 0, viseme: "D" }], speakers: [{ speaker: "hero", start: 0, end: 1 }, { speaker: "narrator", start: 1, end: 2 }, { speaker: "friend", start: 2, end: 3 }] });
  const shot = Shot.parse({ id: "s01", start: 0.5, end: 3, lineIds: [], intent: "listen", characters: [], location: "room" });
  expect(shotSpeech(shot, vo)).toEqual([
    { speaker: "hero", visemes: [{ frame: 0, viseme: "D" }, { frame: 15, viseme: "X" }] },
    { speaker: "narrator", visemes: [{ frame: 0, viseme: "X" }, { frame: 15, viseme: "D" }, { frame: 45, viseme: "X" }] },
    { speaker: "friend", visemes: [{ frame: 0, viseme: "X" }, { frame: 45, viseme: "D" }] },
  ]);
  expect(shotSpeech(shot, { ...vo, speakers: undefined })).toBeUndefined();
});

it("carries locked voices through synthesis, measured speakers and saved scenes", async () => {
  const { engine, audio } = await setup({
    show: () => ({ ...showData(), cast: showData().cast.map((member, i) => ({ ...member, voiceId: i ? "voice-b" : "voice-a" })) }),
    script: () => ({ ...scriptData(), lines: scriptData().lines.map((line, i) => ({ ...line, speaker: i % 3 === 0 ? "narrator" : i % 3 === 1 ? "krishna" : "arjuna" })) }),
  });
  Object.assign(audio, { voices: async () => [{ id: "voice-a", name: "A" }, { id: "voice-b", name: "B" }] });
  const tts = vi.spyOn(audio, "tts");
  const id = await engine.createSeries({ idea: "Two friends talk", language: "en", episodes: 1 });
  for (let gate = 0; gate < 3; gate++) { await advance(engine, id); await approveNext(engine, id); }
  await advance(engine, id);
  expect(tts.mock.calls[0]![0].slice(0, 3)).toMatchObject([{ voiceId: undefined }, { voiceId: "voice-a" }, { voiceId: "voice-b" }]);
  const track = await engine.readArtifact({ seriesId: id, file: "episodes/ep-01/artifacts/voiceover.json" }) as { data: VoiceoverTrack };
  expect(track.data.speakers?.slice(0, 3).map((span) => span.speaker)).toEqual(["narrator", "krishna", "arjuna"]);
  const scene = await engine.readArtifact({ seriesId: id, file: "episodes/ep-01/shots/s01/spec.json" }) as { data: SceneSpec };
  expect(scene.data.speech?.find((track) => track.speaker === "krishna")?.visemes).toEqual([{ frame: 0, viseme: "X" }]);
});
