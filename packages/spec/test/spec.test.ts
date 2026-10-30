import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AiSceneSpec, SceneSpec, toAiJsonSchema } from "../src/index.ts";

const golden = JSON.parse(readFileSync(new URL("../../engine/src/generator/examples/krishna-chariot.json", import.meta.url), "utf8"));

describe("SceneSpec", () => {
  it("accepts the golden Krishna chariot scene", () => {
    expect(SceneSpec.safeParse(golden).success).toBe(true);
  });

  it("rejects positions outside the frame and non-integer frames", () => {
    const bad = structuredClone(golden);
    bad.actors[0].position.x = 1.4;
    bad.captions[0].startFrame = 1.5;
    const result = SceneSpec.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join("."))).toEqual(["actors.0.position.x", "captions.0.startFrame"]);
  });

  // Changes to what the AI is asked to produce should be deliberate: update the snapshot on purpose.
  it("exports a stable AI-facing JSON Schema", () => {
    expect(toAiJsonSchema(AiSceneSpec)).toMatchSnapshot();
  });
});
