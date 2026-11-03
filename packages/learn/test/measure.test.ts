import { describe, expect, it } from "vitest";
import { analyseSpeech, parseEbur128 } from "../src/audio.ts";
import { analyseVideo } from "../src/video.ts";
import { audio, clip, measurements, speak } from "./helpers.ts";

describe("video", () => {
  it("finds a one-frame hard cut and reads each shot's slow creep in", () => {
    const analysis = analyseVideo(clip(120, (f) => (f === 60 ? { cut: 80, hist: 0.6, tracked: 20, inliers: 5 } : {})));
    expect(analysis.transitions).toHaveLength(1);
    expect(analysis.transitions[0]).toMatchObject({ kind: "cut", at: 60 });
    expect(analysis.shots.map((shot) => [shot.start, shot.end])).toEqual([[0, 59], [60, 119]]);
    const camera = analysis.shots[0]!.camera;
    expect(camera.profile).toBe("creep");
    expect(camera.dominant).toBe("zoom_in");
    expect(camera.zoomRate).toBeCloseTo(Math.log(1.002) * 100 * 30, 1); // ≈ 6 %/s
    expect(camera.shake).toBeLessThan(0.001);
  });

  it("names a blurred change by the move into it, and sees the camera accelerate out and arrive moving", () => {
    // Shot A pushes in faster and faster; 5 frames of blur; shot B arrives fast and settles.
    const analysis = analyseVideo(
      clip(110, (f) => {
        if (f >= 40 && f < 50) return { zoom: 1 + 0.004 * 1.4 ** (f - 40) };
        if (f >= 50 && f < 55) return { tracked: 4, inliers: 2, cut: 40, flow: 0 };
        if (f >= 55 && f < 65) return { zoom: 1 + 0.08 * 0.7 ** (f - 55) };
        return {};
      }),
    );
    expect(analysis.transitions).toHaveLength(1);
    expect(analysis.transitions[0]).toMatchObject({ kind: "zoom", start: 50, end: 54, at: 55, direction: "in", directionOut: "in" });
    expect(analysis.transitions[0]!.speedIn).toBeGreaterThan(5);
    expect(analysis.shots[0]!.camera.profile).toBe("accelerates_out");
    expect(analysis.shots[1]!.camera.profile).toBe("arrives_moving");
  });

  it("does not call a flat sky with few features a transition", () => {
    const analysis = analyseVideo(clip(90, () => ({ tracked: 30, inliers: 28 })));
    expect(analysis.transitions).toEqual([]);
    expect(analysis.shots[0]!.camera.measured).toBeGreaterThan(0.98); // all but frame 0, which has no previous frame
  });

  it("finds a burst of motion the camera doesn't explain", () => {
    const analysis = analyseVideo(clip(90, (f) => (f >= 40 && f <= 44 ? { active: 0.3 } : {})));
    expect(analysis.events).toHaveLength(1);
    expect(analysis.events[0]).toMatchObject({ onset: 40, end: 44, frames: 5 });
  });
});

describe("speech", () => {
  it("measures rate, coverage and the pauses after sentences and clauses", () => {
    const words = speak("One two three. | Four five, | six seven eight.");
    const speech = analyseSpeech(audio(words, 4), 4);
    expect(speech.words).toBe(8);
    expect(speech.wpm).toBe(120);
    expect(speech.sentences.map((sentence) => sentence.text)).toEqual(["One two three.", "Four five, six seven eight."]);
    expect(speech.pauses.sentence.median).toBeCloseTo(0.46, 2); // 0.06 between words + the 0.4 pause
    expect(speech.pauses.clause.median).toBeCloseTo(0.46, 2);
    expect(speech.pauses.word.median).toBeCloseTo(0.06, 2);
    expect(speech.clauseStarts).toEqual([0, words[3]!.start, words[5]!.start]);
    expect(speech.levels).toMatchObject({ bed: "music", voiceOverBed: 16 });
  });

  it("reads ffmpeg's loudness summary", () => {
    const stderr = "[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:          -9.7 LUFS\n  Loudness range:\n    LRA:         2.0 LU\n  True peak:\n    Peak:        1.0 dBFS";
    expect(parseEbur128(stderr)).toEqual({ integrated: -9.7, range: 2, truePeak: 1 });
  });
});

describe("sync", () => {
  it("compares transitions with clause starts against chance", () => {
    // Cut exactly where the second sentence starts.
    const words = speak("One two three four. Five six seven eight.", 0.375);
    const m = measurements(clip(180, (f) => (f === 45 ? { cut: 90, hist: 0.7 } : {})), words);
    expect(m.video.transitions[0]!.at).toBe(45);
    expect(m.sync.cutsOnClause).toBe(1);
    expect(m.sync.cutsOnClauseChance).toBeLessThan(0.2);
    expect(m.shotWords).toEqual(["One two three four.", "Five six seven eight."]);
    expect(m.pace).toMatchObject({ firstChange: 1.5, hook: { text: "One two three four." } });
  });
});
