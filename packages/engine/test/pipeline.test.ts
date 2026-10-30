// End-to-end with fakes: idea → plan → bible → episode → VO → shots → scenes → preview → final + memory.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/index.ts";
import { FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import { advance, approveNext, scriptData, setup } from "./helpers.ts";

describe("pipeline", () => {
  it("runs a whole episode, stopping at every gate", async () => {
    const { engine, dir, ai } = await setup();
    const seriesId = await engine.createSeries({ idea: "Krishna and Arjuna at Kurukshetra", language: "en", episodes: 2 });

    // Each gate stops the run; approving it lets the next run continue.
    const gates: string[] = [];
    for (let round = 0; round < 10; round += 1) {
      await advance(engine, seriesId);
      const next = (await engine.status(seriesId)).next;
      if (next.kind !== "waiting") break;
      gates.push(await approveNext(engine, seriesId));
    }
    expect(gates).toEqual(["series_plan", "bible", "ep-01/script", "ep-01/sample", "ep-01/preview", "ep-02/script", "ep-02/preview"]);

    const status = await engine.status(seriesId);
    const byKey = Object.fromEntries(status.stages.map((stage) => [stage.key, stage.status]));
    expect(byKey["ep-01/final"]).toBe("done");
    expect(byKey["ep-01/memory_update"]).toBe("done");
    expect(status.next).toEqual({ kind: "finished" });

    // Memory grew once per episode.
    const memory = JSON.parse(await readFile(join(dir, seriesId, "artifacts/memory.json"), "utf8"));
    expect(memory.data.facts).toHaveLength(2);
    // Episode 2's script prompt carried episode 1's memory.
    const scriptPrompts = ai.requests.filter((request) => request.system.includes("prompt: script"));
    expect(scriptPrompts.at(-1)!.prompt).toContain("Krishna began guiding Arjuna.");

    // Every shot has a validated spec, and the shot times cover the voiceover with no gaps.
    const shotList = JSON.parse(await readFile(join(dir, seriesId, "episodes/ep-01/artifacts/shot_list.json"), "utf8")).data;
    const voiceover = JSON.parse(await readFile(join(dir, seriesId, "episodes/ep-01/artifacts/voiceover.json"), "utf8")).data;
    expect(shotList.shots[0].start).toBe(0);
    expect(shotList.shots.at(-1).end).toBe(voiceover.durationSeconds);
    expect(status.decisions.filter((decision) => decision.category === "fallback")).toHaveLength(0);

    // The engine copied the voiceover's lip-sync track into each shot, in shot frames.
    const lastShot = shotList.shots.at(-1);
    const spec = JSON.parse(await readFile(join(dir, seriesId, `episodes/ep-01/shots/${lastShot.id}/spec.json`), "utf8")).data;
    const shotStart = Math.round(lastShot.start * 30);
    const fromVoiceover = voiceover.visemes.filter((key: { frame: number }) => key.frame > shotStart && key.frame < Math.round(lastShot.end * 30));
    expect(spec.visemes.length).toBeGreaterThan(0);
    expect(spec.visemes.slice(1)).toEqual(fromVoiceover.map((key: { frame: number; viseme: string }) => ({ ...key, frame: key.frame - shotStart })));
  });

  it("refuses approval with a stale hash", async () => {
    const { engine } = await setup();
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    await advance(engine, seriesId);
    await expect(engine.approve({ seriesId, key: "series_plan" }, "not-the-hash")).rejects.toMatchObject({ code: "gate_mismatch" });
    await expect(engine.approve({ seriesId, key: "bible" }, "x")).rejects.toMatchObject({ code: "not_awaiting_approval" });
  });

  it("puts reject() feedback into the next prompt", async () => {
    const { engine, ai } = await setup();
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    await advance(engine, seriesId);
    await engine.reject({ seriesId, key: "series_plan" }, "Make it about Karna instead");
    await advance(engine, seriesId);
    expect(ai.requests.at(-1)!.prompt).toContain("Make it about Karna instead");
  });

  it("sends the script back when the measured voiceover is off target, then gives up after the cap", async () => {
    // 0.55 s per word makes the 112-word script ~62 s against a 45 s target.
    const { engine, ai } = await setup({}, undefined, 0.55);
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    for (let gate = 0; gate < 2; gate += 1) {
      await advance(engine, seriesId);
      await approveNext(engine, seriesId); // plan, bible
    }

    // Script → approve → VO too long → script sent back (twice), then VO accepted with a warning.
    const approvedScripts: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      await advance(engine, seriesId);
      approvedScripts.push(await approveNext(engine, seriesId));
    }
    expect(approvedScripts).toEqual(["ep-01/script", "ep-01/script", "ep-01/script"]);

    await advance(engine, seriesId); // VO accepted after the cap → runs on to the sample gate
    const status = await engine.status(seriesId);
    const categories = status.decisions.map((decision) => decision.category);
    expect(categories.filter((category) => category === "send_back")).toHaveLength(2);
    expect(categories).toContain("duration_off_target");
    const scriptPrompts = ai.requests.filter((request) => request.system.includes("prompt: script"));
    expect(scriptPrompts.at(-1)!.prompt).toContain("Cut about");
    expect(status.next).toMatchObject({ kind: "waiting", key: "ep-01/sample" });
  });

  it("marks downstream stages stale when an approved script is restored to an older revision", async () => {
    let variant = 0;
    const { engine } = await setup({ script: () => ({ ...scriptData(), lines: scriptData().lines.map((line) => ({ ...line, beat: `v${variant}` })) }) });
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
    await advance(engine, seriesId);
    await approveNext(engine, seriesId);
    await advance(engine, seriesId); // script rev 0 awaiting
    await engine.reject({ seriesId, key: "ep-01/script" }, "again");
    variant = 1;
    await advance(engine, seriesId); // script rev 1 awaiting
    await approveNext(engine, seriesId);
    await advance(engine, seriesId); // → sample awaiting
    await approveNext(engine, seriesId);
    await advance(engine, seriesId); // → preview awaiting

    await engine.restore({ seriesId, file: "episodes/ep-01/artifacts/script.json" }, 0);
    const byKey = Object.fromEntries((await engine.status(seriesId)).stages.map((stage) => [stage.key, stage.status]));
    expect(byKey["ep-01/script"]).toBe("awaiting_approval");
    expect(byKey["ep-01/voiceover"]).toBe("stale");
    expect(byKey["ep-01/scenes"]).toBe("stale");
    expect(byKey["ep-01/preview"]).toBe("stale");
    const history = await engine.history({ seriesId, file: "episodes/ep-01/artifacts/script.json" });
    expect(history.map((entry) => entry.revision)).toEqual([0, 1, 2]);
  });

  it("detects a file edited outside the engine", async () => {
    const { engine, dir } = await setup();
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    await advance(engine, seriesId);
    const file = join(dir, seriesId, "artifacts/series_plan.json");
    const envelope = JSON.parse(await readFile(file, "utf8"));
    envelope.data.title = "Hacked";
    await writeFile(file, JSON.stringify(envelope));
    await expect(engine.readArtifact({ seriesId, file: "artifacts/series_plan.json" })).rejects.toMatchObject({ code: "modified_externally" });
    // Accepting the edit as a human revision makes it readable again.
    await engine.restore({ seriesId, file: "artifacts/series_plan.json" }, 0);
    const read = (await engine.readArtifact({ seriesId, file: "artifacts/series_plan.json" })) as { data: { title: string }; meta: { producedBy: string } };
    expect(read.data.title).toBe("Hacked");
    expect(read.meta.producedBy).toBe("human");
  });

  it("resumes after a restart from what is on disk", async () => {
    const first = await setup();
    const seriesId = await first.engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    await advance(first.engine, seriesId);
    await approveNext(first.engine, seriesId);

    // A fresh engine over the same folder, as after an app restart.
    const second = await setup({}, first.dir);
    await advance(second.engine, seriesId);
    expect((await second.engine.status(seriesId)).next).toMatchObject({ kind: "waiting", key: "bible" });
  });

  it("regenerates one shot with feedback and stales the preview", async () => {
    const { engine, ai } = await setup();
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    for (let gate = 0; gate < 4; gate += 1) {
      await advance(engine, seriesId);
      await approveNext(engine, seriesId); // plan, bible, script, sample
    }
    await advance(engine, seriesId); // → preview awaiting
    const job = await engine.waitForJob(await engine.regenerateShot({ seriesId, episodeId: "ep-01", shotId: "s02" }, "closer on Krishna"));
    expect(job.status).toBe("succeeded");
    expect(ai.requests.at(-1)!.prompt).toContain("closer on Krishna");
    const byKey = Object.fromEntries((await engine.status(seriesId)).stages.map((stage) => [stage.key, stage.status]));
    expect(byKey["ep-01/preview"]).toBe("stale");
  });

  it("fails the job with a clear error when the AI isn't logged in", async () => {
    const { dir } = await setup();
    const engine = createEngine({
      projectsDir: dir,
      ai: { id: "x", available: async () => ({ ok: false, reason: "not logged in" }), generate: async () => { throw new Error("unreachable"); } },
      render: new FakeRenderPort(),
      audio: new FakeAudio(),
    });
    const seriesId = await engine.createSeries({ idea: "Gita", language: "en", episodes: 1 });
    const job = await engine.waitForJob(await engine.runStage({ seriesId }));
    expect(job.error).toMatchObject({ code: "ai_unavailable" });
  });

  it("rejects unsafe input", async () => {
    const { engine } = await setup();
    await expect(engine.createSeries({ idea: "x", language: "../../etc", episodes: 1 })).rejects.toMatchObject({ code: "invalid_id" });
    await expect(engine.status("../outside")).rejects.toMatchObject({ code: "invalid_id" });
  });
});
