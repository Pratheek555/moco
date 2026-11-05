import { describe, expect, it } from "vitest";
import type { EngineEvent } from "../src/index.ts";
import { advance, setup, validAnswer } from "./helpers.ts";

describe("series development activity", () => {
  it("delivers ordered public updates and still stops at the validated plan gate", async () => {
    const { engine } = await setup({ series: (request) => {
      request.onActivity?.("I’m outlining the first episode.");
      return validAnswer(request, "series");
    } });
    const events: EngineEvent[] = [];
    engine.on("*", (event) => events.push(event));
    const id = await engine.createSeries({ idea: "A light in the fog", language: "en", episodes: 1 });
    await advance(engine, id);
    expect(events.filter((event) => event.type === "ai.activity").map((event) => event.data.phase)).toEqual(["started", "working", "checked"]);
    expect(events.find((event) => event.data.phase === "working")?.data.message).toBe("I’m outlining the first episode.");
    const checked = events.findIndex((event) => event.data.phase === "checked");
    expect(checked).toBeLessThan(events.findIndex((event) => event.type === "stage.awaiting_approval"));
    expect((await engine.status(id)).next).toMatchObject({ kind: "waiting", key: "series_plan", status: "awaiting_approval" });
  });
});
