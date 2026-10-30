// Partial regeneration: unchanged shots aren't sent to the AI again, and an unchanged episode isn't re-rendered.
import { describe, expect, it } from "vitest";
import { catalog } from "@moco/kit";
import { SceneSpec } from "@moco/spec";
import { formatIssue } from "../src/loop/feedback.ts";
import { repeatedLook, shotLook, validateScene } from "../src/loop/validate.ts";
import { advance, approveNext, setup } from "./helpers.ts";

describe("reuse", () => {
  it("reuses scene specs and the preview render when inputs are unchanged", async () => {
    const { engine, ai, render } = await setup();
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    for (let gate = 0; gate < 4; gate += 1) {
      await advance(engine, seriesId);
      await approveNext(engine, seriesId); // plan, bible, script, sample
    }
    await advance(engine, seriesId); // scenes + preview render
    const sceneCalls = () => ai.requests.filter((request) => request.system.includes("prompt: scene")).length;
    const callsBefore = sceneCalls();
    expect(render.renders).toBe(1);

    // Accepting the current voiceover as a "human" revision re-runs everything downstream with the same data.
    await engine.restore({ seriesId, file: "episodes/ep-01/artifacts/voiceover.json" }, 0);
    await advance(engine, seriesId); // shot list (AI) → sample gate
    await approveNext(engine, seriesId);
    await advance(engine, seriesId); // scenes → preview

    expect(sceneCalls()).toBe(callsBefore); // every shot reused
    expect(render.renders).toBe(1); // preview came from the render cache
    expect((await engine.status(seriesId)).next).toMatchObject({ kind: "waiting", key: "ep-01/preview" });
  });
});

describe("slideshow checks", () => {
  const brief = { shot: { id: "s01", start: 0, end: 5, lineIds: ["l01"], intent: "", characters: ["krishna"], location: "kurukshetra" }, durationFrames: 150, words: [] };
  const bible = { cast: [{ id: "krishna", kitCharacterId: "krishna", description: "" }], style: { palette: [], captionStyle: "", mood: "", grade: "none" }, narrator: { voiceId: "", backend: "", language: "en" } };
  const empty = SceneSpec.parse({ shotId: "s01", durationFrames: 150, background: { id: "kurukshetra" }, actors: [], captions: [] });

  it("flags a missing character and a shot where nothing moves", () => {
    const problems = validateScene(empty, { brief, bible, catalog }).map((issue) => issue.problem);
    expect(problems).toEqual(["missing krishna (the shot list puts them in this shot)", "nothing moves from frame 0 to 150 (5.0 s; the limit is 3 s)"]);
  });

  // A medium Krishna with a push-in over frames 0–80 and a raise_hand over 100–140: moving except 80–100.
  const krishna = { castId: "krishna", kitCharacterId: "krishna", position: { x: 0.5, y: 0.6, scale: 0.7 }, facing: "right", actions: [{ name: "raise_hand", startFrame: 100, endFrame: 140 }] };
  const moving = SceneSpec.parse({ ...empty, actors: [krishna], camera: [{ move: "push_in", startFrame: 0, endFrame: 80, amount: 0.2 }] });
  const issuesOf = (spec: SceneSpec, avoid?: { cameraPreset: string[]; shotSize: string[] }) => validateScene(spec, { brief: { ...brief, avoid }, bible, catalog });

  it("accepts short still gaps and catches a time of day the background doesn't have", () => {
    expect(issuesOf(moving)).toEqual([]);
    expect(issuesOf({ ...moving, timeOfDay: "midnight" }).map((issue) => issue.path)).toEqual(["timeOfDay"]);
  });

  it("tells a regenerated shot which shot sizes keep it out of a run", () => {
    expect(shotLook(moving)).toEqual({ cameraPreset: "push_in", shotSize: "medium" });
    const issue = issuesOf(moving, { cameraPreset: [], shotSize: ["medium"] })[0]!;
    expect(formatIssue(issue)).toBe(
      "actors: this is a medium shot, which would make 3 medium shots in a row. Allowed: wide, close. Change the actors' scale or camera to get one of these. " +
        "wide = largest actor scale below 0.55 (or no actors); medium = 0.55 to 0.9; close = 0.9 or more, or any focus_on move.",
    );
  });

  it("works out what a shot must avoid from both sides", () => {
    const look = (cameraPreset: string, shotSize: string) => ({ cameraPreset, shotSize });
    const looks = [look("pan_left", "wide"), look("pan_left", "close"), look("pan_left", "medium"), look("push_in", "medium"), look("push_in", "medium")];
    // Shot 2 ends a run of pan_left; the two after it are both push_in, so push_in would start a new run.
    expect(repeatedLook(looks, new Set())).toEqual({ index: 2, avoid: { cameraPreset: ["pan_left", "push_in"], shotSize: ["medium"] } });
    // Skipping shot 2 (already tried), the next run is the three medium shots ending at 4.
    expect(repeatedLook(looks, new Set([2]))).toEqual({ index: 4, avoid: { cameraPreset: [], shotSize: ["medium"] } });
  });
});
