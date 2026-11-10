import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AiRequest } from "@moco/ai";
import { describe, expect, it } from "vitest";
import { blenderShot } from "../../spec/test/blender-fixture.ts";
import { createEngine } from "../src/index.ts";
import { advance, approveNext, sceneFor, section, setup } from "./helpers.ts";

function blenderFor(request: AiRequest) {
  const base = sceneFor(request.prompt);
  const brief = section<{ characters: string[] }>(request.prompt, "Shot brief");
  const scene = blenderShot(base.durationFrames).blender!;
  scene.cast = brief.characters;
  scene.objects = [...scene.objects, ...brief.characters.map(id => ({ ...scene.objects[0]!, id }))];
  return { ...base, actors: [], camera: [], blender: scene };
}

describe("Blender production through Moco", () => {
  it("pins renderer choice and completes all review gates with Blender scenes", async () => {
    const { engine, dir, ai, render, audio } = await setup({ blender: blenderFor });
    Object.assign(render, { sceneBackend: "blender" });
    try {
      const id = await engine.createSeries({ idea: "A Blender film", language: "en", episodes: 1 });
      expect((await engine.status(id)).series.renderer).toBe("blender");
      Object.assign(render, { sceneBackend: "remotion" }); // today's preference must not rewrite the project
      for (let round = 0; round < 9; round++) {
        await advance(engine,id);
        const next = (await engine.status(id)).next;
        if (next.kind === "finished") break;
        if (next.kind === "waiting") await approveNext(engine,id);
      }
      const status = await engine.status(id);
      expect(status.next.kind).toBe("finished");
      expect(status.stages.find(stage => stage.key === "ep-01/final")?.status).toBe("done");
      expect(ai.requests.some(req => req.system.includes("prompt: blender"))).toBe(true);
      expect(ai.requests.some(req => req.system.includes("prompt: world"))).toBe(false);
      const saved = JSON.parse(await readFile(join(dir,id,"episodes/ep-01/shots/s01/spec.json"),"utf8"));
      expect(saved.data.blender.version).toBe(1);
      expect(saved.data.world).toBeUndefined();
      // Saved series keep the choice when opened by another engine instance.
      const reopened = createEngine({ projectsDir: dir, ai, render, audio });
      expect((await reopened.status(id)).series.renderer).toBe("blender");
    } finally { await rm(dir,{recursive:true,force:true}); }
  }, 60_000);

  it("fails visibly after invalid Blender attempts instead of substituting a kit fallback", async () => {
    const { engine, dir, render } = await setup({ blender: request => sceneFor(request.prompt) });
    Object.assign(render, { sceneBackend: "blender" });
    try {
      const id = await engine.createSeries({ idea: "A Blender film", language: "en", episodes: 1 });
      for (let i = 0; i < 3; i++) { await advance(engine,id); await approveNext(engine,id); }
      const job = await engine.waitForJob(await engine.runStage({seriesId:id}));
      expect(job.status).toBe("failed");
      expect(job.error?.message).toContain("Blender shot s01 failed");
      expect((await engine.status(id)).decisions.some(decision => decision.category === "fallback")).toBe(false);
    } finally { await rm(dir,{recursive:true,force:true}); }
  });
});
