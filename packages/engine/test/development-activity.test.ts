import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineEvent } from "../src/index.ts";
import { advance, approveNext, setup, validAnswer } from "./helpers.ts";

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


describe("production activity", () => {
  it("streams narration milestones and reports a shot saved only after its artifact exists", async () => {
    const { engine, dir } = await setup({ show: request => {
      request.onActivity?.("Choosing the visual direction.");
      return validAnswer(request, "show");
    }, script: request => {
      request.onActivity?.("Writing the spoken script.");
      return validAnswer(request, "script");
    }, shots: request => {
      request.onActivity?.("Cutting on measured words.");
      return validAnswer(request, "shots");
    }, scene: request => {
      request.onActivity?.("Animating the lighthouse beside the sea.");
      return validAnswer(request, "scene");
    } });
    let savedHash: string | undefined;
    const events: EngineEvent[] = [];
    engine.on("*", event => {
      events.push(event);
      if (event.type === "shot.done") savedHash = JSON.parse(readFileSync(join(dir, event.seriesId, `episodes/${event.data.episodeId}/shots/${event.data.shotId}/spec.json`), "utf8")).meta.contentHash;
    });
    const id = await engine.createSeries({ idea: "A light in the fog", language: "en", episodes: 1 });
    for (let gate = 0; gate < 3; gate++) {
      await advance(engine, id);
      await approveNext(engine, id);
    }
    await advance(engine, id);
    for (const [message, key] of [["Choosing the visual direction.", "bible"], ["Writing the spoken script.", "ep-01/script"], ["Cutting on measured words.", "ep-01/shot_list"]]) {
      expect(events.find(e => e.type === "ai.activity" && e.data.message === message)?.data.key).toBe(key);
    }
    const narration = events.filter(e => e.type === "ai.activity" && e.data.key === "ep-01/voiceover");
    expect(narration.map(e => e.data.message).join(" ")).toContain("Converting");
    expect(narration.map(e => e.data.message).join(" ")).toContain("word timings");
    expect(narration.map(e => e.data.message).join(" ")).toContain("mouth movements");
    const started = events.findIndex(e => e.type === "shot.started");
    const done = events.findIndex(e => e.type === "shot.done");
    expect(started).toBeGreaterThan(-1);
    expect(done).toBeGreaterThan(started);
    const commentary = events.findIndex(e => e.type === "ai.activity" && e.data.message === "Animating the lighthouse beside the sea.");
    expect(commentary).toBeGreaterThan(started);
    expect(commentary).toBeLessThan(done);
    expect(savedHash).toBe(events[done]?.data.contentHash);
    expect(events[done]?.data).toMatchObject({ episodeId: "ep-01", shotId: "s01", fallback: false });
  });
});
