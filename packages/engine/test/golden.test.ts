// The hand-built Krishna chariot scene (CLAUDE.md "First step") is the quality bar and the prompt example,
// so it must pass the same semantic checks as AI output.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { catalog } from "@moco/kit";
import { AiSceneSpec, SceneSpec } from "@moco/spec";
import { goldenScene } from "../src/generator/context.ts";
import { validateScene } from "../src/loop/validate.ts";

it("golden scene passes L2 validation, including the cinematography rules", () => {
  const spec = goldenScene();
  const words = spec.captions.flatMap((caption) => caption.text.split(" ").map((text) => ({ text, startFrame: caption.startFrame, endFrame: caption.endFrame })));
  const issues = validateScene(spec, {
    brief: { shot: { id: "s01", start: 0, end: 10, lineIds: ["l01"], intent: "Krishna on the chariot", characters: ["krishna"], location: "kurukshetra" }, durationFrames: 300, words },
    bible: {
      cast: [{ id: "krishna", kitCharacterId: "krishna", variant: "charioteer", description: "" }],
      style: { palette: [], captionStyle: "", mood: "", grade: "none" },
      narrator: { voiceId: "v", backend: "b", language: "en" },
    },
    catalog,
  });
  expect(issues).toEqual([]);
});

// The renderer's golden stills and benchmark render the full premium scene (with the engine's lip-sync track,
// grade and finish); the prompt example is the same scene minus those engine-owned fields. Read as a file, not
// imported: the engine never depends on the renderer.
it("golden example is the renderer's premium scene minus engine fields", () => {
  const premium = SceneSpec.parse(JSON.parse(readFileSync(new URL("../../renderer/bench/scenes/premium-krishna-dawn.json", import.meta.url), "utf8")));
  expect(AiSceneSpec.parse(goldenScene())).toEqual(AiSceneSpec.parse(premium));
});
